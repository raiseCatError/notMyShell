import type {WrappedRow} from './viewport.js';

/**
 * Transcript FIND and FILTER over NMSh-owned transcript data.
 *
 * Both are presentation-only: FIND highlights and scrolls, FILTER hides
 * non-matching output lines of one command block while active. Neither ever
 * rewrites stored lines, completed records, journals or /copy payloads.
 *
 * Both work on LOGICAL lines (every wrapped row of a line together), so the
 * terminal width never changes whether something matches. Several clauses
 * combine with AND: a line matches only when every clause matches it.
 *
 * Scopes are explicit so search can grow (current block, current transcript,
 * NMSh history today; archived sessions are a documented future scope). This
 * is not a filesystem or project search: that belongs to the editor/host.
 */

export interface MatchOptions {
  regex: boolean;
  caseSensitive: boolean;
}

export interface Span { start: number; end: number }

export type CompiledQuery = {ok: true; test: (text: string) => Span[]} | {ok: false; error: string};

const MAX_MATCHES_PER_LINE = 64;

/** Compile once per query change; a bad regex is reported, never thrown at render time. */
export function compileQuery(query: string, options: MatchOptions): CompiledQuery {
  if (!query) return {ok: true, test: () => []};
  if (options.regex) {
    let pattern: RegExp;
    try { pattern = new RegExp(query, options.caseSensitive ? 'gu' : 'giu'); } catch (error) {
      return {ok: false, error: error instanceof Error ? error.message.replace(/^Invalid regular expression: /u, '') : 'invalid regular expression'};
    }
    return {ok: true, test: text => {
      const spans: Span[] = [];
      pattern.lastIndex = 0;
      for (let match = pattern.exec(text); match && spans.length < MAX_MATCHES_PER_LINE; match = pattern.exec(text)) {
        if (match[0].length === 0) { pattern.lastIndex += 1; continue; } // empty matches never count
        spans.push({start: match.index, end: match.index + match[0].length});
      }
      return spans;
    }};
  }
  const needle = options.caseSensitive ? query : query.toLocaleLowerCase();
  return {ok: true, test: text => {
    const haystack = options.caseSensitive ? text : text.toLocaleLowerCase();
    // Case folding may change length (rare); then only exact-length matches are safe to map.
    if (haystack.length !== text.length) return haystack.includes(needle) ? [{start: 0, end: text.length}] : [];
    const spans: Span[] = [];
    for (let found = haystack.indexOf(needle); found !== -1 && spans.length < MAX_MATCHES_PER_LINE; found = haystack.indexOf(needle, found + needle.length)) {
      spans.push({start: found, end: found + needle.length});
    }
    return spans;
  }};
}

// ------------------------------------------------------------------ logical lines

export interface LogicalLine {
  /** Presented row indexes, top to bottom. */
  rows: number[];
  /** Concatenated plain text of those rows. */
  text: string;
  /** Start offset of each row inside `text`. */
  offsets: number[];
}

/**
 * Group presented rows into logical lines: rows sharing a lineIndex are one
 * line; rows without one (synthetic chrome) stand alone. Filter hints are skipped.
 */
export function logicalLines(rows: readonly WrappedRow[], include: (row: WrappedRow) => boolean = () => true): LogicalLine[] {
  const lines: LogicalLine[] = [];
  let current: LogicalLine | undefined;
  let currentIndex: number | undefined;
  rows.forEach((row, index) => {
    if (row.isFilterHint || !include(row)) { current = undefined; currentIndex = undefined; return; }
    if (current && row.lineIndex !== undefined && row.lineIndex === currentIndex) {
      current.offsets.push(current.text.length);
      current.rows.push(index);
      current.text += row.plain;
      return;
    }
    current = {rows: [index], text: row.plain, offsets: [0]};
    currentIndex = row.lineIndex;
    lines.push(current);
  });
  return lines;
}

/** Map spans in a logical line back onto its rows. */
export function spansByRow(line: LogicalLine, spans: readonly Span[]): Map<number, Span[]> {
  const result = new Map<number, Span[]>();
  line.rows.forEach((row, position) => {
    const start = line.offsets[position]!;
    const end = position + 1 < line.offsets.length ? line.offsets[position + 1]! : line.text.length;
    for (const span of spans) {
      const from = Math.max(span.start, start);
      const to = Math.min(span.end, end);
      if (from < to) result.set(row, [...(result.get(row) ?? []), {start: from - start, end: to - start}]);
    }
  });
  return result;
}

// ------------------------------------------------------------------ find

export type SearchScopeId = 'block' | 'transcript';

export interface FindClause {
  query: string;
  options: MatchOptions;
}

/** One matching logical line: every clause matched it. */
export interface FindResult {
  /** First presented row of the line (navigation target). */
  row: number;
  /** Every clause's spans on that line, per presented row. */
  spans: Map<number, Span[]>;
}

export const MAX_RESULTS = 10_000;

/** Lines where every clause has at least one match, top to bottom; bounded. */
export function findResults(rows: readonly WrappedRow[], clauses: readonly FindClause[], scope: SearchScopeId = 'transcript', blockStartId?: number):
  {results: FindResult[]; error?: string} {
  const active = clauses.filter(clause => clause.query);
  if (!active.length) return {results: []};
  const compiled = active.map(clause => compileQuery(clause.query, clause.options));
  const failed = compiled.find((item): item is {ok: false; error: string} => !item.ok);
  if (failed) return {results: [], error: failed.error};
  const tests = compiled as Array<{ok: true; test: (text: string) => Span[]}>;
  const results: FindResult[] = [];
  for (const line of logicalLines(rows, row => scope !== 'block' || row.blockStartId === blockStartId)) {
    const spans: Span[] = [];
    let all = true;
    for (const compiledClause of tests) {
      const found = compiledClause.test(line.text);
      if (!found.length) { all = false; break; }
      spans.push(...found);
    }
    if (!all) continue;
    results.push({row: line.rows[0]!, spans: spansByRow(line, spans)});
    if (results.length >= MAX_RESULTS) break;
  }
  return {results};
}

export interface FindState {
  /** Applied clauses (AND). */
  clauses: FindClause[];
  /** The clause being typed, while the find editor is open. */
  editing?: FindClause;
  scope: SearchScopeId;
  blockStartId?: number;
  /** Index into `results` of the active result. */
  active: number;
  results: FindResult[];
  error?: string;
  computedFor?: string;
}

export function createFind(scope: SearchScopeId = 'transcript', blockStartId?: number): FindState {
  return {clauses: [], scope, ...(blockStartId === undefined ? {} : {blockStartId}), active: -1, results: []};
}

/** Applied clauses plus the one being typed. */
export function effectiveClauses(state: FindState): FindClause[] {
  return state.editing?.query ? [...state.clauses, state.editing] : [...state.clauses];
}

const clauseKey = (clauses: readonly FindClause[]) => clauses.map(clause => `${clause.options.regex ? 'r' : ''}${clause.options.caseSensitive ? 'c' : ''}:${clause.query}`).join('\u0000');

/**
 * Recompute only when the rows' generation key or the clauses changed (never
 * once per frame); the newest result becomes active when the query changes.
 */
export function refreshFind(state: FindState, rows: readonly WrappedRow[], generation: string): void {
  const clauses = effectiveClauses(state);
  const key = `${generation}\u0001${state.scope}:${state.blockStartId ?? ''}\u0001${clauseKey(clauses)}`;
  if (state.computedFor === key) return;
  const queryChanged = !state.computedFor || state.computedFor.split('\u0001')[2] !== clauseKey(clauses) || state.computedFor.split('\u0001')[1] !== `${state.scope}:${state.blockStartId ?? ''}`;
  const previous = state.results[state.active];
  const {results, error} = findResults(rows, clauses, state.scope, state.blockStartId);
  state.results = results;
  state.error = error;
  if (!results.length) state.active = -1;
  else if (queryChanged || !previous) state.active = results.length - 1;
  else {
    const same = results.findIndex(result => result.row === previous.row);
    state.active = same === -1 ? Math.min(Math.max(0, state.active), results.length - 1) : same;
  }
  state.computedFor = key;
}

/** Next = older (up the transcript, like a terminal's search back); wraps around. */
export function stepFind(state: FindState, direction: 'next' | 'previous'): FindResult | undefined {
  if (!state.results.length) return undefined;
  const count = state.results.length;
  state.active = direction === 'next' ? (state.active - 1 + count) % count : (state.active + 1) % count;
  return state.results[state.active];
}

export function findCount(state: FindState): string {
  if (state.error) return `invalid regex: ${state.error}`;
  if (!effectiveClauses(state).length) return 'type to search';
  if (!state.results.length) return 'no matches';
  return `${state.active + 1}/${state.results.length}${state.results.length >= MAX_RESULTS ? '+' : ''}`;
}

/** Viewport start that shows `row` about a third from the top. */
export function revealStart(row: number, totalRows: number, height: number): number {
  const maximum = Math.max(0, totalRows - height);
  return Math.max(0, Math.min(maximum, row - Math.floor(height / 3)));
}

// ------------------------------------------------------------------ filter

export interface FilterClause {
  query: string;
  options: MatchOptions;
  invert: boolean;
  /** Lines of context kept around kept lines (0..20); the set uses the largest. */
  context: number;
}

export interface OutputFilter {
  /** The command block being filtered; never moved implicitly. */
  startId: number;
  clauses: FilterClause[];
}

export interface FilterResult {
  rows: WrappedRow[];
  /** Output lines of the block kept / total. */
  kept: number;
  total: number;
  error?: string;
}

/**
 * Presentation filter for one block. A line is kept when every clause is
 * satisfied (a clause is satisfied when it matches, or when it does not match
 * for an inverted clause). Header rows, non-output rows and other blocks stay
 * exactly as they are; a hint row says a filter is active.
 */
export function applyOutputFilter(rows: readonly WrappedRow[], filter: OutputFilter, isOutputLine: (lineIndex: number) => boolean): FilterResult {
  const compiled = filter.clauses.map(clause => ({clause, compiled: compileQuery(clause.query, clause.options)}));
  const failed = compiled.find(item => !item.compiled.ok);
  if (failed && !failed.compiled.ok) return {rows: [...rows], kept: 0, total: 0, error: failed.compiled.error};
  const lineText = new Map<number, string>();
  for (const row of rows) {
    if (row.blockStartId !== filter.startId || row.lineIndex === undefined || row.lineIndex === filter.startId || !isOutputLine(row.lineIndex)) continue;
    lineText.set(row.lineIndex, (lineText.get(row.lineIndex) ?? '') + row.plain);
  }
  const lines = [...lineText.keys()];
  const context = Math.max(0, Math.min(20, ...filter.clauses.map(clause => clause.context)));
  const keep = new Set<number>();
  lines.forEach((line, position) => {
    const text = lineText.get(line)!;
    const satisfied = compiled.every(({clause, compiled: query}) => query.ok && (query.test(text).length > 0) !== clause.invert);
    if (!satisfied) return;
    for (let offset = -context; offset <= context; offset += 1) {
      const neighbour = lines[position + offset];
      if (neighbour !== undefined) keep.add(neighbour);
    }
  });
  const result: WrappedRow[] = [];
  let hintPlaced = false;
  for (const row of rows) {
    const filtered = row.blockStartId === filter.startId && row.lineIndex !== undefined && lineText.has(row.lineIndex);
    if (filtered && !keep.has(row.lineIndex!)) continue;
    if (filtered && !hintPlaced) {
      result.push(filterHintRow(filter, keep.size, lines.length));
      hintPlaced = true;
    }
    result.push(row);
  }
  if (!hintPlaced && lines.length > 0) {
    // Nothing kept: the hint goes where the output was, after the block's header.
    const header = result.findIndex(row => row.blockStartId === filter.startId && row.lineIndex === filter.startId);
    result.splice(header === -1 ? result.length : header + 1, 0, filterHintRow(filter, 0, lines.length));
  }
  return {rows: result, kept: keep.size, total: lines.length};
}

/** A compact label for one clause: `FAIL`, `!PASS`, `/disk|vol/`, with c for case-sensitive. */
export function clauseLabel(clause: {query: string; options: MatchOptions; invert?: boolean}): string {
  const body = clause.options.regex ? `/${clause.query}/` : clause.query;
  return `${clause.invert ? '!' : ''}${body}${clause.options.caseSensitive ? ' (c)' : ''}`;
}

function filterHintRow(filter: OutputFilter, kept: number, total: number): WrappedRow {
  const context = Math.max(0, ...filter.clauses.map(clause => clause.context));
  const terms = filter.clauses.map(clause => `“${clauseLabel(clause)}”`).join(' ∧ ');
  const plain = `  ⧩ filter ${terms}${context ? ` (±${context})` : ''} · ${kept} of ${total} lines · /filter clear`;
  return {ansi: `\u001b[2m${plain}\u001b[0m`, plain, blockStartId: filter.startId, isFilterHint: true};
}

/** Parse `/filter` and `/find` flags: -r regex, -c case-sensitive, -v invert, -C N context, -b block. */
export function parseSearchArguments(text: string): {query: string; options: MatchOptions; invert: boolean; context: number; block: boolean} {
  const options: MatchOptions = {regex: false, caseSensitive: false};
  let invert = false;
  let context = 0;
  let block = false;
  const words = text.trim().length ? text.trim().split(/(\s+)/u) : [];
  let index = 0;
  for (; index < words.length; index += 1) {
    const word = words[index]!;
    if (/^\s+$/u.test(word)) continue;
    if (word === '-r') options.regex = true;
    else if (word === '-c') options.caseSensitive = true;
    else if (word === '-v') invert = true;
    else if (word === '-b') block = true;
    else if (word === '-C' && /^\d{1,2}$/u.test(words[index + 2] ?? '')) { context = Number(words[index + 2]); index += 2; }
    else if (word === '--') { index += 2; break; }
    else break;
  }
  const raw = words.slice(index).join('').trim();
  // One pair of surrounding quotes is the user's quoting, not part of the term.
  const query = /^(["']).*\1$/u.test(raw) && raw.length > 1 ? raw.slice(1, -1) : raw;
  return {query, options, invert, context: Math.min(20, context), block};
}

/** `/find clear`, `/find remove N`, or a clause to add. */
export type SearchCommand = {kind: 'clear'} | {kind: 'remove'; index: number} | {kind: 'open'} | {kind: 'add'; parsed: ReturnType<typeof parseSearchArguments>};

export function parseSearchCommand(text: string): SearchCommand {
  const trimmed = text.trim();
  if (!trimmed) return {kind: 'open'};
  if (trimmed === 'clear') return {kind: 'clear'};
  const remove = /^remove\s+(\d{1,3})$/u.exec(trimmed);
  if (remove) return {kind: 'remove', index: Number(remove[1])};
  return {kind: 'add', parsed: parseSearchArguments(trimmed)};
}
