import type {PromptConfiguration} from './configuration.js';
import type {StarshipStatus} from './starship.js';
import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';

export type PromptPanelStep = 'provider' | 'starship' | 'layout' | 'appearance' | 'installConfirm';
export interface PromptPanelState {
  onboarding: boolean;
  step: PromptPanelStep;
  selectedIndex: number;
  draft: PromptConfiguration;
  starshipStatus?: StarshipStatus;
  message?: string;
}

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const ACCENT = foreground(UI_COLORS.accent);
const RESET = '\u001B[0m';

function endStyleLabel(value: PromptConfiguration['nmsh']['endStyle']): string {
  switch (value) {
    case 'fadeWedge': return 'Fading wedge';
    case 'wedge': return 'Wedge';
    case 'fadeFlat': return 'Fading flat';
    case 'flat': return 'Flat';
  }
}

export function promptPanelItemCount(state: PromptPanelState): number {
  switch (state.step) {
    case 'provider': return 2;
    case 'starship': return state.starshipStatus?.installed ? 4 : 3;
    case 'layout': return 2;
    case 'appearance': return 2;
    case 'installConfirm': return 2;
  }
}

export function handlePromptPanelKey(key: Key, state: PromptPanelState): boolean {
  if (key.kind === 'up') state.selectedIndex = (state.selectedIndex - 1 + promptPanelItemCount(state)) % promptPanelItemCount(state);
  else if (key.kind === 'down') state.selectedIndex = (state.selectedIndex + 1) % promptPanelItemCount(state);
  else if (key.kind === 'left' || key.kind === 'right') {
    const delta = key.kind === 'left' ? -1 : 1;
    if (state.step === 'provider') state.selectedIndex = (state.selectedIndex + delta + 2) % 2;
    else if (state.step === 'layout') state.selectedIndex = (state.selectedIndex + delta + 2) % 2;
    else if (state.step === 'appearance' && state.selectedIndex === 0) state.draft.nmsh.gapEnabled = !state.draft.nmsh.gapEnabled;
    else if (state.step === 'appearance' && state.selectedIndex === 1) {
      const values = ['fadeWedge', 'wedge', 'fadeFlat', 'flat'] as const;
      const current = values.indexOf(state.draft.nmsh.endStyle);
      state.draft.nmsh.endStyle = values[(current + delta + values.length) % values.length]!;
    }
  } else return false;
  state.message = undefined;
  return true;
}

export function renderPromptPanel(state: PromptPanelState, columns: number, preview: string[]): string[] {
  const title = state.onboarding ? 'Prompt setup' : 'Prompt settings';
  const rows = [`${PRIMARY}  ${title}${RESET}`, ''];
  const item = (index: number, text: string) => `${index === state.selectedIndex ? ACCENT : SECONDARY}${index === state.selectedIndex ? '›' : ' '} ${text}${RESET}`;
  if (state.step === 'provider') {
    rows.push(`${PRIMARY}Choose your prompt${RESET}`);
    rows.push(item(0, `NMSh · built-in lavender prompt${state.draft.provider === 'nmsh' ? '  ●' : ''}`));
    rows.push(item(1, `Starship · use its themes/configuration${state.draft.provider === 'starship' ? '  ●' : ''}`));
  } else if (state.step === 'starship') {
    rows.push(`${PRIMARY}Starship${RESET}`);
    if (state.starshipStatus?.installed) {
      rows.push(`${SECONDARY}Detected ${state.starshipStatus.version ?? 'binary'}${RESET}`);
      rows.push(`${SECONDARY}Config ${state.starshipStatus.configPath}${state.starshipStatus.configExists ? '' : ' (defaults)'}${RESET}`);
      rows.push(item(0, 'Use existing configuration / defaults'));
      rows.push(item(1, 'Show preset setup command'));
      rows.push(item(2, 'Use NMSh for now'));
      rows.push(item(3, 'Back'));
    } else {
      rows.push(`${SECONDARY}Starship is not installed.${RESET}`);
      rows.push(item(0, process.platform === 'darwin' ? 'Install with Homebrew · brew install starship' : 'Install Starship using its official guide'));
      rows.push(item(1, 'Use NMSh for now'));
      rows.push(item(2, 'Back'));
    }
  } else if (state.step === 'installConfirm') {
    rows.push(`${PRIMARY}Run this command?${RESET}`);
    rows.push(`${SECONDARY}brew install starship${RESET}`);
    rows.push(item(0, 'Install Starship now'));
    rows.push(item(1, 'Back'));
  } else if (state.step === 'layout') {
    rows.push(`${PRIMARY}Choose composer layout${RESET}`);
    rows.push(item(0, `Two-line${state.draft.composerLayout === 'twoLine' ? '  ●' : ''}`));
    rows.push(item(1, `One-line${state.draft.composerLayout === 'oneLine' ? '  ●' : ''}`));
  } else {
    rows.push(`${PRIMARY}NMSh appearance${RESET}`);
    rows.push(item(0, `Gap · ${state.draft.nmsh.gapEnabled ? 'On' : 'Off'}`));
    rows.push(item(1, `Ending · ${endStyleLabel(state.draft.nmsh.endStyle)}`));
  }
  if (state.message) rows.push(`${SECONDARY}${state.message}${RESET}`);
  if (preview.length) {
    rows.push('');
    const selectedLayout = state.step === 'layout'
      ? state.selectedIndex === 1 ? 'oneLine' : 'twoLine'
      : state.draft.composerLayout;
    rows.push(`${PRIMARY}${selectedLayout === 'oneLine' ? 'One-line preview' : 'Two-line preview'}${RESET}`);
    rows.push(...preview);
  }
  rows.push('');
  rows.push(`${SECONDARY}↑↓ select · ←→ adjust · Enter choose · Esc ${state.onboarding ? 'skip' : 'cancel'}${RESET}`);
  return rows.map(row => truncateAnsi(row, columns));
}
