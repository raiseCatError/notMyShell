import type {Key} from '../terminal/keys.js';
import {KIND_LABELS, PASTE_EXACT_NOTE, pasteHeader, primaryKind, type PasteAnalysis, type PasteKind} from './pasteGuard.js';
import {renderControls} from '../ui/controls.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {padCells, truncateAnsi} from '../util/text.js';

/**
 * Paste Review: a bounded, scrollable surface for a large paste. The compact
 * preview above the composer stays compact; R opens this instead of growing
 * that strip. Every source line is shown exactly (display only: controls are
 * made visible, nothing is changed), with the classification of each command
 * beside the line it starts on. Nothing is executed and nothing is classified
 * by running it; Enter inserts the original text, Esc goes back.
 */
export interface PasteReviewState {
  text: string;
  analysis: PasteAnalysis;
  /** The source split on newlines, as pasted (display copy). */
  lines: string[];
  /** Per source line: the kind of the command that starts on it, when one does. */
  starts: Array<PasteKind | undefined>;
  /** First visible source line. */
  top: number;
  /** The paste splits into separate commands that could be queued (offered as B). */
  batch: boolean;
}

export type PasteReviewResult = 'insert' | 'back' | 'cancel' | 'batch' | undefined;

export function createPasteReview(text: string, analysis: PasteAnalysis, batch = false): PasteReviewState {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  const starts: Array<PasteKind | undefined> = new Array(lines.length).fill(undefined);
  // Locate each command in order from where the previous one ended; display-only, linear in the paste size.
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) { offsets.push(at); at += line.length + 1; }
  const normalized = lines.join('\n');
  let cursor = 0;
  let lineIndex = 0;
  for (const command of analysis.commands) {
    const found = normalized.indexOf(command.text, cursor);
    if (found < 0) continue;
    cursor = found + command.text.length;
    while (lineIndex + 1 < lines.length && offsets[lineIndex + 1]! <= found) lineIndex += 1;
    starts[lineIndex] ??= primaryKind(command.kinds);
  }
  return {text, analysis, lines, starts, top: 0, batch};
}

/** The body rows available for source lines: header, a blank, a note row and the footer are fixed. */
function bodyRows(height: number): number {
  return Math.max(1, height - 4);
}

export function pasteReviewKey(state: PasteReviewState, key: Key, height: number): PasteReviewResult {
  const page = Math.max(1, bodyRows(height) - 1);
  const max = Math.max(0, state.lines.length - bodyRows(height));
  const move = (to: number) => { state.top = Math.max(0, Math.min(max, to)); };
  if (key.kind === 'enter') return 'insert';
  if (key.kind === 'escape') return 'back';
  if (key.kind === 'interrupt') return 'cancel';
  if (key.kind === 'text' && key.value.toLowerCase() === 'r') return 'back';
  if (key.kind === 'text' && key.value.toLowerCase() === 'b' && state.batch) return 'batch';
  if (key.kind === 'up' || key.kind === 'wheelUp') move(state.top - (key.kind === 'wheelUp' ? 3 : 1));
  else if (key.kind === 'down' || key.kind === 'wheelDown') move(state.top + (key.kind === 'wheelDown' ? 3 : 1));
  else if (key.kind === 'pageUp') move(state.top - page);
  else if (key.kind === 'pageDown') move(state.top + page);
  else if (key.kind === 'lineHome' || key.kind === 'bufferHome') move(0);
  else if (key.kind === 'lineEnd' || key.kind === 'bufferEnd') move(max);
  return undefined;
}

/**
 * Make a pasted line safe and legible to draw: control characters become visible, tabs become spaces. Format and
 * separator characters (bidi overrides and isolates, zero-width characters, line and paragraph separators) are shown
 * as · too: they change how text reads or hide that it is there, and a reviewer must be able to see them.
 */
export function displaySafe(line: string): string {
  return line.replace(/\t/gu, '  ').replace(/[\u0000-\u001f\u007f-\u009f]|[\p{Cf}\p{Zl}\p{Zp}]/gu, char => char === '\u001B' ? '␛' : '·');
}

const RISKY: ReadonlySet<PasteKind> = new Set(['destructive', 'privilege', 'pipeline']);

/** Exactly `height` rows (never taller, never empty), so the panel does not jump while scrolling. */
export function renderPasteReview(state: PasteReviewState, columns: number, height: number): string[] {
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const primary = foreground(UI_COLORS.primary);
  const accent = foreground(UI_COLORS.accent);
  const failure = foreground(UI_COLORS.failure);
  const reset = '\u001B[0m';
  const total = state.lines.length;
  const rows = bodyRows(height);
  const top = Math.max(0, Math.min(state.top, Math.max(0, total - rows)));
  const last = Math.min(total, top + rows);
  const numberWidth = String(total).length;
  const labelWidth = columns >= 76 ? 26 : columns >= 56 ? 16 : 0;
  const out: string[] = [`  ${primary}Review paste${reset}  ${subtle}${pasteHeader(state.analysis).replace(/^pasted · /u, '')} · lines ${top + 1}-${last} of ${total}${reset}`, ''];
  for (let index = top; index < top + rows; index += 1) {
    if (index >= total) { out.push(''); continue; }
    const kind = state.starts[index];
    const color = kind ? (RISKY.has(kind) ? failure : kind === 'install' || kind === 'modifies' ? accent : subtle) : subtle;
    const label = labelWidth ? `${color}${padCells(kind ? truncateAnsi(KIND_LABELS[kind], labelWidth - 1) : '', labelWidth)}${reset}` : kind && RISKY.has(kind) ? `${failure}! ${reset}` : '';
    out.push(truncateAnsi(`  ${subtle}${String(index + 1).padStart(numberWidth)}${reset}  ${label}${kind === 'text' ? subtle : secondary}${displaySafe(state.lines[index]!)}${reset}`, columns));
  }
  const exact = state.analysis.commands.some(command => primaryKind(command.kinds) === 'text' || primaryKind(command.kinds) === 'unknown');
  out.push(truncateAnsi(`  ${subtle}${exact ? PASTE_EXACT_NOTE : 'Nothing runs until you press Enter again.'}${reset}`, columns));
  out.push(renderControls([['↑↓ PgUp PgDn', 'scroll'], ['Enter', 'insert'], ...(state.batch ? [['B', 'queue as commands'] as const] : []), ['Esc', 'back']]));
  // A very short terminal drops the note before the controls; the panel never exceeds its height.
  const fixed = Math.max(3, height);
  return out.length > fixed ? [...out.slice(0, fixed - 1), out[out.length - 1]!] : out;
}
