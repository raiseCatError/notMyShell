import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {renderControls} from '../ui/controls.js';
import {truncateAnsi} from '../util/text.js';
import type {ShellAvailability, ShellInstall} from './adapters/registry.js';
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
  /** Install preview awaiting an explicit Yes (starts on No). */
  confirm?: {shell: ShellId; install: Extract<ShellInstall, {kind: 'recipe'}>; choice: 'yes' | 'no'};
  /** Running install, rendered by the caller. */
  installing?: string;
  /** How to install a shell; injectable for tests. */
  installFor?: (shell: ShellId) => ShellInstall;
}

export type ShellPanelAction = {kind: 'close'} | {kind: 'switch'; shell: ShellId} | {kind: 'default'; shell: ShellId}
  | {kind: 'install'; shell: ShellId; install: Extract<ShellInstall, {kind: 'recipe'}>};

export function createShellPanel(shells: ShellAvailability[], current: ShellId, defaultShell: ShellId, blocked?: string): ShellPanelState {
  return {shells, current, defaultShell, selected: Math.max(0, shells.findIndex(item => item.adapter.id === current)), ...(blocked ? {blocked} : {})};
}

export function shellPanelKey(state: ShellPanelState, key: Key): ShellPanelAction | undefined {
  if (state.installing) return undefined;
  if (state.confirm) {
    const confirm = state.confirm;
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.confirm = undefined; return undefined; }
    if (key.kind === 'left' || key.kind === 'right' || key.kind === 'up' || key.kind === 'down') confirm.choice = confirm.choice === 'no' ? 'yes' : 'no';
    else if (key.kind === 'text' && /^[yn]$/iu.test(key.value)) confirm.choice = key.value.toLowerCase() === 'y' ? 'yes' : 'no';
    else if (key.kind === 'enter') {
      state.confirm = undefined;
      return confirm.choice === 'yes' ? {kind: 'install', shell: confirm.shell, install: confirm.install} : undefined;
    }
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'up' || key.kind === 'down') {
    state.selected = (state.selected + (key.kind === 'up' ? state.shells.length - 1 : 1)) % state.shells.length;
    state.message = undefined;
    return undefined;
  }
  const choice = state.shells[state.selected];
  if (!choice) return undefined;
  const offerInstall = () => {
    const install = state.installFor?.(choice.adapter.id);
    if (install?.kind === 'recipe') state.confirm = {shell: choice.adapter.id, install, choice: 'no'};
    else state.message = `${choice.reason ?? ''} ${install?.text ?? ''}`.trim();
  };
  if (key.kind === 'text' && key.value.toLowerCase() === 'i' && !choice.executable) { offerInstall(); return undefined; }
  if (key.kind === 'enter') {
    if (!choice.executable) { offerInstall(); return undefined; }
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
  if (state.installing) {
    rows.push(`  ${secondary}${state.installing}${reset}`, '', `  ${subtle}Please wait…${reset}`);
    return rows.map(row => truncateAnsi(row, columns));
  }
  if (state.confirm) {
    const {install, shell, choice} = state.confirm;
    const label = state.shells.find(item => item.adapter.id === shell)?.adapter.label ?? shell;
    rows.push(`  ${primary}Install ${label}?${reset}`, '', `    ${primary}${install.label}${reset}`, '',
      `  ${subtle}This does NOT change your login shell, run chsh, modify shell startup files, or use sudo.${reset}`, '',
      `  ${choice === 'no' ? `${accent}[ No ]${reset}` : `${subtle}  No  ${reset}`}   ${choice === 'yes' ? `${accent}[ Yes ]${reset}` : `${subtle}  Yes  ${reset}`}`,
      '', renderControls([['←→', 'choose'], ['Enter', 'confirm'], ['Esc', 'cancel']]));
    return rows.map(row => truncateAnsi(row, columns));
  }
  state.shells.forEach((item, index) => {
    const selected = index === state.selected;
    const tags = [item.adapter.id === state.current ? 'this session' : '', item.adapter.id === state.defaultShell ? 'default' : ''].filter(Boolean).join(' · ');
    const status = item.executable ? `${item.version ?? item.executable}` : 'not installed here';
    rows.push(`${selected ? `${accent}${GLYPHS.selection}` : ' '} ${selected ? primary : secondary}${item.adapter.label.padEnd(6)}${reset} ${subtle}${status}${tags ? `  [${tags}]` : ''}${reset}`);
    if (selected && !item.executable && item.reason) rows.push(`    ${subtle}${item.reason}${state.installFor?.(item.adapter.id).kind === 'recipe' ? ' · I installs it (previewed first)' : ''}${reset}`);
    if (selected && item.executable && item.adapter.id !== 'zsh') {
      const caps = item.adapter.capabilities;
      rows.push(`    ${subtle}completion ${caps.completion}${caps.completionDescriptions ? ' with descriptions' : ', names only'} · history: ${caps.privateHistory}${reset}`);
    }
  });
  rows.push('', `  ${subtle}Switching starts the selected shell in the current directory. Shell-local state (aliases, functions, variables, jobs)${reset}`,
    `  ${subtle}belongs to the old shell and does not carry over. NMSh history, transcript and settings do.${reset}`);
  if (state.blocked) rows.push('', `  ${secondary}${state.blocked}${reset}`);
  if (state.message) rows.push('', `  ${secondary}${state.message}${reset}`);
  rows.push('', renderControls([['↑↓', 'select'], ['Enter', 'switch this session'], ['D', 'set default for new sessions'], ['I', 'install missing'], ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}
