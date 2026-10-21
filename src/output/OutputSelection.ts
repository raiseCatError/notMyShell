import {HistoryViewport, type HistoryMode, type WrappedRow} from './viewport.js';

export interface OutputScope {session: string; generation: number}
export interface OutputSelection<Return> {
  intent: 'copy' | 'actions';
  scope: OutputScope;
  candidateIds: number[];
  focusedId: number;
  returnTo: Return;
}

/** Identity only: the caller always resolves payloads/actions against the live authoritative records. */
export function createOutputSelection<Return>(intent: OutputSelection<Return>['intent'], scope: OutputScope,
  recent: readonly {startId: number}[], returnTo: Return): OutputSelection<Return> | undefined {
  if (!recent.length) return undefined;
  return {intent, scope: {...scope}, candidateIds: recent.map(record => record.startId), focusedId: recent[0]!.startId, returnTo};
}

export function validateOutputSelection(state: OutputSelection<unknown>, scope: OutputScope, recent: readonly {startId: number}[]): boolean {
  if (state.scope.session !== scope.session || state.scope.generation !== scope.generation) return false;
  const live = new Set(recent.map(record => record.startId));
  if (!live.has(state.focusedId)) return false;
  state.candidateIds = state.candidateIds.filter(id => live.has(id));
  return true;
}

export function moveOutputSelection(state: OutputSelection<unknown>, key: 'up' | 'down'): void {
  const index = state.candidateIds.indexOf(state.focusedId);
  state.focusedId = state.candidateIds[Math.max(0, Math.min(state.candidateIds.length - 1, index + (key === 'up' ? 1 : -1)))]!;
}

export interface OutputAnchor {
  mode: HistoryMode;
  start: number;
  lineIndex?: number;
  blockStartId?: number;
  activityId?: string;
  kind: string;
  /** Wrapped segment within one stable row representation. */
  segment: number;
  /** Synthetic gaps are anchored relative to the nearest following (or preceding) stable row. */
  offset: number;
}

const rowKind = (row: WrappedRow) => row.isFoldHint || row.derived ? 'fold' : row.isHistoricalHeader ? 'historical' : row.isFilterHint ? 'filter' : 'line';
const stableRow = (row: WrappedRow | undefined) => row !== undefined && ((row.lineIndex ?? -1) >= 0 || row.blockStartId !== undefined || row.activityId !== undefined);
const matchesAnchor = (row: WrappedRow, anchor: OutputAnchor) =>
  row.lineIndex === anchor.lineIndex && row.blockStartId === anchor.blockStartId && row.activityId === anchor.activityId && rowKind(row) === anchor.kind;

export function captureOutputAnchor(rows: readonly WrappedRow[], viewport: HistoryViewport, height: number): OutputAnchor {
  const start = viewport.resolve(rows.length, height);
  let reference = start;
  if (!stableRow(rows[reference])) {
    reference = rows.findIndex((row, index) => index > start && stableRow(row));
    if (reference < 0) for (let index = start - 1; index >= 0; index--) if (stableRow(rows[index])) { reference = index; break; }
  }
  const row = rows[reference];
  const anchor: OutputAnchor = {mode: viewport.mode, start, lineIndex: row?.lineIndex, blockStartId: row?.blockStartId,
    activityId: row?.activityId, kind: row ? rowKind(row) : 'gap', segment: 0, offset: row ? start - reference : 0};
  let first = reference;
  if (row) while (first > 0 && matchesAnchor(rows[first - 1]!, anchor)) first--;
  anchor.segment = reference - first;
  return anchor;
}

export function restoreOutputAnchor(rows: readonly WrappedRow[], viewport: HistoryViewport, height: number, anchor: OutputAnchor): void {
  if (anchor.mode === 'follow') { viewport.latest(); viewport.resolve(rows.length, height); return; }
  let at = anchor.kind === 'gap' ? -1 : rows.findIndex(row => matchesAnchor(row, anchor));
  if (at >= 0) {
    let end = at;
    while (rows[end + 1] && matchesAnchor(rows[end + 1]!, anchor)) end++;
    at = Math.min(at + anchor.segment, end) + anchor.offset;
  } else if (anchor.blockStartId !== undefined) at = rows.findIndex(row => row.blockStartId === anchor.blockStartId);
  const current = viewport.resolve(rows.length, height);
  viewport.scrollLines(rows.length, height, (at < 0 ? anchor.start : at) - current);
}

/** Reveal just enough of the existing visible block representation. Never unfold or clear a filter. */
export function revealOutputSelection(rows: readonly WrappedRow[], viewport: HistoryViewport, height: number, startId: number): void {
  const first = rows.findIndex(row => row.blockStartId === startId);
  if (first < 0 || height <= 0) return;
  const current = viewport.resolve(rows.length, height);
  if (rows.slice(current, current + height).some(row => row.blockStartId === startId)) return;
  const target = first < current ? first : first - height + 1;
  viewport.scrollLines(rows.length, height, target - current);
}
