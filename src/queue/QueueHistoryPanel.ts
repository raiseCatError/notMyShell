import {redactText} from '../clipboard/report.js';
import {formatDuration} from '../status/commandTiming.js';
import type {Key} from '../terminal/keys.js';
import type {QueueState} from '../session/CommandQueue.js';
import type {QueueHistoryRecord, QueueTimeline} from '../session/ExecutionTimeline.js';
import {renderControls} from '../ui/controls.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {displayWidth, truncateAnsi, truncateText} from '../util/text.js';
import {displaySafe} from '../input/PasteReview.js';

/**
 * `/queue history`: the session's recent settled chains as a keyboard-first review. Like /queue, the panel holds no
 * state of its own: the owner keeps the chains and answers `history-detail`, and every row is drawn from what the
 * owner observed. Command text appears only in the redacted review form; storing a summary is a separate, explicit
 * reviewed save (`/queue save-summary`, or `s` here, which opens the same review).
 */
const RESET = '\u001b[0m';

export interface QueueHistoryPanelState {
  selected: number;
  /** The chain whose detail was asked for; the owner answers with `historyDetail`. */
  detail?: number;
}

export type QueueHistoryPanelAction =
  | {kind: 'close'}
  /** Ask for one chain's results (or none, to dismiss the detail). */
  | {kind: 'detail'; chainId: number | undefined}
  /** Open the reviewed save for one chain (the review itself never stores without a confirmation). */
  | {kind: 'save'; chainId: number};

/** Chronological history as the panel lists it: newest first, the chain a plain save would default to. */
const listed = (queue: QueueState): QueueHistoryRecord[] => [...(queue.history ?? [])].reverse();

export function queueHistoryPanelKey(panel: QueueHistoryPanelState, key: Key, queue: QueueState): QueueHistoryPanelAction | undefined {
  const chains = listed(queue);
  panel.selected = Math.max(0, Math.min(panel.selected, chains.length - 1));
  if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value === 'q')) return {kind: 'close'};
  if (key.kind === 'up' || key.kind === 'down') {
    if (chains.length) panel.selected = (panel.selected + (key.kind === 'up' ? -1 : 1) + chains.length) % chains.length;
    return undefined;
  }
  const chain = chains[panel.selected];
  if (!chain) return undefined;
  if (key.kind === 'enter') return {kind: 'detail', chainId: panel.detail === chain.id ? undefined : chain.id};
  if (key.kind === 'text' && key.value === 's') return {kind: 'save', chainId: chain.id};
  return undefined;
}

function statusWord(record: QueueHistoryRecord): string {
  return record.status === 'cleared' ? 'Cleared' : record.status === 'shell-ended' ? 'Shell ended' : 'Finished';
}

function statusTone(record: QueueHistoryRecord): string {
  if (record.status === 'cleared') return foreground(UI_COLORS.warning);
  if (record.status === 'shell-ended' || record.counts.failed) return foreground(UI_COLORS.failure);
  if (record.counts.interrupted) return foreground(UI_COLORS.warning);
  return foreground(UI_COLORS.success);
}

const statusGlyph = (record: QueueHistoryRecord): string =>
  record.status === 'finished' && !record.counts.failed && !record.counts.interrupted ? GLYPHS.success : GLYPHS.failure;

/** One chain in a few facts: what it kept, what it counted, and its observed wall time. */
function chainFacts(record: QueueHistoryRecord): string {
  const parts = [`${record.results} result${record.results === 1 ? '' : 's'}`];
  if (record.resultsOmitted) parts.push(`${record.resultsOmitted} older not detailed`);
  if (record.counts.failed) parts.push(`${record.counts.failed} failed`);
  if (record.counts.interrupted) parts.push(`${record.counts.interrupted} interrupted`);
  if (record.counts.skipped) parts.push(`${record.counts.skipped} skipped`);
  if (record.counts.unobserved) parts.push(`${record.counts.unobserved} without exec`);
  parts.push(record.startedAt === undefined ? 'no execution observed' : `wall ${formatDuration(record.elapsedMs)}`);
  return parts.join(' · ');
}

/** The selected chain's retained results: the same observed facts the timeline showed, in the redacted review form. */
function detailRows(detail: QueueTimeline, record: QueueHistoryRecord, columns: number, room: number): string[] {
  const direct = detail.executions.filter(execution => execution.status !== 'running');
  const omitted = record.resultsOmitted;
  // One row is the heading; an omitted-results disclosure takes its own row, never a result's.
  const lines = Math.max(1, room - 1 - (omitted ? 1 : 0));
  const out: string[] = [`  ${foreground(UI_COLORS.subtle)}Retained results (redacted review form)${RESET}`];
  direct.slice(0, lines).forEach(execution => {
    const tone = execution.status === 'succeeded' ? UI_COLORS.success : execution.status === 'failed' ? UI_COLORS.failure : UI_COLORS.warning;
    const facts = [execution.status === 'interrupted' ? 'interrupted' : '', execution.exitCode === undefined ? '' : `exit ${execution.exitCode}`,
      execution.durationMs === undefined ? '' : formatDuration(execution.durationMs)].filter(Boolean).join(' · ');
    const text = displaySafe(redactText(execution.text).text);
    const room_ = Math.max(4, columns - 6 - displayWidth(facts) - (facts ? 2 : 0));
    out.push(`  ${foreground(tone)}${execution.status === 'succeeded' ? GLYPHS.success : GLYPHS.failure}${RESET} ${foreground(UI_COLORS.primary)}${truncateText(text, room_)}${RESET}${facts ? `  ${foreground(tone)}${facts}${RESET}` : ''}`);
  });
  const hidden = direct.length - Math.min(direct.length, lines);
  if (hidden > 0) out.push(`  ${foreground(UI_COLORS.subtle)}… ${hidden} more result${hidden === 1 ? '' : 's'}${RESET}`);
  if (omitted) out.push(`  ${foreground(UI_COLORS.subtle)}${omitted} older result${omitted === 1 ? '' : 's'} left the review detail; the counts still include them${RESET}`);
  return out;
}

/** The panel's rows (unframed): recent chains, the selected chain's results, and what its keys do. */
export function renderQueueHistoryPanel(panel: QueueHistoryPanelState, queue: QueueState, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const width = Math.max(10, columns - 4);
  const chains = listed(queue);
  const out = [`  ${primary}Queue history${RESET}  ${subtle}${chains.length ? `recent ${chains.length} chain${chains.length === 1 ? '' : 's'}` : 'nothing finished yet'}${RESET}`];
  out.push(`  ${subtle}${truncateText('Observed facts from this session; nothing here runs again.', width)}${RESET}`);
  out.push('');
  if (!chains.length) out.push(`  ${secondary}Nothing has settled yet. Finished chains stay reviewable here, newest first.${RESET}`);
  const detail = queue.historyDetail?.id === chains[panel.selected]?.id ? queue.historyDetail : undefined;
  const detailRoom = detail ? Math.min(Math.max(0, height - 12), detail.executions.length + 2) : 0;
  const listRoom = Math.max(1, height - 8 - detailRoom);
  const first = Math.max(0, Math.min(panel.selected - Math.floor(listRoom / 2), chains.length - listRoom));
  chains.slice(first, first + listRoom).forEach((record, offset) => {
    const index = first + offset;
    const selected = index === panel.selected;
    const saved = queue.summaries?.some(summary => summary.chainId === record.id) ? `  ${subtle}· summary saved${RESET}` : '';
    const label = `${statusGlyph(record)} ${statusWord(record)} · chain ${record.id}`;
    const room = Math.max(4, width - displayWidth(label) - (saved ? 18 : 2));
    out.push(`${selected ? `${accent}${GLYPHS.selection}${RESET}` : ' '} ${statusTone(record)}${label}${RESET}  ${subtle}${truncateText(chainFacts(record), room)}${RESET}${saved}`);
  });
  if (detail) out.push('', ...detailRows(detail, chains[panel.selected]!, columns, detailRoom));
  const selected = chains[panel.selected];
  const saved = selected ? queue.summaries?.some(summary => summary.chainId === selected.id) : false;
  out.push('');
  out.push(`  ${subtle}${truncateText(saved ? 'This chain already has a saved summary; saving never rewrites it.' : '/queue save-summary saves the newest chain, after a review.', width)}${RESET}`);
  out.push(renderControls([['↑↓', 'select'], ['Enter', detail ? 'hide results' : 'results'], ['s', 'save summary'], ['Esc', 'close']]));
  return out.map(line => truncateAnsi(line, columns));
}
