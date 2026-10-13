import stringWidth from 'string-width';
import type {ColorLevel} from '../presentation/capabilities.js';
import {displayWidth, padCells, truncateAnsi, truncateText} from '../util/text.js';
import {
  type GithubWorkspaceController, type DetailState, ISSUE_TABS, LIST_TAB_LABELS, LIST_TABS, type ListState, PR_TABS, type WorkspaceState,
} from './controller.js';
import {compactSummary, type DiffFile, fileLabel} from './diff.js';
import {
  type CheckItem, type ChecksRollup, type CommentItem, errorKindLabel, type GithubError, type IssueSummary, type Mergeability,
  type PrDetail, type PrSummary, type SearchItem,
} from './model.js';
import {MERGE_METHOD_LABELS, type MergePlan} from './mergePlan.js';

/**
 * Pure renderer for the GitHub workspace. Input: a state snapshot plus
 * terminal facts. Output: exactly `rows` lines, each at most `columns`
 * display cells. No I/O, no clock reads, no subprocesses: everything time-
 * dependent comes from `now`. All remote text was sanitized at the model
 * boundary; the renderer only measures, truncates and styles it.
 *
 * Focus and selection never depend on color: the focused region is named in
 * the header, the selected row carries a marker, and the active tab is
 * bracketed.
 */

export interface RenderOptions {
  columns: number;
  rows: number;
  glyphs: 'nerd' | 'safe';
  color: ColorLevel;
  now: number;
  staleAfterMs?: number;
}

interface Glyphs { select: string; sep: string; arrow: string; back: string; pass: string; fail: string; pending: string; skip: string; rule: string }

function glyphSet(mode: RenderOptions['glyphs']): Glyphs {
  return mode === 'nerd'
    ? {select: '›', sep: ' · ', arrow: '→', back: '←', pass: '✔', fail: '✘', pending: '◷', skip: '–', rule: '─'}
    : {select: '>', sep: ' | ', arrow: '->', back: '<-', pass: '+', fail: 'x', pending: '~', skip: '-', rule: '-'};
}

interface Style { bold(t: string): string; dim(t: string): string; inverse(t: string): string; add(t: string): string; del(t: string): string; warn(t: string): string }

function styleSet(level: ColorLevel): Style {
  if (level === 'none') { const id = (t: string) => t; return {bold: id, dim: id, inverse: id, add: id, del: id, warn: id}; }
  const wrap = (open: string) => (t: string) => (t ? `\u001b[${open}m${t}\u001b[0m` : t);
  return {bold: wrap('1'), dim: wrap('2'), inverse: wrap('7'), add: wrap('32'), del: wrap('31'), warn: wrap('33')};
}

interface Ctx { o: RenderOptions; g: Glyphs; s: Style; width: number }

/** Fits one line to the terminal width (ANSI-aware). */
function fit(line: string, width: number): string {
  if (displayWidth(line) <= width) return line;
  // Plain text (NO_COLOR) must not gain an SGR reset from the ANSI-aware truncation.
  return line.includes('\u001b') ? truncateAnsi(line, width) : truncateText(line, width);
}

/** Word-wraps plain text to display cells; hard-breaks words wider than the line. */
export function wrapCells(text: string, width: number): string[] {
  if (width <= 0) return [];
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { out.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/(\s+)/u)) {
      if (!word) continue;
      if (stringWidth(line + word) <= width) { line += word; continue; }
      if (line.trim()) out.push(line.trimEnd());
      line = /^\s+$/u.test(word) ? '' : word;
      while (stringWidth(line) > width) {
        let head = '';
        for (const ch of line) { if (stringWidth(head + ch) > width) break; head += ch; }
        if (!head) head = Array.from(line)[0];
        out.push(head);
        line = line.slice(head.length);
      }
    }
    if (line.trim() || !out.length) out.push(line.trimEnd());
  }
  return out;
}

export function relativeTime(iso: string | undefined, now: number): string {
  if (!iso) return 'time unknown';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'time unknown';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

function agoMs(ms: number | undefined, now: number): string {
  return ms === undefined ? 'never' : relativeTime(new Date(ms).toISOString(), now);
}

export function checksLabel(rollup: ChecksRollup): string {
  switch (rollup) {
    case 'success': return 'checks passing';
    case 'failure': case 'error': return 'checks failing';
    case 'pending': case 'expected': return 'checks pending';
    case 'none': return 'no checks';
    case 'unknown': return 'checks unknown';
  }
}

export function mergeabilityLabel(value: Mergeability): string {
  switch (value) {
    case 'mergeable': return 'mergeable (no conflicts)';
    case 'conflicting': return 'conflicts';
    case 'unknown': return 'unknown (GitHub has not computed it)';
  }
}

function reviewLabel(pr: PrSummary): string | undefined {
  switch (pr.reviewDecision) {
    case 'approved': return 'approved';
    case 'changes_requested': return 'changes requested';
    case 'review_required': return 'review required';
    case 'none': return undefined;
    case 'unknown': return undefined;
  }
}

function prStateLabel(pr: PrSummary): string { return pr.draft && pr.state === 'open' ? 'draft' : pr.state; }

function itemStatus(item: SearchItem, compact: boolean, sep: string): string {
  if (item.ref.kind === 'pr') {
    const pr = item as PrSummary;
    const parts = [prStateLabel(pr)];
    if (pr.state === 'open') {
      parts.push(compact ? checksLabel(pr.checks).replace('checks ', '') : checksLabel(pr.checks));
      const review = reviewLabel(pr);
      if (review && !compact) parts.push(review);
      if (pr.mergeable === 'conflicting') parts.push('conflicts');
    }
    return parts.join(sep);
  }
  const issue = item as IssueSummary;
  const parts: string[] = [issue.state];
  if (!compact && issue.labels.length) parts.push(issue.labels.slice(0, 2).join(', '));
  return parts.join(sep);
}

function errorLine(error: GithubError): string {
  const hint = error.kind === 'auth' ? ' Run `gh auth login` in a shell, then R.'
    : error.kind === 'rate_limit' ? ' Wait for the limit to reset, then R.'
      : error.kind === 'network' || error.kind === 'timeout' ? ' Check the connection, then R.'
        : error.kind === 'unavailable' ? ' Install GitHub CLI (gh) to use live mode.' : '';
  return `${errorKindLabel(error.kind)}: ${error.message}.${hint}`.replace(/\.\./gu, '.');
}

function listStatus(list: ListState, ctx: Ctx, stale: number): string | undefined {
  const {s, o} = ctx;
  if (list.status === 'loading') return 'Loading from GitHub…';
  if (list.error && !list.items.length) return s.warn(errorKindLabel(list.error.kind));
  if (list.error) return s.warn(`Refresh failed; showing results from ${agoMs(list.fetchedAt, o.now)}. ${errorLine(list.error)}`);
  if (list.refreshing) return `Refreshing… showing results from ${agoMs(list.fetchedAt, o.now)}`;
  if (list.loadingMore) return 'Loading more…';
  if (list.status === 'idle') return list.draft.trim() ? 'Not loaded yet. Press R to run this query.' : 'Press / to enter a GitHub search query.';
  const parts: string[] = [];
  if (list.fetchedAt !== undefined && o.now - list.fetchedAt > stale) parts.push(s.warn(`STALE: fetched ${agoMs(list.fetchedAt, o.now)}, R to refresh`));
  if (list.selectionLost) parts.push('Previous selection is no longer in the results');
  if (list.warnings.length) parts.push(s.warn(`Partial results: ${list.warnings[0]}`));
  return parts.length ? parts.join(ctx.g.sep) : undefined;
}

function header(state: WorkspaceState, ctx: Ctx): string {
  const focusName = {list: 'list', query: 'search input', detail: 'detail', merge: 'merge preview'}[state.focus];
  const left = ctx.s.bold(`GitHub${ctx.g.sep}${state.title}`);
  const right = `[focus: ${focusName}]`;
  const space = ctx.width - displayWidth(left) - displayWidth(right);
  if (space >= 1) return `${left}${' '.repeat(space)}${right}`;
  return fit(`${right} ${left}`, ctx.width);
}

/** Tabs: active tab bracketed; collapses to `< Active n/m >` when the full strip does not fit. */
function tabStrip(labels: readonly string[], active: number, ctx: Ctx, focused: boolean): string {
  const full = labels.map((label, i) => (i === active ? ctx.s.bold(`[${label}]`) : ` ${label} `)).join(' ');
  if (displayWidth(full) <= ctx.width) return focused ? full : ctx.s.dim(full);
  return fit(`${ctx.g.back} ${ctx.s.bold(`[${labels[active]}]`)} ${active + 1}/${labels.length} ${ctx.g.arrow}`, ctx.width);
}

function multiRepo(items: readonly SearchItem[]): boolean {
  const first = items[0];
  return !!first && items.some(item => item.ref.owner !== first.ref.owner || item.ref.repo !== first.ref.repo);
}

function listRow(item: SearchItem, selected: boolean, showRepo: boolean, ctx: Ctx, idWidth: number): string {
  const {width, g, s} = ctx;
  const marker = selected ? `${g.select} ` : '  ';
  const id = `${showRepo ? `${item.ref.owner}/${item.ref.repo}` : ''}#${item.ref.number}`;
  const compact = width < 60;
  const status = itemStatus(item, compact, compact ? ' ' : g.sep);
  const idCell = padCells(id, Math.min(idWidth, Math.max(4, Math.floor(width / 3))));
  const fixed = displayWidth(marker) + displayWidth(idCell);
  const statusWidth = Math.min(displayWidth(status), Math.max(0, Math.floor((width - fixed) / 2)));
  const titleWidth = Math.max(0, width - fixed - statusWidth - (statusWidth ? 2 : 0));
  const title = padCells(truncateText(item.title, titleWidth), titleWidth, statusWidth ? 2 : 0);
  const row = `${marker}${idCell}${title}${truncateText(status, statusWidth)}`;
  return selected ? s.inverse(fit(row, width)) : fit(row, width);
}

function listBody(state: WorkspaceState, ctx: Ctx, height: number): string[] {
  const list = state.lists[state.tab];
  if (!list.items.length) {
    if (list.error) return wrapCells(errorLine(list.error), ctx.width);
    if (list.status === 'loaded' && !list.error) return [`No results for: ${list.query?.effective ?? ''}`, 'GitHub found nothing matching this query.'];
    return [];
  }
  const showRepo = multiRepo(list.items);
  const top = Math.max(0, Math.min(list.selectedIndex - Math.floor(height / 2), list.items.length - height));
  const visible = list.items.slice(top, top + height);
  const idWidth = Math.max(...visible.map(item => displayWidth(`${showRepo ? `${item.ref.owner}/${item.ref.repo}` : ''}#${item.ref.number}`)));
  return visible.map((item, i) => listRow(item, top + i === list.selectedIndex, showRepo, ctx, idWidth));
}

function listFooterInfo(list: ListState, ctx: Ctx): string {
  const shown = list.items.length;
  const total = list.total !== undefined ? ` of ${list.total}${list.total > 1000 ? ' (GitHub search navigates at most 1000)' : ''}` : '';
  const more = list.hasNextPage ? `${ctx.g.sep}N for more` : '';
  const rate = list.rateRemaining !== undefined ? `${ctx.g.sep}API ${list.rateRemaining} left` : '';
  return shown ? `${list.selectedIndex + 1}/${shown}${total}${more}${rate}` : '';
}

// ---------------------------------------------------------------------------------------------
// Detail bodies: logical lines (unwrapped) are wrapped to width here; scrolling slices them.

function kv(label: string, value: string): string { return `${label}: ${value}`; }

function checkCounts(checks: readonly CheckItem[]): string {
  let pass = 0, fail = 0, pending = 0, other = 0;
  for (const check of checks) {
    if (check.status !== 'completed') pending++;
    else if (check.conclusion === 'success') pass++;
    else if (check.conclusion === 'failure' || check.conclusion === 'error' || check.conclusion === 'timed_out' || check.conclusion === 'startup_failure' || check.conclusion === 'action_required' || check.conclusion === 'cancelled') fail++;
    else other++;
  }
  return `${pass} passed, ${fail} failed, ${pending} pending${other ? `, ${other} neutral/skipped` : ''} of ${checks.length}`;
}

function truncationNotes(detail: {truncation: Record<string, {shown: number; total?: number}>}): string[] {
  return Object.entries(detail.truncation).map(([name, t]) => `Showing ${t.shown} of ${t.total ?? 'more'} ${name} (bounded; open on GitHub for all).`);
}

function prOverview(pr: PrDetail, ctx: Ctx, stale: boolean): string[] {
  const {summary} = pr;
  const {g, o} = ctx;
  const lines = [
    `${summary.headRef ?? '(head unknown)'} ${g.arrow} ${summary.baseRef ?? '(base unknown)'}`,
    kv('Repository', `${pr.baseRepository}${pr.headRepository && pr.headRepository !== pr.baseRepository ? ` (head from ${pr.headRepository})` : ''}`),
    kv('Head SHA', pr.headSha ?? 'unknown'),
    kv('State', `${prStateLabel(summary)}${g.sep}author ${summary.author ?? 'unknown'}${g.sep}updated ${relativeTime(summary.updatedAt, o.now)}`),
    kv('Review', reviewLabel(summary) ?? (summary.reviewDecision === 'none' ? 'no review decision reported' : 'unknown')),
    kv('Checks', `${checksLabel(summary.checks)}${pr.checks.length ? ` (${checkCounts(pr.checks)})` : ''}`),
    kv('Mergeability', mergeabilityLabel(summary.mergeable)),
    kv('Merge state', pr.mergeStateStatus === 'unknown' ? 'unknown (not reported)' : pr.mergeStateStatus.replace('_', ' ')),
    kv('Changes', summary.additions === undefined ? 'unknown' : `+${summary.additions} -${summary.deletions ?? '?'} in ${summary.changedFiles ?? '?'} files`),
    kv('Data', `fetched from GitHub ${agoMs(pr.fetchedAt, o.now)}${stale ? ' (STALE, R to refresh)' : ''}`),
  ];
  for (const warning of pr.warnings ?? []) lines.push(`Partial data: ${warning}`);
  lines.push(...truncationNotes(pr));
  lines.push('');
  lines.push(...(pr.body ? pr.body.split('\n') : ['(no description)']));
  if (pr.bodyTruncated) lines.push('… description truncated by NMSh; open on GitHub for the full text.');
  return lines;
}

function checkSymbol(check: CheckItem, g: Glyphs): string {
  if (check.status !== 'completed') return g.pending;
  if (check.conclusion === 'success') return g.pass;
  if (check.conclusion === 'skipped' || check.conclusion === 'neutral') return g.skip;
  return g.fail;
}

function checksBody(pr: PrDetail, ctx: Ctx): string[] {
  if (!pr.checks.length) return [pr.summary.checks === 'none' ? 'GitHub reports no checks or statuses for the head commit.' : 'No individual checks were reported.'];
  const lines = [`${checksLabel(pr.summary.checks)}: ${checkCounts(pr.checks)}`, ''];
  for (const check of pr.checks) {
    const outcome = check.status === 'completed' ? (check.conclusion ?? 'unknown') : check.status.replace('_', ' ');
    const required = check.required === true ? ' (required)' : check.required === undefined ? ' (required: unknown)' : '';
    lines.push(`${checkSymbol(check, ctx.g)} ${check.name}  ${outcome}${required}${check.source === 'status' ? ' (status)' : ''}`);
  }
  lines.push(...truncationNotes({truncation: pr.truncation.checks ? {checks: pr.truncation.checks} : {}}));
  return lines;
}

function commentSourceLabel(comment: CommentItem): string {
  switch (comment.source) {
    case 'issue_comment': return 'Comment';
    case 'review': return `Review${comment.reviewState ? ` (${comment.reviewState.replace('_', ' ')})` : ''}`;
    case 'review_comment': return `Inline review comment${comment.path ? ` on ${comment.path}${comment.line ? `:${comment.line}` : ''}` : ''}`;
  }
}

function commentsBody(comments: readonly CommentItem[], ctx: Ctx, truncation: Record<string, {shown: number; total?: number}>): string[] {
  const visible = comments.filter(comment => comment.source !== 'review' || comment.body || comment.reviewState !== 'commented');
  if (!visible.length) return ['No comments.'];
  const lines: string[] = [];
  for (const comment of visible) {
    lines.push(ctx.s.bold(`${commentSourceLabel(comment)}${ctx.g.sep}${comment.author ?? 'unknown author'}${ctx.g.sep}${relativeTime(comment.createdAt, ctx.o.now)}`));
    for (const line of (comment.body || '(no text)').split('\n')) lines.push(`  ${line}`);
    if (comment.truncated) lines.push('  … truncated by NMSh');
    lines.push('');
  }
  lines.push(...truncationNotes({truncation}));
  return lines;
}

function commitsBody(pr: PrDetail, ctx: Ctx): string[] {
  if (!pr.commits.length) return ['No commits reported.'];
  const lines = pr.commits.map(commit => `${commit.shortSha}  ${commit.headline}${ctx.g.sep}${commit.author ?? 'unknown'}${ctx.g.sep}${relativeTime(commit.committedAt, ctx.o.now)}`);
  if (pr.truncation.commits) lines.push(`Showing the latest ${pr.truncation.commits.shown} of ${pr.truncation.commits.total ?? 'more'} commits.`);
  return lines;
}

const CHANGE_LETTER: Record<string, string> = {added: 'A', modified: 'M', removed: 'D', renamed: 'R', copied: 'C', changed: 'T', unknown: '?'};

function filesBody(detail: DetailState, pr: PrDetail, ctx: Ctx): string[] {
  const files = detail.diff.model?.files ?? pr.files.map(file => ({...file, availability: undefined}));
  if (!files.length) return ['No changed files reported.'];
  const lines = files.map((file, i) => {
    const marker = i === detail.fileIndex ? `${ctx.g.select} ` : '  ';
    const counts = `+${file.additions ?? '?'} -${file.deletions ?? '?'}`;
    const label = 'previousPath' in file && file.previousPath ? fileLabel(file as DiffFile) : file.path;
    const row = `${marker}${CHANGE_LETTER[file.changeType] ?? '?'} ${label}  ${counts}`;
    return i === detail.fileIndex ? ctx.s.inverse(row) : row;
  });
  if (pr.truncation.files) lines.push(`Showing ${pr.truncation.files.shown} of ${pr.truncation.files.total ?? 'more'} files.`);
  return lines;
}

function availabilityLabel(file: DiffFile): string {
  switch (file.availability) {
    case 'complete': return 'patch complete';
    case 'incomplete': return 'patch abbreviated by GitHub';
    case 'truncated': return 'patch truncated by NMSh';
    case 'omitted': return 'no patch from GitHub';
    case 'skipped': return 'not loaded (budget)';
  }
}

function diffBody(detail: DetailState, pr: PrDetail, ctx: Ctx): string[] {
  const {diff} = detail;
  const {g, s} = ctx;
  if (diff.status === 'loading' || diff.status === 'idle') return ['Loading diff from GitHub…'];
  if (diff.status === 'error' || !diff.model) return [s.warn(diff.error ? errorLine(diff.error) : 'Diff unavailable.')];
  const model = diff.model;
  const lines = [s.dim(`Remote GitHub PR diff${g.sep}${model.source.repository}#${model.source.number}`),
    s.dim(`${model.source.baseRef ?? '?'} ${g.back} ${model.source.headRef ?? '?'} @ ${model.source.headSha?.slice(0, 12) ?? 'unknown SHA'}`)];
  if (model.filesTruncated) lines.push(s.warn(`Only ${model.files.length} of ${model.reportedFileCount ?? 'more'} files loaded; the diff is NOT complete.`));
  if (pr.headSha && model.source.headSha && pr.headSha !== model.source.headSha) lines.push(s.warn('Head moved since this diff was fetched; R to refresh.'));
  lines.push('');
  if (diff.depth === 'compact') {
    lines.push(...compactSummary(model, 8));
    const incomplete = model.files.filter(file => file.availability !== 'complete');
    if (incomplete.length) lines.push('', `${incomplete.length} file(s) without a complete patch:`, ...incomplete.slice(0, 8).map(file => `  ${fileLabel(file)}: ${availabilityLabel(file)}`));
    return lines;
  }
  const file = model.files[Math.min(detail.fileIndex, model.files.length - 1)];
  if (!file) return [...lines, 'No changed files reported.'];
  lines.push(s.bold(`File ${detail.fileIndex + 1}/${model.files.length}: ${fileLabel(file)}`));
  lines.push(`${file.changeType}${g.sep}+${file.additions ?? '?'} -${file.deletions ?? '?'}${g.sep}${availabilityLabel(file)}`);
  if (file.note && file.availability !== 'complete') lines.push(s.warn(file.note));
  for (const hunk of file.hunks) {
    lines.push(s.dim(hunk.header));
    for (const line of hunk.lines) {
      const number = String(line.kind === 'del' ? line.oldLine ?? '' : line.newLine ?? '').padStart(5);
      if (line.kind === 'add') lines.push(s.add(`${number} + ${line.text}`));
      else if (line.kind === 'del') lines.push(s.del(`${number} - ${line.text}`));
      else if (line.kind === 'note') lines.push(s.dim(`      \\ ${line.text}`));
      else lines.push(`${number}   ${line.text}`);
    }
  }
  return lines;
}

function issueOverview(detail: DetailState, ctx: Ctx, stale: boolean): string[] {
  const issue = detail.issue!;
  const {summary} = issue;
  const {g, o} = ctx;
  const lines = [
    kv('State', `${summary.state}${g.sep}author ${summary.author ?? 'unknown'}`),
    kv('Labels', summary.labels.length ? summary.labels.join(', ') : 'none'),
    kv('Assignees', issue.assignees.length ? issue.assignees.join(', ') : 'none'),
    kv('Created', relativeTime(issue.createdAt, o.now)),
    kv('Updated', relativeTime(summary.updatedAt, o.now)),
    kv('Data', `fetched from GitHub ${agoMs(issue.fetchedAt, o.now)}${stale ? ' (STALE, R to refresh)' : ''}`),
  ];
  for (const warning of issue.warnings ?? []) lines.push(`Partial data: ${warning}`);
  lines.push(...truncationNotes(issue), '');
  lines.push(...(issue.body ? issue.body.split('\n') : ['(no description)']));
  if (issue.bodyTruncated) lines.push('… description truncated by NMSh; open on GitHub for the full text.');
  return lines;
}

function relatedBody(detail: DetailState, ctx: Ctx): string[] {
  const issue = detail.issue!;
  if (!issue.related.length) return ['GitHub reports no closing pull requests or cross-references for this issue.', 'NMSh does not infer relationships from titles or branch names.'];
  return [ctx.s.dim('Relationships reported by GitHub:'), '', ...issue.related.map(link =>
    `${link.kind === 'closing_pr' ? 'Closing PR' : 'Cross-reference'}  ${link.ref.owner}/${link.ref.repo}#${link.ref.number}  ${link.title}${link.state ? ` (${link.state})` : ''}`)];
}

function mergeBody(plan: MergePlan, ctx: Ctx): string[] {
  const {g, s} = ctx;
  const lines = [
    s.bold('Merge preview (planning only: merging is disabled in this phase)'),
    '',
    kv('Repository', plan.repository),
    kv('Pull request', `#${plan.number} ${plan.title}`),
    kv('Head SHA', plan.headSha ?? 'UNKNOWN (cannot be guarded)'),
    kv('Target', `${plan.headRef ?? '?'} ${g.arrow} ${plan.baseRef ?? '?'}`),
    kv('Method', `[${MERGE_METHOD_LABELS[plan.method]}]`),
  ];
  for (const method of ['merge', 'squash', 'rebase'] as const) {
    const support = plan.methods[method];
    const marker = method === plan.method ? `${g.select} ` : '  ';
    lines.push(`${marker}${MERGE_METHOD_LABELS[method]}: ${support === 'allowed' ? 'allowed by repository' : support === 'disabled_by_repository' ? 'disabled by repository' : 'unknown'}`);
  }
  lines.push(kv('Delete branch afterward', plan.deleteBranch.requested ? 'REQUESTED (separate destructive step)' : 'no')
    + (plan.deleteBranch.repositoryAutoDeletes === true ? ' (repository auto-deletes head branches)' : ''));
  lines.push(kv('Mergeability', mergeabilityLabel(plan.mergeable)));
  lines.push(kv('Merge state', plan.mergeStateStatus === 'unknown' ? 'unknown (not reported)' : plan.mergeStateStatus.replace('_', ' ')));
  lines.push(kv('Data as of', agoMs(plan.fetchedAt, ctx.o.now)));
  lines.push('');
  if (plan.conditions.length) {
    lines.push('Conditions reported by GitHub:');
    for (const condition of plan.conditions) {
      const tag = condition.severity === 'blocker' ? 'BLOCKED' : condition.severity === 'unknown' ? 'UNKNOWN' : 'WARNING';
      lines.push(s.warn(`  ${tag}: ${condition.message}`));
    }
  } else lines.push('No blocking conditions were reported. GitHub must still re-validate at merge time.');
  lines.push('');
  for (const warning of plan.warnings) lines.push(s.warn(`! ${warning}`));
  lines.push('', s.dim(plan.disabledReason));
  return lines;
}

/** Unwrapped logical lines for the current detail/merge body. Exported so the controller can clamp scrolling. */
export function detailLines(state: WorkspaceState, ctx: Ctx): string[] {
  const detail = state.detail;
  if (!detail) return [];
  if (state.focus === 'merge' && state.merge) return mergeBody(state.merge.plan, ctx);
  if (detail.status === 'loading') return ['Loading from GitHub…'];
  if (detail.status === 'error' && detail.error) return [ctx.s.warn(errorLine(detail.error))];
  const stale = detail.pr || detail.issue ? ctx.o.now - (detail.pr?.fetchedAt ?? detail.issue!.fetchedAt) > (ctx.o.staleAfterMs ?? 120_000) : false;
  const prefix: string[] = [];
  if (detail.refreshing) prefix.push('Refreshing from GitHub…');
  if (detail.error) prefix.push(ctx.s.warn(`Refresh failed; showing earlier data. ${errorLine(detail.error)}`));
  if (detail.pr) {
    const pr = detail.pr;
    switch (detail.tab) {
      case 'overview': return [...prefix, ...prOverview(pr, ctx, stale)];
      case 'diff': return [...prefix, ...diffBody(detail, pr, ctx)];
      case 'checks': return [...prefix, ...checksBody(pr, ctx)];
      case 'comments': return [...prefix, ...commentsBody(pr.comments, ctx, Object.fromEntries(Object.entries(pr.truncation).filter(([k]) => k.includes('comment') || k === 'reviews')))];
      case 'commits': return [...prefix, ...commitsBody(pr, ctx)];
      case 'files': return [...prefix, ...filesBody(detail, pr, ctx)];
      default: return prefix;
    }
  }
  if (detail.issue) {
    switch (detail.tab) {
      case 'overview': return [...prefix, ...issueOverview(detail, ctx, stale)];
      case 'comments': return [...prefix, ...commentsBody(detail.issue.comments, ctx, detail.issue.truncation.comments ? {comments: detail.issue.truncation.comments} : {})];
      case 'related': return [...prefix, ...relatedBody(detail, ctx)];
      default: return prefix;
    }
  }
  return prefix;
}

/** Wraps logical lines to the width. Styled lines (with SGR) are truncated rather than wrapped. */
function wrapAll(lines: readonly string[], width: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.includes('\u001b[')) out.push(fit(line, width));
    else out.push(...wrapCells(line, width));
  }
  return out;
}

function makeCtx(options: RenderOptions): Ctx {
  return {o: options, g: glyphSet(options.glyphs), s: styleSet(options.color), width: Math.max(1, options.columns)};
}

/** Number of wrapped body lines; lets the controller clamp scrolling without rendering. */
export function bodyLineCount(state: WorkspaceState, options: RenderOptions): number {
  const ctx = makeCtx(options);
  return wrapAll(detailLines(state, ctx), ctx.width).length;
}

/** Footer help from the controller's available actions: labelled when it fits, keys-only when narrow. */
function helpLine(actions: ReadonlyArray<{key: string; label: string}>, ctx: Ctx): string {
  const join = (items: readonly string[], separator: string) => {
    let out = '';
    for (const item of items) {
      const next = out ? `${out}${separator}${item}` : item;
      if (displayWidth(next) > ctx.width) break;
      out = next;
    }
    return out;
  };
  const labelled = actions.map(action => `${action.key} ${action.label}`);
  const full = join(labelled, '  ');
  if (full.length === labelled.join('  ').length) return ctx.s.dim(full);
  // Narrow: every available key stays visible, in a compact spelling.
  const short = (key: string) => key === 'Up/Down' ? (ctx.o.glyphs === 'nerd' ? '↑↓' : '^v') : key === 'PgUp/PgDn' ? 'Pg' : key;
  const keys = actions.map(action => short(action.key));
  const withLabel = [labelled[0], ...keys.slice(1)].join(' ');
  return ctx.s.dim(displayWidth(withLabel) <= ctx.width ? withLabel : join(keys, ' '));
}

export function renderWorkspace(state: WorkspaceState, actions: ReadonlyArray<{key: string; label: string}>, options: RenderOptions): string[] {
  const ctx = makeCtx(options);
  const {width, g, s} = ctx;
  const rows = Math.max(1, options.rows);
  const stale = options.staleAfterMs ?? 120_000;
  const top: string[] = [header(state, ctx)];
  const bottom: string[] = [];
  let body: string[];
  const inDetail = (state.focus === 'detail' || state.focus === 'merge' || (state.focus === 'query' && state.queryReturn === 'detail')) && state.detail;

  if (inDetail && state.detail) {
    const detail = state.detail;
    const summary = detail.pr?.summary ?? detail.issue?.summary;
    const kindLabel = detail.ref.kind === 'pr' ? 'PR' : 'Issue';
    top.push(fit(s.bold(`${kindLabel} #${detail.ref.number}${summary ? `${g.sep}${summary.title}` : ''}`), width));
    const tabs = detail.ref.kind === 'pr' ? PR_TABS : ISSUE_TABS;
    const labels = tabs.map(tab => tab[0].toUpperCase() + tab.slice(1));
    top.push(state.focus === 'merge' ? fit(s.dim(`${detail.ref.owner}/${detail.ref.repo}${g.sep}merge preview`), width)
      : tabStrip(labels, Math.max(0, tabs.indexOf(detail.tab as never)), ctx, state.focus === 'detail'));
    top.push(s.dim(g.rule.repeat(width)));
    const wrapped = wrapAll(detailLines(state, ctx), width);
    const height = Math.max(0, rows - top.length - 2);
    const maxScroll = Math.max(0, wrapped.length - height);
    const scroll = Math.min(detail.scroll, maxScroll);
    body = wrapped.slice(scroll, scroll + height);
    const position = wrapped.length > height ? `lines ${scroll + 1}-${Math.min(wrapped.length, scroll + height)} of ${wrapped.length}` : '';
    bottom.push(fit(state.message ? s.warn(state.message) : s.dim(position), width));
  } else {
    const list = state.lists[state.tab];
    top.push(tabStrip(LIST_TABS.map(tab => LIST_TAB_LABELS[tab]), LIST_TABS.indexOf(state.tab), ctx, state.focus === 'list'));
    if (state.focus === 'query') top.push(fit(s.bold(`Search ${g.select} ${list.draft}_`), width));
    else top.push(fit(list.query ? `/ ${list.query.effective}` : s.dim(`/ ${list.draft || '(no query)'}`), width));
    const notice = state.focus === 'query' ? undefined : listStatus(list, ctx, stale);
    const queryNotice = list.notices.find(n => n.level === 'warning') ?? list.notices[0];
    top.push(fit(notice ?? (queryNotice ? s.dim(queryNotice.message) : s.dim(g.rule.repeat(width))), width));
    const height = Math.max(0, rows - top.length - 2);
    body = listBody(state, ctx, height);
    bottom.push(fit(state.message ? s.warn(state.message) : s.dim(listFooterInfo(list, ctx)), width));
  }
  bottom.push(helpLine(actions, ctx));

  const height = Math.max(0, rows - top.length - bottom.length);
  const lines = [...top, ...body.slice(0, height)];
  while (lines.length < rows - bottom.length) lines.push('');
  lines.push(...bottom);
  // Very small terminals: keep the header and help, drop the middle.
  const result = lines.length > rows ? [...lines.slice(0, Math.max(0, rows - 1)), lines[lines.length - 1]].slice(0, rows) : lines;
  return result.map(line => fit(line, width));
}

/** Convenience: wires the controller's scroll clamp to this renderer's line count. */
export function attachRenderer(controller: GithubWorkspaceController, options: () => RenderOptions): void {
  controller.bodyLineCount = state => bodyLineCount(state, options());
}
