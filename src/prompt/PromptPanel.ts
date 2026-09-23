import {
  applyNativeGapChoice,
  NATIVE_PALETTE_IDS,
  nativeGapChoice,
  type NativeGapChoice,
  type PromptConfiguration,
} from './configuration.js';
import {NATIVE_PROMPT_THEMES} from './prompt.js';
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
  /** The configuration currently in effect; the draft is only a preview until saved. */
  saved?: PromptConfiguration;
  starshipStatus?: StarshipStatus;
  message?: string;
}

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const ACCENT = foreground(UI_COLORS.accent);
const SUBTLE = foreground(UI_COLORS.subtle);
const RESET = '\u001B[0m';
const GAP_CHOICES: readonly NativeGapChoice[] = ['off', 'compact', 'normal'];
const END_STYLES = ['fadeWedge', 'wedge', 'fadeFlat', 'flat'] as const;

function cycle<T>(values: readonly T[], current: T, delta: number): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + delta + values.length) % values.length]!;
}

function gapLabel(value: NativeGapChoice): string {
  return value === 'off' ? 'Off · connected' : value === 'compact' ? 'Compact' : 'Normal';
}

function startStyleLabel(value: PromptConfiguration['nmsh']['startStyle']): string {
  return value === 'flat' ? 'Flat' : 'Pointed';
}

function layoutLabel(value: PromptConfiguration['composerLayout']): string {
  return value === 'oneLine' ? 'one-line' : 'two-line';
}

/** One-line summary of an effective configuration. */
export function describePromptConfiguration(configuration: PromptConfiguration): string {
  if (configuration.provider === 'starship') return `Starship · ${layoutLabel(configuration.composerLayout)}`;
  return [
    NATIVE_PROMPT_THEMES[configuration.nmsh.palette].label,
    layoutLabel(configuration.composerLayout),
    `${startStyleLabel(configuration.nmsh.startStyle).toLowerCase()} start`,
    `gap ${nativeGapChoice(configuration)}`,
    endStyleLabel(configuration.nmsh.endStyle).toLowerCase(),
  ].join(' · ');
}

export function promptDraftChanged(state: PromptPanelState): boolean {
  return Boolean(state.saved) && describePromptConfiguration(state.draft) !== describePromptConfiguration(state.saved!);
}

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
    case 'appearance': return 4;
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
    else if (state.step === 'appearance') {
      const nmsh = state.draft.nmsh;
      if (state.selectedIndex === 0) nmsh.palette = cycle(NATIVE_PALETTE_IDS, nmsh.palette, delta);
      else if (state.selectedIndex === 1) nmsh.startStyle = nmsh.startStyle === 'flat' ? 'pointed' : 'flat';
      else if (state.selectedIndex === 2) applyNativeGapChoice(state.draft, cycle(GAP_CHOICES, nativeGapChoice(state.draft), delta));
      else nmsh.endStyle = cycle(END_STYLES, nmsh.endStyle, delta);
    }
  } else return false;
  state.message = undefined;
  return true;
}

/**
 * `themePreviews` holds one live native prompt per palette, in
 * NATIVE_PALETTE_IDS order; it is shown only while editing appearance.
 */
export function renderPromptPanel(state: PromptPanelState, columns: number, preview: string[], themePreviews: string[] = []): string[] {
  const title = state.onboarding ? 'Prompt setup' : 'Prompt settings';
  const rows = [`${PRIMARY}  ${title}${RESET}`];
  if (state.saved) rows.push(`${SUBTLE}  Current  ${SECONDARY}${describePromptConfiguration(state.saved)}${RESET}`);
  rows.push('');
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
    const saved = state.saved?.nmsh;
    const value = (text: string, savedText: string | undefined) => savedText === undefined || savedText === text
      ? `‹ ${text} ›`
      : `‹ ${text} ›  ${SUBTLE}saved: ${savedText}`;
    const savedGap = state.saved ? gapLabel(nativeGapChoice(state.saved)) : undefined;
    rows.push(`${PRIMARY}NMSh appearance${RESET}`);
    rows.push(item(0, `Theme   ${value(NATIVE_PROMPT_THEMES[state.draft.nmsh.palette].label, saved && NATIVE_PROMPT_THEMES[saved.palette].label)}`));
    rows.push(item(1, `Start   ${value(startStyleLabel(state.draft.nmsh.startStyle), saved && startStyleLabel(saved.startStyle))}`));
    rows.push(item(2, `Gap     ${value(gapLabel(nativeGapChoice(state.draft)), savedGap)}`));
    rows.push(item(3, `Ending  ${value(endStyleLabel(state.draft.nmsh.endStyle), saved && endStyleLabel(saved.endStyle))}`));
    if (themePreviews.length) {
      rows.push('');
      rows.push(`${PRIMARY}Themes${RESET}  ${SUBTLE}● selected  ✓ saved${RESET}`);
      NATIVE_PALETTE_IDS.forEach((id, index) => {
        const theme = NATIVE_PROMPT_THEMES[id];
        const marker = state.draft.nmsh.palette === id ? `${ACCENT}●` : `${SUBTLE}○`;
        const savedMark = saved?.palette === id ? '✓' : ' ';
        const label = `${theme.label}${' '.repeat(Math.max(1, 16 - theme.label.length))}`;
        rows.push(`${marker} ${SECONDARY}${label}${ACCENT}${savedMark}${RESET} ${themePreviews[index] ?? ''}${RESET}`);
      });
    }
  }
  if (state.message) rows.push(`${SECONDARY}${state.message}${RESET}`);
  if (preview.length) {
    rows.push('');
    const selectedLayout = state.step === 'layout'
      ? state.selectedIndex === 1 ? 'oneLine' : 'twoLine'
      : state.draft.composerLayout;
    const status = promptDraftChanged(state) ? `${ACCENT}unsaved preview` : state.saved ? `${SUBTLE}matches current` : '';
    rows.push(`${PRIMARY}${selectedLayout === 'oneLine' ? 'One-line preview' : 'Two-line preview'}${RESET}${status ? `  ${status}${RESET}` : ''}`);
    rows.push(...preview);
  }
  rows.push('');
  const enter = state.step === 'appearance' ? 'Enter save' : 'Enter choose';
  rows.push(`${SECONDARY}↑↓ select · ←→ adjust · ${enter} · Esc ${state.onboarding ? 'skip' : 'cancel'}${RESET}`);
  return rows.map(row => truncateAnsi(row, columns));
}
