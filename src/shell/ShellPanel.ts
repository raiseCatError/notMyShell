import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {renderControls} from '../ui/controls.js';
import {truncateAnsi} from '../util/text.js';
import type {ShellAvailability} from './adapters/registry.js';
import type {ShellId} from './adapters/ShellAdapter.js';

/**
 * /shell: the backends this machine has, the one this session runs, and the
 * default for new sessions. Switching here changes only the current session;
 * D saves the selection as the default. Missing shells are listed, never installed.
 */
export interface ShellPanelState {
  shells: ShellAvailability[];
  current: ShellId;
  defaultShell: ShellId;
  selected: number;
  /** Why the current session cannot switch right now (running command, jobs), if known up front. */
  blocked?: string;
  message?: string;
}

export type ShellPanelAction = {kind: 'close'} | {kind: 'switch'; shell: ShellId} | {kind: 'default'; shell: ShellId};

export function createShellPanel(shells: ShellAvailability[], current: ShellId, defaultShell: ShellId, blocked?: string): ShellPanelState {
  return {shells, current, defaultShell, selected: Math.max(0, shells.findIndex(item => item.adapter.id === current)), ...(blocked ? {blocked} : {})};
}

export function shellPanelKey(state: ShellPanelState, key: Key): ShellPanelAction | undefined {
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'up' || key.kind === 'down') {
    state.selected = (state.selected + (key.kind === 'up' ? state.shells.length - 1 : 1)) % state.shells.length;
    state.message = undefined;
    return undefined;
  }
  const choice = state.shells[state.selected];
  if (!choice) return undefined;
  if (key.kind === 'enter') {
    if (!choice.executable) { state.message = choice.reason; return undefined; }
    if (choice.adapter.id === state.current) { state.message = `This session already runs ${choice.adapter.label}.`; return undefined; }
    if (state.blocked) { state.message = state.blocked; return undefined; }
    return {kind: 'switch', shell: choice.adapter.id};
  }
  if (key.kind === 'text' && key.value.toLowerCase() === 'd') {
    if (!choice.executable) { state.message = choice.reason; return undefined; }
    return {kind: 'default', shell: choice.adapter.id};
  }
  return undefined;
}

export function renderShellPanel(state: ShellPanelState, columns: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const rows = [`${primary}  Shell${reset}  ${subtle}the real shell under this session · NMSh's composer, transcript and settings stay the same${reset}`, ''];
  state.shells.forEach((item, index) => {
    const selected = index === state.selected;
    const tags = [item.adapter.id === state.current ? 'this session' : '', item.adapter.id === state.defaultShell ? 'default' : ''].filter(Boolean).join(' · ');
    const status = item.executable ? `${item.version ?? item.executable}` : 'not installed here';
    rows.push(`${selected ? `${accent}${GLYPHS.selection}` : ' '} ${selected ? primary : secondary}${item.adapter.label.padEnd(6)}${reset} ${subtle}${status}${tags ? `  [${tags}]` : ''}${reset}`);
    if (selected && !item.executable && item.reason) rows.push(`    ${subtle}${item.reason}${reset}`);
    if (selected && item.executable && item.adapter.id !== 'zsh') {
      const caps = item.adapter.capabilities;
      rows.push(`    ${subtle}completion ${caps.completion}${caps.completionDescriptions ? ' with descriptions' : ', names only'} · history: ${caps.privateHistory}${reset}`);
    }
  });
  rows.push('', `  ${subtle}Switching starts the selected shell in the current directory. Shell-local state (aliases, functions, variables, jobs)${reset}`,
    `  ${subtle}belongs to the old shell and does not carry over. NMSh history, transcript and settings do.${reset}`);
  if (state.blocked) rows.push('', `  ${secondary}${state.blocked}${reset}`);
  if (state.message) rows.push('', `  ${secondary}${state.message}${reset}`);
  rows.push('', renderControls([['↑↓', 'select'], ['Enter', 'switch this session'], ['D', 'set default for new sessions'], ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}
