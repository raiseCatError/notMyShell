import {
  applyNativeGapChoice,
  NATIVE_PALETTE_IDS,
  nativeGapChoice,
  type NativeGapChoice,
  type PromptConfiguration,
} from './configuration.js';
import {NATIVE_PROMPT_THEMES} from './prompt.js';
import {POWERLINE_EDGE_STYLES, POWERLINE_SHAPES, type PowerlineEdgeStyle, type PowerlineShape} from './powerline.js';
import {renderControls} from '../ui/controls.js';
import type {StarshipStatus} from './starship.js';
import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';

export type PromptPanelStep = 'provider' | 'starship' | 'layout' | 'appearance' | 'modules' | 'installConfirm';
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
const APPEARANCE_ROWS = ['theme', 'start', 'connector', 'gap', 'end', 'icons', 'modules'] as const;
export const APPEARANCE_MODULES_ROW = APPEARANCE_ROWS.indexOf('modules');

const SHAPE_LABELS: Record<PowerlineShape, string> = {
  wedge: 'Wedge', flat: 'Flat', rounded: 'Rounded', slash: 'Slant /', backslash: 'Slant \\',
};

export function edgeStyleLabel(value: PowerlineEdgeStyle): string {
  switch (value) {
    case 'fadeWedge': return 'Fading wedge';
    case 'fadeFlat': return 'Fading flat';
    case 'fadeRounded': return 'Fading rounded';
    case 'fadeSlash': return 'Fading slant';
    default: return SHAPE_LABELS[value];
  }
}

const MODULE_LABELS: Record<PromptConfiguration['modules'][number]['id'], string> = {
  project: 'Project', cwd: 'Path', gitBranch: 'Git branch', toolchain: 'Toolchains', exitStatus: 'Exit status',
};

function cycle<T>(values: readonly T[], current: T, delta: number): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + delta + values.length) % values.length]!;
}

function gapLabel(value: NativeGapChoice): string {
  return value === 'off' ? 'Off · connected' : value === 'compact' ? 'Compact' : 'Normal';
}

/**
 * Layout choices write the existing `composerLayout` and `placement` keys.
 * `placement` only matters in two-line mode: `header` draws the prompt row as
 * the composer's divider, `composer` adds a border and places it inside.
 * One-line leaves the stored placement untouched.
 */
export const LAYOUT_CHOICES = [
  {label: 'Two-line · prompt row is the divider', summary: 'two-line divider', composerLayout: 'twoLine', placement: 'header'},
  {label: 'Two-line · prompt inside bordered composer', summary: 'two-line inside', composerLayout: 'twoLine', placement: 'composer'},
  {label: 'One-line · prompt inline with input', summary: 'one-line', composerLayout: 'oneLine', placement: undefined},
] as const;

export function layoutChoiceIndex(configuration: PromptConfiguration): number {
  if (configuration.composerLayout === 'oneLine') return 2;
  return configuration.placement === 'composer' ? 1 : 0;
}

export function applyLayoutChoice(configuration: PromptConfiguration, index: number): void {
  const choice = LAYOUT_CHOICES[Math.max(0, Math.min(LAYOUT_CHOICES.length - 1, index))]!;
  configuration.composerLayout = choice.composerLayout;
  if (choice.placement) configuration.placement = choice.placement;
}

function layoutLabel(configuration: PromptConfiguration): string {
  return LAYOUT_CHOICES[layoutChoiceIndex(configuration)]!.summary;
}

/** One-line summary of an effective configuration. */
export function describePromptConfiguration(configuration: PromptConfiguration): string {
  if (configuration.provider === 'starship') return `Starship · ${layoutLabel(configuration)}`;
  const nmsh = configuration.nmsh;
  return [
    NATIVE_PROMPT_THEMES[nmsh.palette].label,
    layoutLabel(configuration),
    `${edgeStyleLabel(nmsh.startStyle).toLowerCase()} start`,
    `${SHAPE_LABELS[nmsh.connector].toLowerCase()} joins`,
    `gap ${nativeGapChoice(configuration)}`,
    `${edgeStyleLabel(nmsh.endStyle).toLowerCase()} end`,
    `icons ${nmsh.icons === 'off' ? 'off' : 'on'}`,
  ].join(' · ');
}

export function promptDraftChanged(state: PromptPanelState): boolean {
  if (!state.saved) return false;
  const comparable = (configuration: PromptConfiguration) => JSON.stringify({...configuration, onboardingComplete: undefined});
  return comparable(state.draft) !== comparable(state.saved);
}

function moduleOption(module: PromptConfiguration['modules'][number]): string {
  switch (module.id) {
    case 'gitBranch': return 'in repositories';
    case 'toolchain': return 'when detected';
    case 'exitStatus': return module.condition === 'always' ? 'always' : 'on failure';
    default: return 'always';
  }
}

/** Space toggles, ←→ changes the module's option, Shift+↑↓ reorders. */
function handleModulesKey(key: Key, state: PromptPanelState): boolean {
  const modules = state.draft.modules;
  const index = state.selectedIndex;
  const module = modules[index];
  if (!module) return false;
  if (key.kind === 'text' && key.value === ' ') module.visible = !module.visible;
  else if ((key.kind === 'left' || key.kind === 'right') && module.id === 'exitStatus') {
    module.condition = module.condition === 'always' ? 'nonzeroExit' : 'always';
  } else if (key.kind === 'selectUp' || key.kind === 'selectDown') {
    const target = index + (key.kind === 'selectUp' ? -1 : 1);
    if (target < 0 || target >= modules.length) return true;
    [modules[index], modules[target]] = [modules[target]!, modules[index]!];
    state.selectedIndex = target;
  } else return false;
  return true;
}

export function promptPanelControls(state: PromptPanelState): Array<[string, string]> {
  const escape: [string, string] = ['Esc', state.onboarding ? 'skip' : 'cancel'];
  if (state.step === 'modules') {
    return [['↑↓', 'move'], ['Space', 'show/hide'], ['Shift+↑↓', 'reorder'], ['←→', 'option'], ['Enter/Esc', 'done']];
  }
  if (state.step === 'appearance') {
    const onModules = state.selectedIndex === APPEARANCE_MODULES_ROW;
    return [['↑↓', 'move'], ['←→', 'change'], ['Enter', onModules ? 'edit modules' : 'save'], escape];
  }
  return [['↑↓', 'move'], ['Enter', 'choose'], escape];
}

export function promptPanelItemCount(state: PromptPanelState): number {
  switch (state.step) {
    case 'provider': return 2;
    case 'starship': return state.starshipStatus?.installed ? 4 : 3;
    case 'layout': return LAYOUT_CHOICES.length;
    case 'appearance': return APPEARANCE_ROWS.length;
    case 'modules': return state.draft.modules.length;
    case 'installConfirm': return 2;
  }
}

export function handlePromptPanelKey(key: Key, state: PromptPanelState): boolean {
  if (state.step === 'modules' && handleModulesKey(key, state)) {
    state.message = undefined;
    return true;
  }
  if (key.kind === 'up') state.selectedIndex = (state.selectedIndex - 1 + promptPanelItemCount(state)) % promptPanelItemCount(state);
  else if (key.kind === 'down') state.selectedIndex = (state.selectedIndex + 1) % promptPanelItemCount(state);
  else if (key.kind === 'left' || key.kind === 'right') {
    const delta = key.kind === 'left' ? -1 : 1;
    if (state.step === 'provider') state.selectedIndex = (state.selectedIndex + delta + 2) % 2;
    else if (state.step === 'layout') state.selectedIndex = (state.selectedIndex + delta + LAYOUT_CHOICES.length) % LAYOUT_CHOICES.length;
    else if (state.step === 'appearance') {
      const nmsh = state.draft.nmsh;
      switch (APPEARANCE_ROWS[state.selectedIndex]) {
        case 'theme': nmsh.palette = cycle(NATIVE_PALETTE_IDS, nmsh.palette, delta); break;
        case 'start': nmsh.startStyle = cycle(POWERLINE_EDGE_STYLES, nmsh.startStyle, delta); break;
        case 'connector': nmsh.connector = cycle(POWERLINE_SHAPES, nmsh.connector, delta); break;
        case 'gap': applyNativeGapChoice(state.draft, cycle(GAP_CHOICES, nativeGapChoice(state.draft), delta)); break;
        case 'end': nmsh.endStyle = cycle(POWERLINE_EDGE_STYLES, nmsh.endStyle, delta); break;
        case 'icons': nmsh.icons = nmsh.icons === 'off' ? 'nerd' : 'off'; break;
        default: return false;
      }
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
    const draftChoice = layoutChoiceIndex(state.draft);
    const savedChoice = state.saved ? layoutChoiceIndex(state.saved) : -1;
    LAYOUT_CHOICES.forEach((choice, index) => rows.push(item(index,
      `${choice.label}${index === draftChoice ? '  ●' : ''}${index === savedChoice ? '  ✓ saved' : ''}`)));
  } else if (state.step === 'modules') {
    rows.push(`${PRIMARY}Prompt modules${RESET}  ${SUBTLE}left to right, in prompt order${RESET}`);
    state.draft.modules.forEach((module, index) => {
      const shown = module.visible ? `${ACCENT}●` : `${SUBTLE}○`;
      const option = module.id === 'exitStatus' ? `‹ ${moduleOption(module)} ›` : moduleOption(module);
      rows.push(`${index === state.selectedIndex ? `${ACCENT}›` : ' '} ${shown} ${index === state.selectedIndex ? PRIMARY : SECONDARY}${MODULE_LABELS[module.id].padEnd(13)}${SUBTLE}${module.visible ? option : 'hidden'}${RESET}`);
    });
  } else {
    const saved = state.saved?.nmsh;
    const value = (text: string, savedText: string | undefined) => savedText === undefined || savedText === text
      ? `‹ ${text} ›`
      : `‹ ${text} ›  ${SUBTLE}saved: ${savedText}`;
    const savedGap = state.saved ? gapLabel(nativeGapChoice(state.saved)) : undefined;
    const draft = state.draft.nmsh;
    const iconLabel = (mode: PromptConfiguration['nmsh']['icons']) => mode === 'off' ? 'Off' : 'On';
    const visibleModules = state.draft.modules.filter(module => module.visible).length;
    rows.push(`${PRIMARY}NMSh appearance${RESET}`);
    rows.push(item(0, `Theme      ${value(NATIVE_PROMPT_THEMES[draft.palette].label, saved && NATIVE_PROMPT_THEMES[saved.palette].label)}`));
    rows.push(item(1, `Start      ${value(edgeStyleLabel(draft.startStyle), saved && edgeStyleLabel(saved.startStyle))}`));
    rows.push(item(2, `Connector  ${value(SHAPE_LABELS[draft.connector], saved && SHAPE_LABELS[saved.connector])}`));
    rows.push(item(3, `Gap        ${value(gapLabel(nativeGapChoice(state.draft)), savedGap)}`));
    rows.push(item(4, `End        ${value(edgeStyleLabel(draft.endStyle), saved && edgeStyleLabel(saved.endStyle))}`));
    rows.push(item(5, `Icons      ${value(iconLabel(draft.icons), saved && iconLabel(saved.icons))}`));
    rows.push(item(6, `Modules    ${visibleModules} of ${state.draft.modules.length} shown ›`));
    if (themePreviews.length) {
      rows.push('');
      rows.push(`${PRIMARY}Themes${RESET}  ${SUBTLE}● selected  ✓ saved${RESET}`);
      NATIVE_PALETTE_IDS.forEach((id, index) => {
        const theme = NATIVE_PROMPT_THEMES[id];
        const marker = state.draft.nmsh.palette === id ? `${ACCENT}●` : `${SUBTLE}○`;
        const savedMark = saved?.palette === id ? '✓' : ' ';
        const label = theme.label.padEnd(17);
        rows.push(`${marker} ${SECONDARY}${label}${ACCENT}${savedMark}${RESET} ${themePreviews[index] ?? ''}${RESET}`);
      });
    }
  }
  if (state.message) rows.push(`${SECONDARY}${state.message}${RESET}`);
  if (preview.length) {
    rows.push('');
    const selectedLayout = state.step === 'layout'
      ? LAYOUT_CHOICES[state.selectedIndex]?.composerLayout ?? state.draft.composerLayout
      : state.draft.composerLayout;
    const status = promptDraftChanged(state) ? `${ACCENT}unsaved preview` : state.saved ? `${SUBTLE}matches current` : '';
    rows.push(`${PRIMARY}${selectedLayout === 'oneLine' ? 'One-line preview' : 'Two-line preview'}${RESET}${status ? `  ${status}${RESET}` : ''}`);
    rows.push(...preview);
  }
  rows.push('');
  rows.push(renderControls(promptPanelControls(state)));
  return rows.map(row => truncateAnsi(row, columns));
}
