import {colorLevel} from '../presentation/capabilities.js';
import {fullWidthRowBand} from '../ui/PanelShell.js';
import {routeModule} from '../context/surfaceRouter.js';
import {applyModulePlacement, applyShellModuleVisibility, shellModuleVisibility, SHELL_MODULE_VISIBILITY, SHELL_MODULE_VISIBILITY_LABELS, type PromptConfiguration, type ShellModuleVisibility, type ModulePlacement} from '../prompt/configuration.js';
import type {Key} from '../terminal/keys.js';
import {background, focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {renderControls} from '../ui/controls.js';
import {truncateAnsi, displayWidth} from '../util/text.js';
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
  /** Current shared prompt config; display edits are applied immediately by the caller. */
  promptConfiguration?: Pick<PromptConfiguration, 'modules'>;
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
  | {kind: 'indicatorVisibility'; visibility: ShellModuleVisibility} | {kind: 'indicatorSide'; side: ModulePlacement}
  | {kind: 'install'; shell: ShellId; install: Extract<ShellInstall, {kind: 'recipe'}>};

export function createShellPanel(shells: ShellAvailability[], current: ShellId, defaultShell: ShellId, blocked?: string, promptConfiguration?: Pick<PromptConfiguration, 'modules'>): ShellPanelState {
  return {shells, current, defaultShell, promptConfiguration, selected: Math.max(0, shells.findIndex(item => item.adapter.id === current)), ...(blocked ? {blocked} : {})};
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
    const count = state.shells.length + (state.promptConfiguration ? 2 : 0);
    state.selected = (state.selected + (key.kind === 'up' ? count - 1 : 1)) % count;
    state.message = undefined;
    return undefined;
  }
  if (state.promptConfiguration && state.selected >= state.shells.length) {
    if (key.kind !== 'left' && key.kind !== 'right') return undefined;
    if (state.selected === state.shells.length) {
      const current = SHELL_MODULE_VISIBILITY.indexOf(shellModuleVisibility(state.promptConfiguration));
      const delta = key.kind === 'right' ? 1 : -1;
      return {kind: 'indicatorVisibility', visibility: SHELL_MODULE_VISIBILITY[(current + delta + SHELL_MODULE_VISIBILITY.length) % SHELL_MODULE_VISIBILITY.length]!};
    }
    return {kind: 'indicatorSide', side: shellIndicatorSide(state.promptConfiguration) === 'Right' ? 'left' : 'right'};
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
  const statusWidth = Math.max(0, ...state.shells.map(item => shellStatus(item).length));
  state.shells.forEach((item, index) => {
    const selected = index === state.selected;
    const current = item.adapter.id === state.current;
    const badges = shellBadges(item.adapter.id, state).replace('[default]', '\u001b[1m[default]\u001b[22m');
    const detailWidth = Math.max(0, Math.min(statusWidth, columns - 13 - displayWidth(badges) - (badges ? 2 : 0)));
    const detail = truncateAnsi(shellStatus(item), detailWidth).padEnd(detailWidth);
    let row = `${selected ? `${accent}${GLYPHS.selection}` : ' '} ${current ? '✓' : ' '} ${focusForeground(selected)}${item.adapter.label.padEnd(6)}${reset} ${subtle}${detail}${reset}`
      + (badges ? `  ${primary}${badges}${reset}` : '');
    row = truncateAnsi(row, columns);
    if (current) {
      const band = colorLevel() === 'none' ? '\u001b[7m' : background(UI_COLORS.cwdBackground);
      row = fullWidthRowBand(row, columns, band);
    }
    rows.push(row);
    if (selected && !item.executable && item.reason) rows.push(`    ${subtle}${item.reason}${state.installFor?.(item.adapter.id).kind === 'recipe' ? ' · I installs it (previewed first)' : ''}${reset}`);
    if (selected && item.executable && item.adapter.id !== 'zsh') {
      const caps = item.adapter.capabilities;
      rows.push(`    ${subtle}completion ${caps.completion}${caps.completionDescriptions ? ' with descriptions' : ', names only'} · history: ${caps.privateHistory}${reset}`);
    }
  });
  if (state.promptConfiguration) {
    rows.push('', `  ${primary}Prompt shell indicator${reset}`);
    const controls = [
      `Visibility      ‹ ${SHELL_MODULE_VISIBILITY_LABELS[shellModuleVisibility(state.promptConfiguration)]} ›`,
      `Side            ‹ ${shellIndicatorSide(state.promptConfiguration)} ›`,
    ];
    controls.forEach((text, index) => {
      const selected = state.selected === state.shells.length + index;
      rows.push(`${selected ? `${accent}${GLYPHS.selection}` : ' '} ${focusForeground(selected)}${text}${reset}`);
    });
    rows.push(`  ${subtle}←→ changes and saves display settings · /prompt shares this module${reset}`);
  }
  rows.push('', `  ${subtle}[current] runs under this session · [default] starts new sessions · ${GLYPHS.selection} is the selected row${reset}`,
    '', `  ${subtle}Switching keeps this session and its directory, archives this view to /resume and starts a fresh one. Shell-local${reset}`,
    `  ${subtle}state (aliases, functions, variables, jobs) belongs to the old shell and does not carry over. NMSh history and settings do.${reset}`);
  if (state.blocked) rows.push('', `  ${secondary}${state.blocked}${reset}`);
  if (state.message) rows.push('', `  ${secondary}${state.message}${reset}`);
  rows.push('', renderControls([['↑↓', 'select'], ['Enter', 'switch this session'], ['D', 'set default for new sessions'], ['I', 'install missing'], ['Esc', 'close']]));
  return rows.map(row => truncateAnsi(row, columns));
}

function shellStatus(item: ShellPanelState['shells'][number]): string {
  return item.executable ? `${item.version ?? item.executable}` : 'not installed here';
}

/** Plain-text badges, so current and default read without color. */
export function shellBadges(id: ShellId, state: Pick<ShellPanelState, 'current' | 'defaultShell'>): string {
  return [id === state.current ? '[current]' : '', id === state.defaultShell ? '[default]' : ''].filter(Boolean).join(' ');
}

/** Explicit routing wins over legacy placement, just as it does in the prompt. */
function shellIndicatorSide(configuration: Pick<PromptConfiguration, 'modules'>): string {
  const module = configuration.modules.find(item => item.id === 'shell');
  if (!module) return 'Left';
  const surface = routeModule({...module, visible: true, ...(module.surface === 'hidden' ? {surface: undefined} : {})});
  return surface === 'rightContext' ? 'Right' : surface === 'contextRail' ? 'Context Rail (/prompt)' : 'Left';
}

/** Only the shared shell module changes; actual shell selection is independent. */
export function applyShellIndicatorAction(configuration: Pick<PromptConfiguration, 'modules'>,
  action: Extract<ShellPanelAction, {kind: 'indicatorVisibility' | 'indicatorSide'}>): void {
  if (action.kind === 'indicatorVisibility') applyShellModuleVisibility(configuration, action.visibility);
  else {
    let module = configuration.modules.find(item => item.id === 'shell');
    if (!module) {
      applyShellModuleVisibility(configuration, 'whenDifferent');
      module = configuration.modules.find(item => item.id === 'shell')!;
    }
    applyModulePlacement(module, action.side);
  }
}
