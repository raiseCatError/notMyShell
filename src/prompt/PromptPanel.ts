import {
  applyNativeGapChoice,
  NATIVE_PALETTE_IDS,
  nativeGapChoice,
  type NativeGapChoice,
  type PromptConfiguration,
  type PromptProviderId,
} from './configuration.js';
import {NATIVE_PROMPT_THEMES} from './prompt.js';
import {POWERLINE_EDGE_STYLES, POWERLINE_SHAPES, type PowerlineEdgeStyle, type PowerlineShape} from './powerline.js';
import {renderControls} from '../ui/controls.js';
import type {StarshipStatus} from './starship.js';
import {STARSHIP_MODULES, type StarshipConfigProposal} from './StarshipConfigAdapter.js';
import type {Powerlevel10kStatus} from './powerlevel10k.js';
import {powerlevel10kZshrcPath, type ConfiguratorPreparation} from './Powerlevel10kConfigurator.js';
import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {stripAnsi, truncateAnsi} from '../util/text.js';
import {renderTaskProgress, type TaskProgress} from '../status/TaskProgress.js';

export type PromptPanelStep = 'provider' | 'starship' | 'starshipModules' | 'starshipConfirm' | 'powerlevel10k' | 'p10kConfirm' | 'p10kReady' | 'p10kResult' | 'layout' | 'appearance' | 'modules' | 'installConfirm' | 'installProgress' | 'installResult' | 'installDetails';
export interface PromptPanelState {
  onboarding: boolean;
  step: PromptPanelStep;
  selectedIndex: number;
  draft: PromptConfiguration;
  /** The configuration currently in effect; the draft is only a preview until saved. */
  saved?: PromptConfiguration;
  starshipStatus?: StarshipStatus;
  p10kStatus?: Powerlevel10kStatus;
  p10kPreparation?: ConfiguratorPreparation;
  p10kResult?: string[];
  message?: string;
  task?: TaskProgress;
  starshipModules?: boolean[];
  starshipProposal?: StarshipConfigProposal;
}

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const ACCENT = foreground(UI_COLORS.accent);
const SUBTLE = foreground(UI_COLORS.subtle);
const RESET = '\u001B[0m';
const GAP_CHOICES: readonly NativeGapChoice[] = ['off', 'compact', 'normal'];
export const PROVIDER_ORDER: readonly PromptProviderId[] = ['nmsh', 'starship', 'powerlevel10k'];

export function providerLabel(provider: PromptProviderId): string {
  return provider === 'nmsh' ? 'NMSh Native' : provider === 'starship' ? 'Starship' : 'Powerlevel10k';
}

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

export function layoutLabel(configuration: PromptConfiguration): string {
  return LAYOUT_CHOICES[layoutChoiceIndex(configuration)]!.summary;
}

/** One-line summary of an effective configuration. */
export function describePromptConfiguration(configuration: PromptConfiguration): string {
  if (configuration.provider !== 'nmsh') return `${providerLabel(configuration.provider)} · ${layoutLabel(configuration)}`;
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
  if (state.step === 'installProgress') return [['Please wait', 'installation in progress']];
  if (state.step === 'installResult') return [['Enter', state.task?.state.status === 'failed' ? 'details' : 'continue'], ['D', 'details'], ['Esc', 'back']];
  if (state.step === 'installDetails') return [['Enter/Esc', 'back']];
  if (state.step === 'starshipModules') return [['↑↓', 'move'], ['Enter', 'edit'], ['Esc', 'back']];
  if (state.step === 'starshipConfirm') return [['↑↓', 'move'], ['Enter', 'choose'], ['Esc', 'cancel']];
  if (state.step === 'p10kResult') return [['Enter/Esc', 'back']];
  if (state.step === 'p10kConfirm' || state.step === 'p10kReady') return [['↑↓', 'move'], ['Enter', 'choose'], ['Esc', 'cancel']];
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
    case 'provider': return PROVIDER_ORDER.length;
    case 'powerlevel10k': return state.p10kStatus?.installed ? 4 : 2;
    case 'p10kConfirm': case 'p10kReady': return 2;
    case 'p10kResult': return 1;
    case 'starship': return state.starshipStatus?.installed ? 5 : 3;
    case 'starshipModules': return STARSHIP_MODULES.length;
    case 'starshipConfirm': return 2;
    case 'layout': return LAYOUT_CHOICES.length;
    case 'appearance': return APPEARANCE_ROWS.length;
    case 'modules': return state.draft.modules.length;
    case 'installConfirm': return 2;
    case 'installProgress': case 'installResult': case 'installDetails': return 1;
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
    if (state.step === 'provider') state.selectedIndex = (state.selectedIndex + delta + PROVIDER_ORDER.length) % PROVIDER_ORDER.length;
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
export function renderPromptPanel(state: PromptPanelState, columns: number, preview: string[], themePreviews: string[] = [], rowsAvailable = Infinity): string[] {
  const title = state.onboarding ? 'Prompt setup' : 'Prompt settings';
  const rows = [`${PRIMARY}  ${title}${RESET}`];
  if (state.saved) rows.push(`${SUBTLE}  Current  ${SECONDARY}${describePromptConfiguration(state.saved)}${RESET}`);
  rows.push('');
  const item = (index: number, text: string) => `${index === state.selectedIndex ? ACCENT : SECONDARY}${index === state.selectedIndex ? '›' : ' '} ${text}${RESET}`;
  if (state.step === 'provider') {
    rows.push(`${PRIMARY}Choose your prompt${RESET}`);
    const descriptions: Record<PromptProviderId, string> = {
      nmsh: 'NMSh Native · built-in themes, geometry, and modules',
      starship: 'Starship · use its themes/configuration',
      powerlevel10k: 'Powerlevel10k · use your ~/.p10k.zsh left prompt',
    };
    PROVIDER_ORDER.forEach((provider, index) => rows.push(item(index,
      `${descriptions[provider]}${state.draft.provider === provider ? '  ●' : ''}${state.saved?.provider === provider ? '  ✓ saved' : ''}`)));
  } else if (state.step === 'starship') {
    rows.push(`${PRIMARY}Starship${RESET}`);
    if (state.starshipStatus?.installed) {
      rows.push(`${SECONDARY}Detected ${state.starshipStatus.version ?? 'binary'}${RESET}`);
      rows.push(`${SECONDARY}Config ${state.starshipStatus.configPath}${state.starshipStatus.configExists ? '' : ' (defaults)'}${RESET}`);
      rows.push(item(0, 'Use existing configuration / defaults'));
      rows.push(item(1, 'Configure modules'));
      rows.push(item(2, 'Show preset setup command'));
      rows.push(item(3, 'Use NMSh for now'));
      rows.push(item(4, 'Back'));
    } else {
      rows.push(`${SECONDARY}Starship is not installed.${RESET}`);
      rows.push(item(0, process.platform === 'darwin' ? 'Install with Homebrew · brew install starship' : 'Install Starship using its official guide'));
      rows.push(item(1, 'Use NMSh for now'));
      rows.push(item(2, 'Back'));
    }
  } else if (state.step === 'starshipModules') {
    rows.push(`${PRIMARY}Starship modules${RESET}`);
    rows.push(`${SUBTLE}Edit supported modules using Starship's config command.${RESET}`);
    STARSHIP_MODULES.forEach((module, index) => rows.push(item(index,
      `${module.padEnd(16)} ${state.starshipModules?.[index] ? 'Disabled' : 'Enabled'}`)));
  } else if (state.step === 'starshipConfirm') {
    const proposal = state.starshipProposal;
    rows.push(`${PRIMARY}Review Starship config change${RESET}`);
    if (proposal) {
      rows.push(`${SECONDARY}${proposal.path}${RESET}`);
      rows.push(`${SUBTLE}${proposal.module}: ${proposal.disabled ? 'disable' : 'enable'}${RESET}`);
      rows.push(...proposal.diff.map(line => `${SECONDARY}  ${stripAnsi(line).replace(/[\u0000-\u001f\u007f]/gu, '?')}${RESET}`));
      rows.push(`${SUBTLE}An existing file will be backed up before the change.${RESET}`);
    }
    rows.push(item(0, 'Apply reviewed change'));
    rows.push(item(1, 'Cancel'));
  } else if (state.step === 'powerlevel10k') {
    rows.push(`${PRIMARY}Powerlevel10k${RESET}`);
    const status = state.p10kStatus;
    if (status?.installed) {
      rows.push(`${SECONDARY}Theme ${status.themePath}${RESET}`);
      rows.push(`${SECONDARY}Config ${status.configPath}${status.configExists ? '' : ' (not found; p10k defaults)'}${RESET}`);
      rows.push(`${SUBTLE}Rendered in an isolated zsh; NMSh keeps the editor. Your left prompt is shown without its prompt character;${RESET}`);
      rows.push(`${SUBTLE}git state uses p10k's vcs_info fallback, and the right prompt is not shown yet.${RESET}`);
      rows.push(item(0, 'Use Powerlevel10k'));
      rows.push(item(1, 'Configure Powerlevel10k'));
      rows.push(item(2, 'Use NMSh for now'));
      rows.push(item(3, 'Back'));
    } else {
      rows.push(`${SECONDARY}Powerlevel10k was not found.${RESET}`);
      rows.push(`${SUBTLE}Install it yourself (e.g. brew install powerlevel10k), run p10k configure from /zsh, then reopen /prompt.${RESET}`);
      rows.push(item(0, 'Use NMSh for now'));
      rows.push(item(1, 'Back'));
    }
  } else if (state.step === 'p10kConfirm') {
    rows.push(`${PRIMARY}Run Powerlevel10k's official configurator?${RESET}`);
    rows.push(`${SECONDARY}The wizard may modify:${RESET}`);
    rows.push(`${SECONDARY}  ${state.p10kStatus?.configPath ?? '~/.p10k.zsh'}${RESET}`);
    rows.push(`${SECONDARY}  ${powerlevel10kZshrcPath()}${RESET}`);
    rows.push(`${SUBTLE}NMSh will hand terminal control to the wizard and restore it afterwards.${RESET}`);
    rows.push(item(0, 'Create backups and continue'));
    rows.push(item(1, 'Cancel'));
  } else if (state.step === 'p10kReady') {
    rows.push(`${PRIMARY}Powerlevel10k backup ready${RESET}`);
    for (const file of [state.p10kPreparation?.config, state.p10kPreparation?.zshrc]) {
      if (file) rows.push(`${SECONDARY}  ${file.path}: ${file.backup ?? 'not present before wizard'}${RESET}`);
    }
    rows.push(item(0, 'Launch official wizard'));
    rows.push(item(1, 'Cancel'));
  } else if (state.step === 'p10kResult') {
    rows.push(`${PRIMARY}Powerlevel10k configurator finished${RESET}`);
    rows.push(...(state.p10kResult ?? []).map(line => `${SECONDARY}  ${line}${RESET}`));
  } else if (state.step === 'installConfirm') {
    rows.push(`${PRIMARY}Run this command?${RESET}`);
    rows.push(`${SECONDARY}brew install starship${RESET}`);
    rows.push(item(0, 'Install Starship now'));
    rows.push(item(1, 'Back'));
  } else if (state.step === 'installProgress' || state.step === 'installResult') {
    rows.push(...(state.task ? renderTaskProgress(state.task.state) : [`${SUBTLE}No task is active.${RESET}`]));
  } else if (state.step === 'installDetails') {
    rows.push(`${PRIMARY}Installation details${RESET}`);
    const details = state.task?.state.details.trim() || state.task?.state.error || 'No diagnostic output was captured.';
    rows.push(...details.split(/\r?\n/u).slice(-Math.max(1, Math.min(12, rowsAvailable - 6))).map(line =>
      `${SECONDARY}  ${stripAnsi(line).replace(/[\u0000-\u001f\u007f]/gu, '?')}${RESET}`));
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
