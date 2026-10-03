import type {WrappedRow} from './viewport.js';

/**
 * Transcript FIND and FILTER over NMSh-owned transcript data.
 *
 * Both are presentation-only: FIND highlights and scrolls, FILTER hides
 * non-matching output lines of one command block while active. Neither ever
 * rewrites stored lines, completed records, journals or /copy payloads.
 *
 * Scopes are explicit so search can grow (current block, current transcript,
 * NMSh history today; archived sessions are a documented future scope). This
 * is not a filesystem or project search: that belongs to the editor/host.
 */

export interface MatchOptions {
  regex: boolean;
  caseSensitive: boolean;
}

export type CompiledQuery = {ok: true; test: (text: string) => Array<{start: number; end: number}>} | {ok: false; error: string};

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
      const spans: Array<{start: number; end: number}> = [];
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
    const spans: Array<{start: number; end: number}> = [];
    for (let found = haystack.indexOf(needle); found !== -1 && spans.length < MAX_MATCHES_PER_LINE; found = haystack.indexOf(needle, found + needle.length)) {
      spans.push({start: found, end: found + needle.length});
    }
    return spans;
  }};
}

export type SearchScopeId = 'block' | 'transcript';

export interface TranscriptMatch {
  /** Index into the presented (wrapped) rows. */
  row: number;
  start: number;
  end: number;
}

export const MAX_MATCHES = 10_000;

/** All matches in presented rows, top to bottom; bounded. Rows outside the scope are skipped. */
export function findInRows(rows: readonly WrappedRow[], compiled: CompiledQuery, scope: SearchScopeId, blockStartId?: number): TranscriptMatch[] {
  if (!compiled.ok) return [];
  const matches: TranscriptMatch[] = [];
  for (let row = 0; row < rows.length && matches.length < MAX_MATCHES; row += 1) {
    const item = rows[row]!;
    if (item.isFilterHint) continue;
    if (scope === 'block' && item.blockStartId !== blockStartId) continue;
    for (const span of compiled.test(item.plain)) matches.push({row, ...span});
  }
  return matches;
}

export interface FindState {
  query: string;
  options: MatchOptions;
  scope: SearchScopeId;
  blockStartId?: number;
  /** Index into `matches` of the active match. */
  active: number;
  matches: TranscriptMatch[];
  error?: string;
  /** Rows identity the matches were computed against, to avoid re-scanning every frame. */
  computedFor?: {rows: string; query: string; regex: boolean; caseSensitive: boolean; scope: SearchScopeId; block?: number};
}

export function createFind(query = '', options: MatchOptions = {regex: false, caseSensitive: false}, scope: SearchScopeId = 'transcript', blockStartId?: number): FindState {
  return {query, options, scope, ...(blockStartId === undefined ? {} : {blockStartId}), active: -1, matches: []};
}

/**
 * Recompute only when the rows' generation key or the query changed (never
 * once per frame); the newest match becomes active the first time.
 */
export function refreshFind(state: FindState, rows: readonly WrappedRow[], generation: string): void {
  const key = state.computedFor;
  if (key && key.rows === generation && key.query === state.query && key.regex === state.options.regex && key.caseSensitive === state.options.caseSensitive
    && key.scope === state.scope && key.block === state.blockStartId) return;
  const previous = state.matches[state.active];
  const compiled = compileQuery(state.query, state.options);
  state.error = compiled.ok ? undefined : compiled.error;
  state.matches = findInRows(rows, compiled, state.scope, state.blockStartId);
  const queryChanged = !key || key.query !== state.query || key.regex !== state.options.regex || key.caseSensitive !== state.options.caseSensitive;
  if (state.matches.length === 0) state.active = -1;
  else if (queryChanged || !previous) state.active = state.matches.length - 1;
  else {
    // Same query, new rows (output arrived): keep the same match if it still exists.
    const same = state.matches.findIndex(match => match.row === previous.row && match.start === previous.start);
    state.active = same === -1 ? Math.min(state.active, state.matches.length - 1) : same;
  }
  state.computedFor = {rows: generation, query: state.query, regex: state.options.regex, caseSensitive: state.options.caseSensitive, scope: state.scope, block: state.blockStartId};
}

/** Next = older (up the transcript, like a terminal's search back); wraps around. */
export function stepFind(state: FindState, direction: 'next' | 'previous'): TranscriptMatch | undefined {
  if (state.matches.length === 0) return undefined;
  const count = state.matches.length;
  state.active = direction === 'next' ? (state.active - 1 + count) % count : (state.active + 1) % count;
  return state.matches[state.active];
}

export function findStatus(state: FindState): string {
  const flags = `regex ${state.options.regex ? 'on' : 'off'} · case ${state.options.caseSensitive ? 'on' : 'off'}${state.scope === 'block' ? ' · this block' : ''}`;
  if (state.error) return `invalid regex: ${state.error} · ${flags}`;
  if (!state.query) return `type to search · ${flags}`;
  if (state.matches.length === 0) return `no matches · ${flags}`;
  const capped = state.matches.length >= MAX_MATCHES ? '+' : '';
  return `${state.active + 1}/${state.matches.length}${capped} ${state.matches.length === 1 ? 'match' : 'matches'} · ${flags}`;
}

/** Viewport start that shows `row` about a third from the top. */
export function revealStart(row: number, totalRows: number, height: number): number {
  const maximum = Math.max(0, totalRows - height);
  return Math.max(0, Math.min(maximum, row - Math.floor(height / 3)));
}

// ------------------------------------------------------------------ filter

export interface OutputFilter {
  /** The command block being filtered. */
  startId: number;
  query: string;
  options: MatchOptions;
  invert: boolean;
  /** Lines of context kept around each match (0..20). */
  context: number;
}

export interface FilterResult {
  rows: WrappedRow[];
  /** Output lines of the block kept / total. */
  kept: number;
  total: number;
  error?: string;
}

/**
 * Presentation filter for one block. Header rows, non-output rows and every
 * other block stay exactly as they are; a hint row says a filter is active.
 * Matching is per logical line (all wrapped rows of a line are kept or hidden together).
 */
export function applyOutputFilter(rows: readonly WrappedRow[], filter: OutputFilter, isOutputLine: (lineIndex: number) => boolean): FilterResult {
  const compiled = compileQuery(filter.query, filter.options);
  if (!compiled.ok) return {rows: [...rows], kept: 0, total: 0, error: compiled.error};
  // Logical output lines of the block, in order, with their joined text.
  const lineText = new Map<number, string>();
  for (const row of rows) {
    if (row.blockStartId !== filter.startId || row.lineIndex === undefined || row.lineIndex === filter.startId || !isOutputLine(row.lineIndex)) continue;
    lineText.set(row.lineIndex, (lineText.get(row.lineIndex) ?? '') + row.plain);
  }
  const lines = [...lineText.keys()];
  const keep = new Set<number>();
  lines.forEach((line, position) => {
    const hit = compiled.test(lineText.get(line)!).length > 0;
    if (hit === filter.invert) return;
    const context = Math.max(0, Math.min(20, filter.context));
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

function filterHintRow(filter: OutputFilter, kept: number, total: number): WrappedRow {
  const flags = [filter.invert ? 'inverted' : '', filter.options.regex ? 'regex' : '', filter.options.caseSensitive ? 'case' : '', filter.context ? `±${filter.context}` : '']
    .filter(Boolean).join(' · ');
  const plain = `  ⧩ filter “${filter.query}”${flags ? ` (${flags})` : ''} · ${kept} of ${total} lines · /filter clear`;
  return {ansi: `\u001b[2m${plain}\u001b[0m`, plain, blockStartId: filter.startId, isFilterHint: true};
}

/** Parse `/filter` and `/find` flags: -r regex, -c case-sensitive, -v invert, -C N context. */
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
  return {query: words.slice(index).join('').trim(), options, invert, context: Math.min(20, context), block};
}
