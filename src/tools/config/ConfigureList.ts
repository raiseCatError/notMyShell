import type {Key} from '../../terminal/keys.js';
import {framePanel} from '../../ui/PanelShell.js';
import {renderControls} from '../../ui/controls.js';
import {focusForeground, foreground, UI_COLORS} from '../../ui/palette.js';
import {GLYPHS} from '../../ui/glyphs.js';
import {padCells, truncateAnsi} from '../../util/text.js';
import {OWNERSHIP_LABELS, type ToolConfigEntry} from './registry.js';

/** /configure: every registered tool, what NMSh can configure for it and how; Enter opens the tool's editor. */
export interface ConfigureListState {selected: number; message?: string}
export type ConfigureListAction = {kind: 'close'} | {kind: 'open'; id: string} | {kind: 'bridge'};

export function configureListKey(state: ConfigureListState, key: Key, tools: ReadonlyArray<ToolConfigEntry & {installed: boolean}>): ConfigureListAction | undefined {
  state.message = undefined;
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + tools.length) % tools.length; return undefined; }
  if (key.kind !== 'enter') return undefined;
  const tool = tools[state.selected]!;
  if (tool.configurable) return {kind: 'open', id: tool.id};
  if (tool.ownership === 'theme-bridge') return {kind: 'bridge'};
  state.message = `${tool.label}: ${tool.summary}.`;
  return undefined;
}

export function renderConfigureList(state: ConfigureListState, tools: ReadonlyArray<ToolConfigEntry & {installed: boolean}>, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001B[0m';
  const lines = [`  ${primary}Tool Configuration${reset}  ${subtle}supported settings for registered tools only; detection never grants write access${reset}`, ''];
  tools.forEach((tool, index) => {
    const selected = index === state.selected;
    const action = tool.configurable ? 'Configure ›' : tool.ownership === 'theme-bridge' ? 'Theme Bridge ›' : 'Inspect only';
    lines.push(`${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${focusForeground(selected)}${padCells(tool.label, 12)}${reset}${padCells(tool.installed ? 'Installed' : 'Not installed', 15)}${selected ? accent : subtle}${padCells(action, 16)}${reset}${subtle}${OWNERSHIP_LABELS[tool.ownership]}${reset}`);
    if (selected) lines.push(`    ${subtle}${tool.summary} · takes effect: ${tool.takesEffect}${reset}`);
  });
  if (state.message) lines.push('', `  ${secondary}${state.message}${reset}`);
  lines.push('', renderControls([['↑↓', 'select'], ['Enter', 'open'], ['Esc', 'close']]));
  return framePanel(lines.map(line => truncateAnsi(line, columns)), columns).slice(0, Math.max(1, height));
}
