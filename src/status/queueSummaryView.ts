import type {QueueSummary, QueueSummaryEntry} from '../session/QueueSummary.js';
import {displaySafe} from '../input/PasteReview.js';
import {DEFAULT_TREATMENT_SETTINGS, paintDivider, type TreatmentSettings} from '../chroma/treatment.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {displayWidth, truncateText} from '../util/text.js';
import {formatDuration} from './commandTiming.js';

/**
 * One renderer for the saved Queue Summary: the same lines for live chrome, the history panel, the Settings preview
 * and the plain rereviewed form. Input is the stored artifact only; nothing here reads a shell, a session or output.
 */
const RESET = '\u001b[0m';
/** The bounded container: wide enough for facts, never the whole terminal on a wide host. */
export const SUMMARY_CONTAINER_WIDTH = 56;

export type SummaryDetail = 'compact' | 'detailed';
export type SummaryPlacement = 'left' | 'center' | 'right';
export type SummaryAlign = 'left' | 'center' | 'right';

export interface QueueSummaryViewOptions {
  detail?: SummaryDetail;
  placement?: SummaryPlacement;
  align?: SummaryAlign;
  durations?: boolean;
  exitCodes?: boolean;
  inputWaits?: boolean;
  treatment?: TreatmentSettings;
  now?: number;
}

interface Segment {text: string; color?: RgbColor}

const painted = (segments: readonly Segment[]): string =>
  segments.map(segment => segment.color ? `${foreground(segment.color)}${segment.text}${RESET}` : segment.text).join('');
const written = (segments: readonly Segment[]): string => segments.map(segment => segment.text).join('');

/** A saved summary's tone is its status; toggling detail never changes it. */
function summaryTone(summary: QueueSummary): RgbColor {
  if (summary.status === 'cleared') return UI_COLORS.warning;
  if (summary.status === 'shell-ended' || summary.counts.failed) return UI_COLORS.failure;
  if (summary.counts.interrupted) return UI_COLORS.warning;
  return UI_COLORS.success;
}

const entryTone = (entry: QueueSummaryEntry): RgbColor =>
  entry.outcome === 'succeeded' ? UI_COLORS.success : entry.outcome === 'failed' ? UI_COLORS.failure : UI_COLORS.warning;

/** Only observed facts; a missing duration, wait or exit is absent, never guessed or zero-filled. */
function entryFacts(entry: QueueSummaryEntry, options: QueueSummaryViewOptions): string[] {
  const facts: string[] = [];
  if (entry.outcome === 'interrupted') facts.push('interrupted');
  if (options.exitCodes !== false && entry.exitCode !== undefined) facts.push(`exit ${entry.exitCode}`);
  if (options.inputWaits === true && entry.inputWaitMs !== undefined) facts.push(`waited ${formatDuration(entry.inputWaitMs)}`);
  if (options.durations !== false && entry.durationMs !== undefined) facts.push(formatDuration(entry.durationMs));
  return facts;
}

/** Aggregate facts in importance order; the wall fact is the chain's own observed interval. */
function aggregateFacts(summary: QueueSummary): Segment[] {
  const {counts} = summary;
  const executed = counts.succeeded + counts.failed + counts.interrupted;
  const parts: Segment[] = [];
  const push = (text: string, color: RgbColor) => { if (parts.length) parts.push({text: ' · ', color: UI_COLORS.subtle}); parts.push({text, color}); };
  if (executed) push(`${executed} executed`, UI_COLORS.secondary);
  if (counts.succeeded) push(`${counts.succeeded} succeeded`, UI_COLORS.success);
  if (counts.failed) push(`${counts.failed} failed`, UI_COLORS.failure);
  if (counts.interrupted) push(`${counts.interrupted} interrupted`, UI_COLORS.warning);
  if (counts.skipped) push(`${counts.skipped} skipped`, UI_COLORS.subtle);
  if (counts.unobserved) push(`${counts.unobserved} without exec`, UI_COLORS.subtle);
  if (summary.entriesOmitted) push(`${summary.entriesOmitted} results not detailed`, UI_COLORS.subtle);
  push(summary.startedAt === undefined ? 'no execution observed' : `wall time ${formatDuration(summary.elapsedMs)}`, UI_COLORS.subtle);
  return parts;
}

/** Greedy wrap of colored facts into inner-width rows; facts are never reordered or dropped for looks. */
function wrapFacts(facts: readonly Segment[], inner: number): Segment[][] {
  const rows: Segment[][] = [];
  let row: Segment[] = [];
  let rowWidth = 0;
  for (const fact of facts) {
    const width = displayWidth(fact.text);
    if (row.length && rowWidth + width > inner) { rows.push(row); row = []; rowWidth = 0; }
    row.push(fact);
    rowWidth += width;
  }
  if (row.length) rows.push(row);
  return rows.length ? rows : [[{text: 'no execution observed', color: UI_COLORS.subtle}]];
}

function alignPad(text: string, inner: number, align: SummaryAlign): {before: number; after: number} {
  const pad = Math.max(0, inner - displayWidth(text));
  if (align === 'right') return {before: pad, after: 0};
  if (align === 'center') return {before: Math.floor(pad / 2), after: pad - Math.floor(pad / 2)};
  return {before: 0, after: pad};
}

function entryRow(entry: QueueSummaryEntry, inner: number, align: SummaryAlign, options: QueueSummaryViewOptions): Segment[] {
  const icon = entry.outcome === 'succeeded' ? GLYPHS.success : GLYPHS.failure;
  const tone = entryTone(entry);
  const label = displaySafe(entry.text ?? entry.label);
  const facts = entryFacts(entry, options);
  const factsText = facts.join(' · ');
  const factsWidth = factsText ? displayWidth(factsText) + 2 : 0;
  const room = Math.max(1, inner - displayWidth(icon) - 1 - factsWidth);
  const shown = truncateText(label, room);
  const {before, after} = alignPad(shown, room, align);
  const segments: Segment[] = [{text: ' '}, {text: icon, color: tone}, {text: ' '.repeat(1 + before)}, {text: shown, color: UI_COLORS.primary}];
  if (factsText) segments.push({text: ' '.repeat(after + 2)}, {text: factsText, color: tone});
  else segments.push({text: ' '.repeat(after)});
  segments.push({text: ' '});
  return segments;
}

function textRow(segments: readonly Segment[], inner: number, align: SummaryAlign): Segment[] {
  const text = written(segments);
  const {before, after} = alignPad(text, inner, align);
  return [{text: ' '.repeat(1 + before)}, ...segments, {text: ' '.repeat(after + 1)}];
}

function titleRow(width: number, treatment: TreatmentSettings, now: number): string {
  const title = truncateText('Queue Summary', Math.max(1, width));
  const fill = Math.max(0, width - displayWidth(title) - 2);
  const left = Math.floor(fill / 2);
  const right = fill - left;
  const dashes = GLYPHS.separator;
  return `${paintDivider(dashes.repeat(left), treatment, now)} ${foreground(UI_COLORS.secondary)}${title}${RESET} ${paintDivider(dashes.repeat(right), treatment, now)}`;
}

/**
 * The saved summary as presentation lines: a bounded container, entries in observed order, then the aggregate
 * facts. `height` is the largest number of rows the caller wants; entries give way first, facts never change.
 */
export function renderQueueSummary(summary: QueueSummary, columns: number, height: number, options: QueueSummaryViewOptions = {}): string[] {
  if (columns < 8 || height < 3) return [];
  const width = columns <= 12 ? columns : Math.min(columns - 2, SUMMARY_CONTAINER_WIDTH);
  const inner = Math.max(1, width - 2);
  const align = options.align ?? 'left';
  const placement = options.placement ?? 'center';
  const offset = placement === 'left' ? 0 : placement === 'right' ? Math.max(0, columns - width) : Math.max(0, Math.floor((columns - width) / 2));
  const treatment: TreatmentSettings = {...(options.treatment ?? DEFAULT_TREATMENT_SETTINGS), motion: 'static'};
  const now = options.now ?? 0;
  const entries = options.detail === 'compact' ? [] : summary.entries.map(entry => entryRow(entry, inner, align, options));
  let aggregates = wrapFacts(aggregateFacts(summary), inner).map(row => textRow(row, inner, align));
  let room = height - 2;
  if (aggregates.length > room) aggregates = aggregates.slice(0, Math.max(1, room));
  room -= aggregates.length;
  let overflow = 0;
  if (entries.length > room) {
    const keep = room >= 2 ? room - 1 : Math.max(0, room);
    overflow = entries.length - keep;
    entries.length = keep;
  }
  const pad = ' '.repeat(offset);
  const rows = [titleRow(width, treatment, now), ...entries.map(painted), ...(overflow ? [painted(textRow([{text: `+${overflow} more results`, color: UI_COLORS.subtle}], inner, align))] : []),
    ...aggregates.map(painted), paintDivider(GLYPHS.separator.repeat(width), treatment, now)];
  return rows.map(row => pad + row);
}

/** The same layout without color, for plain rereviewed/copy surfaces. */
export function queueSummaryLines(summary: QueueSummary, columns: number, options: QueueSummaryViewOptions = {}): string[] {
  const stripped = renderQueueSummary(summary, columns, Number.MAX_SAFE_INTEGER, options);
  return stripped.map(line => line.replace(/\u001b\[[0-9;]*m/gu, ''));
}
