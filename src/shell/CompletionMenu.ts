import type {CompletionCandidate} from './completion.js';
export {filterCompletions} from './completion.js';
import {completionLabel} from './completion.js';
import {GLYPHS, getCurrentGlyphMode} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi, truncateText, displayWidth} from '../util/text.js';
import type {UiAction} from '../ui/actions.js';

export const COMPLETION_ACTIONS: readonly UiAction[] = [
  {id: 'move', label: 'move', keyLabel: '↑↓', kinds: ['up', 'down']},
  {id: 'insert', label: 'insert', keyLabel: 'Tab', kinds: ['complete']},
  {id: 'cancel', label: 'dismiss', keyLabel: 'Esc', kinds: ['escape']},
];

const ICONS = {command: '\uf489', subcommand: '\uf489', option: '\uf024', argument: '\uf12e',
  file: '\uf15b', directory: '\uf07b', value: '\uf12e'} as const;

/** One selectable row: groups are inline so geometry and selection indices stay identical. */
export function renderCompletion(candidate: CompletionCandidate, selected: boolean, columns: number): string {
  const accent = foreground(selected ? UI_COLORS.accent : UI_COLORS.secondary);
  const secondary = foreground(UI_COLORS.secondary);
  const marker = selected ? GLYPHS.selection : ' ';
  const icon = getCurrentGlyphMode() === 'nerd' ? `${ICONS[candidate.kind]} ` : '';
  const display = completionLabel(candidate.display);
  const group = completionLabel(candidate.group ?? candidate.kind);
  const prefix = `${marker} ${icon}`;
  const width = Math.max(0, columns - displayWidth(prefix));
  if (width < 28) return truncateAnsi(`${accent}${prefix}${truncateText(display, width)}\u001b[0m`, columns);
  const labelWidth = Math.min(28, Math.floor(width * 0.5));
  const label = truncateText(display, labelWidth);
  const padding = ' '.repeat(Math.max(1, labelWidth - displayWidth(label) + 1));
  return truncateAnsi(`${accent}${prefix}${label}${padding}\u001b[0m${secondary}[${group}] ${completionLabel(candidate.description)}\u001b[0m`, columns);
}
