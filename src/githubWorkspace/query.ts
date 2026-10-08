import {LIMITS} from './model.js';

/**
 * GitHub issue/PR search queries are passed through, not reinterpreted.
 * NMSh only (1) validates obvious local problems, (2) scopes a query to the
 * PR or Issue view when the user did not say which, and (3) honestly reports
 * qualifiers GitHub will not recognise. GitHub's search API stays the
 * authority for what a query means.
 */

export type QueryScope = 'pr' | 'issue' | 'all';

/** Qualifiers documented for GitHub issue & pull request search. */
const KNOWN_QUALIFIERS = new Set([
  'is', 'type', 'in', 'author', 'assignee', 'mentions', 'commenter', 'involves', 'team', 'team-review-requested',
  'review-requested', 'user-review-requested', 'reviewed-by', 'review', 'state', 'reason', 'label', 'milestone', 'project',
  'repo', 'org', 'user', 'head', 'base', 'status', 'sha', 'language', 'comments', 'interactions', 'reactions', 'draft',
  'linked', 'created', 'updated', 'closed', 'merged', 'no', 'archived', 'sort', 'has', 'parent-issue', 'sub-issue', 'app',
]);

export interface QueryNotice {
  level: 'info' | 'warning';
  message: string;
}

export interface PreparedQuery {
  /** Exactly what the user typed (trimmed). */
  original: string;
  /** Exactly what is sent to GitHub. */
  effective: string;
  scope: QueryScope;
  notices: QueryNotice[];
}

export type QueryValidation = {ok: true; query: PreparedQuery} | {ok: false; error: string};

interface Token { text: string; qualifier?: string; value?: string; negated: boolean }

/** Splits on whitespace outside double quotes. Returns undefined for an unbalanced quote. */
export function tokenizeQuery(input: string): Token[] | undefined {
  const tokens: Token[] = [];
  let current = '';
  let quoted = false;
  for (const character of input) {
    if (character === '"') quoted = !quoted;
    if (!quoted && /\s/u.test(character)) {
      if (current) tokens.push(token(current));
      current = '';
    } else current += character;
  }
  if (quoted) return undefined;
  if (current) tokens.push(token(current));
  return tokens;
}

function token(text: string): Token {
  const negated = text.startsWith('-') && text.length > 1;
  const body = negated ? text.slice(1) : text;
  const match = /^([A-Za-z][A-Za-z-]*):(.+)$/u.exec(body);
  return match ? {text, qualifier: match[1].toLowerCase(), value: match[2], negated} : {text, negated};
}

function kindOf(tokens: readonly Token[]): {pr: boolean; issue: boolean} {
  let pr = false, issue = false;
  for (const t of tokens) {
    if ((t.qualifier !== 'is' && t.qualifier !== 'type') || t.negated) continue;
    const value = t.value?.toLowerCase();
    if (value === 'pr' || value === 'pull-request') pr = true;
    if (value === 'issue') issue = true;
  }
  return {pr, issue};
}

export function prepareQuery(raw: string, scope: QueryScope): QueryValidation {
  const original = raw.trim();
  if (!original) return {ok: false, error: 'Enter a GitHub search query, for example: is:pr is:open author:@me'};
  if (original.length > LIMITS.queryLength) return {ok: false, error: `GitHub search queries are limited to ${LIMITS.queryLength} characters`};
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(original)) return {ok: false, error: 'Query contains control characters'};
  const tokens = tokenizeQuery(original);
  if (!tokens) return {ok: false, error: 'Unbalanced double quote in query'};
  const operators = tokens.filter(t => t.text === 'AND' || t.text === 'OR' || t.text === 'NOT').length;
  if (operators > 5) return {ok: false, error: 'GitHub search allows at most five AND, OR or NOT operators'};

  const notices: QueryNotice[] = [];
  for (const t of tokens) {
    if (t.qualifier && !KNOWN_QUALIFIERS.has(t.qualifier)) {
      notices.push({level: 'warning', message: `"${t.qualifier}:" is not a documented GitHub search qualifier; GitHub may treat it as plain text`});
    }
  }

  const kind = kindOf(tokens);
  let effective = original;
  if (scope === 'pr') {
    if (kind.issue && !kind.pr) return {ok: false, error: 'This query asks for issues; switch to the Issues view or remove is:issue'};
    if (!kind.pr) { effective = `${original} is:pr`; notices.push({level: 'info', message: 'Scoped to pull requests (added is:pr)'}); }
  } else if (scope === 'issue') {
    if (kind.pr && !kind.issue) return {ok: false, error: 'This query asks for pull requests; switch to the PRs view or remove is:pr'};
    if (!kind.issue) { effective = `${original} is:issue`; notices.push({level: 'info', message: 'Scoped to issues (added is:issue)'}); }
  }
  if (effective.length > LIMITS.queryLength) return {ok: false, error: `Query too long after scoping (${LIMITS.queryLength} characters)`};
  return {ok: true, query: {original, effective, scope, notices}};
}

/** Bounded, de-duplicated most-recent-first search history. */
export function rememberQuery(history: readonly string[], query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [...history];
  return [trimmed, ...history.filter(entry => entry !== trimmed)].slice(0, LIMITS.searchHistory);
}
