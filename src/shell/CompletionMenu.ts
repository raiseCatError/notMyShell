import type {CompletionCandidate} from './completion.js';
export {filterCompletions} from './completion.js';
import {completionLabel} from './completion.js';
import {GLYPHS, getCurrentGlyphMode} from '../ui/glyphs.js';
import {background, foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {contrastOn} from '../chroma/color.js';
import {truncateAnsi, truncateText, displayWidth} from '../util/text.js';
import type {UiAction} from '../ui/actions.js';

export const COMPLETION_ACTIONS: readonly UiAction[] = [
  {id: 'move', label: 'move', keyLabel: '↑↓', kinds: ['up', 'down']},
  {id: 'insert', label: 'insert', keyLabel: 'Tab', kinds: ['complete']},
  {id: 'cancel', label: 'dismiss', keyLabel: 'Esc', kinds: ['escape']},
];

/** Visible completion rows; longer lists scroll and end with a factual "↓ N more" cue. */
export const COMPLETION_VIEWPORT = 10;

/** Rows the menu needs for `count` candidates: at most the viewport plus its cue row. */
export function completionMenuRows(count: number): number {
  return count > COMPLETION_VIEWPORT ? COMPLETION_VIEWPORT + 1 : count;
}

type IconKey = NonNullable<CompletionCandidate['identity']> | Exclude<CompletionCandidate['kind'], 'command'>;
/** Nerd Font icons per meaningful type; command and subcommand differ, identities differ. */
const NERD_ICONS: Record<IconKey, string> = {
  executable: '\uf489', alias: '\uf0c1', function: '\uf121', builtin: '\uf1b2', keyword: '\uf02b',
  subcommand: '\uf054', option: '\uf024', argument: '\uf12e', value: '\uf12e', file: '\uf15b', directory: '\uf07b',
};
/** Safe one-character markers in the same column, so types stay distinguishable without Nerd Fonts. */
const SAFE_ICONS: Record<IconKey, string> = {
  executable: '$', alias: '@', function: 'f', builtin: 'b', keyword: 'k',
  subcommand: '>', option: '-', argument: '=', value: '=', file: '.', directory: '/',
};

function iconKey(candidate: CompletionCandidate): IconKey {
  return candidate.kind === 'command' ? candidate.identity ?? 'executable' : candidate.kind;
}

export function completionIcon(candidate: CompletionCandidate): string {
  const key = iconKey(candidate);
  return getCurrentGlyphMode() === 'nerd' ? NERD_ICONS[key] : SAFE_ICONS[key];
}

/**
 * The quiet type word beside a candidate. Plain executables, files, folders
 * and options need none (their icon and text already say it); aliases,
 * functions, builtins and keywords say what they are; source groups such as
 * "local branches" are kept.
 */
export function completionTypeLabel(candidate: CompletionCandidate): string {
  if (candidate.kind === 'command') {
    return candidate.identity && candidate.identity !== 'executable'
      ? {alias: 'alias', function: 'function', builtin: 'builtin', keyword: 'keyword'}[candidate.identity] : '';
  }
  const group = completionLabel(candidate.group ?? '');
  if (group) return group;
  return candidate.kind === 'subcommand' ? 'subcommand' : candidate.kind === 'value' || candidate.kind === 'argument' ? candidate.kind : '';
}

/**
 * One selectable row: icon, a stable name column, then the quiet type word and
 * the description in whatever width is left (truncated with an ellipsis,
 * never wrapped, never pushing the name). Every row shows its description;
 * it stays secondary to the name.
 *
 * The selected row is one coherent state on the shared selection band: each
 * part keeps its own hue but is contrast-corrected against the active
 * selection background (theme, Grayscale or Custom chrome alike), so the
 * name, icon and description stay readable without turning uniformly white.
 */
export function renderCompletion(candidate: CompletionCandidate, selected: boolean, columns: number,
  description = candidate.description): string {
  const RESET = '\u001b[0m';
  const band = UI_COLORS.selection;
  const on = (color: RgbColor, minimum: number) => selected ? contrastOn(color, band, minimum) : color;
  const pointer = selected ? `${foreground(on(UI_COLORS.accent, 3))}${GLYPHS.selection}` : ' ';
  const icon = completionIcon(candidate);
  const label = completionLabel(candidate.display);
  const type = completionTypeLabel(candidate);
  const prefix = `${pointer} ${foreground(selected ? on(UI_COLORS.accent, 3) : UI_COLORS.subtle)}${icon} `;
  const prefixWidth = 2 + displayWidth(icon) + 1;
  const width = Math.max(0, columns - prefixWidth);
  const labelColor = selected ? `\u001b[1m${foreground(on(UI_COLORS.primary, 7))}` : foreground(UI_COLORS.secondary);
  // Muted on ordinary rows; lifted to a readable secondary tone on the selection band.
  const detailColor = foreground(selected ? on(UI_COLORS.secondary, 4.5) : UI_COLORS.subtle);
  let row: string;
  if (width < 28) row = `${prefix}${labelColor}${truncateText(label, width)}${RESET}`;
  else {
    const labelWidth = Math.min(28, Math.floor(width * 0.45));
    const shown = truncateText(label, labelWidth);
    const typeText = type ? truncateText(type, 18) : '';
    const detailText = [typeText, description ? completionLabel(description) : ''].filter(Boolean).join('  ');
    const room = Math.max(0, width - labelWidth - 1);
    row = `${prefix}${labelColor}${shown}${RESET}${' '.repeat(Math.max(1, labelWidth - displayWidth(shown) + 1))}`
      + `${detailColor}${truncateText(detailText, room)}${RESET}`;
  }
  const fitted = truncateAnsi(row, columns);
  if (!selected) return fitted;
  // A full-width band, so the selection does not rely on color of the text alone.
  const fill = background(band);
  return `${fill}${fitted.replaceAll(RESET, `${RESET}${fill}`)}${' '.repeat(Math.max(0, columns - displayWidth(fitted)))}${RESET}`;
}

/** The cue under a scrolled list: how many candidates follow the window, or, at its end, how many precede it. */
export function renderCompletionMore(below: number, above: number, columns: number): string {
  const nerd = getCurrentGlyphMode() === 'nerd';
  const text = below > 0 ? `${nerd ? '↓' : 'v'} ${below} more` : `${nerd ? '↑' : '^'} ${above} above`;
  return truncateAnsi(`  ${foreground(UI_COLORS.subtle)}${text}\u001b[0m`, columns);
}
