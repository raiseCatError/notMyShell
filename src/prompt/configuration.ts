import {normalizeTreatmentSettings, DEFAULT_TREATMENT_SETTINGS, validCustomStops, type TreatmentSettings} from '../chroma/treatment.js';
import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {promptConfigurationPath} from '../configuration/paths.js';
import {UPDATE_CHECK_FREQUENCIES, migrateUpdateSettings, type UpdateCheckFrequency, type UpdateFrequency, type UpdateMode} from '../update/update.js';

export const LIVE_SESSION_STARTUP = ['ask', 'always', 'never'] as const;
export type LiveSessionStartup = typeof LIVE_SESSION_STARTUP[number];
export const LIVE_SESSION_MULTIPLE = ['ask', 'open-all'] as const;
export type LiveSessionMultiple = typeof LIVE_SESSION_MULTIPLE[number];
import type {OutputFoldingMode} from '../output/FoldPolicy.js';
import type {NavigationProviderId} from '../shell/DirectoryService.js';
import type {PickerProviderId} from '../pickers/Picker.js';
import type {HistoryProviderId} from '../shell/historyProviders.js';
import {SUGGESTION_PROVIDER_IDS, type SuggestionProviderId} from '../suggestions/types.js';
import {
  normalizeConnectorFadeColors,
  resolveFadeColors,
  type ConnectorFadeColors,
  normalizeConnectorStyle,
  normalizeEdgeStyle,
  type PowerlineConnectorStyle,
  type PowerlineEdgeStyle,
  type PowerlineShape,
  normalizePromptStyle,
  type PromptStyle,
} from './powerline.js';
import {normalizeStyleProfiles, type StyleProfiles} from './styles.js';
import {normalizeCustomGlyph, normalizePromptSymbol, type PromptSymbolId} from './glyphChoices.js';
import {normalizeCatppuccinAccent, type CatppuccinAccent} from '../appearance/themeFamilies.js';
import {type CustomTheme} from '../appearance/customTheme.js';
import {findTheme, normalizeThemeLibrary, type ThemeAsset} from '../appearance/themeLibrary.js';
import {DEFAULT_THEME_BRIDGE, normalizeThemeBridge, type ThemeBridgeSettings} from '../themeBridge/model.js';
import {IDLE_MODES, type IdleMode} from '../idle/scenes.js';
import {DEFAULT_UI_CHROME, normalizeUiChrome, type UiChromeSettings} from '../appearance/uiChrome.js';
import {normalizeVibrance, type Vibrance} from '../chroma/color.js';
import {isShellId, type ShellId} from '../shell/adapters/ShellAdapter.js';
import {normalizeProfiles, type AgentProfile} from '../agents/sessions/manager.js';
import {OPEN_WITH_IDS, type OpenWith} from '../host/HostActions.js';
import {DEFAULT_KEEP_AWAKE_PRESENTATION, normalizeKeepAwakePresentation, type KeepAwakePresentation} from '../keepAwake/presentation.js';

export type WelcomeProviderId = 'vespyr' | 'fastfetch' | 'neofetch' | 'macchina' | 'zigfetch' | 'none';
export const WELCOME_PROVIDER_IDS: readonly WelcomeProviderId[] = ['vespyr', 'fastfetch', 'neofetch', 'macchina', 'zigfetch', 'none'];

export type ContextPlacement = 'header' | 'composer';
export type ComposerLayout = 'oneLine' | 'twoLine';
/** Bottom and Top dock the composer; Flow places it right after the newest output, inside the document. */
export type PanelPosition = 'bottom' | 'top';
export const PANEL_POSITIONS: readonly PanelPosition[] = ['bottom', 'top'];
export type ComposerPosition = 'bottom' | 'top' | 'flow';
export type TranscriptPresentation = 'normal' | 'chat';
/** Implemented layout choices, shared by Config rows and the /layout showcase. */
export const COMPOSER_POSITIONS: readonly ComposerPosition[] = ['bottom', 'top', 'flow'];
export const COMPOSER_POSITION_LABELS: Record<ComposerPosition, string> = {bottom: 'Bottom', top: 'Top', flow: 'Flow'};
export const TRANSCRIPT_PRESENTATIONS: readonly TranscriptPresentation[] = ['normal', 'chat'];
export const TRANSCRIPT_PRESENTATION_LABELS: Record<TranscriptPresentation, string> = {normal: 'Normal', chat: 'Chat'};
export type GlyphStyle = 'nerd' | 'safe';
export type SessionRetention = 100 | 500 | 1000 | 5000 | null;
export type ContextModuleId = 'project' | 'cwd' | 'gitBranch' | 'gitStatus' | 'toolchain' | 'exitStatus' | 'kubeContext' | 'dockerContext' | 'shell';
/** Where a module's segments render: appended to the left prompt, or the right-aligned context area. */
export type ModulePlacement = 'left' | 'right';
/** Every module can sit in either area; narrow widths drop the right area first. */
export function modulePlacement(module: {placement?: ModulePlacement}): ModulePlacement {
  return module.placement === 'right' ? 'right' : 'left';
}
/** `onCommand`: shown only while the typed command is one the module is about (show-on-command). */
/** `shellDiffers`: shown only while this session's backend is not the default for new sessions (the `shell` module). */
export type ContextCondition = 'always' | 'inRepository' | 'nonzeroExit' | 'onCommand' | 'shellDiffers';
/** The current-shell module's visibility, stored as the module's visible flag and condition. */
export type ShellModuleVisibility = 'whenDifferent' | 'always' | 'never';
export const SHELL_MODULE_VISIBILITY: readonly ShellModuleVisibility[] = ['whenDifferent', 'always', 'never'];
export const SHELL_MODULE_VISIBILITY_LABELS: Record<ShellModuleVisibility, string> = {whenDifferent: 'When different', always: 'Always', never: 'Never'};
export function shellModuleVisibility(configuration: Pick<PromptConfiguration, 'modules'>): ShellModuleVisibility {
  const module = configuration.modules.find(item => item.id === 'shell');
  if (!module || !module.visible) return module ? 'never' : 'whenDifferent';
  return module.condition === 'always' ? 'always' : 'whenDifferent';
}
export function applyShellModuleVisibility(configuration: Pick<PromptConfiguration, 'modules'>, visibility: ShellModuleVisibility): void {
  let module = configuration.modules.find(item => item.id === 'shell');
  if (!module) { module = {id: 'shell', visible: true, condition: 'shellDiffers'}; configuration.modules.push(module); }
  module.visible = visibility !== 'never';
  module.condition = visibility === 'always' ? 'always' : 'shellDiffers';
}
/** Modules whose condition can be switched to show-on-command. */
export const ON_COMMAND_MODULES: ReadonlySet<ContextModuleId> = new Set(['toolchain', 'kubeContext', 'dockerContext']);
/** `none` is composer only: no prompt row, modules, right prompt or marker; everything else in NMSh stays on. */
export type PromptProviderId = 'nmsh' | 'starship' | 'powerlevel10k' | 'ohMyPosh' | 'none';
export type NativeEndStyle = PowerlineEdgeStyle;
export type NativeStartStyle = PowerlineEdgeStyle;
export type NativeConnectorStyle = PowerlineConnectorStyle;
/** `nerd` shows Nerd Font module icons; a future `text` mode can join without migration. */
export type NativeIconMode = 'nerd' | 'off';
export type NativePaletteId = 'lavender' | 'brand' | 'cool' | 'warm' | 'grayscale' | 'aurora' | 'ocean' | 'sunset' | 'forest' | 'rose' | 'nebula' | 'highContrast'
  | ThirdPartyPaletteId | 'custom';
/** Bundled third-party variants (see appearance/themeFamilies). */
export type ThirdPartyPaletteId = 'catppuccinLatte' | 'catppuccinFrappe' | 'catppuccinMacchiato' | 'catppuccinMocha' | 'dracula'
  | 'tokyonightNight' | 'tokyonightStorm' | 'tokyonightMoon' | 'tokyonightDay' | 'gruvboxDark' | 'gruvboxLight'
  | 'rosePine' | 'rosePineMoon' | 'rosePineDawn' | 'nord' | 'solarizedDark' | 'solarizedLight' | 'oneDark' | 'oneLight';
export const THIRD_PARTY_PALETTE_IDS: readonly ThirdPartyPaletteId[] = ['catppuccinLatte', 'catppuccinFrappe', 'catppuccinMacchiato', 'catppuccinMocha',
  'dracula', 'tokyonightNight', 'tokyonightStorm', 'tokyonightMoon', 'tokyonightDay', 'gruvboxDark', 'gruvboxLight',
  'rosePine', 'rosePineMoon', 'rosePineDawn', 'nord', 'solarizedDark', 'solarizedLight', 'oneDark', 'oneLight'];
export type NativeGapChoice = 'off' | 'compact' | 'normal' | 'wide';
/**
 * Rich Git state colors: `semantic` keeps meaningful Git colors under any
 * theme, `followTheme` derives them from the Main Prompt theme, `grayscale`
 * removes their hue. The branch itself always follows the theme.
 */
export type GitColorMode = 'semantic' | 'followTheme' | 'grayscale';
export const GIT_COLOR_MODES: readonly GitColorMode[] = ['semantic', 'followTheme', 'grayscale'];
/** One-cell softened connector: follow the Connector shape, off, or a fixed shape override. */
export type ConnectorFadeStyle = 'follow' | 'off' | PowerlineShape;
export const CONNECTOR_FADE_STYLES: readonly ConnectorFadeStyle[] = ['follow', 'off', 'wedge', 'flat', 'rounded', 'slash', 'backslash'];

/** Rich Git state geometry: follow the Main Prompt connector, or a fixed shape. */
export type GitGeometry = 'follow' | PowerlineShape;
export const GIT_GEOMETRIES: readonly GitGeometry[] = ['follow', 'wedge', 'flat', 'rounded', 'slash', 'backslash'];
/**
 * Rich Git connector fade: inherit the Main Prompt fade, follow Rich Git's own
 * geometry, turn it off, or a fixed shape.
 */
export type GitConnectorFade = 'followMain' | 'followGeometry' | 'off' | PowerlineShape;
export const GIT_CONNECTOR_FADES: readonly GitConnectorFade[] = ['followMain', 'followGeometry', 'off', 'wedge', 'flat', 'rounded', 'slash', 'backslash'];

export function normalizeGitGeometry(value: unknown): GitGeometry {
  return GIT_GEOMETRIES.includes(value as GitGeometry) ? value as GitGeometry : 'follow';
}

export function normalizeGitConnectorFade(value: unknown): GitConnectorFade {
  return GIT_CONNECTOR_FADES.includes(value as GitConnectorFade) ? value as GitConnectorFade : 'followMain';
}

export function normalizeGitColorMode(value: unknown): GitColorMode {
  return GIT_COLOR_MODES.includes(value as GitColorMode) ? value as GitColorMode : 'semantic';
}

export function normalizeConnectorFade(value: unknown): ConnectorFadeStyle {
  return CONNECTOR_FADE_STYLES.includes(value as ConnectorFadeStyle) ? value as ConnectorFadeStyle : 'off';
}

/** The NMSh theme family (Native themes); other families are listed by THEME_PALETTE_IDS. */
export const NATIVE_PALETTE_IDS: readonly NativePaletteId[] = ['lavender', 'brand', 'cool', 'warm', 'grayscale',
  'aurora', 'ocean', 'sunset', 'forest', 'rose', 'nebula', 'highContrast'];
/** Every selectable theme id: NMSh themes, bundled families, and the user's custom theme. */
export const THEME_PALETTE_IDS: readonly NativePaletteId[] = [...NATIVE_PALETTE_IDS, ...THIRD_PARTY_PALETTE_IDS, 'custom'];

/** Retired theme ids keep working: Soft Semantic overlapped Brand / Semantic. */
export function normalizePaletteId(value: unknown, fallback: NativePaletteId = 'lavender'): NativePaletteId {
  if (value === 'semantic') return 'brand';
  return THEME_PALETTE_IDS.includes(value as NativePaletteId) ? value as NativePaletteId : fallback;
}

export interface ContextModuleConfig {
  id: ContextModuleId;
  visible: boolean;
  condition: ContextCondition;
  /** Missing means left; only right-eligible modules honor `right`. */
  placement?: ModulePlacement;
  foreground?: string;
  background?: string;
}

export type HistoryColorMode = 'followPrompt' | 'theme' | 'grayscale';
export type DividerDensity = 'normal' | 'compact';
/**
 * Historical divider colors (live composer dividers follow the Chroma
 * Divider lines setting instead). Follow Chroma is static in history.
 */
export const DIVIDER_COLOR_MODES = ['chroma', 'history', 'ui', 'muted'] as const;
export type DividerColorMode = typeof DIVIDER_COLOR_MODES[number];
export const DIVIDER_COLOR_LABELS: Record<DividerColorMode, string> = {chroma: 'Follow Chroma', history: 'Follow history', ui: 'Follow UI theme', muted: 'Muted grayscale'};

/** How historical command headers are presented; stored snapshots are never changed. */
/** How much of a stored prompt snapshot past commands show; Off is `historicalPrompt: false`. */
export const HISTORICAL_PROMPT_LEVELS = ['full', 'compact', 'minimal'] as const;
export type HistoricalPromptLevel = typeof HISTORICAL_PROMPT_LEVELS[number];
export const HISTORICAL_PROMPT_LEVEL_LABELS: Record<HistoricalPromptLevel | 'off', string> = {full: 'Full', compact: 'Compact', minimal: 'Minimal', off: 'Off'};

export interface TranscriptAppearance {
  divider: boolean;
  historicalPrompt: boolean;
  /** Presentation only, used while `historicalPrompt` is on; the stored snapshot stays complete. Missing means Full. */
  historicalPromptLevel: HistoricalPromptLevel;
  historyColors: HistoryColorMode;
  /** Used when `historyColors` is `theme`. */
  historyTheme: NativePaletteId;
  dividerDensity: DividerDensity;
  dividerColors: DividerColorMode;
}

export const DEFAULT_TRANSCRIPT_APPEARANCE: TranscriptAppearance = {
  divider: true,
  historicalPrompt: true,
  historicalPromptLevel: 'full',
  historyColors: 'followPrompt',
  historyTheme: 'lavender',
  dividerDensity: 'normal',
  dividerColors: 'chroma',
};

export function normalizeTranscriptAppearance(value: unknown): TranscriptAppearance {
  if (!isRecord(value)) return {...DEFAULT_TRANSCRIPT_APPEARANCE};
  return {
    divider: typeof value.divider === 'boolean' ? value.divider : true,
    historicalPrompt: typeof value.historicalPrompt === 'boolean' ? value.historicalPrompt : true,
    historicalPromptLevel: HISTORICAL_PROMPT_LEVELS.includes(value.historicalPromptLevel as HistoricalPromptLevel) ? value.historicalPromptLevel as HistoricalPromptLevel : 'full',
    historyColors: value.historyColors === 'theme' || value.historyColors === 'grayscale' ? value.historyColors : 'followPrompt',
    historyTheme: normalizePaletteId(value.historyTheme),
    dividerDensity: value.dividerDensity === 'compact' ? 'compact' : 'normal',
    dividerColors: DIVIDER_COLOR_MODES.includes(value.dividerColors as DividerColorMode) ? value.dividerColors as DividerColorMode : 'chroma',
  };
}

export type SyntaxColorMode = HistoryColorMode;
export const SYNTAX_COLOR_MODES: readonly SyntaxColorMode[] = ['followPrompt', 'theme', 'grayscale'];

/** Editor and submitted-command syntax presentation; raw PTY output is never recolored. */
export interface SyntaxAppearance {
  highlighting: boolean;
  colors: SyntaxColorMode;
  /** Used when `colors` is `theme`. */
  theme: NativePaletteId;
}

export const DEFAULT_SYNTAX_APPEARANCE: SyntaxAppearance = {highlighting: true, colors: 'followPrompt', theme: 'lavender'};

export function normalizeSyntaxAppearance(value: unknown): SyntaxAppearance {
  if (!isRecord(value)) return {...DEFAULT_SYNTAX_APPEARANCE};
  return {
    highlighting: typeof value.highlighting === 'boolean' ? value.highlighting : true,
    colors: SYNTAX_COLOR_MODES.includes(value.colors as SyntaxColorMode) ? value.colors as SyntaxColorMode : 'followPrompt',
    theme: normalizePaletteId(value.theme),
  };
}

export type NotificationFocusPolicy = 'suppress' | 'notify';

/** Command-completion notifications; read at completion time, never snapshotted at start. */
export interface NotificationSettings {
  enabled: boolean;
  /** Minimum elapsed command time, in seconds, before a completion notifies. */
  thresholdSeconds: number;
  onSuccess: boolean;
  onFailure: boolean;
  /** Suppress: a definitely-focused terminal notifies nothing. Notify: focus is ignored. */
  whenFocused: NotificationFocusPolicy;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  thresholdSeconds: 60,
  onSuccess: true,
  onFailure: true,
  whenFocused: 'suppress',
};

/** One day; longer thresholds are almost certainly a typo. */
export const MAX_NOTIFICATION_THRESHOLD_SECONDS = 86_400;

export function normalizeNotificationSettings(value: unknown): NotificationSettings {
  if (!isRecord(value)) return {...DEFAULT_NOTIFICATION_SETTINGS};
  const threshold = value.thresholdSeconds;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    thresholdSeconds: typeof threshold === 'number' && Number.isFinite(threshold) && threshold >= 1
      ? Math.min(MAX_NOTIFICATION_THRESHOLD_SECONDS, Math.round(threshold))
      : DEFAULT_NOTIFICATION_SETTINGS.thresholdSeconds,
    onSuccess: typeof value.onSuccess === 'boolean' ? value.onSuccess : true,
    onFailure: typeof value.onFailure === 'boolean' ? value.onFailure : true,
    whenFocused: value.whenFocused === 'notify' ? 'notify' : 'suppress',
  };
}

/** Text-caret style while NMSh owns the composer; Host default sends nothing. */
export const CURSOR_SHAPES = ['host', 'block', 'bar', 'underline'] as const;
export type CursorShape = typeof CURSOR_SHAPES[number];
export const CURSOR_BLINKS = ['host', 'on', 'off'] as const;
export type CursorBlink = typeof CURSOR_BLINKS[number];
/**
 * One registry for NMSh's UI motion, each a short, finite presentation of a
 * real event; none delays input or execution, none runs when Off, under
 * Reduced Motion, with Decorative Effects Off, or without color.
 */
export const CONTEXT_TRANSITIONS = ['off', 'subtle', 'expressive'] as const;
export const COMMAND_LAUNCHES = ['off', 'sweep', 'pulse'] as const;
export const COMPLETION_HIGHLIGHTS = ['off', 'subtle', 'vivid'] as const;
export const COMPLETION_EFFECTS = ['off', 'seal'] as const;
export const EVENT_FEEDBACK = ['off', 'subtle', 'expressive'] as const;
export const CURSOR_TRAVELS = ['off', 'on'] as const;
export interface MotionSettings {
  /** Prompt modules transform in place when their facts change (cwd, branch, Git state, tools). */
  contextTransitions: typeof CONTEXT_TRANSITIONS[number];
  /** The handoff when Enter submits a shell command. */
  commandLaunch: typeof COMMAND_LAUNCHES[number];
  /** What completion just inserted. */
  completionHighlight: typeof COMPLETION_HIGHLIGHTS[number];
  /** Block Seal: a finished block settles. */
  completionEffect: typeof COMPLETION_EFFECTS[number];
  /** Semantic Echo: a short response to meaningful events (long success, failure, attention, task done). */
  eventFeedback: typeof EVENT_FEEDBACK[number];
  /** A soft trail between the old and new caret position on multi-cell jumps. Presentation only; the caret moves at once. */
  cursorTravel: typeof CURSOR_TRAVELS[number];
  /**
   * How the same events are drawn. Clean keeps the host's background (foreground tint, dim, underline);
   * Rich draws the stronger filled bands. One event system feeds either renderer.
   */
  rendering: MotionRendering;
  /** Each rendering keeps its own tuning, so switching never loses the other's. */
  tuning: Record<MotionRendering, MotionTuning>;
}
export const MOTION_RENDERINGS = ['clean', 'rich'] as const;
export type MotionRendering = typeof MOTION_RENDERINGS[number];
export const MOTION_INTENSITIES = ['low', 'medium', 'high'] as const;
export const MOTION_SPEEDS = ['slow', 'normal', 'fast'] as const;
/** Intensity scales how strong the paint is; speed scales how long it lasts. Medium/Normal is each renderer's own baseline. */
export interface MotionTuning {intensity: typeof MOTION_INTENSITIES[number]; speed: typeof MOTION_SPEEDS[number]}
export const DEFAULT_MOTION_TUNING = (): Record<MotionRendering, MotionTuning> => ({clean: {intensity: 'medium', speed: 'normal'}, rich: {intensity: 'medium', speed: 'normal'}});
/** Fresh installs: restrained motion, Clean rendering. */
export const DEFAULT_MOTION: MotionSettings = {contextTransitions: 'subtle', commandLaunch: 'sweep', completionHighlight: 'subtle', completionEffect: 'seal', eventFeedback: 'subtle', cursorTravel: 'on',
  rendering: 'clean', tuning: DEFAULT_MOTION_TUNING()};
/** Existing configs without a motion group: nothing new moves until the person turns it on. */
export const MIGRATED_MOTION: MotionSettings = {contextTransitions: 'off', commandLaunch: 'off', completionHighlight: 'off', completionEffect: 'off', eventFeedback: 'off', cursorTravel: 'off',
  rendering: 'clean', tuning: DEFAULT_MOTION_TUNING()};

export function normalizeMotion(value: unknown): MotionSettings {
  if (!isRecord(value)) return {...MIGRATED_MOTION};
  const pickOne = <T extends string>(list: readonly T[], item: unknown, fallback: T): T => list.includes(item as T) ? item as T : fallback;
  return {contextTransitions: pickOne(CONTEXT_TRANSITIONS, value.contextTransitions, 'off'), commandLaunch: pickOne(COMMAND_LAUNCHES, value.commandLaunch, 'off'),
    completionHighlight: pickOne(COMPLETION_HIGHLIGHTS, value.completionHighlight, 'off'), completionEffect: pickOne(COMPLETION_EFFECTS, value.completionEffect, 'off'),
    eventFeedback: pickOne(EVENT_FEEDBACK, value.eventFeedback, 'off'), cursorTravel: pickOne(CURSOR_TRAVELS, value.cursorTravel, 'off'),
    // Saved configs without a rendering are on today's behavior, which is Clean.
    rendering: pickOne(MOTION_RENDERINGS, value.rendering, 'clean'), tuning: normalizeMotionTuning(value.tuning)};
}

function normalizeMotionTuning(value: unknown): Record<MotionRendering, MotionTuning> {
  const record = isRecord(value) ? value : {};
  const one = (item: unknown): MotionTuning => {
    const tuning = isRecord(item) ? item : {};
    return {intensity: MOTION_INTENSITIES.includes(tuning.intensity as never) ? tuning.intensity as MotionTuning['intensity'] : 'medium',
      speed: MOTION_SPEEDS.includes(tuning.speed as never) ? tuning.speed as MotionTuning['speed'] : 'normal'};
  };
  return {clean: one(record.clean), rich: one(record.rich)};
}

export const PROMPT_TEXT_COLORS = ['neutral', 'theme'] as const;
export type PromptTextColors = typeof PROMPT_TEXT_COLORS[number];

export const CURSOR_RENDERERS = ['auto', 'portable', 'native'] as const;
export type CursorRenderer = typeof CURSOR_RENDERERS[number];
/** How the visual caret travels; the logical caret always moves at once. */
export const CURSOR_MOTIONS = ['off', 'smooth', 'smear', 'tail'] as const;
export type CursorMotion = typeof CURSOR_MOTIONS[number];
/** What the movement emits (separate from Motion: Fire is not a movement algorithm). */
export const CURSOR_EFFECTS = ['none', 'fire', 'sparks', 'lightning', 'railgun', 'ripple', 'wireframe'] as const;
export type CursorEffect = typeof CURSOR_EFFECTS[number];
/** A low-cadence effect while the caret rests (opt-in; Off schedules nothing). */
export const CURSOR_IDLE_EFFECTS = ['off', 'glow', 'embers', 'flame', 'sparks'] as const;
export type CursorIdleEffect = typeof CURSOR_IDLE_EFFECTS[number];
/**
 * Where the caret/effect color comes from. `theme` is Follow current theme (the
 * stored name predates Choose theme and is kept so saved configs keep working);
 * `chosen` is Choose theme: any bundled theme, independent of the prompt.
 */
export const CURSOR_COLOR_SOURCES = ['host', 'accent', 'theme', 'custom', 'chosen'] as const;
export type CursorColorSource = typeof CURSOR_COLOR_SOURCES[number];
export const CURSOR_TRAIL_COLORS = ['cursor', 'custom', 'gradient'] as const;
export const CURSOR_PARTICLE_COLORS = ['trail', 'custom', 'gradient'] as const;
export const CURSOR_LEVELS = ['low', 'medium', 'high'] as const;
export type CursorLevel = typeof CURSOR_LEVELS[number];
export const CURSOR_EASINGS = ['out-cubic', 'out-expo', 'linear', 'spring'] as const;

/** Physics and pacing for people who want to tune (the default view never shows these). */
export interface CursorAdvanced {
  shortMoveMs: number; longMoveMs: number; easing: typeof CURSOR_EASINGS[number];
  stiffness: number; tailStiffness: number; damping: number; trailExponent: number; maxTrail: number;
  /** Cells: moves at or under this are "short" (adjacent typing). */
  moveThreshold: number;
  /** ms of rest before the idle effect starts. */
  dwellMs: number;
  particleDensity: number; particleLifetimeMs: number; spread: number; particleSpeed: number; drag: number; gravity: number;
  /** Frames per second while moving; idle effects use at most 15. */
  fps: number;
}

export interface CursorSettings {
  shape: CursorShape; blink: CursorBlink;
  renderer: CursorRenderer; motion: CursorMotion; effect: CursorEffect; idleEffect: CursorIdleEffect;
  color: {source: CursorColorSource; custom?: string; /** Choose theme: the theme and (Catppuccin) accent the cursor uses. */ theme?: NativePaletteId; themeAccent?: CatppuccinAccent};
  trail: {source: typeof CURSOR_TRAIL_COLORS[number]; colors: string[]};
  particles: {source: typeof CURSOR_PARTICLE_COLORS[number]; colors: string[]};
  speed: CursorLevel; intensity: CursorLevel; trailLength: CursorLevel; particleAmount: CursorLevel;
  advanced: CursorAdvanced;
}
export const DEFAULT_CURSOR_ADVANCED: CursorAdvanced = {shortMoveMs: 40, longMoveMs: 150, easing: 'out-cubic', stiffness: 0.6, tailStiffness: 0.35, damping: 0.85,
  trailExponent: 1.6, maxTrail: 24, moveThreshold: 1, dwellMs: 600, particleDensity: 1, particleLifetimeMs: 520, spread: 0.6, particleSpeed: 1, drag: 0.9, gravity: 1, fps: 60};
/** Factory defaults: no motion, no effect, no idle effect. Existing users see no surprise animation. */
export const DEFAULT_CURSOR: CursorSettings = {shape: 'host', blink: 'host', renderer: 'auto', motion: 'off', effect: 'none', idleEffect: 'off',
  color: {source: 'host'}, trail: {source: 'cursor', colors: []}, particles: {source: 'trail', colors: []},
  speed: 'medium', intensity: 'medium', trailLength: 'medium', particleAmount: 'medium', advanced: DEFAULT_CURSOR_ADVANCED};

const HEX = /^#[0-9a-f]{6}$/iu;
const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => list.includes(value as T) ? value as T : fallback;
const clampNumber = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function normalizeCursor(value: unknown): CursorSettings {
  const v = isRecord(value) ? value : {};
  const color = isRecord(v.color) ? v.color : {};
  const trail = isRecord(v.trail) ? v.trail : {};
  const particles = isRecord(v.particles) ? v.particles : {};
  const advanced = isRecord(v.advanced) ? v.advanced : {};
  const colors = (list: unknown) => Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string' && HEX.test(item)).slice(0, 6) : [];
  const a = DEFAULT_CURSOR_ADVANCED;
  return {shape: pick(CURSOR_SHAPES, v.shape, 'host'), blink: pick(CURSOR_BLINKS, v.blink, 'host'),
    renderer: pick(CURSOR_RENDERERS, v.renderer, 'auto'), motion: pick(CURSOR_MOTIONS, v.motion, 'off'), effect: pick(CURSOR_EFFECTS, v.effect, 'none'),
    idleEffect: pick(CURSOR_IDLE_EFFECTS, v.idleEffect, 'off'),
    color: {source: pick(CURSOR_COLOR_SOURCES, color.source, 'host'), ...(typeof color.custom === 'string' && HEX.test(color.custom) ? {custom: color.custom} : {}),
      ...(color.theme !== undefined || color.source === 'chosen' ? {theme: normalizePaletteId(color.theme)} : {}),
      ...(color.themeAccent !== undefined ? {themeAccent: normalizeCatppuccinAccent(color.themeAccent)} : {})},
    trail: {source: pick(CURSOR_TRAIL_COLORS, trail.source, 'cursor'), colors: colors(trail.colors)},
    particles: {source: pick(CURSOR_PARTICLE_COLORS, particles.source, 'trail'), colors: colors(particles.colors)},
    speed: pick(CURSOR_LEVELS, v.speed, 'medium'), intensity: pick(CURSOR_LEVELS, v.intensity, 'medium'), trailLength: pick(CURSOR_LEVELS, v.trailLength, 'medium'),
    particleAmount: pick(CURSOR_LEVELS, v.particleAmount, 'medium'),
    advanced: {shortMoveMs: clampNumber(advanced.shortMoveMs, 0, 200, a.shortMoveMs), longMoveMs: clampNumber(advanced.longMoveMs, 40, 600, a.longMoveMs),
      easing: pick(CURSOR_EASINGS, advanced.easing, a.easing), stiffness: clampNumber(advanced.stiffness, 0.05, 1, a.stiffness),
      tailStiffness: clampNumber(advanced.tailStiffness, 0.05, 1, a.tailStiffness), damping: clampNumber(advanced.damping, 0.1, 1, a.damping),
      trailExponent: clampNumber(advanced.trailExponent, 0.5, 4, a.trailExponent), maxTrail: clampNumber(advanced.maxTrail, 2, 80, a.maxTrail),
      moveThreshold: clampNumber(advanced.moveThreshold, 0, 8, a.moveThreshold), dwellMs: clampNumber(advanced.dwellMs, 0, 5000, a.dwellMs),
      particleDensity: clampNumber(advanced.particleDensity, 0, 4, a.particleDensity), particleLifetimeMs: clampNumber(advanced.particleLifetimeMs, 100, 2000, a.particleLifetimeMs),
      spread: clampNumber(advanced.spread, 0, 2, a.spread), particleSpeed: clampNumber(advanced.particleSpeed, 0.1, 4, a.particleSpeed),
      drag: clampNumber(advanced.drag, 0.5, 1, a.drag), gravity: clampNumber(advanced.gravity, -2, 2, a.gravity), fps: clampNumber(advanced.fps, 12, 120, a.fps)}};
}

/** Optional NMSh-owned status strip; Off by default, Minimal (clock + real battery) when enabled. */
export const RAM_DISPLAYS = ['percent', 'absolute', 'both'] as const;
export type RamDisplay = typeof RAM_DISPLAYS[number];
export interface StatusStripSettings {
  enabled: boolean; clock: boolean; battery: boolean; cpu: boolean; ram: boolean; uptime: boolean; ramDisplay: RamDisplay;
}
export const DEFAULT_STATUS_STRIP: StatusStripSettings = {enabled: false, clock: true, battery: true, cpu: false, ram: false, uptime: false, ramDisplay: 'percent'};

export function normalizeStatusStrip(value: unknown): StatusStripSettings {
  const v = isRecord(value) ? value : {};
  const flag = (key: keyof StatusStripSettings) => typeof v[key] === 'boolean' ? v[key] as boolean : DEFAULT_STATUS_STRIP[key] as boolean;
  return {enabled: flag('enabled'), clock: flag('clock'), battery: flag('battery'), cpu: flag('cpu'), ram: flag('ram'), uptime: flag('uptime'),
    ramDisplay: RAM_DISPLAYS.includes(v.ramDisplay as RamDisplay) ? v.ramDisplay as RamDisplay : 'percent'};
}

/** Idle visuals: minutes of inactivity before the NMSh screensaver starts; 0 is Never (the default). */
export const IDLE_TIMEOUTS = [0, 1, 5, 15, 30, 60] as const;
export type IdleTimeout = typeof IDLE_TIMEOUTS[number];
/**
 * Idle colors. Follow Chroma / Theme (stored `appearance`): Chroma when it is
 * on, otherwise the active theme. Theme only: always the theme, ignoring
 * Chroma. Custom: the idle visuals' own gradient stops.
 */
export const IDLE_COLOR_SOURCES = ['appearance', 'theme', 'custom'] as const;
export type IdleColorSource = typeof IDLE_COLOR_SOURCES[number];
export const IDLE_COLOR_LABELS: Record<IdleColorSource, string> = {appearance: 'Follow Chroma / Theme', theme: 'Theme only', custom: 'Custom'};
/** runWhileBusy lets the saver start during a foreground command; it never overrides passthrough or a fullscreen program. */
export interface IdleVisualSettings {timeout: IdleTimeout; mode: IdleMode; colorSource: IdleColorSource; customStops: string[]; runWhileBusy: boolean}
export const DEFAULT_IDLE_VISUALS: IdleVisualSettings = {timeout: 0, mode: 'aurora', colorSource: 'appearance', customStops: [], runWhileBusy: false};

export function normalizeIdleVisuals(value: unknown): IdleVisualSettings {
  const v = isRecord(value) ? value : {};
  const customStops = validCustomStops(v.customStops) ? v.customStops.map(stop => stop.toLowerCase()) : [];
  const colorSource = IDLE_COLOR_SOURCES.includes(v.colorSource as IdleColorSource) ? v.colorSource as IdleColorSource : 'appearance';
  return {timeout: IDLE_TIMEOUTS.includes(v.timeout as IdleTimeout) ? v.timeout as IdleTimeout : 0,
    mode: IDLE_MODES.includes(v.mode as IdleMode) ? v.mode as IdleMode : 'aurora',
    colorSource: colorSource === 'custom' && !customStops.length ? 'appearance' : colorSource, customStops, runWhileBusy: v.runWhileBusy === true};
}

/**
 * Live activity colors: the running-command line ("• Running sleep 5 · 3.4s").
 * Follow appearance uses Chroma when it is on (Semantic Preserve keeps the
 * working color), otherwise the theme. Only the live line moves; a finished
 * command is the ordinary, static semantic result.
 */
export const LIVE_ACTIVITY_COLORS = ['appearance', 'lavender', 'grayscale', 'custom'] as const;
export type LiveActivityColors = typeof LIVE_ACTIVITY_COLORS[number];
export const LIVE_ACTIVITY_COLOR_LABELS: Record<LiveActivityColors, string> = {appearance: 'Follow appearance', lavender: 'Native Lavender', grayscale: 'Grayscale', custom: 'Custom'};
export interface LiveActivitySettings {colors: LiveActivityColors; customStops: string[]}
export const DEFAULT_LIVE_ACTIVITY: LiveActivitySettings = {colors: 'appearance', customStops: []};

export function normalizeLiveActivity(value: unknown): LiveActivitySettings {
  const v = isRecord(value) ? value : {};
  const customStops = validCustomStops(v.customStops) ? v.customStops.map(stop => stop.toLowerCase()) : [];
  const colors = LIVE_ACTIVITY_COLORS.includes(v.colors as LiveActivityColors) ? v.colors as LiveActivityColors : 'appearance';
  return {colors: colors === 'custom' && !customStops.length ? 'appearance' : colors, customStops};
}

export interface PromptConfiguration {
  presentation: TreatmentSettings;
  /** General NMSh UI motion (cursor motion lives in `cursor`, Chroma in `presentation`). */
  motion: MotionSettings;
  /** Paste Preview: Smart shows multiline, chained, mutating or risky pastes before they enter the composer. */
  pastePreview: 'smart' | 'always' | 'off';
  provider: PromptProviderId;
  onboardingComplete: boolean;
  /** Optional discovery is separate; legacy completed onboarding stays completed. */
  toolsSetupComplete: boolean;
  /** Missing in v0.3 configs; normalize to nerd to preserve their appearance. */
  glyphStyle: GlyphStyle;
  glyphChoiceComplete: boolean;
  /** Maximum unpinned presentation sessions; null disables rotation. */
  sessionRetention: SessionRetention;
  /** Automatic updates: Automatic prepares verified releases, Notify only announces them, Off never checks. `/update` always works on request. */
  updateMode: UpdateMode;
  updateFrequency: UpdateFrequency;
  /** Whether launch restores a detached live session: ask, always, or never (never only skips; it ends nothing). */
  liveSessionStartup: LiveSessionStartup;
  /** With several detached live sessions at launch: ask which, or open them all. */
  liveSessionMultiple: LiveSessionMultiple;
  /** Whether long, boring finished output starts collapsed. Presentation only. */
  outputFolding: OutputFoldingMode;
  /** What new presentation sessions show at the top; archived sessions keep theirs. */
  welcome: WelcomeProviderId;
  /** Ghost-text suggestion provider; external providers fall back to Native. */
  suggestions: SuggestionProviderId;
  /** Native default; Atuin is an explicit local read-only source. */
  history: HistoryProviderId;
  picker: PickerProviderId;
  navigation: NavigationProviderId;
  /** Predict a whole command on an empty prompt from the previous one. */
  suggestionsOnEmpty: boolean;
  /** Batched outdated checks for optional external tools; Off by default, never on render. */
  toolUpdateChecks: UpdateCheckFrequency;
  /** Offer an install when a submitted command is a missing curated tool (exact name only). */
  installSuggestions: boolean;
  /** Curated tool ids the user asked not to be offered again. */
  ignoredInstallSuggestions: string[];
  /** The composer's prompt marker; provider-owned prompts (Starship, Powerlevel10k) are never changed. */
  promptSymbol: PromptSymbolId;
  /** Used when `promptSymbol` is `custom`; kept when another symbol is chosen. */
  promptSymbolCustom?: string;
  /**
   * The Native theme library: canonical user-owned themes (Custom and
   * Imported) with stable ids. `nmsh.themeId` names the one the `custom`
   * palette uses.
   */
  themes: ThemeAsset[];
  /**
   * Mirror of the library asset named by `nmsh.themeId`, rewritten on every
   * normalization (never edited directly). Renderers and older NMSh versions
   * read it; only a configuration without `themes` migrates from it.
   */
  customTheme?: CustomTheme;
  /** Opt-in Theme Bridge: one independent mode per external tool target; all Independent by default. */
  themeBridge: ThemeBridgeSettings;
  cursor: CursorSettings;
  statusStrip: StatusStripSettings;
  /** How an active Keep Awake shows in NMSh chrome (placement, display, idle reminder, screensaver). Off shows nothing. */
  keepAwake: KeepAwakePresentation;
  idleVisuals: IdleVisualSettings;
  liveActivity: LiveActivitySettings;
  /** Where NMSh chrome (frames, rules, tabs, selection, accents) takes its colors from. */
  uiChrome: UiChromeSettings;
  /** Compact cross-session notices above the composer (other sessions finished, failed, ended...). */
  sessionNotices: boolean;
  /** Named agent launch profiles (provider-specific, never credentials); see src/agents/sessions/manager.ts. */
  agentProfiles: AgentProfile[];
  /** Keep Ask questions and replies with the session transcript. Approved actions follow their own history rules either way. */
  askRecord: boolean;
  /** How the Ask panel lays out its conversation; independent of the transcript's presentation. */
  askPresentation: 'chat' | 'normal';
  /** Optional local language understanding; Auto by default (deterministic first, nothing downloads without consent). Folding stays opt-in. */
  localUnderstanding: LocalUnderstandingSettings;
  /** Local-only agent CLI activity stats (durations and counts; never content). */
  agentActivity: boolean;
  /** Shell backend for new sessions; /shell switches only the current session unless saved as default. */
  shellBackend: ShellId;
  /** Where /open and /open-diff delegate: the surrounding editor (auto), Zed, VS Code, or $VISUAL/$EDITOR. */
  openWith: OpenWith;
  nmsh: {
    gapEnabled: boolean;
    startStyle: NativeStartStyle;
    connector: NativeConnectorStyle;
    endStyle: NativeEndStyle;
    palette: NativePaletteId;
    /** The library asset (`themes[].id`) a `custom` palette uses; kept while a built-in is active. */
    themeId?: string;
    icons: NativeIconMode;
    /** Visual style over the same semantic segments; missing in older configs means Powerline. */
    style: PromptStyle;
    connectorFade: ConnectorFadeStyle;
    /** Which neighbor(s) color the faded transition zones; missing in older configs, meaning Previous. */
    connectorFadeColors: ConnectorFadeColors;
    /** Rich Git master switch; Off keeps the plain branch module. */
    gitEnabled: boolean;
    gitColors: GitColorMode;
    gitGeometry: GitGeometry;
    gitConnectorFade: GitConnectorFade;
    /** Right-aligned context faces left (reflected geometry); missing in older configs means On. */
    mirrorRight: boolean;
    /** Theme color strength; missing in older configs means Standard (unchanged colors). */
    vibrance: Vibrance;
    /**
     * Prompt text colors: Theme uses the theme's own text treatment; Neutral keeps every
     * fill, connector and accent but draws ordinary text in stable neutral tones. Applies
     * to every Native theme. Missing in older configs means Theme (saved looks unchanged).
     */
    textColors: PromptTextColors;
    /** Catppuccin accent; ignored by other families. */
    accent: CatppuccinAccent;
    /**
     * Per-style settings for every style except Powerline, whose settings are
     * the fields above plus the root gap/spacing. Missing profiles are seeded
     * from the legacy shared gap/spacing so upgrades look the same.
     */
    styleProfiles: StyleProfiles;
  };
  starship: {configPath: string | null};
  /** Optional overrides; null uses detection and the default ~/.p10k.zsh. Never written to. */
  powerlevel10k: {themePath: string | null; configPath: string | null};
  /** Optional local config path; null uses POSH_CONFIG, else Oh My Posh's built-in default. Never written to. */
  ohMyPosh: {configPath: string | null};
  notifications: NotificationSettings;
  transcript: TranscriptAppearance;
  syntax: SyntaxAppearance;
  placement: ContextPlacement;
  composerLayout: ComposerLayout;
  /** Dock Bottom (default) or Dock Top; independent of transcript presentation. */
  composerPosition: ComposerPosition;
  /** Where full-width NMSh panels (Setup, Settings, Tools, ...) sit; independent of the composer position. */
  panelPosition: PanelPosition;
  /** Normal or Chat rows; presentation only and independent of composer position. */
  transcriptPresentation: TranscriptPresentation;
  /** The decorative horizontal rules around the live composer; Off reclaims their rows. Transcript dividers are separate. */
  composerDividers: boolean;
  modules: ContextModuleConfig[];
  separator: string;
  /** Spaces between colored context blocks; use spacing for padding inside each block. */
  gap: number;
  spacing: number;
}

export const DEFAULT_PROMPT_CONFIGURATION: PromptConfiguration = {
  presentation: {...DEFAULT_TREATMENT_SETTINGS, customStops: []},
  motion: {...DEFAULT_MOTION},
  pastePreview: 'smart',
  provider: 'nmsh',
  onboardingComplete: false,
  toolsSetupComplete: false,
  glyphStyle: 'nerd',
  glyphChoiceComplete: false,
  sessionRetention: 1000,
  updateMode: 'automatic',
  updateFrequency: 'daily',
  liveSessionStartup: 'ask',
  liveSessionMultiple: 'ask',
  notifications: {...DEFAULT_NOTIFICATION_SETTINGS},
  outputFolding: 'smart',
  welcome: 'vespyr',
  suggestions: 'nmsh',
  history: 'native',
  picker: 'native',
  navigation: 'native',
  suggestionsOnEmpty: false,
  toolUpdateChecks: 'off',
  installSuggestions: true,
  ignoredInstallSuggestions: [],
  promptSymbol: 'chevron',
  cursor: {...DEFAULT_CURSOR},
  statusStrip: {...DEFAULT_STATUS_STRIP},
  keepAwake: {...DEFAULT_KEEP_AWAKE_PRESENTATION},
  agentProfiles: [],
  sessionNotices: true,
  askRecord: true,
  askPresentation: 'chat' as const,
  localUnderstanding: {mode: 'auto', ask: true, folding: false},
  agentActivity: true,
  shellBackend: 'zsh',
  openWith: 'auto',
  idleVisuals: {...DEFAULT_IDLE_VISUALS, customStops: []},
  liveActivity: {...DEFAULT_LIVE_ACTIVITY, customStops: []},
  uiChrome: {...DEFAULT_UI_CHROME},
  themes: [],
  themeBridge: DEFAULT_THEME_BRIDGE(),
  nmsh: {gapEnabled: true, startStyle: 'wedge', connector: 'wedge', endStyle: 'fadeWedge', palette: 'lavender', icons: 'nerd', style: 'powerline',
    connectorFade: 'off', connectorFadeColors: 'previous', gitEnabled: true, gitColors: 'semantic', gitGeometry: 'follow', gitConnectorFade: 'followMain',
    mirrorRight: true, vibrance: 'standard', textColors: 'theme', accent: 'mauve', styleProfiles: normalizeStyleProfiles(undefined)},
  starship: {configPath: null},
  powerlevel10k: {themePath: null, configPath: null},
  ohMyPosh: {configPath: null},
  transcript: {...DEFAULT_TRANSCRIPT_APPEARANCE},
  syntax: {...DEFAULT_SYNTAX_APPEARANCE},
  placement: 'header',
  composerLayout: 'twoLine',
  composerPosition: 'bottom',
  panelPosition: 'bottom',
  composerDividers: true,
  transcriptPresentation: 'normal',
  modules: [
    {id: 'project', visible: true, condition: 'always'},
    {id: 'cwd', visible: true, condition: 'always'},
    {id: 'gitBranch', visible: true, condition: 'inRepository'},
    {id: 'gitStatus', visible: true, condition: 'inRepository'},
    {id: 'toolchain', visible: true, condition: 'always'},
    {id: 'exitStatus', visible: true, condition: 'nonzeroExit'},
    {id: 'kubeContext', visible: true, condition: 'onCommand'},
    {id: 'dockerContext', visible: true, condition: 'onCommand'},
    {id: 'shell', visible: true, condition: 'shellDiffers'},
  ],
  separator: '',
  gap: 1,
  spacing: 1,
};

const MODULE_IDS = new Set<ContextModuleId>(['project', 'cwd', 'gitBranch', 'gitStatus', 'toolchain', 'exitStatus', 'kubeContext', 'dockerContext', 'shell']);
const CONDITIONS = new Set<ContextCondition>(['always', 'inRepository', 'nonzeroExit', 'onCommand', 'shellDiffers']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);
}

function validSeparator(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 8 && !/[\u0000-\u001f\u007f\u001b]/u.test(value);
}

export function normalizePromptConfiguration(value: unknown): PromptConfiguration {
  if (!isRecord(value)) return structuredClone(DEFAULT_PROMPT_CONFIGURATION);

  const presentation = normalizeTreatmentSettings(value.presentation);
  const promptValue = isRecord(value.prompt) ? value.prompt : value;
  const glyphStyle: GlyphStyle = value.glyphStyle === 'safe' ? 'safe' : 'nerd';
  // Existing configured installations keep their v0.3 appearance without a new wizard.
  const glyphChoiceComplete = value.glyphChoiceComplete === true || value.onboardingComplete === true;
  const toolsSetupComplete = typeof value.toolsSetupComplete === 'boolean' ? value.toolsSetupComplete : value.onboardingComplete === true;
  const sessionRetention: SessionRetention = value.sessionRetention === null
    ? null : [100, 500, 1000, 5000].includes(value.sessionRetention as number)
      ? value.sessionRetention as SessionRetention : 1000;
  const {updateMode, updateFrequency} = migrateUpdateSettings(value);
  const liveSessionStartup: LiveSessionStartup = LIVE_SESSION_STARTUP.includes(value.liveSessionStartup as LiveSessionStartup)
    ? value.liveSessionStartup as LiveSessionStartup : 'ask';
  const liveSessionMultiple: LiveSessionMultiple = LIVE_SESSION_MULTIPLE.includes(value.liveSessionMultiple as LiveSessionMultiple)
    ? value.liveSessionMultiple as LiveSessionMultiple : 'ask';
  // Off persists as `never`, so v0.4 configs load unchanged.
  const outputFolding: OutputFoldingMode = value.outputFolding === 'never' || value.outputFolding === 'always' ? value.outputFolding : 'smart';
  const welcome: WelcomeProviderId = WELCOME_PROVIDER_IDS.includes(value.welcome as WelcomeProviderId)
    ? value.welcome as WelcomeProviderId : 'vespyr';
  const suggestions: SuggestionProviderId = SUGGESTION_PROVIDER_IDS.includes(value.suggestions as SuggestionProviderId)
    ? value.suggestions as SuggestionProviderId : 'nmsh';
  const navigation: NavigationProviderId = value.navigation === 'zoxide' ? 'zoxide' : 'native';
  const picker: PickerProviderId = value.picker === 'fzf' || value.picker === 'television' ? value.picker : 'native';
  const history: HistoryProviderId = value.history === 'atuin' ? 'atuin' : 'native';
  const suggestionsOnEmpty = value.suggestionsOnEmpty === true;
  const toolUpdateChecks: UpdateCheckFrequency = UPDATE_CHECK_FREQUENCIES.includes(value.toolUpdateChecks as UpdateCheckFrequency)
    ? value.toolUpdateChecks as UpdateCheckFrequency : 'off';
  const installSuggestions = value.installSuggestions !== false;
  const ignoredInstallSuggestions = Array.isArray(value.ignoredInstallSuggestions)
    ? [...new Set(value.ignoredInstallSuggestions.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,63}$/u.test(id)))].slice(0, 256)
    : [];
  const promptSymbolCustom = normalizeCustomGlyph(value.promptSymbolCustom);
  const tooling = {motion: normalizeMotion(value.motion), pastePreview: (value.pastePreview === 'always' || value.pastePreview === 'off' ? value.pastePreview : 'smart') as 'smart' | 'always' | 'off', cursor: normalizeCursor(value.cursor), statusStrip: normalizeStatusStrip(value.statusStrip), keepAwake: normalizeKeepAwakePresentation(value.keepAwake), idleVisuals: normalizeIdleVisuals(value.idleVisuals), liveActivity: normalizeLiveActivity(value.liveActivity), uiChrome: normalizeUiChrome(value.uiChrome),
    sessionNotices: value.sessionNotices !== false, agentProfiles: normalizeProfiles(value.agentProfiles), agentActivity: value.agentActivity !== false, askRecord: value.askRecord !== false, askPresentation: value.askPresentation === 'normal' ? 'normal' as const : 'chat' as const,
    localUnderstanding: normalizeLocalUnderstanding(value.localUnderstanding),
    shellBackend: isShellId(value.shellBackend) ? value.shellBackend : 'zsh',
    openWith: OPEN_WITH_IDS.includes(value.openWith as OpenWith) ? value.openWith as OpenWith : 'auto', toolUpdateChecks, installSuggestions, ignoredInstallSuggestions, promptSymbol: normalizePromptSymbol(value.promptSymbol),
    ...(promptSymbolCustom ? {promptSymbolCustom} : {})};
  const provider: PromptProviderId = promptValue.provider === 'starship' || promptValue.provider === 'powerlevel10k' || promptValue.provider === 'ohMyPosh' || promptValue.provider === 'none'
    ? promptValue.provider
    : 'nmsh';
  const p10kValue = isRecord(promptValue.powerlevel10k) ? promptValue.powerlevel10k : {};
  const optionalPath = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
  const powerlevel10k = {themePath: optionalPath(p10kValue.themePath), configPath: optionalPath(p10kValue.configPath)};
  const ompValue = isRecord(promptValue.ohMyPosh) ? promptValue.ohMyPosh : {};
  const ohMyPosh = {configPath: optionalPath(ompValue.configPath)};
  const nativeValue = isRecord(promptValue.nmsh) ? promptValue.nmsh : promptValue;
  const starshipValue = isRecord(promptValue.starship) ? promptValue.starship : {};
  const endStyle = normalizeEdgeStyle(nativeValue.endStyle, 'fadeWedge');
  const startStyle = normalizeEdgeStyle(nativeValue.startStyle, 'wedge');
  const connector = normalizeConnectorStyle(nativeValue.connector);
  const icons: NativeIconMode = nativeValue.icons === 'off' || nativeValue.icons === false ? 'off' : 'nerd';
  const style = normalizePromptStyle(nativeValue.style);
  // The library is canonical; a pre-library customTheme migrates into it once.
  const library = normalizeThemeLibrary(value.themes, value.customTheme, nativeValue.themeId);
  const customTheme = findTheme(library.themes, library.themeId)?.theme;
  // A custom palette without a valid library theme falls back instead of rendering nothing.
  const storedPalette = normalizePaletteId(nativeValue.palette);
  const palette = storedPalette === 'custom' && !customTheme ? 'lavender' : storedPalette;
  const themed = {...tooling, themes: library.themes, themeBridge: normalizeThemeBridge(value.themeBridge), ...(customTheme ? {customTheme: structuredClone(customTheme)} : {})};
  const transcript = normalizeTranscriptAppearance(promptValue.transcript);
  const syntax = normalizeSyntaxAppearance(promptValue.syntax);
  const notifications = normalizeNotificationSettings(value.notifications);
  const nmsh = {gapEnabled: typeof nativeValue.gapEnabled === 'boolean' ? nativeValue.gapEnabled : true,
    startStyle, connector, endStyle, palette, ...(library.themeId ? {themeId: library.themeId} : {}), icons, style,
    connectorFade: normalizeConnectorFade(nativeValue.connectorFade),
    connectorFadeColors: normalizeConnectorFadeColors(nativeValue.connectorFadeColors),
    gitEnabled: typeof nativeValue.gitEnabled === 'boolean' ? nativeValue.gitEnabled : true,
    gitColors: normalizeGitColorMode(nativeValue.gitColors),
    gitGeometry: normalizeGitGeometry(nativeValue.gitGeometry),
    gitConnectorFade: normalizeGitConnectorFade(nativeValue.gitConnectorFade),
    mirrorRight: typeof nativeValue.mirrorRight === 'boolean' ? nativeValue.mirrorRight : true,
    vibrance: normalizeVibrance(nativeValue.vibrance),
    textColors: (nativeValue.textColors === 'neutral' ? 'neutral' : 'theme') as PromptTextColors,
    accent: normalizeCatppuccinAccent(nativeValue.accent),
    styleProfiles: normalizeStyleProfiles(undefined)};
  const starshipConfigPath = typeof starshipValue.configPath === 'string' && starshipValue.configPath.trim()
    ? starshipValue.configPath
    : null;

  const placement: ContextPlacement = value.placement === 'composer' ? 'composer' : 'header';
  const composerLayout: ComposerLayout = value.composerLayout === 'oneLine' ? 'oneLine' : 'twoLine';
  const panelPosition: PanelPosition = value.panelPosition === 'top' ? 'top' : 'bottom';
  const composerPosition: ComposerPosition = value.composerPosition === 'top' || value.composerPosition === 'flow' ? value.composerPosition : 'bottom';
  const transcriptPresentation: TranscriptPresentation = value.transcriptPresentation === 'chat' ? 'chat' : 'normal';
  const spacing = typeof value.spacing === 'number' && Number.isFinite(value.spacing)
    ? Math.max(0, Math.min(3, Math.round(value.spacing)))
    : DEFAULT_PROMPT_CONFIGURATION.spacing;
  const gap = typeof value.gap === 'number' && Number.isFinite(value.gap)
    ? Math.max(0, Math.min(3, Math.round(value.gap)))
    : DEFAULT_PROMPT_CONFIGURATION.gap;
  nmsh.styleProfiles = normalizeStyleProfiles(nativeValue.styleProfiles, nmsh.gapEnabled ? gap : 0, spacing);
  // Mixed needs a Normal or Wide gap; an unreleased Compact/Off + Mixed reads as Previous.
  nmsh.connectorFadeColors = resolveFadeColors(nmsh.connectorFadeColors, nmsh.gapEnabled, gap);
  const separator = validSeparator(value.separator) ? value.separator : DEFAULT_PROMPT_CONFIGURATION.separator;

  if (!Array.isArray(value.modules)) {
    return {...structuredClone(DEFAULT_PROMPT_CONFIGURATION), provider, onboardingComplete: value.onboardingComplete === true,
      toolsSetupComplete, glyphStyle, glyphChoiceComplete, sessionRetention, updateMode, updateFrequency, liveSessionStartup, liveSessionMultiple, outputFolding, welcome, suggestions, history, picker, navigation, suggestionsOnEmpty,
      presentation, nmsh, starship: {configPath: starshipConfigPath}, powerlevel10k, ohMyPosh, transcript, syntax, notifications, placement, composerLayout, composerPosition, panelPosition, transcriptPresentation, composerDividers: value.composerDividers !== false, spacing, gap, separator, ...themed};
  }

  const modules: ContextModuleConfig[] = [];
  const seen = new Set<ContextModuleId>();
  for (const item of value.modules) {
    if (!isRecord(item) || typeof item.id !== 'string' || !MODULE_IDS.has(item.id as ContextModuleId)) continue;
    const id = item.id as ContextModuleId;
    if (seen.has(id)) continue;
    seen.add(id);
    const fallback = DEFAULT_PROMPT_CONFIGURATION.modules.find(module => module.id === id)!;
    const module: ContextModuleConfig = {
      id,
      visible: typeof item.visible === 'boolean' ? item.visible : fallback.visible,
      condition: typeof item.condition === 'string' && CONDITIONS.has(item.condition as ContextCondition)
        && (item.condition !== 'onCommand' || ON_COMMAND_MODULES.has(id))
        && ((item.condition === 'shellDiffers') === (id === 'shell') || (id === 'shell' && item.condition === 'always'))
        ? item.condition as ContextCondition
        : fallback.condition,
    };
    if (item.placement === 'right') module.placement = 'right';
    if (validColor(item.foreground)) module.foreground = item.foreground;
    if (validColor(item.background)) module.background = item.background;
    modules.push(module);
  }
  // Modules added in later releases join saved configurations at their
  // default position instead of silently staying absent.
  DEFAULT_PROMPT_CONFIGURATION.modules.forEach((fallback, defaultIndex) => {
    if (seen.has(fallback.id)) return;
    // Git status split from the branch module: it joins right after the
    // branch wherever the user placed it, so v0.3 prompts look the same.
    const branch = fallback.id === 'gitStatus' ? modules.findIndex(module => module.id === 'gitBranch') : -1;
    if (branch !== -1) {
      modules.splice(branch + 1, 0, {...fallback, visible: modules[branch]!.visible});
      return;
    }
    const later = DEFAULT_PROMPT_CONFIGURATION.modules.slice(defaultIndex + 1).map(module => module.id);
    const before = modules.findIndex(module => later.includes(module.id));
    modules.splice(before === -1 ? modules.length : before, 0, {...fallback});
  });

  return {provider, onboardingComplete: value.onboardingComplete === true,
    toolsSetupComplete,
    glyphStyle, glyphChoiceComplete, sessionRetention, updateMode, updateFrequency, liveSessionStartup, liveSessionMultiple, outputFolding, welcome, suggestions, history, picker, navigation, suggestionsOnEmpty, presentation, nmsh, transcript, syntax, notifications, powerlevel10k, ohMyPosh,
    starship: {configPath: starshipConfigPath}, placement, composerLayout, composerPosition, panelPosition, transcriptPresentation, composerDividers: value.composerDividers !== false, modules, separator, spacing, gap, ...themed};
}

export function loadPromptConfiguration(path = promptConfigurationPath()): PromptConfiguration {
  try {
    return normalizePromptConfiguration(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch {
    return structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  }
}

/** Merge only along the bounded normalized schema; unknown declarative fields survive edits. */
function preserveConfiguration(existing: unknown, normalized: unknown): unknown {
  if (!isRecord(existing) || !isRecord(normalized)) return normalized;
  return Object.fromEntries(Object.entries({...existing, ...normalized}).map(([key, value]) =>
    [key, key in normalized ? preserveConfiguration(existing[key], value) : value]));
}

/** Raised when an existing config cannot be safely read; the file is left untouched. */
export class ConfigurationUnreadableError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`Settings were not saved: ${path} ${reason}. The file was left unchanged; fix or move it, then try again.`);
    this.name = 'ConfigurationUnreadableError';
  }
}

/** Absent files yield undefined; anything present but unusable throws instead of being replaced. */
function readExistingConfiguration(path: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ConfigurationUnreadableError(path, `could not be read (${(error as NodeJS.ErrnoException).code ?? 'unknown error'})`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; } catch { throw new ConfigurationUnreadableError(path, 'is not valid JSON'); }
  if (!isRecord(parsed)) throw new ConfigurationUnreadableError(path, 'is not a JSON object');
  // Flatten the legacy prompt wrapper so it cannot shadow newly saved values on reload.
  if (isRecord(parsed.prompt)) {
    const {prompt, ...root} = parsed;
    return {...prompt as Record<string, unknown>, ...root};
  }
  return parsed;
}

/** Apply only the leaves that differ between base and next onto the fresh on-disk state. */
function applyChanges(fresh: unknown, base: unknown, next: unknown): unknown {
  if (!isRecord(next)) return JSON.stringify(base) === JSON.stringify(next) && fresh !== undefined ? fresh : next;
  const target: Record<string, unknown> = isRecord(fresh) ? {...fresh} : {};
  const baseRecord = isRecord(base) ? base : {};
  for (const [key, value] of Object.entries(next)) {
    const changed = !(key in baseRecord) || JSON.stringify(baseRecord[key]) !== JSON.stringify(value);
    // Unchanged settings keep whatever is on disk (another frontend may have changed them); absent ones are filled in.
    if (changed || !(key in target) || isRecord(value)) target[key] = isRecord(value) ? applyChanges(target[key], baseRecord[key], value) : value;
  }
  return target;
}

/**
 * Persist the configuration atomically. With `base` (the state this frontend last loaded or saved),
 * only changed settings are written over a fresh read, so another frontend's unrelated edits survive.
 * An existing file that cannot be read or parsed is never replaced.
 */
export function savePromptConfiguration(configuration: PromptConfiguration, path = promptConfigurationPath(), base?: PromptConfiguration): void {
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  const normalized = normalizePromptConfiguration(configuration);
  const existing = readExistingConfiguration(path);
  const persisted = base
    ? applyChanges(existing ?? {}, normalizePromptConfiguration(base), normalized)
    : preserveConfiguration(existing, normalized);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(persisted, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  renameSync(temporary, path);
}

export function hasVisibleContextModule(
  configuration: PromptConfiguration,
  context?: {branch?: string; exitStatus?: number; commandWords?: readonly string[]; shell?: {differs: boolean}},
  /** Whether an on-command module is relevant to the typed command. */
  onCommand: (id: ContextModuleId, words: readonly string[]) => boolean = () => false,
): boolean {
  return configuration.modules.some(module => module.visible
    && (module.condition !== 'inRepository' || Boolean(context?.branch))
    && (module.condition !== 'nonzeroExit' || (context?.exitStatus ?? 0) !== 0)
    && (module.condition !== 'onCommand' || onCommand(module.id, context?.commandWords ?? []))
    && (module.id !== 'shell' || Boolean(context?.shell))
    && (module.condition !== 'shellDiffers' || Boolean(context?.shell?.differs)));
}

/**
 * Gap presets map onto the stored gap width: compact 0, normal 1, wide 2.
 * Legacy widths above 2 read as wide.
 */
export function nativeGapChoice(configuration: PromptConfiguration): NativeGapChoice {
  if (!configuration.nmsh.gapEnabled) return 'off';
  return configuration.gap === 0 ? 'compact' : configuration.gap === 1 ? 'normal' : 'wide';
}

export function applyNativeGapChoice(configuration: PromptConfiguration, choice: NativeGapChoice): void {
  configuration.nmsh.gapEnabled = choice !== 'off';
  if (choice === 'compact') configuration.gap = 0;
  else if (choice === 'normal') configuration.gap = 1;
  else if (choice === 'wide') configuration.gap = 2;
  configuration.nmsh.connectorFadeColors = resolveFadeColors(configuration.nmsh.connectorFadeColors,
    configuration.nmsh.gapEnabled, configuration.gap);
}

/** Off never loads a model. Auto may, lazily, for enabled scopes. Always prefers it for enabled scopes. */
export type LocalUnderstandingMode = 'off' | 'auto' | 'always';
export const LOCAL_UNDERSTANDING_MODES: readonly LocalUnderstandingMode[] = ['off', 'auto', 'always'];
export const LOCAL_UNDERSTANDING_LABELS: Record<LocalUnderstandingMode, string> = {off: 'Off', auto: 'Auto', always: 'Always'};
export type LocalRuntimeKind = 'llama.cpp' | 'ollama' | 'lmstudio';

/** The chosen model: NMSh's own download, or a compatible model found locally. Runtime state is never stored here. */
export interface LocalModelChoice {
  label: string;
  runtime: LocalRuntimeKind;
  /** GGUF file for llama.cpp. */
  path?: string;
  /** Model name for Ollama or LM Studio. */
  name?: string;
  /** NMSh downloaded it (and may remove it); otherwise it was found and is never deleted by NMSh. */
  owned: boolean;
}

export interface LocalUnderstandingSettings {
  mode: LocalUnderstandingMode;
  /** Feature scopes; each is opt-in and kept when the mode is Off. */
  ask: boolean;
  folding: boolean;
  model?: LocalModelChoice;
}

function normalizeLocalUnderstanding(value: unknown): LocalUnderstandingSettings {
  const record = isRecord(value) ? value : {};
  // Only an absent or unrecognised mode gets the Auto default; a saved Off stays Off.
  const mode = LOCAL_UNDERSTANDING_MODES.includes(record.mode as LocalUnderstandingMode) ? record.mode as LocalUnderstandingMode : 'auto';
  const settings: LocalUnderstandingSettings = {mode, ask: typeof record.ask === 'boolean' ? record.ask : true, folding: record.folding === true};
  const model = isRecord(record.model) ? record.model : undefined;
  const runtime = model && (['llama.cpp', 'ollama', 'lmstudio'] as const).includes(model.runtime as LocalRuntimeKind) ? model.runtime as LocalRuntimeKind : undefined;
  if (model && runtime && typeof model.label === 'string' && model.label.length <= 120 && !/[\u0000-\u001f]/u.test(model.label)
    && (typeof model.path === 'string' || typeof model.name === 'string')) {
    settings.model = {label: model.label, runtime, owned: model.owned === true,
      ...(typeof model.path === 'string' ? {path: model.path} : {}), ...(typeof model.name === 'string' ? {name: model.name} : {})};
  }
  return settings;
}
