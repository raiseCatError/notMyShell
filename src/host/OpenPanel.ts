import type {Key} from '../terminal/keys.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {renderControls} from '../ui/controls.js';
import {truncateAnsi} from '../util/text.js';
import type {SourceReference} from './HostActions.js';

/** /open with no argument: source references found in recent command output, newest first. Keyboard-first. */
export interface OpenPanelState {
  references: Array<SourceReference & {cwd: string; command: string}>;
  selected: number;
  editor: string;
  message?: string;
}

export function openPanelKey(state: OpenPanelState, key: Key): 'close' | 'open' | undefined {
  if (key.kind === 'escape' || key.kind === 'interrupt') return 'close';
  if (key.kind === 'up' || key.kind === 'down') {
    const count = Math.max(1, state.references.length);
    state.selected = (state.selected + (key.kind === 'up' ? count - 1 : 1)) % count;
  }
  if (key.kind === 'enter' && state.references.length) return 'open';
  return undefined;
}

export function renderOpenPanel(state: OpenPanelState, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const rows = [`${primary}  Open source reference${reset}  ${subtle}from recent output · opens in ${state.editor}${reset}`, ''];
  if (!state.references.length) rows.push(`  ${subtle}No path:line references in recent output. /open <path>[:line[:column]] opens one directly.${reset}`);
  const budget = Math.max(3, height - 7);
  const start = Math.max(0, Math.min(state.selected - Math.floor(budget / 2), state.references.length - budget));
  state.references.slice(start, start + budget).forEach((reference, offset) => {
    const selected = start + offset === state.selected;
    rows.push(`${selected ? `${accent}${GLYPHS.selection}` : ' '} ${focusForeground(selected)}${reference.text}${reset}  ${subtle}from ${reference.command.slice(0, 40)}${reset}`);
  });
  if (state.message) rows.push('', `  ${secondary}${state.message}${reset}`);
  rows.push('', renderControls([['↑↓', 'select'], ['Enter', 'open'], ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}
