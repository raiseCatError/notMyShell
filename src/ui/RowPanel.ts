import type {Key} from '../terminal/keys.js';
import type {PromptConfiguration} from '../prompt/configuration.js';
import {adjustSettingsRow, settingsRowValue, SETTINGS_ROWS, toggleSettingsRow, type SettingsRow} from './SettingsPanel.js';
import {framePanel} from './PanelShell.js';
import {renderControls} from './controls.js';
import {foreground, UI_COLORS} from './palette.js';
import {GLYPHS} from './glyphs.js';
import {padCells, truncateAnsi} from '../util/text.js';

/**
 * A focused panel over a fixed set of the canonical Settings rows (for
 * example the Status Strip). It holds no settings of its own: every change
 * is the Settings row's own `select`, applied through the normal
 * configuration path by the caller.
 */
export interface RowPanelState {
  title: string;
  subtitle: string;
  rowIds: readonly string[];
  selected: number;
}

export function createRowPanel(title: string, subtitle: string, rowIds: readonly string[]): RowPanelState {
  return {title, subtitle, rowIds, selected: 0};
}

function rows(state: RowPanelState, config: PromptConfiguration): SettingsRow[] {
  return state.rowIds.map(id => SETTINGS_ROWS.find(row => row.id === id)).filter((row): row is SettingsRow => Boolean(row) && (row!.when?.(config) ?? true));
}

export type RowPanelAction = {kind: 'close'} | {kind: 'change'; configuration: PromptConfiguration};

export function rowPanelKey(state: RowPanelState, key: Key, config: PromptConfiguration): RowPanelAction | undefined {
  const visible = rows(state, config);
  state.selected = Math.max(0, Math.min(state.selected, visible.length - 1));
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + visible.length) % visible.length; return undefined; }
  const row = visible[state.selected];
  if (!row) return undefined;
  const next = key.kind === 'left' || key.kind === 'right' ? adjustSettingsRow(row, config, key.kind === 'left' ? -1 : 1)
    : key.kind === 'enter' || (key.kind === 'text' && key.value === ' ') ? toggleSettingsRow(row, config) : undefined;
  return next ? {kind: 'change', configuration: next} : undefined;
}

export function renderRowPanel(state: RowPanelState, config: PromptConfiguration, columns: number, height: number, preview: readonly string[]): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001B[0m';
  const visible = rows(state, config);
  const out = [`  ${primary}${state.title}${reset}  ${subtle}${state.subtitle}${reset}`, ''];
  visible.forEach((row, index) => {
    const selected = index === state.selected;
    const value = settingsRowValue(row, config) ?? '';
    const indent = row.parent ? '  ' : '';
    out.push(`${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${indent}${selected ? primary : secondary}${padCells(row.label.trim(), 22 - indent.length)}${reset}${selected ? `${accent}‹ ${value} ›${reset}` : value}`);
  });
  const description = visible[state.selected]?.description;
  if (description && height >= out.length + preview.length + 6) out.push('', `  ${subtle}${description}${reset}`);
  if (preview.length && height >= out.length + preview.length + 4) out.push('', `  ${subtle}Preview${reset}`, ...preview);
  out.push('', renderControls([['↑↓', 'select'], ['←→', 'change'], ['Esc', 'close']]));
  return framePanel(out.map(line => truncateAnsi(line, columns)), columns).slice(0, Math.max(1, height));
}
