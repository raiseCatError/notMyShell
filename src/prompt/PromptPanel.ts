import {
  applyNativeGapChoice,
  CONNECTOR_FADE_STYLES,
  GIT_COLOR_MODES,
  GIT_CONNECTOR_FADES,
  GIT_GEOMETRIES,
  type GitConnectorFade,
  type GitGeometry,
  NATIVE_PALETTE_IDS,
  type ConnectorFadeStyle,
  type GitColorMode,
  nativeGapChoice,
  type NativeGapChoice,
  type PromptConfiguration,
  type PromptProviderId,
  modulePlacement,
  ON_COMMAND_MODULES,
} from './configuration.js';
import {NATIVE_PROMPT_THEMES, RICH_GIT_SHOWCASE} from './prompt.js';
import {fadeColorChoices, POWERLINE_EDGE_STYLES, POWERLINE_SHAPES, PROMPT_STYLES, PROMPT_STYLE_LABELS, type ConnectorFadeColors, type PowerlineEdgeStyle, type PowerlineShape} from './powerline.js';
import {PROMPT_STYLE_NOTES, STYLE_OPTION_LABELS, STYLE_PROFILE_OPTIONS, type ProfiledStyle} from './styles.js';
import {VIBRANCE_LABELS, VIBRANCE_LEVELS, parseHexColor} from '../chroma/color.js';
import {
  MAX_CUSTOM_STOPS, MIN_CUSTOM_STOPS, motionHasDirection, PRESET_STOPS, TREATMENT_CURVE_LABELS, TREATMENT_CURVES, TREATMENT_DIRECTIONS,
  TREATMENT_GEOMETRIES, TREATMENT_GEOMETRY_LABELS, TREATMENT_INFLUENCES, TREATMENT_MOTION_LABELS, TREATMENT_MOTIONS, TREATMENT_PRESET_LABELS,
  TREATMENT_PRESETS, TREATMENT_SCOPE_LABELS, TREATMENT_SCOPES, TREATMENT_SPEED_LABELS, TREATMENT_SPEEDS, treatmentInfluence, treatmentSwatch,
} from '../chroma/treatment.js';
import {isReducedMotion} from '../presentation/environment.js';
import {colorEscape} from '../chroma/escape.js';
import {renderControls} from '../ui/controls.js';
import {renderTabStrip} from '../ui/PanelShell.js';
import type {StarshipStatus} from './starship.js';
import {STARSHIP_MODULES, type StarshipConfigProposal} from './StarshipConfigAdapter.js';
import type {Powerlevel10kStatus} from './powerlevel10k.js';
import {powerlevel10kZshrcPath, type ConfiguratorPreparation} from './Powerlevel10kConfigurator.js';
import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {stripAnsi, truncateAnsi} from '../util/text.js';
import {renderTaskProgress, type TaskProgress} from '../status/TaskProgress.js';
import {providerRowText, type ProviderDescriptor} from '../providers/providers.js';

export type PromptPanelStep = 'provider' | 'starship' | 'starshipModules' | 'starshipConfirm' | 'powerlevel10k' | 'p10kConfirm' | 'p10kReady' | 'p10kResult' | 'layout' | 'appearance' | 'modules' | 'gradient' | 'installConfirm' | 'installProgress' | 'installResult' | 'installDetails';

/** The custom gradient editor: a working copy of the stops, never executable. */
export interface GradientEditorState {
  stops: string[];
  index: number;
  /** Hex text being typed for the selected stop; undefined when not editing. */
  editing?: string;
  error?: string;
}
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
  /** NMSh appearance top view: Main Prompt (default) or Rich Git. */
  view?: PromptView;
  /** `tabs`: ←/→ switch views; `rows` (default): ←/→ edit the selected row. */
  focus?: 'tabs' | 'rows';
  gradient?: GradientEditorState;
}

export type PromptView = 'main' | 'git' | 'chroma';
export const PROMPT_VIEWS = ['Main Prompt', 'Rich Git', 'Chroma'] as const;
const PROMPT_VIEW_IDS: readonly PromptView[] = ['main', 'git', 'chroma'];

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const ACCENT = foreground(UI_COLORS.accent);
const SUBTLE = foreground(UI_COLORS.subtle);
const ERROR = foreground(UI_COLORS.failure);
const INVERSE = '\u001B[7m';
const RESET = '\u001B[0m';
const GAP_CHOICES: readonly NativeGapChoice[] = ['off', 'compact', 'normal', 'wide'];
/** Prompt providers on the shared provider descriptor (#134). */
export const PROMPT_PROVIDERS: readonly ProviderDescriptor<PromptProviderId>[] = [
  {id: 'nmsh', family: 'prompt', label: 'NMSh Native', kind: 'native', description: 'built-in themes, geometry, and modules'},
  {id: 'starship', family: 'prompt', label: 'Starship', kind: 'external', executable: 'starship', description: 'use its themes/configuration'},
  {id: 'powerlevel10k', family: 'prompt', label: 'Powerlevel10k', kind: 'external', description: 'use your ~/.p10k.zsh left prompt'},
];
export const PROVIDER_ORDER: readonly PromptProviderId[] = PROMPT_PROVIDERS.map(provider => provider.id);

export function providerLabel(provider: PromptProviderId): string {
  return PROMPT_PROVIDERS.find(descriptor => descriptor.id === provider)?.label ?? provider;
}

/**
 * One editable appearance row. Rows are derived from the draft, so a style
 * shows only controls that change it and a hidden row can never be edited.
 */
export interface AppearanceRow {
  id: string;
  label: string;
  value(configuration: PromptConfiguration): string;
  /** ←/→; undefined for rows opened with Enter. */
  change?(configuration: PromptConfiguration, delta: number): void;
  note?(configuration: PromptConfiguration): string | undefined;
  /** Enter opens a sub-editor instead of saving. */
  opens?: 'modules' | 'gradient';
}

const cycleKey = <T>(values: readonly T[], current: T, delta: number): T => cycle(values, current, delta);
const optionLabel = (value: string | number) => typeof value === 'number' ? String(value) : STYLE_OPTION_LABELS[value] ?? value;

/** Rows for one style profile field, cycling only that style's valid options. */
function profileRow<S extends ProfiledStyle, K extends keyof typeof STYLE_PROFILE_OPTIONS[S] & string>(style: S, key: K, label: string,
  format: (value: string | number) => string = optionLabel): AppearanceRow {
  return {
    id: `${style}.${key}`, label,
    value: configuration => format((configuration.nmsh.styleProfiles[style] as unknown as Record<string, string | number>)[key]!),
    change: (configuration, delta) => {
      const profile = configuration.nmsh.styleProfiles[style] as unknown as Record<string, string | number>;
      const options = (STYLE_PROFILE_OPTIONS[style] as unknown as Record<string, readonly (string | number)[]>)[key]!;
      profile[key] = cycleKey(options, profile[key]!, delta);
    },
  };
}

const cells = (value: string | number) => `${value} ${value === 1 ? 'cell' : 'cells'}`;

const POWERLINE_ROWS: readonly AppearanceRow[] = [
  {id: 'start', label: 'Start', value: c => edgeStyleLabel(c.nmsh.startStyle), change: (c, d) => { c.nmsh.startStyle = cycle(POWERLINE_EDGE_STYLES, c.nmsh.startStyle, d); }},
  {id: 'connector', label: 'Connector', value: c => SHAPE_LABELS[c.nmsh.connector], change: (c, d) => { c.nmsh.connector = cycle(POWERLINE_SHAPES, c.nmsh.connector, d); }},
  {id: 'connectorFade', label: 'Connector fade', value: c => connectorFadeLabel(c.nmsh.connectorFade),
    change: (c, d) => { c.nmsh.connectorFade = cycle(CONNECTOR_FADE_STYLES, c.nmsh.connectorFade, d); }},
  {id: 'fadeColors', label: 'Fade colors', value: c => fadeColorsLabel(c.nmsh.connectorFadeColors),
    change: (c, d) => { c.nmsh.connectorFadeColors = cycle(fadeColorChoices(c.nmsh.gapEnabled, c.gap), c.nmsh.connectorFadeColors, d); }},
  {id: 'gap', label: 'Gap', value: c => gapLabel(nativeGapChoice(c)), change: (c, d) => applyNativeGapChoice(c, cycle(GAP_CHOICES, nativeGapChoice(c), d))},
  {id: 'end', label: 'End', value: c => edgeStyleLabel(c.nmsh.endStyle), change: (c, d) => { c.nmsh.endStyle = cycle(POWERLINE_EDGE_STYLES, c.nmsh.endStyle, d); }},
  {id: 'padding', label: 'Padding', value: c => cells(c.spacing), change: (c, d) => { c.spacing = cycle([0, 1, 2, 3], c.spacing, d); }},
];

/** Each style's own controls, shown only when they can change that style. */
export function styleRows(configuration: PromptConfiguration): AppearanceRow[] {
  const profiles = configuration.nmsh.styleProfiles;
  switch (configuration.nmsh.style) {
    case 'powerline': return POWERLINE_ROWS.filter(row =>
      // A fade lives in a gap: with the gap Off neither the fade nor its colors can show.
      (row.id !== 'connectorFade' || configuration.nmsh.gapEnabled)
      && (row.id !== 'fadeColors' || (configuration.nmsh.gapEnabled && configuration.nmsh.connectorFade !== 'off')));
    case 'soft': return [profileRow('soft', 'cap', 'Caps'), profileRow('soft', 'layout', 'Layout'),
      ...(profiles.soft.layout === 'separated' ? [profileRow('soft', 'gap', 'Gap', cells)] : []),
      profileRow('soft', 'padding', 'Padding', cells), profileRow('soft', 'fill', 'Fill')];
    case 'minimal': return [profileRow('minimal', 'separator', 'Separator'), profileRow('minimal', 'spacing', 'Spacing', cells),
      profileRow('minimal', 'emphasis', 'Bold')];
    case 'outline': return [profileRow('outline', 'cap', 'Outline'), profileRow('outline', 'layout', 'Layout'),
      ...(profiles.outline.layout === 'separated' ? [profileRow('outline', 'gap', 'Gap', cells)] : []),
      profileRow('outline', 'padding', 'Padding', cells)];
    case 'breadcrumb': return [profileRow('breadcrumb', 'separator', 'Separator'), profileRow('breadcrumb', 'anchor', 'Anchor'),
      profileRow('breadcrumb', 'spacing', 'Spacing', cells)];
    case 'compact': return [profileRow('compact', 'ends', 'Ends'), profileRow('compact', 'padding', 'Padding', cells),
      profileRow('compact', 'seams', 'Seams')];
    case 'ribbon': return [profileRow('ribbon', 'slant', 'Slant'), profileRow('ribbon', 'ends', 'Ends'),
      profileRow('ribbon', 'padding', 'Padding', cells), profileRow('ribbon', 'band', 'Band')];
  }
}

/** Main Prompt rows: theme, style and vibrance, the style's own controls, then icons and modules. */
export function appearanceRows(configuration: PromptConfiguration): AppearanceRow[] {
  return [
    {id: 'theme', label: 'Theme', value: c => NATIVE_PROMPT_THEMES[c.nmsh.palette].label, change: (c, d) => { c.nmsh.palette = cycle(NATIVE_PALETTE_IDS, c.nmsh.palette, d); }},
    {id: 'style', label: 'Style', value: c => PROMPT_STYLE_LABELS[c.nmsh.style], change: (c, d) => { c.nmsh.style = cycle(PROMPT_STYLES, c.nmsh.style, d); },
      note: c => PROMPT_STYLE_NOTES[c.nmsh.style]},
    {id: 'vibrance', label: 'Vibrance', value: c => VIBRANCE_LABELS[c.nmsh.vibrance], change: (c, d) => { c.nmsh.vibrance = cycle(VIBRANCE_LEVELS, c.nmsh.vibrance, d); }},
    ...styleRows(configuration),
    {id: 'icons', label: 'Icons', value: c => c.nmsh.icons === 'off' ? 'Off' : 'On', change: c => { c.nmsh.icons = c.nmsh.icons === 'off' ? 'nerd' : 'off'; }},
    {id: 'modules', label: 'Modules', value: c => `${c.modules.filter(module => module.visible).length} of ${c.modules.length} shown ›`, opens: 'modules'},
  ];
}

export function appearanceModulesRow(configuration: PromptConfiguration): number {
  return appearanceRows(configuration).findIndex(row => row.id === 'modules');
}

/** Chroma rows; everything after Palette hides while Chroma is Off, and timing rows hide while static. */
export function chromaRows(configuration: PromptConfiguration): AppearanceRow[] {
  const p = configuration.presentation;
  const rows: AppearanceRow[] = [{id: 'preset', label: 'Palette', value: c => TREATMENT_PRESET_LABELS[c.presentation.preset],
    change: (c, d) => {
      c.presentation.preset = cycle(TREATMENT_PRESETS, c.presentation.preset, d);
      // Custom always has stops to edit: seed from the Lavender family.
      if (c.presentation.preset === 'custom' && c.presentation.customStops.length < MIN_CUSTOM_STOPS) c.presentation.customStops = [...PRESET_STOPS.lavender];
    },
    note: c => c.provider !== 'nmsh' ? 'external prompts keep their own colors' : undefined}];
  if (p.preset === 'off') return rows;
  if (p.preset === 'custom') rows.push({id: 'gradient', label: 'Custom gradient', value: c => `${c.presentation.customStops.length} stops ›`, opens: 'gradient'});
  rows.push(
    {id: 'influence', label: 'Influence', value: c => TREATMENT_INFLUENCES.find(entry => entry.id === treatmentInfluence(c.presentation))!.label,
      change: (c, d) => {
        const ids = TREATMENT_INFLUENCES.map(entry => entry.id);
        const next = cycle(ids, treatmentInfluence(c.presentation), d);
        c.presentation.intensity = TREATMENT_INFLUENCES.find(entry => entry.id === next)!.intensity;
      }},
    {id: 'scope', label: 'Applies to', value: c => TREATMENT_SCOPE_LABELS[c.presentation.scope ?? 'identity'],
      change: (c, d) => { c.presentation.scope = cycle(TREATMENT_SCOPES, c.presentation.scope ?? 'identity', d); }},
    {id: 'geometry', label: 'Geometry', value: c => TREATMENT_GEOMETRY_LABELS[c.presentation.geometry],
      change: (c, d) => { c.presentation.geometry = cycle(TREATMENT_GEOMETRIES, c.presentation.geometry, d); }},
    {id: 'motion', label: 'Motion', value: c => TREATMENT_MOTION_LABELS[c.presentation.motion],
      change: (c, d) => { c.presentation.motion = cycle(TREATMENT_MOTIONS, c.presentation.motion, d); },
      note: c => c.presentation.motion !== 'static' && (c.presentation.reducedMotion || c.presentation.effectsOff || isReducedMotion())
        ? 'held still: Reduced Motion / Effects Off' : undefined},
  );
  if (p.motion !== 'static') {
    rows.push(
      {id: 'speed', label: 'Speed', value: c => TREATMENT_SPEED_LABELS[c.presentation.speed ?? 'normal'],
        change: (c, d) => { c.presentation.speed = cycle(TREATMENT_SPEEDS, c.presentation.speed ?? 'normal', d); }},
      {id: 'curve', label: 'Ramp', value: c => TREATMENT_CURVE_LABELS[c.presentation.curve ?? 'linear'],
        change: (c, d) => { c.presentation.curve = cycle(TREATMENT_CURVES, c.presentation.curve ?? 'linear', d); }},
    );
    if (motionHasDirection(p.motion)) rows.push({id: 'direction', label: 'Direction', value: c => (c.presentation.direction ?? 'forward') === 'forward' ? 'Forward' : 'Reverse',
      change: (c, d) => { c.presentation.direction = cycle(TREATMENT_DIRECTIONS, c.presentation.direction ?? 'forward', d); }});
  }
  // Only meaningful when some module actually has explicit colors.
  if (configuration.modules.some(module => module.foreground || module.background)) {
    rows.push({id: 'customColors', label: 'Custom module colors', value: c => c.presentation.customColors ? 'Chroma too' : 'Kept as set',
      change: c => { c.presentation.customColors = !c.presentation.customColors; }});
  }
  return rows;
}

function viewRows(state: PromptPanelState): AppearanceRow[] {
  return (state.view ?? 'main') === 'chroma' ? chromaRows(state.draft) : appearanceRows(state.draft);
}

/** Rich Git's own settings; each edits inline with ←/→ (Space also toggles Enabled). */
const RICH_GIT_ROWS = ['gitEnabled', 'gitColors', 'gitGeometry', 'gitConnectorFade'] as const;

/** Enter on the Main Prompt Modules row opens the module manager. */
export function onModulesRow(state: PromptPanelState): boolean {
  return state.step === 'appearance' && (state.view ?? 'main') === 'main' && state.focus !== 'tabs'
    && appearanceRows(state.draft)[state.selectedIndex]?.opens === 'modules';
}

/** Enter on the Chroma Custom gradient row opens the stop editor. */
export function onGradientRow(state: PromptPanelState): boolean {
  return state.step === 'appearance' && state.view === 'chroma' && state.focus !== 'tabs'
    && chromaRows(state.draft)[state.selectedIndex]?.opens === 'gradient';
}

export function openGradientEditor(state: PromptPanelState): void {
  state.gradient = {stops: [...state.draft.presentation.customStops], index: 0};
  state.step = 'gradient';
  state.selectedIndex = 0;
}

/** Leave the stop editor, keeping valid stops in the draft (still unsaved until Enter in the panel). */
export function closeGradientEditor(state: PromptPanelState): void {
  const gradient = state.gradient;
  if (gradient && gradient.stops.length >= MIN_CUSTOM_STOPS) {
    state.draft.presentation.customStops = [...gradient.stops];
    state.draft.presentation.preset = 'custom';
  }
  state.gradient = undefined;
  state.step = 'appearance';
  state.view = 'chroma';
  state.selectedIndex = Math.max(0, chromaRows(state.draft).findIndex(row => row.opens === 'gradient'));
}

/** Normalize typed hex (with or without #); undefined when invalid. */
export function parseStopInput(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  const hex = text.startsWith('#') ? text : `#${text}`;
  return parseHexColor(hex) ? hex : undefined;
}

/**
 * Stop editor keys. ↑↓ select · Enter edit/confirm hex · A add · D/Delete
 * remove · Shift+↑↓ reorder · R reset. Values are plain hex only.
 */
export function handleGradientKey(key: Key, state: PromptPanelState): boolean {
  const gradient = state.gradient;
  if (!gradient) return false;
  if (gradient.editing !== undefined) {
    if (key.kind === 'enter') {
      const value = parseStopInput(gradient.editing);
      if (!value) { gradient.error = 'Use a hex color like #a67cf3'; return true; }
      gradient.stops[gradient.index] = value;
      gradient.editing = undefined;
      gradient.error = undefined;
      return true;
    }
    if (key.kind === 'escape') { gradient.editing = undefined; gradient.error = undefined; return true; }
    if (key.kind === 'backspace') { gradient.editing = [...gradient.editing].slice(0, -1).join(''); return true; }
    if ((key.kind === 'text' || key.kind === 'paste') && /^[#0-9a-f]*$/iu.test(key.value)) {
      gradient.editing = (gradient.editing + key.value).slice(0, 7);
      gradient.error = undefined;
      return true;
    }
    return key.kind === 'text' || key.kind === 'paste';
  }
  const count = gradient.stops.length;
  if (key.kind === 'up') gradient.index = (gradient.index - 1 + count) % count;
  else if (key.kind === 'down') gradient.index = (gradient.index + 1) % count;
  else if (key.kind === 'selectUp' || key.kind === 'selectDown') {
    const target = gradient.index + (key.kind === 'selectUp' ? -1 : 1);
    if (target < 0 || target >= count) return true;
    [gradient.stops[gradient.index], gradient.stops[target]] = [gradient.stops[target]!, gradient.stops[gradient.index]!];
    gradient.index = target;
  } else if (key.kind === 'enter') {
    gradient.editing = gradient.stops[gradient.index]!;
  } else if (key.kind === 'text' && /^[aA]$/u.test(key.value)) {
    if (count >= MAX_CUSTOM_STOPS) { gradient.error = `At most ${MAX_CUSTOM_STOPS} stops`; return true; }
    gradient.stops.splice(gradient.index + 1, 0, gradient.stops[gradient.index]!);
    gradient.index += 1;
    gradient.editing = gradient.stops[gradient.index]!;
  } else if ((key.kind === 'text' && /^[dD]$/u.test(key.value)) || key.kind === 'delete') {
    if (count <= MIN_CUSTOM_STOPS) { gradient.error = `At least ${MIN_CUSTOM_STOPS} stops`; return true; }
    gradient.stops.splice(gradient.index, 1);
    gradient.index = Math.min(gradient.index, gradient.stops.length - 1);
  } else if (key.kind === 'text' && /^[rR]$/u.test(key.value)) {
    gradient.stops = [...(state.saved?.presentation.customStops.length ? state.saved.presentation.customStops : PRESET_STOPS.lavender)];
    gradient.index = 0;
  } else return false;
  gradient.error = undefined;
  return true;
}

export function connectorFadeLabel(value: ConnectorFadeStyle): string {
  return value === 'follow' ? 'Follow connector' : value === 'off' ? 'Off' : SHAPE_LABELS[value];
}

export function fadeColorsLabel(value: ConnectorFadeColors): string {
  return value === 'previous' ? 'Previous' : value === 'next' ? 'Next' : 'Mixed';
}

export function gitGeometryLabel(value: GitGeometry): string {
  return value === 'follow' ? 'Follow main prompt' : SHAPE_LABELS[value];
}

export function gitConnectorFadeLabel(value: GitConnectorFade): string {
  return value === 'followMain' ? 'Follow main prompt' : value === 'followGeometry' ? 'Follow Rich Git geometry'
    : value === 'off' ? 'Off' : SHAPE_LABELS[value];
}

export function gitColorsLabel(value: GitColorMode): string {
  return value === 'semantic' ? 'Semantic' : value === 'followTheme' ? 'Follow theme' : 'Grayscale';
}

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
  project: 'Project', cwd: 'Path', gitBranch: 'Git branch', gitStatus: 'Git status', toolchain: 'Toolchains', exitStatus: 'Exit status',
  kubeContext: 'Kubernetes', dockerContext: 'Docker context',
};

function cycle<T>(values: readonly T[], current: T, delta: number): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + delta + values.length) % values.length]!;
}

function gapLabel(value: NativeGapChoice): string {
  return value === 'off' ? 'Off · connected' : value === 'compact' ? 'Compact' : value === 'normal' ? 'Normal' : 'Wide';
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
  // Powerline geometry describes only Powerline; other styles name their own look.
  const geometry = nmsh.style === 'powerline' ? [
    `${edgeStyleLabel(nmsh.startStyle).toLowerCase()} start`,
    `${SHAPE_LABELS[nmsh.connector].toLowerCase()} joins`,
    `gap ${nativeGapChoice(configuration)}`,
    `${edgeStyleLabel(nmsh.endStyle).toLowerCase()} end`,
  ] : [`${PROMPT_STYLE_LABELS[nmsh.style].toLowerCase()} style`];
  return [
    NATIVE_PROMPT_THEMES[nmsh.palette].label,
    layoutLabel(configuration),
    ...geometry,
    `icons ${nmsh.icons === 'off' ? 'off' : 'on'}`,
    ...(nmsh.vibrance !== 'standard' ? [`${VIBRANCE_LABELS[nmsh.vibrance].toLowerCase()} vibrance`] : []),
    ...(configuration.presentation.preset !== 'off' ? [`${TREATMENT_PRESET_LABELS[configuration.presentation.preset]} Chroma`] : []),
  ].join(' · ');
}

export function promptDraftChanged(state: PromptPanelState): boolean {
  if (!state.saved) return false;
  const comparable = (configuration: PromptConfiguration) => JSON.stringify({...configuration, onboardingComplete: undefined});
  return comparable(state.draft) !== comparable(state.saved);
}

function moduleOption(module: PromptConfiguration['modules'][number]): string {
  switch (module.id) {
    case 'gitBranch': case 'gitStatus': return 'in repositories';
    case 'toolchain': return module.condition === 'onCommand' ? 'on command' : 'when detected';
    case 'kubeContext': case 'dockerContext': return module.condition === 'onCommand' ? 'on command' : 'always';
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
  else if (key.kind === 'text' && (key.value === 'm' || key.value === 'M')) state.draft.nmsh.mirrorRight = !state.draft.nmsh.mirrorRight;
  else if (key.kind === 'text' && (key.value === 'p' || key.value === 'P')) {
    if (modulePlacement(module) === 'right') delete module.placement;
    else module.placement = 'right';
  }
  else if ((key.kind === 'left' || key.kind === 'right') && module.id === 'exitStatus') {
    module.condition = module.condition === 'always' ? 'nonzeroExit' : 'always';
  } else if ((key.kind === 'left' || key.kind === 'right') && ON_COMMAND_MODULES.has(module.id)) {
    module.condition = module.condition === 'onCommand' ? 'always' : 'onCommand';
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
    return [['↑↓', 'move'], ['Space', 'show/hide'], ['Shift+↑↓', 'reorder'], ['←→', 'option'], ['P', 'left/right'],
      ['M', `mirror right: ${state.draft.nmsh.mirrorRight ? 'On' : 'Off'}`], ['Enter/Esc', 'done']];
  }
  if (state.step === 'gradient') {
    if (state.gradient?.editing !== undefined) return [['0-9 a-f', 'type hex'], ['Enter', 'apply'], ['Esc', 'cancel edit']];
    return [['↑↓', 'stop'], ['Enter', 'edit'], ['A', 'add'], ['D', 'remove'], ['Shift+↑↓', 'reorder'], ['R', 'reset'], ['Esc', 'done']];
  }
  if (state.step === 'appearance') {
    if (state.focus === 'tabs') return [['←→', 'switch view'], ['↓', 'select'], ['Enter', 'save'], escape];
    return [['↑↓', 'move'], ['←→', 'change'], ['Enter', onModulesRow(state) ? 'edit modules' : onGradientRow(state) ? 'edit gradient' : 'save'], escape];
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
    case 'appearance': return (state.view ?? 'main') === 'git' ? RICH_GIT_ROWS.length : viewRows(state).length;
    case 'gradient': return state.gradient?.stops.length ?? 1;
    case 'modules': return state.draft.modules.length;
    case 'installConfirm': return 2;
    case 'installProgress': case 'installResult': case 'installDetails': return 1;
  }
  return 1;
}

export function handlePromptPanelKey(key: Key, state: PromptPanelState): boolean {
  if (state.step === 'appearance' && state.view === 'git' && state.focus !== 'tabs'
    && RICH_GIT_ROWS[state.selectedIndex] === 'gitEnabled' && key.kind === 'text' && key.value === ' ') {
    state.draft.nmsh.gitEnabled = !state.draft.nmsh.gitEnabled;
    state.message = undefined;
    return true;
  }
  if (state.step === 'gradient') {
    const handled = handleGradientKey(key, state);
    if (handled) state.message = undefined;
    return handled;
  }
  if (state.step === 'modules' && handleModulesKey(key, state)) {
    state.message = undefined;
    return true;
  }
  if (state.step === 'appearance' && state.focus === 'tabs') {
    if (key.kind === 'left' || key.kind === 'right') {
      const index = PROMPT_VIEW_IDS.indexOf(state.view ?? 'main');
      state.view = PROMPT_VIEW_IDS[(index + (key.kind === 'left' ? -1 : 1) + PROMPT_VIEW_IDS.length) % PROMPT_VIEW_IDS.length];
      state.selectedIndex = 0;
    } else if (key.kind === 'down') state.focus = 'rows';
    else return false;
    state.message = undefined;
    return true;
  }
  // ↑ from the first appearance row reaches the view bar, as in /settings.
  if (key.kind === 'up' && state.step === 'appearance' && state.selectedIndex === 0) state.focus = 'tabs';
  else if (key.kind === 'up') state.selectedIndex = (state.selectedIndex - 1 + promptPanelItemCount(state)) % promptPanelItemCount(state);
  else if (key.kind === 'down') state.selectedIndex = (state.selectedIndex + 1) % promptPanelItemCount(state);
  else if (key.kind === 'left' || key.kind === 'right') {
    const delta = key.kind === 'left' ? -1 : 1;
    if (state.step === 'provider') state.selectedIndex = (state.selectedIndex + delta + PROVIDER_ORDER.length) % PROVIDER_ORDER.length;
    else if (state.step === 'layout') state.selectedIndex = (state.selectedIndex + delta + LAYOUT_CHOICES.length) % LAYOUT_CHOICES.length;
    else if (state.step === 'appearance' && state.view === 'git') {
      const nmsh = state.draft.nmsh;
      switch (RICH_GIT_ROWS[state.selectedIndex]) {
        case 'gitEnabled': nmsh.gitEnabled = !nmsh.gitEnabled; break;
        case 'gitColors': nmsh.gitColors = cycle(GIT_COLOR_MODES, nmsh.gitColors, delta); break;
        case 'gitGeometry': nmsh.gitGeometry = cycle(GIT_GEOMETRIES, nmsh.gitGeometry, delta); break;
        case 'gitConnectorFade': nmsh.gitConnectorFade = cycle(GIT_CONNECTOR_FADES, nmsh.gitConnectorFade, delta); break;
        default: return false;
      }
    } else if (state.step === 'appearance') {
      const row = viewRows(state)[state.selectedIndex];
      if (!row?.change) return false;
      row.change(state.draft, delta);
      // Rows can appear or vanish (e.g. Speed once Motion moves); keep the cursor on this row.
      const moved = viewRows(state).findIndex(candidate => candidate.id === row.id);
      if (moved !== -1) state.selectedIndex = moved;
    }
  } else return false;
  state.message = undefined;
  return true;
}

/**
 * `themePreviews` holds one live native prompt per palette, in
 * NATIVE_PALETTE_IDS order; it is shown only while editing appearance.
 */
export function renderPromptPanel(state: PromptPanelState, columns: number, preview: string[], themePreviews: string[] = [], rowsAvailable = Infinity,
  gitShowcase: string[] = [], chromaThemeStops?: readonly RgbColor[]): string[] {
  const title = state.onboarding ? 'Prompt setup' : 'Prompt settings';
  const rows = [`${PRIMARY}  ${title}${RESET}`];
  if (state.saved) rows.push(`${SUBTLE}  Current  ${SECONDARY}${describePromptConfiguration(state.saved)}${RESET}`);
  rows.push('');
  const item = (index: number, text: string) => `${index === state.selectedIndex ? ACCENT : SECONDARY}${index === state.selectedIndex ? '›' : ' '} ${text}${RESET}`;
  if (state.step === 'provider') {
    rows.push(`${PRIMARY}Choose your prompt${RESET}`);
    // Prompt providers report detection in their own steps, so the list carries no badge.
    PROMPT_PROVIDERS.forEach((provider, index) => rows.push(item(index,
      providerRowText(provider, {draft: state.draft.provider, saved: state.saved?.provider, status: 'none'}))));
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
  } else if (state.step === 'gradient' && state.gradient) {
    const gradient = state.gradient;
    rows.push(`${PRIMARY}Custom gradient${RESET}  ${SUBTLE}${gradient.stops.length} of ${MIN_CUSTOM_STOPS}–${MAX_CUSTOM_STOPS} stops · hex colors only${RESET}`);
    gradient.stops.forEach((stop, index) => {
      const selected = index === gradient.index;
      const swatch = `${colorEscape(38, parseHexColor(stop)!)}████${RESET}`;
      const editing = selected && gradient.editing !== undefined
        ? `${ACCENT}${gradient.editing}${INVERSE} ${RESET}` : `${selected ? PRIMARY : SECONDARY}${stop}`;
      rows.push(`${selected ? `${ACCENT}›` : ' '} ${SECONDARY}${String(index + 1).padStart(2)}${RESET}  ${swatch}  ${editing}${RESET}`);
    });
    if (gradient.error) rows.push(`  ${ERROR}${gradient.error}${RESET}`);
    const stops = gradient.stops.length >= MIN_CUSTOM_STOPS ? gradient.stops : state.draft.presentation.customStops;
    rows.push(`  ${SUBTLE}Gradient  ${RESET}${treatmentSwatch({...state.draft.presentation, preset: 'custom', customStops: stops}, Math.max(8, Math.min(40, columns - 14)))}${RESET}`);
  } else if (state.step === 'modules') {
    rows.push(`${PRIMARY}Prompt modules${RESET}  ${SUBTLE}in prompt order · Mirror right side: ${RESET}${state.draft.nmsh.mirrorRight ? `${ACCENT}On` : `${SECONDARY}Off`}${RESET}`);
    state.draft.modules.forEach((module, index) => {
      const shown = module.visible ? `${ACCENT}●` : `${SUBTLE}○`;
      const option = module.id === 'exitStatus' || ON_COMMAND_MODULES.has(module.id) ? `‹ ${moduleOption(module)} ›` : moduleOption(module);
      const side = modulePlacement(module).padEnd(7);
      rows.push(`${index === state.selectedIndex ? `${ACCENT}›` : ' '} ${shown} ${index === state.selectedIndex ? PRIMARY : SECONDARY}${MODULE_LABELS[module.id].padEnd(15)}${SUBTLE}${side}${module.visible ? option : 'hidden'}${RESET}`);
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
    const view = state.view ?? 'main';
    const rowIndex = (index: number) => state.focus === 'tabs' ? -1 : index;
    const row = (index: number, text: string) => item(rowIndex(index), text);
    rows.push(renderTabStrip(PROMPT_VIEWS, PROMPT_VIEW_IDS.indexOf(view), columns, state.focus === 'tabs'), '');
    if (view === 'git') {
      const onOff = (enabled: boolean) => enabled ? 'On' : 'Off';
      rows.push(row(0, `Enabled         ${value(onOff(draft.gitEnabled), saved && onOff(saved.gitEnabled))}`));
      rows.push(row(1, `Colors          ${value(gitColorsLabel(draft.gitColors), saved && gitColorsLabel(saved.gitColors))}`));
      rows.push(row(2, `Geometry        ${value(gitGeometryLabel(draft.gitGeometry), saved && gitGeometryLabel(saved.gitGeometry))}`));
      const gitFadeNote = !state.draft.nmsh.gapEnabled && draft.gitConnectorFade !== 'off' ? `  ${SUBTLE}applies with a gap` : '';
      rows.push(row(3, `Connector fade  ${value(gitConnectorFadeLabel(draft.gitConnectorFade), saved && gitConnectorFadeLabel(saved.gitConnectorFade))}${gitFadeNote}`));
      if (gitShowcase.length) {
        rows.push('', draft.gitEnabled
          ? `${PRIMARY}Rich Git states${RESET}  ${SUBTLE}preview only${RESET}`
          : `${PRIMARY}Rich Git states${RESET}  ${SUBTLE}Rich Git is off · the prompt shows the branch only · dimmed sample${RESET}`);
        RICH_GIT_SHOWCASE.forEach((entry, index) => {
          const line = gitShowcase[index] ?? '';
          rows.push(`  ${SECONDARY}${entry.label.padEnd(10)}${RESET} ${draft.gitEnabled ? line : `${SUBTLE}${stripAnsi(line)}`}${RESET}`);
        });
      }
    } else {
      // Main Prompt and Chroma: rows derived from the draft, so hidden controls cannot be edited.
      const savedConfiguration = state.saved;
      viewRows(state).forEach((entry, index) => {
        const text = entry.value(state.draft);
        const savedText = savedConfiguration ? entry.value(savedConfiguration) : undefined;
        const note = entry.note?.(state.draft);
        const body = entry.opens ? text : value(text, savedText);
        rows.push(row(index, `${entry.label.padEnd(16)}${body}${note ? `  ${SUBTLE}${note}` : ''}`));
      });
      if (view === 'chroma' && state.draft.presentation.preset !== 'off') {
        rows.push(`  ${SUBTLE}Gradient  ${RESET}${treatmentSwatch(state.draft.presentation, Math.max(8, Math.min(40, columns - 14)), chromaThemeStops)}${RESET}`);
      }
    }
    if (themePreviews.length && view === 'chroma') {
      rows.push('');
      rows.push(`${PRIMARY}Palettes${RESET}  ${SUBTLE}● selected  ✓ saved · the showcase prompt in each${RESET}`);
      TREATMENT_PRESETS.forEach((id, index) => {
        const marker = state.draft.presentation.preset === id ? `${ACCENT}●` : `${SUBTLE}○`;
        const savedMark = state.saved?.presentation.preset === id ? '✓' : ' ';
        rows.push(`${marker} ${SECONDARY}${TREATMENT_PRESET_LABELS[id].padEnd(14)}${ACCENT}${savedMark}${RESET} ${themePreviews[index] ?? ''}${RESET}`);
      });
    }
    if (themePreviews.length && view === 'main') {
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
    const chromaPreview = state.step === 'gradient' || (state.step === 'appearance' && state.view === 'chroma');
    rows.push(`${PRIMARY}${chromaPreview ? 'Chroma preview' : selectedLayout === 'oneLine' ? 'One-line preview' : 'Two-line preview'}${RESET}${status ? `  ${status}${RESET}` : ''}`);
    rows.push(...preview);
  }
  rows.push('');
  rows.push(renderControls(promptPanelControls(state)));
  return rows.map(row => truncateAnsi(row, columns));
}
