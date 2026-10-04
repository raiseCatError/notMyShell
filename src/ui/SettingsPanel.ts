import {SHELL_IDS} from '../shell/adapters/ShellAdapter.js';
import {shellAdapter} from '../shell/adapters/registry.js';
import {OPEN_WITH_IDS} from '../host/HostActions.js';
import {TREATMENT_PRESETS, TREATMENT_PRESET_LABELS, TREATMENT_GEOMETRIES, TREATMENT_GEOMETRY_LABELS, TREATMENT_MOTIONS, TREATMENT_MOTION_LABELS,
  TREATMENT_SPEEDS, TREATMENT_SPEED_LABELS, TREATMENT_INFLUENCES, treatmentInfluence, SEMANTIC_MODES, SEMANTIC_MODE_LABELS, TREATMENT_SCOPES, TREATMENT_SCOPE_LABELS, TREATMENT_CURVES, TREATMENT_CURVE_LABELS, DIVIDER_LINES_HELP, dividerLinesLabel, PRESET_STOPS} from '../chroma/treatment.js';
import {historicalPromptLevel} from '../output/TranscriptPanel.js';
import {PANEL_POSITIONS, DIVIDER_COLOR_LABELS, DIVIDER_COLOR_MODES, NATIVE_PALETTE_IDS, CURSOR_BLINKS, CURSOR_SHAPES, IDLE_COLOR_LABELS, IDLE_COLOR_SOURCES, IDLE_TIMEOUTS, LIVE_ACTIVITY_COLORS, LIVE_ACTIVITY_COLOR_LABELS, RAM_DISPLAYS, LOCAL_UNDERSTANDING_LABELS, LOCAL_UNDERSTANDING_MODES, SHELL_MODULE_VISIBILITY, SHELL_MODULE_VISIBILITY_LABELS, applyShellModuleVisibility, shellModuleVisibility, type StatusStripSettings} from '../prompt/configuration.js';
import {IDLE_MODES, IDLE_MODE_LABELS} from '../idle/scenes.js';
import {MOTION_LABELS, MOTION_RENDERING_ITEM, MOTION_ROWS, MOTION_TUNING_ITEMS, type MotionItem} from '../motion/motionRows.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';
import {withIdleColorSource} from '../idle/IdleVisuals.js';
import {CATPPUCCIN_ACCENTS, CATPPUCCIN_ACCENT_LABELS, normalizeCatppuccinAccent} from '../appearance/themeFamilies.js';
import {availabilityOf, availableValues, currentCursorHost, unavailableReason, type CursorFeature} from '../cursor/backends.js';
import {describeCursorColor, contextFor} from '../cursor/colors.js';
import {CURSOR_EFFECTS, CURSOR_IDLE_EFFECTS, CURSOR_LEVELS, CURSOR_MOTIONS, CURSOR_RENDERERS, type CursorSettings} from '../prompt/configuration.js';
import {CHROME_PRESET_LABELS, CHROME_PRESETS, CHROME_SOURCES, chromeColorsFrom, LAVENDER_TINT_LABELS, LAVENDER_TINTS, resolveChrome} from '../appearance/uiChrome.js';
import {currentSelectionFamily, defaultVariant, FAMILY_IDS, FAMILY_LABELS, familyOf, selectionFamilies, selectionFamilyLabel, selectionVariants, selectSelectionFamily, variantOptions} from '../appearance/themeSelection.js';
import {librarySummary} from '../appearance/themeLibrary.js';
import {BRIDGE_TARGETS, effectiveMode} from '../themeBridge/model.js';
import {PROMPT_SYMBOL_IDS, promptSymbolLabel} from '../prompt/glyphChoices.js';
import {VIBRANCE_LABELS, VIBRANCE_LEVELS} from '../chroma/color.js';
import {OUTPUT_FOLDING_MODES} from '../output/FoldPolicy.js';
import {UPDATE_CHECK_FREQUENCIES, UPDATE_FREQUENCIES, UPDATE_MODES} from '../update/update.js';
import {COMPOSER_POSITIONS, COMPOSER_POSITION_LABELS, LIVE_SESSION_MULTIPLE, LIVE_SESSION_STARTUP, TRANSCRIPT_PRESENTATIONS,
  TRANSCRIPT_PRESENTATION_LABELS} from '../prompt/configuration.js';
import {
  DEFAULT_PROMPT_CONFIGURATION,
  type DividerDensity,
  type GlyphStyle,
  type HistoryColorMode,
  type PromptConfiguration,
  type NotificationSettings,
  type TranscriptAppearance,
} from '../prompt/configuration.js';
import {providerLabel} from '../prompt/PromptPanel.js';
import {welcomeProvider} from '../output/WelcomeProviders.js';
import {PROMPT_STYLES, PROMPT_STYLE_LABELS} from '../prompt/powerline.js';
import {NAVIGATION_PROVIDERS} from '../shell/DirectoryService.js';
import {PICKER_PROVIDERS} from '../pickers/Picker.js';
import {HISTORY_PROVIDERS} from '../shell/historyProviders.js';
import {SUGGESTION_PROVIDERS} from '../suggestions/types.js';
import {foregroundOf, status, theme} from '../chroma/chroma.js';
import {groupedWindow, groupLines, type GroupedLine} from './groupedList.js';
import {foreground, UI_COLORS, lazyForeground} from './palette.js';
import {GLYPHS, getCurrentGlyphMode} from './glyphs.js';
import {framePanel, renderTabStrip} from './PanelShell.js';
import {stepIndex, toggleValue} from './formControls.js';
import {ASK_PRESENTATION_LABELS, ASK_PRESENTATIONS} from '../ask/AskPanel.js';
import {displayWidth, highlightMatches, truncateAnsi} from '../util/text.js';

/** The three top-level views of the one shared panel behind /settings, /config, and /status. */
export const SETTINGS_VIEWS = ['Settings', 'Status', 'Config'] as const;
export type SettingsView = 'settings' | 'status' | 'config';
const VIEW_IDS: readonly SettingsView[] = ['settings', 'status', 'config'];

export type SettingsSection = 'root' | 'appearance';
export interface SettingsPanelState {
  section: SettingsSection;
  /** Top-level view; Config when omitted. */
  view?: SettingsView;
  /** `tabs`: ←/→ switch views. `rows` (default): ↑↓ select, ←/→ change editable values. */
  focus?: 'tabs' | 'rows';
  /** Selected glyph choice in the appearance (glyph preview) section. */
  selectedIndex: number;
  /** Selected row in Settings/Config; scroll offset in Status. */
  contentIndex?: number;
  searchQuery?: string;
  /** Only `/` focuses search; while focused, typing edits the query. */
  searchFocused?: boolean;
  /** Config also lists advanced rows. */
  showAdvanced?: boolean;
  glyphStyle: GlyphStyle;
  onboarding: boolean;
}

export function settingsView(state: SettingsPanelState): SettingsView {
  return state.view ?? 'config';
}

export function switchSettingsView(state: SettingsPanelState, delta: -1 | 1): void {
  const index = VIEW_IDS.indexOf(settingsView(state));
  state.view = VIEW_IDS[(index + delta + VIEW_IDS.length) % VIEW_IDS.length]!;
  state.contentIndex = 0;
  state.searchQuery = '';
  state.searchFocused = false;
}

/** Where Enter leads: `glyph` is the rich glyph preview inside the panel, the rest are full panels. */
export type SettingsDestination = 'glyph' | 'appearance' | 'prompt' | 'transcript' | 'syntax' | 'layout' | 'keyboard' | 'welcome' | 'suggestions' | 'history' | 'picker' | 'navigation' | 'toolConfig' | 'tools'
  | 'setup' | 'resetInstallSuggestions' | 'screensaver' | 'chromeColors' | 'cursor' | 'idleColors' | 'activityColors' | 'themeStudio' | 'themeBridge';

interface SettingsRowBase {
  id: string;
  label: string;
  description: string;
  /** Search also matches the area a row belongs to. */
  category: string;
  /** Advanced rows stay out of the default Config list until the user asks for them (or searches). */
  level?: 'advanced';
  /** The row this one depends on; it renders indented right below its parent. */
  parent?: string;
  /** Whether the row applies to the current values; rows that do not apply disappear. */
  when?: (config: PromptConfiguration) => boolean;
  /**
   * A reason when the row applies but nothing can be chosen here (the effective
   * renderer or terminal cannot provide it). The row stays visible and says
   * Unavailable with this reason; ←/→ never cycle values that cannot work.
   */
  unavailable?: (config: PromptConfiguration) => string | undefined;
}

/**
 * The control a row exposes. `enum` and `boolean` edit a real configuration
 * value inline; `child` opens a full panel; `action` runs on Enter only.
 */
export type SettingsRow = SettingsRowBase & (
  | {control: 'enum'; options: readonly string[]; optionsFor?: (config: PromptConfiguration) => readonly string[]; index: (config: PromptConfiguration) => number;
    select: (config: PromptConfiguration, index: number) => PromptConfiguration}
  | {control: 'boolean'; get: (config: PromptConfiguration) => boolean;
    set: (config: PromptConfiguration, value: boolean) => PromptConfiguration}
  | {control: 'stepper'; steps: readonly number[]; format: (value: number) => string;
    get: (config: PromptConfiguration) => number; set: (config: PromptConfiguration, value: number) => PromptConfiguration}
  | {control: 'child'; destination: SettingsDestination; value?: (config: PromptConfiguration) => string}
  | {control: 'action'; actionLabel: string; destination: SettingsDestination; value?: (config: PromptConfiguration) => string;
    /** An action that only changes configuration (so Setup can run it on its draft instead of opening anything). */
    run?: (config: PromptConfiguration) => PromptConfiguration}
);

function withTranscript(config: PromptConfiguration, patch: Partial<TranscriptAppearance>): PromptConfiguration {
  return {...config, transcript: {...config.transcript, ...patch}};
}

export function enumRow<T>(row: SettingsRowBase & {values: readonly T[]; labels: readonly string[];
  get: (config: PromptConfiguration) => T; set: (config: PromptConfiguration, value: T) => PromptConfiguration}): SettingsRow {
  const {values, labels, get, set, ...base} = row;
  return {...base, control: 'enum', options: labels,
    index: config => Math.max(0, values.indexOf(get(config))),
    select: (config, index) => set(config, values[index]!)};
}

const GLYPH_STYLES: readonly GlyphStyle[] = ['nerd', 'safe'];
const DENSITIES: readonly DividerDensity[] = ['normal', 'compact'];
const COLOR_MODES: readonly HistoryColorMode[] = ['followPrompt', 'theme', 'grayscale'];

function withNotifications(config: PromptConfiguration, patch: Partial<NotificationSettings>): PromptConfiguration {
  return {...config, notifications: {...config.notifications, ...patch}};
}

/** Step to the next preset above (or below) the current value, wrapping at the ends. */
export function stepPreset(steps: readonly number[], current: number, delta: -1 | 1): number {
  if (delta === 1) return steps.find(step => step > current) ?? steps[0]!;
  return [...steps].reverse().find(step => step < current) ?? steps[steps.length - 1]!;
}

export function formatThreshold(seconds: number): string {
  if (seconds <= 60) return `${seconds}s`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Config: the flat list of real, inline-editable values (plus the prompt provider, edited in its panel). */
const NOTIFICATION_CATEGORY = 'Command notifications';
const ON_OFF = [true, false] as const;
const FOCUS_POLICIES = ['suppress', 'notify'] as const;
const NOTIFICATION_THRESHOLD_STEPS = [5, 10, 30, 60, 120, 300, 600, 1800, 3600];

const symbolIds = (c: PromptConfiguration) => PROMPT_SYMBOL_IDS.filter(id => id !== 'custom' || c.promptSymbolCustom);
const chromaOn = (c: PromptConfiguration) => c.presentation.preset !== 'off';
const chromaMoving = (c: PromptConfiguration) => chromaOn(c) && c.presentation.motion !== 'static';
const nativePrompt = (c: PromptConfiguration) => c.provider === 'nmsh';
const stripOn = (c: PromptConfiguration) => c.statusStrip.enabled;
const withStrip = (c: PromptConfiguration, patch: Partial<StatusStripSettings>): PromptConfiguration => ({...c, statusStrip: {...c.statusStrip, ...patch}});

/** Theme family, then the family's variant and (Catppuccin) accent, as nested rows. */
const THEME_ROWS: readonly SettingsRow[] = [
  enumRow({id: 'uiChrome', label: 'UI chrome', description: 'Colors of NMSh frames, rules, tabs, selection and accents; Follow theme matches the active theme', category: 'Appearance',
    values: CHROME_SOURCES, labels: ['Follow theme', 'Custom'],
    get: c => c.uiChrome.source, set: (c, source) => ({...c, uiChrome: {...c.uiChrome, source}})}),
  {id: 'uiChromePreset', parent: 'uiChrome', when: c => c.uiChrome.source === 'custom', label: 'Preset', description: 'Native Lavender, Grayscale, or your own chrome colors', category: 'Appearance',
    control: 'enum', options: CHROME_PRESETS.map(preset => CHROME_PRESET_LABELS[preset]),
    index: c => CHROME_PRESETS.indexOf(c.uiChrome.preset),
    // Custom colors start from the chrome in effect, so nothing jumps.
    select: (c, index) => {
      const preset = CHROME_PRESETS[index]!;
      const colors = c.uiChrome.colors ?? chromeColorsFrom(resolveChrome({...c.uiChrome, source: 'theme'}, c.nmsh.palette, c.nmsh.accent, c.customTheme));
      return {...c, uiChrome: {...c.uiChrome, preset, ...(preset === 'custom' ? {colors} : {})}};
    }},
  {id: 'uiChromeColors', parent: 'uiChromePreset', when: c => c.uiChrome.source === 'custom' && c.uiChrome.preset === 'custom', label: 'Edit colors',
    description: 'Accent, text, separator, selection and status roles with the color picker', category: 'Appearance', control: 'action', actionLabel: 'Edit ›', destination: 'chromeColors'},
  {id: 'themeFamily', label: 'Theme', description: 'Built-in NMSh themes and families, or your Imported and Custom themes (manage them in /theme); colors NMSh-owned UI only', category: 'Appearance',
    control: 'enum', options: FAMILY_LABELS, optionsFor: c => selectionFamilies(c).map(selectionFamilyLabel),
    index: c => Math.max(0, selectionFamilies(c).indexOf(currentSelectionFamily(c))),
    select: (c, index) => { const families = selectionFamilies(c); return selectSelectionFamily(c, families[((index % families.length) + families.length) % families.length]!); }},
  {id: 'themeVariant', parent: 'themeFamily', when: c => selectionVariants(c, currentSelectionFamily(c)).length > 1, label: 'Variant',
    description: 'Flavor, style or variant within the family, or which Imported/Custom theme', category: 'Appearance', control: 'enum',
    options: [], optionsFor: c => selectionVariants(c, currentSelectionFamily(c)).map(option => option.label),
    index: c => Math.max(0, selectionVariants(c, currentSelectionFamily(c)).findIndex(option => option.current(c))),
    select: (c, index) => {
      const options = selectionVariants(c, currentSelectionFamily(c));
      return options[((index % options.length) + options.length) % options.length]!.apply(c);
    }},
  {id: 'themeStudio', parent: 'themeFamily', label: 'Theme Studio', description: 'Create, edit, import, export and manage Native themes', category: 'Appearance',
    control: 'action', actionLabel: 'Open ›', value: c => [librarySummary(c.themes), 'Open ›'].filter(Boolean).join('  '), destination: 'themeStudio'},
  {id: 'themeBridge', label: 'Theme Bridge', description: 'Extend NMSh themes to fzf, less/man, LS_COLORS, tmux, Neovim and Vim; every tool starts Independent', category: 'Appearance',
    control: 'action', actionLabel: "Open ›", value: c => { const active = BRIDGE_TARGETS.filter(target => effectiveMode(c.themeBridge, target) !== 'independent').length;
      return `${active ? `${active} tool${active === 1 ? '' : 's'}` : 'Off'}  Open ›`; }, destination: 'themeBridge'},
  enumRow({id: 'pastePreview', label: 'Paste preview', description: 'Smart: multiline, chained, mutating or risky pastes are shown before they enter the composer (never changed; nothing runs until Enter). Always: every paste. Off: insert at once', category: 'Editor',
    values: ['smart', 'always', 'off'] as const, labels: ['Smart', 'Always', 'Off'],
    get: c => c.pastePreview, set: (c, pastePreview) => ({...c, pastePreview})}),
  enumRow({id: 'themeText', parent: 'themeFamily', label: 'UI text colors', description: 'NMSh panels and menus (not the prompt): On lets the theme color text tiers (primary, secondary, muted); Off keeps NMSh neutral text. Prompt text has its own Text colors in /prompt. Status colors keep their meaning', category: 'Appearance',
    values: [true, false], labels: ['On', 'Off'],
    get: c => c.uiChrome.themeText !== false, set: (c, themeText) => ({...c, uiChrome: {...c.uiChrome, themeText}})}),
  enumRow({id: 'lavenderText', parent: 'themeFamily', when: c => c.nmsh.palette === 'lavender', label: 'UI text tint',
    description: 'Lavender Native, NMSh panels and menus only (the prompt uses /prompt → Text colors): Off keeps neutral text; Lavender tints primary, secondary and muted text. The #A67CF3 accent stays either way', category: 'Appearance',
    values: LAVENDER_TINTS, labels: LAVENDER_TINTS.map(tint => LAVENDER_TINT_LABELS[tint]),
    get: c => c.uiChrome.lavenderText ?? 'off', set: (c, lavenderText) => ({...c, uiChrome: {...c.uiChrome, lavenderText}})}),
  enumRow({id: 'lavenderSurface', parent: 'themeFamily', when: c => c.nmsh.palette === 'lavender', label: 'Surface tint',
    description: 'Lavender Native, NMSh surfaces: Off keeps neutral dark surfaces; Lavender uses subtle dark plum surfaces for selection and focus', category: 'Appearance',
    values: LAVENDER_TINTS, labels: LAVENDER_TINTS.map(tint => LAVENDER_TINT_LABELS[tint]),
    get: c => c.uiChrome.lavenderSurface ?? 'off', set: (c, lavenderSurface) => ({...c, uiChrome: {...c.uiChrome, lavenderSurface}})}),
  enumRow({id: 'themeAccent', parent: 'themeFamily', when: c => familyOf(c.nmsh.palette) === 'catppuccin', label: 'Accent',
    description: 'Catppuccin accent for the project module and NMSh accents', category: 'Appearance',
    values: CATPPUCCIN_ACCENTS, labels: CATPPUCCIN_ACCENTS.map(accent => CATPPUCCIN_ACCENT_LABELS[accent]),
    get: c => c.nmsh.accent, set: (c, accent) => ({...c, nmsh: {...c.nmsh, accent}})}),
];

/** General NMSh motion: Rendering first, then one row per effect, then the selected rendering's tuning; all from the tables /appearance → Motion uses. */
const motionRow = (item: MotionItem, patch: Partial<SettingsRowBase> = {}): SettingsRow => enumRow({id: `motion_${item.id}`, label: item.label, category: 'Motion',
  description: `${item.note}. Off, Reduced Motion, Decorative Effects Off and NO_COLOR always stop motion`, ...patch,
  values: item.values, labels: item.values.map(value => item.labelOf(value)),
  get: c => item.get(c.motion), set: (c, value) => ({...c, motion: item.set(c.motion, value)})});
const MOTION_SETTINGS_ROWS: readonly SettingsRow[] = [
  motionRow(MOTION_RENDERING_ITEM),
  ...MOTION_ROWS.map(row => motionRow({id: row.key, label: row.label, note: row.note, values: row.values, labelOf: value => MOTION_LABELS[value] ?? value,
    get: motion => motion[row.key] as string, set: (motion, value) => ({...motion, [row.key]: value}), preview: row.key})),
  ...MOTION_TUNING_ITEMS.map(item => motionRow({...item, label: `Motion ${item.label.toLowerCase()}`}, {level: 'advanced'})),
];

/** What a cursor value costs or how it is delivered, as a short suffix (Portable fallback, after setup), under the effective renderer. */
function cursorSuffix(feature: CursorFeature, value: string, config: PromptConfiguration): string {
  const availability = availabilityOf(feature, value, config.cursor.renderer, currentCursorHost());
  return availability.available && availability.suffix ? ` · ${availability.suffix}` : '';
}

const CURSOR_LABELS: Record<string, string> = {off: 'Off', none: 'None', smooth: 'Smooth', smear: 'Smear', tail: 'Tail', fire: 'Fire', sparks: 'Sparks', lightning: 'Lightning', railgun: 'Railgun',
  ripple: 'Ripple', wireframe: 'Wireframe', glow: 'Glow', embers: 'Embers', flame: 'Flame', auto: 'Auto', portable: 'Portable', native: 'Host native', low: 'Low', medium: 'Medium', high: 'High'};

/**
 * A cursor motion/effect/idle row that only offers what the effective renderer
 * really draws. Forced Host native on a host that draws none of it says
 * Unavailable (with why) instead of offering values that cannot work; Auto
 * labels what Portable draws in place of the host backend.
 */
function cursorFeatureRow(row: SettingsRowBase & {feature: CursorFeature; values: readonly string[]; get: (c: CursorSettings) => string; set: (c: CursorSettings, value: string) => CursorSettings}): SettingsRow {
  const {feature, values, get, set, ...base} = row;
  const offered = (config: PromptConfiguration) => availableValues(feature, values, config.cursor.renderer, currentCursorHost());
  const stale = (config: PromptConfiguration) => offered(config).includes(get(config.cursor)) ? [] : [get(config.cursor)];
  return {...base, control: 'enum', options: values.map(value => CURSOR_LABELS[value] ?? value),
    optionsFor: config => [...offered(config).map(value => `${CURSOR_LABELS[value] ?? value}${cursorSuffix(feature, value, config)}`), ...stale(config).map(value => `${CURSOR_LABELS[value] ?? value} · unavailable`)],
    index: config => { const list = offered(config); const at = list.indexOf(get(config.cursor)); return at >= 0 ? at : list.length; },
    select: (config, index) => { const list = offered(config); const value = list[index]; return value === undefined ? config : {...config, cursor: set(config.cursor, value)}; },
    unavailable: config => unavailableReason(feature, values, config.cursor.renderer, currentCursorHost())};
}

const withCursor = (config: PromptConfiguration, cursor: CursorSettings): PromptConfiguration => ({...config, cursor});
const chosenCursorTheme = (config: PromptConfiguration) => config.cursor.color.theme ?? config.nmsh.palette;
const CURSOR_COLOR_SOURCES_UI = ['theme', 'chosen', 'accent', 'host', 'custom'] as const;

/** Cursor & effects: the same values /cursor edits, one definition for Settings and Setup. Rich editing (picker, physics) lives in /cursor. */
const CURSOR_ROWS: readonly SettingsRow[] = [
  enumRow({id: 'cursorShape', label: 'Cursor shape', description: 'Text caret shape while NMSh owns the composer; Host default keeps your terminal\'s own cursor and sends nothing', category: 'Cursor',
    values: CURSOR_SHAPES, labels: ['Host default', 'Block', 'Bar', 'Underline'],
    get: c => c.cursor.shape, set: (c, shape) => ({...c, cursor: {...c.cursor, shape}})}),
  {...enumRow({id: 'cursorBlink', parent: 'cursorShape', label: 'Blink', description: 'Caret blink; speed stays the terminal\'s own. Needs an explicit shape', category: 'Cursor',
    values: CURSOR_BLINKS, labels: ['Host default', 'On', 'Off'],
    get: c => c.cursor.blink, set: (c, blink) => ({...c, cursor: {...c.cursor, blink}})}),
  unavailable: c => c.cursor.shape === 'host' ? 'Blink needs an explicit shape; Host default keeps your terminal\'s own cursor.' : undefined},
  enumRow({id: 'cursorRenderer', label: 'Cursor renderer', description: 'Auto uses the terminal\'s GPU cursor (Ghostty, Kitty) once /cursor has set it up, and Portable otherwise. Portable is built in. Host native draws only what the terminal does', category: 'Cursor',
    values: CURSOR_RENDERERS, labels: CURSOR_RENDERERS.map(value => CURSOR_LABELS[value]!),
    get: c => c.cursor.renderer, set: (c, renderer) => ({...c, cursor: {...c.cursor, renderer}})}),
  cursorFeatureRow({id: 'cursorMotion', label: 'Cursor motion', description: 'How the visual caret travels (off by default); the real caret always moves at once', category: 'Cursor',
    feature: 'motion', values: CURSOR_MOTIONS, get: c => c.motion, set: (c, motion) => ({...c, motion: motion as CursorSettings['motion']})}),
  cursorFeatureRow({id: 'cursorEffect', label: 'Cursor effect', description: 'What movement sheds: Fire, Sparks, Ripple and more (off by default)', category: 'Cursor',
    feature: 'effect', values: CURSOR_EFFECTS, get: c => c.effect, set: (c, effect) => ({...c, effect: effect as CursorSettings['effect']})}),
  cursorFeatureRow({id: 'cursorIdle', label: 'Cursor idle effect', description: 'A slow effect while the caret rests (off by default)', category: 'Cursor',
    feature: 'idleEffect', values: CURSOR_IDLE_EFFECTS, get: c => c.idleEffect, set: (c, idleEffect) => ({...c, idleEffect: idleEffect as CursorSettings['idleEffect']})}),
  enumRow({id: 'cursorColor', label: 'Cursor color', description: 'Follow the prompt\'s theme, choose a theme for the cursor alone, use NMSh\'s accent, keep the host\'s color, or pick your own', category: 'Cursor',
    values: CURSOR_COLOR_SOURCES_UI, labels: ['Follow current theme', 'Choose theme', 'NMSh accent', 'Host', 'Custom'],
    get: c => c.cursor.color.source, set: (c, source) => withCursor(c, {...c.cursor, color: {...c.cursor.color, source,
      ...(source === 'chosen' ? {theme: c.cursor.color.theme ?? c.nmsh.palette, themeAccent: c.cursor.color.themeAccent ?? c.nmsh.accent} : {}),
      ...(source === 'custom' && !c.cursor.color.custom ? {custom: describeCursorColor(c.cursor, contextFor(c)).hex ?? '#a67cf3'} : {})}})}),
  {id: 'cursorColorFamily', parent: 'cursorColor', when: c => c.cursor.color.source === 'chosen', label: 'Cursor theme family', description: 'The theme family the cursor uses, independent of the prompt', category: 'Cursor',
    control: 'enum', options: FAMILY_LABELS, optionsFor: c => FAMILY_IDS.filter(id => id !== 'custom' || c.customTheme).map(id => FAMILY_LABELS[FAMILY_IDS.indexOf(id)]!),
    index: c => Math.max(0, FAMILY_IDS.filter(id => id !== 'custom' || c.customTheme).indexOf(familyOf(chosenCursorTheme(c)))),
    select: (c, index) => { const ids = FAMILY_IDS.filter(id => id !== 'custom' || c.customTheme); const family = ids[index] ?? ids[0]!; return withCursor(c, {...c.cursor, color: {...c.cursor.color, theme: defaultVariant(family)}}); }},
  {id: 'cursorColorVariant', parent: 'cursorColorFamily', when: c => c.cursor.color.source === 'chosen' && variantOptions(familyOf(chosenCursorTheme(c))).length > 1, label: 'Cursor theme variant',
    description: 'Flavor, style or variant within the cursor\'s theme family', category: 'Cursor', control: 'enum', options: [],
    optionsFor: c => variantOptions(familyOf(chosenCursorTheme(c))).map(option => option.label),
    index: c => Math.max(0, variantOptions(familyOf(chosenCursorTheme(c))).findIndex(option => option.id === chosenCursorTheme(c))),
    select: (c, index) => { const options = variantOptions(familyOf(chosenCursorTheme(c))); return withCursor(c, {...c.cursor, color: {...c.cursor.color, theme: options[((index % options.length) + options.length) % options.length]!.id}}); }},
  enumRow({id: 'cursorColorAccent', parent: 'cursorColorFamily', when: c => c.cursor.color.source === 'chosen' && familyOf(chosenCursorTheme(c)) === 'catppuccin', label: 'Cursor accent',
    description: 'Catppuccin accent for the cursor\'s theme', category: 'Cursor',
    values: CATPPUCCIN_ACCENTS, labels: CATPPUCCIN_ACCENTS.map(accent => CATPPUCCIN_ACCENT_LABELS[accent]),
    get: c => c.cursor.color.themeAccent ?? c.nmsh.accent, set: (c, accent) => withCursor(c, {...c.cursor, color: {...c.cursor.color, themeAccent: normalizeCatppuccinAccent(accent)}})}),
  {id: 'cursorColorCustom', parent: 'cursorColor', when: c => c.cursor.color.source === 'custom', label: 'Cursor custom color', description: 'Your own #RRGGBB, chosen with the color picker; Enter opens it', category: 'Cursor',
    control: 'action', actionLabel: 'Choose ›', destination: 'cursor', value: c => `■ ${(describeCursorColor(c.cursor, contextFor(c)).hex ?? '#a67cf3').toUpperCase()}`},
  enumRow({id: 'cursorSpeed', level: 'advanced', label: 'Cursor speed', description: 'How long the caret takes to travel', category: 'Cursor', values: CURSOR_LEVELS, labels: CURSOR_LEVELS.map(value => CURSOR_LABELS[value]!),
    get: c => c.cursor.speed, set: (c, speed) => ({...c, cursor: {...c.cursor, speed}})}),
  enumRow({id: 'cursorIntensity', level: 'advanced', label: 'Cursor intensity', description: 'How strong the trail and effect colors are', category: 'Cursor', values: CURSOR_LEVELS, labels: CURSOR_LEVELS.map(value => CURSOR_LABELS[value]!),
    get: c => c.cursor.intensity, set: (c, intensity) => ({...c, cursor: {...c.cursor, intensity}})}),
  enumRow({id: 'cursorTrail', level: 'advanced', label: 'Cursor trail length', description: 'How far Smear and Tail stretch', category: 'Cursor', values: CURSOR_LEVELS, labels: CURSOR_LEVELS.map(value => CURSOR_LABELS[value]!),
    get: c => c.cursor.trailLength, set: (c, trailLength) => ({...c, cursor: {...c.cursor, trailLength}})}),
  enumRow({id: 'cursorParticles', level: 'advanced', label: 'Cursor particles', description: 'How many particles an effect sheds', category: 'Cursor', values: CURSOR_LEVELS, labels: CURSOR_LEVELS.map(value => CURSOR_LABELS[value]!),
    get: c => c.cursor.particleAmount, set: (c, particleAmount) => ({...c, cursor: {...c.cursor, particleAmount}})}),
  {id: 'cursorAdvanced', level: 'advanced', label: 'Advanced cursor tuning', description: 'Trail and particle colors, durations, easing and physics, in /cursor', category: 'Cursor', control: 'action', actionLabel: 'Open ›', destination: 'cursor'},
];

export const SETTINGS_ROWS: readonly SettingsRow[] = [
  enumRow({id: 'glyphStyle', label: 'Glyph style', description: 'Nerd Font or safe terminal symbols', category: 'General',
    values: GLYPH_STYLES, labels: ['Nerd Font', 'Safe / ASCII'],
    get: config => config.glyphStyle, set: (config, glyphStyle) => ({...config, glyphStyle, glyphChoiceComplete: true})}),
  enumRow({id: 'panelPosition', label: 'NMSh panel position', description: 'Where full-width NMSh panels (Setup, Settings, Tools, ...) sit: Bottom (default) or Top. Independent of the composer position', category: 'General',
    values: PANEL_POSITIONS, labels: ['Bottom', 'Top'],
    get: config => config.panelPosition, set: (config, panelPosition) => ({...config, panelPosition})}),
  {id: 'provider', label: 'Prompt provider', description: 'Provider, theme, layout, and modules', category: 'Prompt',
    control: 'child', destination: 'prompt', value: config => providerLabel(config.provider)},
  {id: 'divider', label: 'History divider', description: 'Rule drawn above each past command', category: 'Transcript',
    control: 'boolean', get: config => config.transcript.divider, set: (config, divider) => withTranscript(config, {divider})},
  enumRow({id: 'dividerDensity', level: 'advanced', parent: 'divider', when: config => config.transcript.divider, label: 'Divider density', description: 'Spacing around history dividers', category: 'Transcript',
    values: DENSITIES, labels: ['Normal', 'Compact'],
    get: config => config.transcript.dividerDensity, set: (config, dividerDensity) => withTranscript(config, {dividerDensity})}),
  enumRow({id: 'dividerColors', level: 'advanced', parent: 'divider', when: config => config.transcript.divider, label: 'Divider colors', description: 'Past-command dividers: Follow Chroma (static in history), the History colors, the UI theme, or a muted grayscale', category: 'Transcript',
    values: DIVIDER_COLOR_MODES, labels: DIVIDER_COLOR_MODES.map(mode => DIVIDER_COLOR_LABELS[mode]),
    get: config => config.transcript.dividerColors, set: (config, dividerColors) => withTranscript(config, {dividerColors})}),
  enumRow({id: 'historicalPrompt', label: 'Prompt snapshots', description: 'How past commands show the prompt they ran under: Full, Compact (place, branch, marker), Minimal (marker) or Off. Stored snapshots stay complete', category: 'Transcript',
    values: ['full', 'compact', 'minimal', 'off'] as const, labels: ['Full', 'Compact', 'Minimal', 'Off'],
    get: config => historicalPromptLevel(config.transcript),
    set: (config, level) => withTranscript(config, level === 'off' ? {historicalPrompt: false} : {historicalPrompt: true, historicalPromptLevel: level})}),
  enumRow({id: 'historyColors', level: 'advanced', parent: 'historicalPrompt', when: config => config.transcript.historicalPrompt, label: 'History colors', description: 'How past prompt snapshots are colored', category: 'Transcript',
    values: COLOR_MODES, labels: ['Follow prompt', 'Choose theme', 'Grayscale'],
    get: config => config.transcript.historyColors, set: (config, historyColors) => withTranscript(config, {historyColors})}),
  enumRow({id: 'historyTheme', level: 'advanced', parent: 'historyColors', when: config => config.transcript.historicalPrompt && config.transcript.historyColors === 'theme', label: 'History theme', description: 'The NMSh theme past prompt snapshots are shown in', category: 'Transcript',
    values: NATIVE_PALETTE_IDS, labels: NATIVE_PALETTE_IDS.map(id => NATIVE_PROMPT_THEMES[id].label),
    get: config => config.transcript.historyTheme, set: (config, historyTheme) => withTranscript(config, {historyTheme})}),
  {id: 'syntaxHighlighting', label: 'Syntax highlighting', description: 'Color commands while typing and in new history', category: 'Syntax',
    control: 'boolean', get: config => config.syntax.highlighting, set: (config, highlighting) => ({...config, syntax: {...config.syntax, highlighting}})},
  enumRow({id: 'syntaxColors', level: 'advanced', parent: 'syntaxHighlighting', when: config => config.syntax.highlighting, label: 'Syntax colors', description: 'Follow prompt theme, a chosen theme, or grayscale', category: 'Syntax',
    values: COLOR_MODES, labels: ['Follow prompt', 'Choose theme', 'Grayscale'],
    get: config => config.syntax.colors, set: (config, colors) => ({...config, syntax: {...config.syntax, colors}})}),
  {id: 'syntaxThemeFamily', level: 'advanced', parent: 'syntaxColors', when: config => config.syntax.highlighting && config.syntax.colors === 'theme', label: 'Syntax theme family',
    description: 'The theme family syntax colors come from, independent of the prompt', category: 'Syntax', control: 'enum', options: FAMILY_LABELS,
    optionsFor: c => FAMILY_IDS.filter(id => id !== 'custom' || c.customTheme).map(id => FAMILY_LABELS[FAMILY_IDS.indexOf(id)]!),
    index: c => Math.max(0, FAMILY_IDS.filter(id => id !== 'custom' || c.customTheme).indexOf(familyOf(c.syntax.theme))),
    select: (c, index) => { const ids = FAMILY_IDS.filter(id => id !== 'custom' || c.customTheme); const family = ids[index] ?? ids[0]!; return {...c, syntax: {...c.syntax, theme: defaultVariant(family)}}; }},
  {id: 'syntaxThemeVariant', level: 'advanced', parent: 'syntaxThemeFamily', when: config => config.syntax.highlighting && config.syntax.colors === 'theme' && variantOptions(familyOf(config.syntax.theme)).length > 1,
    label: 'Syntax theme variant', description: 'Flavor, style or variant within the syntax theme family', category: 'Syntax', control: 'enum', options: [],
    optionsFor: c => variantOptions(familyOf(c.syntax.theme)).map(option => option.label),
    index: c => Math.max(0, variantOptions(familyOf(c.syntax.theme)).findIndex(option => option.id === c.syntax.theme)),
    select: (c, index) => { const options = variantOptions(familyOf(c.syntax.theme)); return {...c, syntax: {...c.syntax, theme: options[((index % options.length) + options.length) % options.length]!.id}}; }},
  enumRow({id: 'syntaxThemeAccent', level: 'advanced', parent: 'syntaxThemeFamily', when: config => config.syntax.highlighting && config.syntax.colors === 'theme' && familyOf(config.syntax.theme) === 'catppuccin',
    label: 'Syntax accent (shared)', description: 'Catppuccin accent; shared with the prompt theme\'s accent, so changing it here changes it there too', category: 'Syntax',
    values: CATPPUCCIN_ACCENTS, labels: CATPPUCCIN_ACCENTS.map(accent => CATPPUCCIN_ACCENT_LABELS[accent]),
    get: c => c.nmsh.accent, set: (c, accent) => ({...c, nmsh: {...c.nmsh, accent}})}),
  enumRow({id: 'promptStyle', label: 'Prompt style', description: 'NMSh Native look; each style keeps its own settings in /prompt', category: 'Prompt',
    values: PROMPT_STYLES, labels: PROMPT_STYLES.map(style => PROMPT_STYLE_LABELS[style]),
    get: config => config.nmsh.style, set: (config, style) => ({...config, nmsh: {...config.nmsh, style}})}),
  ...THEME_ROWS,
  enumRow({id: 'promptVibrance', label: 'Prompt vibrance', description: 'Soft, Standard or Vibrant theme colors; explicit module colors are kept', category: 'Prompt',
    values: VIBRANCE_LEVELS, labels: VIBRANCE_LEVELS.map(level => VIBRANCE_LABELS[level]),
    get: config => config.nmsh.vibrance, set: (config, vibrance) => ({...config, nmsh: {...config.nmsh, vibrance}})}),
  enumRow({id: 'composerPosition', label: 'Composer position', description: 'Dock the composer at the bottom or top, or Flow it after the newest output', category: 'Layout',
    values: COMPOSER_POSITIONS, labels: COMPOSER_POSITIONS.map(position => COMPOSER_POSITION_LABELS[position]),
    get: config => config.composerPosition, set: (config, composerPosition) => ({...config, composerPosition})}),
  enumRow({id: 'transcriptPresentation', label: 'Transcript presentation', description: 'Normal rows, or Chat with commands on the right', category: 'Layout',
    values: TRANSCRIPT_PRESENTATIONS, labels: TRANSCRIPT_PRESENTATIONS.map(presentation => TRANSCRIPT_PRESENTATION_LABELS[presentation]),
    get: config => config.transcriptPresentation, set: (config, transcriptPresentation) => ({...config, transcriptPresentation})}),
  {id: 'composerDividers', label: 'Composer dividers', description: 'The horizontal lines around the composer; Off gives their rows back. Transcript dividers and prompt separators are separate', category: 'Layout',
    control: 'boolean', get: config => config.composerDividers, set: (config, composerDividers) => ({...config, composerDividers})},
  enumRow({id: 'outputFolding', level: 'advanced', label: 'Output folding', description: 'Off, Smart (long repetitive successes), or Always (every long block)', category: 'Transcript',
    values: OUTPUT_FOLDING_MODES, labels: ['Off', 'Smart', 'Always'],
    get: config => config.outputFolding, set: (config, outputFolding) => ({...config, outputFolding})}),
  enumRow({id: 'updateMode', label: 'Automatic updates', description: 'Automatic prepares verified releases for the next launch (official source installs only); Notify only announces them; Off never checks. /update works on request', category: 'Updates',
    values: UPDATE_MODES, labels: ['Automatic', 'Notify only', 'Off'],
    get: config => config.updateMode, set: (config, updateMode) => ({...config, updateMode})}),
  enumRow({id: 'updateFrequency', parent: 'updateMode', when: config => config.updateMode !== 'off', label: 'Check frequency', description: 'How often to look for a new stable release', category: 'Updates',
    values: UPDATE_FREQUENCIES, labels: ['Daily', 'Weekly'],
    get: config => config.updateFrequency, set: (config, updateFrequency) => ({...config, updateFrequency})}),
  enumRow({id: 'liveSessionStartup', label: 'Startup restore', description: 'Resume a detached live session at launch: Ask, Always, or Never (never ends none)', category: 'Sessions',
    values: LIVE_SESSION_STARTUP, labels: ['Ask', 'Always', 'Never'],
    get: config => config.liveSessionStartup, set: (config, liveSessionStartup) => ({...config, liveSessionStartup})}),
  enumRow({id: 'liveSessionMultiple', level: 'advanced', label: 'Multiple detached sessions', description: 'At launch with several: ask which, or open all in new windows', category: 'Sessions',
    values: LIVE_SESSION_MULTIPLE, labels: ['Ask which', 'Open all'],
    get: config => config.liveSessionMultiple, set: (config, liveSessionMultiple) => ({...config, liveSessionMultiple})}),
  {id: 'sessionNotices', label: 'Session notices', description: 'Brief factual lines (up to three) above the composer when other sessions finish, fail, ask for attention or end; each fades on its own, and /sessions keeps the state', category: 'Sessions',
    control: 'boolean', get: config => config.sessionNotices, set: (config, sessionNotices) => ({...config, sessionNotices})},
  {id: 'agentActivity', label: 'Agent activity', description: 'Local-only durations and counts for Claude Code and Codex CLI runs (/agents); never prompts or output', category: 'Sessions',
    control: 'boolean', get: config => config.agentActivity, set: (config, agentActivity) => ({...config, agentActivity})},
  enumRow({id: 'shellBackend', label: 'Default shell', description: 'Shell for new sessions; /shell switches the current session and lists what is installed', category: 'Sessions',
    values: SHELL_IDS, labels: SHELL_IDS.map(id => shellAdapter(id).label),
    get: config => config.shellBackend, set: (config, shellBackend) => ({...config, shellBackend})}),
  enumRow({id: 'showShell', label: 'Show current shell', description: 'Prompt module naming this session\'s backend: only when it differs from the default, always, or never', category: 'Sessions',
    values: SHELL_MODULE_VISIBILITY, labels: SHELL_MODULE_VISIBILITY.map(value => SHELL_MODULE_VISIBILITY_LABELS[value]),
    get: config => shellModuleVisibility(config), set: (config, value) => {
      const next = {...config, modules: config.modules.map(module => ({...module}))};
      applyShellModuleVisibility(next, value);
      return next;
    }}),
  {id: 'askRecord', label: 'Record Ask in transcript', description: 'Keep Ask questions and replies with this session\'s transcript; commands or actions you approve still follow their normal history rules', category: 'Ask',
    control: 'boolean', get: config => config.askRecord, set: (config, askRecord) => ({...config, askRecord})},
  enumRow({id: 'askPresentation', label: 'Ask presentation', description: 'Chat puts your Ask turns on the right; Normal keeps both sides on the left. The transcript keeps its own presentation', category: 'Ask',
    values: ASK_PRESENTATIONS, labels: ASK_PRESENTATIONS.map(mode => ASK_PRESENTATION_LABELS[mode]),
    get: config => config.askPresentation, set: (config, askPresentation) => ({...config, askPresentation})}),
  enumRow({id: 'localUnderstanding', label: 'Local understanding', description: 'Optional local language model for the features you enable; Off never loads one. Ask and Smart Folding work without it', category: 'Ask',
    values: LOCAL_UNDERSTANDING_MODES, labels: LOCAL_UNDERSTANDING_MODES.map(mode => LOCAL_UNDERSTANDING_LABELS[mode]),
    get: config => config.localUnderstanding.mode, set: (config, mode) => ({...config, localUnderstanding: {...config.localUnderstanding, mode}})}),
  {id: 'localUnderstandingAsk', label: 'Use local model for Ask', description: 'Improve Ask\'s understanding of loosely worded requests (built-in understanding is used first in Auto)', category: 'Ask',
    parent: 'localUnderstanding', when: config => config.localUnderstanding.mode !== 'off',
    control: 'boolean', get: config => config.localUnderstanding.ask, set: (config, ask) => ({...config, localUnderstanding: {...config.localUnderstanding, ask}})},
  {id: 'localUnderstandingFolding', label: 'Use local model for Smart Folding', description: 'Advisory hints for which output to fold; never hides errors or changes output', category: 'Ask',
    parent: 'localUnderstanding', when: config => config.localUnderstanding.mode !== 'off',
    control: 'boolean', get: config => config.localUnderstanding.folding, set: (config, folding) => ({...config, localUnderstanding: {...config.localUnderstanding, folding}})},
  enumRow({id: 'openWith', label: 'Open with', description: 'Where /open and /open-diff hand files: the editor around NMSh (Auto), Zed, VS Code, or VISUAL/EDITOR', category: 'Sessions',
    values: OPEN_WITH_IDS, labels: ['Auto', 'Zed', 'VS Code', 'VISUAL / EDITOR'],
    get: config => config.openWith, set: (config, openWith) => ({...config, openWith})}),
  {id: 'welcome', label: 'Welcome provider', description: 'What new sessions show first: Vespyr, Fastfetch, Neofetch, or None', category: 'Welcome',
    control: 'child', destination: 'welcome', value: config => welcomeProvider(config.welcome).label},
  {id: 'suggestions', label: 'Suggestions', description: 'Ghost-text prediction provider: NMSh Native, Deja, or None', category: 'Suggestions',
    control: 'child', destination: 'suggestions',
    value: config => SUGGESTION_PROVIDERS.find(provider => provider.id === config.suggestions)?.label ?? config.suggestions},
  {id: 'history', label: 'Command history provider', description: 'Native journals and zsh history, or explicit local read-only Atuin', category: 'History',
    control: 'child', destination: 'history', value: config => HISTORY_PROVIDERS.find(provider => provider.id === config.history)?.label ?? config.history},
  {id: 'picker', label: 'Picker provider', description: 'Native composer search, fzf, or Television; selections never execute', category: 'History',
    control: 'child', destination: 'picker', value: config => PICKER_PROVIDERS.find(provider => provider.id === config.picker)?.label ?? config.picker},
  {id: 'navigation', label: 'Directory navigation', description: 'Native command-history frecency or read-only zoxide snapshot', category: 'History',
    control: 'child', destination: 'navigation', value: config => NAVIGATION_PROVIDERS.find(provider => provider.id === config.navigation)?.label ?? config.navigation},
  {id: 'suggestionsOnEmpty', level: 'advanced', label: 'Empty-prompt prediction', description: 'Suggest the likely next command before typing', category: 'Suggestions',
    control: 'boolean', get: config => config.suggestionsOnEmpty, set: (config, suggestionsOnEmpty) => ({...config, suggestionsOnEmpty})},
  enumRow({id: 'notifications', label: 'Notifications', description: 'Notify when a long-running command finishes', category: NOTIFICATION_CATEGORY,
    values: ON_OFF, labels: ['On', 'Off'],
    get: config => config.notifications.enabled, set: (config, enabled) => withNotifications(config, {enabled})}),
  {id: 'notifyAfter', parent: 'notifications', when: config => config.notifications.enabled, label: 'Notify after', description: 'Minimum command duration before notifying', category: NOTIFICATION_CATEGORY,
    control: 'stepper', steps: NOTIFICATION_THRESHOLD_STEPS, format: formatThreshold,
    get: config => config.notifications.thresholdSeconds,
    set: (config, thresholdSeconds) => withNotifications(config, {thresholdSeconds})},
  enumRow({id: 'notifyOnSuccess', parent: 'notifications', when: config => config.notifications.enabled, label: 'On success', description: 'Notify when a long command exits 0', category: NOTIFICATION_CATEGORY,
    values: ON_OFF, labels: ['On', 'Off'],
    get: config => config.notifications.onSuccess, set: (config, onSuccess) => withNotifications(config, {onSuccess})}),
  enumRow({id: 'notifyOnFailure', parent: 'notifications', when: config => config.notifications.enabled, label: 'On failure', description: 'Notify when a long command fails or is interrupted', category: NOTIFICATION_CATEGORY,
    values: ON_OFF, labels: ['On', 'Off'],
    get: config => config.notifications.onFailure, set: (config, onFailure) => withNotifications(config, {onFailure})}),
  enumRow({id: 'notifyWhenFocused', parent: 'notifications', when: config => config.notifications.enabled, label: 'When focused', description: 'Suppress notifications while this terminal is focused', category: NOTIFICATION_CATEGORY,
    values: FOCUS_POLICIES, labels: ['Suppress', 'Notify'],
    get: config => config.notifications.whenFocused, set: (config, whenFocused) => withNotifications(config, {whenFocused})}),
  ...CURSOR_ROWS,
  {id: 'promptSymbol', when: nativePrompt, label: 'Prompt symbol', description: 'The composer marker; a custom symbol is typed in /prompt. Starship/Powerlevel10k prompts are unchanged', category: 'Prompt',
    // Custom is offered here only once a glyph exists; the glyph is typed in /prompt.
    control: 'enum', options: PROMPT_SYMBOL_IDS.filter(id => id !== 'custom').map(id => promptSymbolLabel(id)),
    optionsFor: c => symbolIds(c).map(id => promptSymbolLabel(id, c.promptSymbolCustom)),
    index: c => Math.max(0, symbolIds(c).indexOf(c.promptSymbol)),
    select: (c, index) => ({...c, promptSymbol: symbolIds(c)[index] ?? 'chevron'})},
  {id: 'statusStrip', label: 'Status strip', description: 'Compact NMSh-owned status row, top right; Minimal shows the clock and a real battery', category: 'Status strip',
    control: 'boolean', get: c => c.statusStrip.enabled, set: (c, enabled) => withStrip(c, {enabled})},
  {id: 'stripClock', parent: 'statusStrip', when: stripOn, label: 'Clock', description: 'Local time', category: 'Status strip',
    control: 'boolean', get: c => c.statusStrip.clock, set: (c, clock) => withStrip(c, {clock})},
  {id: 'stripBattery', parent: 'statusStrip', when: stripOn, label: 'Battery', description: 'Shown only when this machine has a battery', category: 'Status strip',
    control: 'boolean', get: c => c.statusStrip.battery, set: (c, battery) => withStrip(c, {battery})},
  {id: 'stripCpu', parent: 'statusStrip', when: stripOn, label: 'CPU', description: 'CPU use from local OS counters', category: 'Status strip',
    control: 'boolean', get: c => c.statusStrip.cpu, set: (c, cpu) => withStrip(c, {cpu})},
  {id: 'stripRam', parent: 'statusStrip', when: stripOn, label: 'RAM', description: 'Memory in use', category: 'Status strip',
    control: 'boolean', get: c => c.statusStrip.ram, set: (c, ram) => withStrip(c, {ram})},
  enumRow({id: 'stripRamDisplay', parent: 'stripRam', when: c => stripOn(c) && c.statusStrip.ram, label: 'Show', description: 'Percent, absolute, or both', category: 'Status strip',
    values: RAM_DISPLAYS, labels: ['Percent', 'Absolute', 'Both'],
    get: c => c.statusStrip.ramDisplay, set: (c, ramDisplay) => withStrip(c, {ramDisplay})}),
  {id: 'stripUptime', parent: 'statusStrip', when: stripOn, label: 'Uptime', description: 'Time since this machine booted', category: 'Status strip',
    control: 'boolean', get: c => c.statusStrip.uptime, set: (c, uptime) => withStrip(c, {uptime})},
  enumRow({id: 'idleTimeout', label: 'Idle visuals', description: 'Screensaver after inactivity while NMSh owns the terminal; Never by default. /screensaver previews', category: 'Idle visuals',
    values: IDLE_TIMEOUTS, labels: IDLE_TIMEOUTS.map(minutes => minutes === 0 ? 'Never' : minutes === 60 ? '60 minutes' : `${minutes} minute${minutes === 1 ? '' : 's'}`),
    get: c => c.idleVisuals.timeout, set: (c, timeout) => ({...c, idleVisuals: {...c.idleVisuals, timeout}})}),
  enumRow({id: 'idleMode', parent: 'idleTimeout', label: 'Mode', description: 'The idle visual; /screensaver shows each one live', category: 'Idle visuals',
    values: IDLE_MODES, labels: IDLE_MODES.map(mode => IDLE_MODE_LABELS[mode]),
    get: c => c.idleVisuals.mode, set: (c, mode) => ({...c, idleVisuals: {...c.idleVisuals, mode}})}),
  {id: 'idleRunBusy', parent: 'idleTimeout', label: 'Run while busy', description: 'Let the screensaver start while a command is running; never over a fullscreen program', category: 'Idle visuals',
    control: 'boolean', get: c => c.idleVisuals.runWhileBusy, set: (c, runWhileBusy) => ({...c, idleVisuals: {...c.idleVisuals, runWhileBusy}})},
  enumRow({id: 'idleColor', parent: 'idleTimeout', label: 'Colors', description: 'Follow Chroma / Theme: Chroma when it is on, otherwise the theme. Theme only ignores Chroma. Custom: your own idle gradient', category: 'Idle visuals',
    values: IDLE_COLOR_SOURCES, labels: IDLE_COLOR_SOURCES.map(source => IDLE_COLOR_LABELS[source]),
    get: c => c.idleVisuals.colorSource, set: (c, colorSource) => ({...c, idleVisuals: withIdleColorSource(c, colorSource)})}),
  {id: 'idleCustomColors', parent: 'idleColor', when: c => c.idleVisuals.colorSource === 'custom', label: 'Edit colors',
    description: 'The idle visuals\' own gradient stops, with a live preview', category: 'Idle visuals', control: 'action', actionLabel: 'Edit ›', destination: 'idleColors'},
  enumRow({id: 'activityColors', label: 'Live activity colors', description: 'The running-command line. Follow appearance uses Chroma when it is on, otherwise the theme. Only live work moves; finished commands show their plain result', category: 'Live activity',
    values: LIVE_ACTIVITY_COLORS, labels: LIVE_ACTIVITY_COLORS.map(colors => LIVE_ACTIVITY_COLOR_LABELS[colors]),
    get: c => c.liveActivity.colors, set: (c, colors) => ({...c, liveActivity: {...c.liveActivity, colors,
      customStops: colors === 'custom' && c.liveActivity.customStops.length < 2 ? [...PRESET_STOPS.lavender] : c.liveActivity.customStops}})}),
  {id: 'activityCustomColors', parent: 'activityColors', when: c => c.liveActivity.colors === 'custom', label: 'Edit colors',
    description: 'Gradient stops for the live activity line', category: 'Live activity', control: 'action', actionLabel: 'Edit ›', destination: 'activityColors'},
  {id: 'tools', label: 'Tools', description: 'Optional discovery, installed state, installation previews and supported configuration', category: 'Tools', control: 'child', destination: 'tools'},
  enumRow({id: 'toolUpdateChecks', label: 'Optional tool update checks', description: 'Batched Homebrew outdated checks for optional tools; upgrades are always previewed and confirmed', category: 'Tools',
    values: UPDATE_CHECK_FREQUENCIES, labels: ['Off', 'Daily', 'Weekly'],
    get: config => config.toolUpdateChecks, set: (config, toolUpdateChecks) => ({...config, toolUpdateChecks})}),
  {id: 'installSuggestions', label: 'Install suggestions', description: 'Offer to install a missing curated tool when its exact command is submitted', category: 'Tools',
    control: 'boolean', get: config => config.installSuggestions, set: (config, installSuggestions) => ({...config, installSuggestions})},
  {id: 'resetInstallSuggestions', parent: 'installSuggestions', label: 'Ignored install suggestions', description: 'Tools you asked NMSh not to offer again; Enter resets the list', category: 'Tools',
    control: 'action', actionLabel: 'Reset', destination: 'resetInstallSuggestions', run: config => ({...config, ignoredInstallSuggestions: []})},
  enumRow({id: 'treatmentPreset', label: 'Chroma', description: 'Colors the Native prompt; /chroma has every option. Ordinary UI chrome is not Chroma; external prompts keep their colors', category: 'Presentation',
    values: TREATMENT_PRESETS, labels: TREATMENT_PRESETS.map(preset => TREATMENT_PRESET_LABELS[preset]),
    get: c => c.presentation.preset, set: (c, preset) => ({...c, presentation: {...c.presentation, preset: preset === 'custom' && !c.presentation.customStops.length ? 'off' : preset}})}),
  {id: 'treatmentIntensity', parent: 'treatmentPreset', when: chromaOn, label: 'Influence', description: 'How strongly Chroma recolors the Native prompt; Full Chroma is the default', category: 'Presentation',
    control: 'enum', options: TREATMENT_INFLUENCES.map(entry => entry.label),
    index: c => TREATMENT_INFLUENCES.findIndex(entry => entry.id === treatmentInfluence(c.presentation)),
    // Choosing Full Chroma brings Semantic colors to its default, Override; it stays editable below.
    select: (c, index) => {
      const entry = TREATMENT_INFLUENCES[index]!;
      return {...c, presentation: {...c.presentation, intensity: entry.intensity, ...(entry.id === 'full' ? {semantic: 'override' as const} : {})}};
    }},
  enumRow({id: 'treatmentSemantic', parent: 'treatmentIntensity', when: chromaOn, label: 'Semantic colors', description: 'Override lets Chroma recolor success, failure and Git state; their symbols and readable text keep the meaning', category: 'Presentation',
    values: SEMANTIC_MODES, labels: SEMANTIC_MODES.map(mode => SEMANTIC_MODE_LABELS[mode]),
    get: c => c.presentation.semantic ?? 'preserve', set: (c, semantic) => ({...c, presentation: {...c.presentation, semantic}})}),
  enumRow({id: 'treatmentScope', parent: 'treatmentPreset', when: chromaOn, label: 'Applies to', description: 'The whole Native prompt (default), or identity modules only', category: 'Presentation',
    values: TREATMENT_SCOPES, labels: TREATMENT_SCOPES.map(scope => TREATMENT_SCOPE_LABELS[scope]),
    get: c => c.presentation.scope ?? 'prompt', set: (c, scope) => ({...c, presentation: {...c.presentation, scope}})}),
  enumRow({id: 'chromaRules', parent: 'treatmentPreset', when: chromaOn, label: 'Divider lines', description: DIVIDER_LINES_HELP, category: 'Presentation',
    values: [true, false], labels: [dividerLinesLabel(true), dividerLinesLabel(false)],
    get: c => c.presentation.rules !== false, set: (c, rules) => ({...c, presentation: {...c.presentation, rules}})}),
  enumRow({id: 'treatmentGeometry', parent: 'treatmentPreset', when: chromaOn, label: 'Gradient layout', description: 'Where the gradient runs: Left → Right, Right → Left, Center → Outward or Outside → Center; works with Static', category: 'Presentation',
    values: TREATMENT_GEOMETRIES, labels: TREATMENT_GEOMETRIES.map(geometry => TREATMENT_GEOMETRY_LABELS[geometry]),
    get: c => c.presentation.geometry, set: (c, geometry) => ({...c, presentation: {...c.presentation, geometry}})}),
  enumRow({id: 'treatmentMotion', parent: 'treatmentPreset', when: chromaOn, label: 'Motion', description: 'Live prompt motion (and divider lines when they follow Chroma); history stays static', category: 'Presentation',
    values: TREATMENT_MOTIONS, labels: TREATMENT_MOTIONS.map(motion => TREATMENT_MOTION_LABELS[motion]),
    get: c => c.presentation.motion, set: (c, motion) => ({...c, presentation: {...c.presentation, motion}})}),
  enumRow({id: 'treatmentSpeed', parent: 'treatmentMotion', when: chromaMoving, label: 'Speed', description: 'Chroma animation cycle length', category: 'Presentation',
    values: TREATMENT_SPEEDS, labels: TREATMENT_SPEEDS.map(speed => TREATMENT_SPEED_LABELS[speed]),
    get: c => c.presentation.speed ?? 'normal', set: (c, speed) => ({...c, presentation: {...c.presentation, speed}})}),
  enumRow({id: 'treatmentCurve', parent: 'treatmentMotion', when: chromaMoving, label: 'Ramp', description: 'Easing of the animation', category: 'Presentation',
    values: TREATMENT_CURVES, labels: TREATMENT_CURVES.map(curve => TREATMENT_CURVE_LABELS[curve]),
    get: c => c.presentation.curve ?? 'linear', set: (c, curve) => ({...c, presentation: {...c.presentation, curve}})}),
  ...MOTION_SETTINGS_ROWS,
  {id: 'reducedMotion', label: 'Reduced Motion', description: 'Static colors; no decorative movement or effects', category: 'Presentation', control: 'boolean',
    get: c => c.presentation.reducedMotion, set: (c, reducedMotion) => ({...c, presentation: {...c.presentation, reducedMotion}})},
  // Stored as effectsOff for compatibility; shown positively so nobody reads "Effects Off: Off".
  enumRow({id: 'effectsOff', label: 'Decorative effects', description: 'Chroma motion, sparkle effects, idle visuals and the Welcome blink; Off keeps NMSh still and quiet', category: 'Presentation',
    values: [true, false], labels: ['On', 'Off'],
    get: c => !c.presentation.effectsOff, set: (c, on) => ({...c, presentation: {...c.presentation, effectsOff: !on}})}),
  enumRow({id: 'shimmer', when: c => !c.presentation.effectsOff, label: 'Shimmer', description: 'One soft sweep of light when you select or change something, submit, or confirm; also the live Working status. Characters never move', category: 'Presentation',
    values: ['on', 'off'] as const, labels: ['On', 'Off'],
    get: c => c.presentation.shimmer ?? 'on', set: (c, shimmer) => ({...c, presentation: {...c.presentation, shimmer}})}),
  {id: 'autoEffects', label: 'Milestone effects', description: 'A brief effect after a successful tool install, update or setup', category: 'Presentation', control: 'boolean',
    get: c => c.presentation.autoEffects !== false, set: (c, autoEffects) => ({...c, presentation: {...c.presentation, autoEffects}})},


];

/** Settings: entry points to the richer panels. Their values live in Config / the panels themselves. */
export const SETTINGS_ENTRIES: readonly SettingsRow[] = [
  {id: 'appearance', label: 'Appearance', description: 'Terminal opacity and blur', category: 'General', control: 'child', destination: 'appearance'},
  {id: 'glyphPreview', label: 'Glyph style', description: 'Compare Nerd Font and safe symbols', category: 'General', control: 'child', destination: 'glyph'},
  {id: 'prompt', label: 'Prompt', description: 'Provider, theme, layout, and modules', category: 'Prompt', control: 'child', destination: 'prompt'},
  {id: 'transcript', label: 'Transcript', description: 'History colors, dividers, and prompt snapshots', category: 'Transcript', control: 'child', destination: 'transcript'},
  {id: 'syntax', label: 'Syntax', description: 'Editor highlighting and syntax colors', category: 'Syntax', control: 'child', destination: 'syntax'},
  {id: 'keyboard', label: 'Keyboard', description: 'Terminal key bindings', category: 'Keyboard', control: 'child', destination: 'keyboard'},
  {id: 'welcome', label: 'Welcome', description: 'Native, optional external fetch provider, or None', category: 'Welcome', control: 'child', destination: 'welcome'},
  {id: 'suggestionsPanel', label: 'Suggestions', description: 'Ghost-text prediction provider', category: 'Suggestions', control: 'child', destination: 'suggestions'},
  {id: 'layout', label: 'Layout', description: 'Preview and choose composer position and transcript presentation', category: 'Layout', control: 'child', destination: 'layout'},
  {id: 'toolConfig', label: 'Tool configuration', description: 'Review supported Starship module changes', category: 'Tools', control: 'child', destination: 'toolConfig'},
  {id: 'tools', label: 'Tools', description: 'Discover and manage optional shell tools', category: 'Tools', control: 'child', destination: 'tools'},
  {id: 'screensaver', label: 'Screensaver', description: 'Idle visuals: live gallery, timeout and colors', category: 'Idle visuals', control: 'child', destination: 'screensaver'},
  {id: 'setup', label: 'Setup Cat', description: 'Guided setup; rerun anytime, your current choices are kept', category: 'General', control: 'child', destination: 'setup'},
];

/** Text cue (not color) that a value differs from its default. */
const CHANGED_MARK = () => (getCurrentGlyphMode() === 'nerd' ? '•' : '*');


/**
 * Config reads as a short list of named groups, scrolled continuously. A row's group comes from its
 * root parent (children always sit under their parent), then an explicit id, then its category.
 * Order here is the order on screen.
 */
export const CONFIG_GROUPS = ['General', 'Appearance', 'Prompt & Composer', 'Editor', 'Cursor & Motion', 'Sessions & Alerts', 'Shell & Providers', 'Local Understanding', 'Transcript & Privacy'] as const;
export type ConfigGroup = typeof CONFIG_GROUPS[number];

export const CONFIG_GROUP_BY_ID: Readonly<Record<string, ConfigGroup>> = {
  glyphStyle: 'General', panelPosition: 'General', liveSessionStartup: 'General', liveSessionMultiple: 'General', updateMode: 'General', updateFrequency: 'General',
  promptVibrance: 'Appearance',
  showShell: 'Prompt & Composer', composerPosition: 'Prompt & Composer', composerDividers: 'Prompt & Composer', divider: 'Prompt & Composer', historicalPrompt: 'Prompt & Composer',
  transcriptPresentation: 'Editor', openWith: 'Editor', suggestionsOnEmpty: 'Editor', pastePreview: 'Editor',
  reducedMotion: 'Cursor & Motion', effectsOff: 'Cursor & Motion',
  shellBackend: 'Shell & Providers', suggestions: 'Shell & Providers',
  localUnderstanding: 'Local Understanding',
  askRecord: 'Transcript & Privacy', askPresentation: 'Transcript & Privacy', outputFolding: 'Transcript & Privacy',
};
export const CONFIG_GROUP_BY_CATEGORY: Readonly<Record<string, ConfigGroup>> = {
  General: 'General', Updates: 'General',
  Appearance: 'Appearance', Presentation: 'Appearance', 'Idle visuals': 'Appearance', 'Live activity': 'Appearance',
  Prompt: 'Prompt & Composer', Layout: 'Prompt & Composer', 'Status strip': 'Prompt & Composer',
  Editor: 'Editor', Syntax: 'Editor', Suggestions: 'Editor',
  Cursor: 'Cursor & Motion', Motion: 'Cursor & Motion',
  Sessions: 'Sessions & Alerts', 'Command notifications': 'Sessions & Alerts',
  Tools: 'Shell & Providers', Welcome: 'Shell & Providers', History: 'Shell & Providers',
  Ask: 'Local Understanding', Transcript: 'Transcript & Privacy',
};

function rootOf(row: SettingsRow): SettingsRow {
  let current = row;
  for (let depth = 0; current.parent && depth < 5; depth += 1) current = SETTINGS_ROWS.find(item => item.id === current.parent) ?? current;
  return current;
}

/** The Config group a row is listed under. */
export function configGroup(row: SettingsRow): ConfigGroup {
  const root = rootOf(row);
  return CONFIG_GROUP_BY_ID[root.id] ?? CONFIG_GROUP_BY_CATEGORY[root.category] ?? 'General';
}

/** The order of root rows inside their groups (children follow their root); roots not listed keep their place after these. */
const CONFIG_ORDER: readonly string[] = [
  'glyphStyle', 'panelPosition', 'liveSessionStartup', 'liveSessionMultiple', 'updateMode', 'updateFrequency',
  'uiChrome', 'themeFamily', 'promptVibrance', 'treatmentPreset', 'shimmer', 'autoEffects', 'idleTimeout', 'activityColors',
  'provider', 'promptStyle', 'promptSymbol', 'composerPosition', 'composerDividers', 'divider', 'historicalPrompt', 'showShell', 'statusStrip',
  'syntaxHighlighting', 'pastePreview', 'transcriptPresentation', 'suggestionsOnEmpty', 'openWith',
  'cursorShape', 'cursorRenderer', 'cursorMotion', 'cursorEffect', 'cursorIdle', 'cursorColor', 'cursorSpeed', 'cursorIntensity', 'cursorTrail', 'cursorParticles', 'cursorAdvanced',
  'motion_rendering', 'motion_contextTransitions', 'motion_commandLaunch', 'motion_completionHighlight', 'motion_completionEffect', 'motion_cursorTravel', 'motion_eventFeedback', 'motion_intensity', 'motion_speed',
  'reducedMotion', 'effectsOff',
  'sessionNotices', 'agentActivity', 'notifications',
  'shellBackend', 'welcome', 'suggestions', 'history', 'picker', 'navigation', 'tools', 'toolUpdateChecks', 'installSuggestions',
  'localUnderstanding',
  'askRecord', 'askPresentation', 'outputFolding',
];
const groupRank = (row: SettingsRow) => CONFIG_GROUPS.indexOf(configGroup(row));
/** Sort key: group, the root's place in CONFIG_ORDER, the root's own position, then the row's (so a child stays under its parent). */
function configOrder(row: SettingsRow): number[] {
  const root = rootOf(row);
  const listed = CONFIG_ORDER.indexOf(root.id);
  return [groupRank(row), listed < 0 ? CONFIG_ORDER.length : listed, SETTINGS_ROWS.indexOf(root), SETTINGS_ROWS.indexOf(row)];
}
const compareOrder = (a: SettingsRow, b: SettingsRow) => { const x = configOrder(a); const y = configOrder(b); for (let i = 0; i < 4; i += 1) if (x[i] !== y[i]) return x[i]! - y[i]!; return 0; };

/** How deep a row nests under its parents (0 for top-level rows). */
export function settingsRowDepth(row: SettingsRow): number {
  let depth = 0;
  for (let parent = row.parent; parent && depth < 4; depth++) parent = SETTINGS_ROWS.find(item => item.id === parent)?.parent;
  return depth;
}

/** A row applies when its own condition and every parent's hold; rows that do not apply are hidden, not disabled. */
export function settingsRowApplies(row: SettingsRow, config: PromptConfiguration): boolean {
  if (row.when && !row.when(config)) return false;
  const parent = row.parent ? SETTINGS_ROWS.find(item => item.id === row.parent) : undefined;
  return parent ? settingsRowApplies(parent, config) : true;
}

export function visibleSettingsRows(state: SettingsPanelState, config: PromptConfiguration = DEFAULT_PROMPT_CONFIGURATION): SettingsRow[] {
  const view = settingsView(state);
  if (view === 'status') return [];
  if (view === 'settings') return [...SETTINGS_ENTRIES];
  const query = state.searchQuery?.trim().toLowerCase();
  // Grouped, in a stable order: a row keeps its place within its group, so a child stays directly under its parent.
  const applicable = SETTINGS_ROWS.filter(row => settingsRowApplies(row, config)).sort(compareOrder);
  if (!query) return applicable.filter(row => state.showAdvanced || row.level !== 'advanced');
  return applicable.filter(row => [row.label, row.description, row.category, configGroup(row)].some(text => text.toLowerCase().includes(query)));
}

export function selectedSettingsRow(state: SettingsPanelState, config?: PromptConfiguration): SettingsRow | undefined {
  return state.focus === 'tabs' ? undefined : visibleSettingsRows(state, config)[state.contentIndex ?? 0];
}

export function settingsItemCount(state: SettingsPanelState, config?: PromptConfiguration): number {
  return state.section === 'root' ? visibleSettingsRows(state, config).length : 2;
}

export function isInlineEditable(row: SettingsRow | undefined): boolean {
  return row?.control === 'enum' || row?.control === 'boolean' || row?.control === 'stepper';
}

/** ←/→ on an enum or boolean row; undefined when the row has nothing to change inline. */
export function adjustSettingsRow(row: SettingsRow, config: PromptConfiguration, delta: -1 | 1): PromptConfiguration | undefined {
  // Nothing can work here: ←/→ never cycle values that cannot; the only change offered puts a stale value back to Off/None (the first option).
  if (row.unavailable?.(config)) return row.control === 'enum' && row.index(config) !== 0 ? row.select(config, 0) : undefined;
  if (row.control === 'boolean') return row.set(config, toggleValue(row.get(config)));
  if (row.control === 'stepper') return row.set(config, stepPreset(row.steps, row.get(config), delta));
  if (row.control !== 'enum') return undefined;
  return row.select(config, stepIndex(rowOptions(row, config).length, row.index(config), delta));
}

/** An enum row's options for this configuration (some rows depend on other values). */
export function rowOptions(row: Extract<SettingsRow, {control: 'enum'}>, config: PromptConfiguration): readonly string[] {
  return row.optionsFor?.(config) ?? row.options;
}

/** Enter/Space: toggle a boolean or step an enum forward. */
export function toggleSettingsRow(row: SettingsRow, config: PromptConfiguration): PromptConfiguration | undefined {
  return adjustSettingsRow(row, config, 1);
}

/** True when an inline-editable row differs from the shipped default. */
export function settingsRowChanged(row: SettingsRow, config: PromptConfiguration): boolean {
  if (row.control === 'enum') return row.index(config) !== row.index(DEFAULT_PROMPT_CONFIGURATION);
  if (row.control === 'stepper') return row.get(config) !== row.get(DEFAULT_PROMPT_CONFIGURATION);
  if (row.control === 'boolean') return row.get(config) !== row.get(DEFAULT_PROMPT_CONFIGURATION);
  return false;
}

/** The row's default display value, for "reset to ..." help. */
export function settingsRowDefaultLabel(row: SettingsRow): string | undefined {
  return settingsRowValue(row, DEFAULT_PROMPT_CONFIGURATION);
}

/** Configuration with only this row reset to its default; undefined when the row has no inline value. */
export function resetSettingsRow(row: SettingsRow, config: PromptConfiguration): PromptConfiguration | undefined {
  if (row.control === 'enum') return row.select(config, row.index(DEFAULT_PROMPT_CONFIGURATION));
  if (row.control === 'stepper') return row.set(config, row.get(DEFAULT_PROMPT_CONFIGURATION));
  if (row.control === 'boolean') return row.set(config, row.get(DEFAULT_PROMPT_CONFIGURATION));
  return undefined;
}

/** Enter on a row that opens something. */
export function settingsRowDestination(row: SettingsRow): SettingsDestination | undefined {
  return row.control === 'child' || row.control === 'action' ? row.destination : undefined;
}

export function settingsRowValue(row: SettingsRow, config: PromptConfiguration): string | undefined {
  if (row.unavailable?.(config)) return 'Unavailable';
  switch (row.control) {
    case 'enum': return rowOptions(row, config)[row.index(config)];
    case 'stepper': return row.format(row.get(config));
    case 'boolean': return row.get(config) ? 'true' : 'false';
    case 'child': return row.value?.(config);
    case 'action': return row.value?.(config) ?? row.actionLabel;
  }
}

/** One Status line; `tone` maps to NMSh semantic colors. */
export interface StatusItem {
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'muted';
}
/** A named Status group; arrays stay plain item lists (`flat()` still works) with an optional title. */
export type StatusSection = readonly StatusItem[] & {title?: string};
export type StatusSections = readonly StatusSection[];
/** Build a titled Status section. */
export const statusSection = (title: string, items: readonly StatusItem[]): StatusSection => Object.assign([...items], {title});

export interface SettingsRenderContext {
  configuration?: PromptConfiguration;
  status?: StatusSections;
}

const PRIMARY = lazyForeground(UI_COLORS.primary);
const SECONDARY = lazyForeground(UI_COLORS.secondary);
const ACCENT = lazyForeground(UI_COLORS.accent);
const SUBTLE = lazyForeground(UI_COLORS.subtle);
const BORDER = lazyForeground(UI_COLORS.separator);
const BOLD = '\u001B[1m';
const INVERSE = '\u001B[7m';
const RESET = '\u001B[0m';
const MARGIN = '  ';
/**
 * Search matches: underlined lavender text, no background. The underline keeps
 * a match distinct inside the selected row, whose label is itself bold lavender.
 */
export const SEARCH_MATCH = `${BOLD}\u001B[4m${ACCENT}`;

function box(): {tl: string; tr: string; bl: string; br: string; h: string; v: string} {
  return getCurrentGlyphMode() === 'nerd'
    ? {tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│'}
    : {tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|'};
}

/** A bordered input: icon, query or placeholder, and a block cursor while focused. */
export function renderSearchField(state: SettingsPanelState, columns: number): string[] {
  const chars = box();
  const width = Math.max(8, columns - MARGIN.length * 2);
  const inner = width - 2;
  const border = state.searchFocused ? ACCENT : BORDER;
  const query = state.searchQuery ?? '';
  const icon = `${state.searchFocused ? ACCENT : SUBTLE}${GLYPHS.search}${RESET}`;
  const cursor = state.searchFocused ? `${INVERSE} ${RESET}` : '';
  const text = query
    ? `${PRIMARY}${query}${RESET}${cursor}`
    : `${cursor}${SUBTLE}Search settings…${RESET}`;
  const body = truncateAnsi(` ${icon} ${text}`, inner);
  const pad = Math.max(0, inner - displayWidth(body));
  return [
    `${MARGIN}${border}${chars.tl}${chars.h.repeat(inner)}${chars.tr}${RESET}`,
    `${MARGIN}${border}${chars.v}${RESET}${body}${' '.repeat(pad)}${border}${chars.v}${RESET}`,
    `${MARGIN}${border}${chars.bl}${chars.h.repeat(inner)}${chars.br}${RESET}`,
  ];
}

/**
 * Compact rows: pointer, label, and a value aligned in one column. The value
 * survives narrow widths; the label truncates first.
 */
function renderRows(rows: readonly SettingsRow[], selected: number | undefined,
  columns: number, query: string, valueOf: (row: SettingsRow) => string, budget: number, grouped = false): string[] {
  const widest = Math.max(0, ...rows.map(row => displayWidth(valueOf(row))));
  // Dependent rows sit under their parent with a small plain indent.
  const indent = (row: SettingsRow) => '  '.repeat(settingsRowDepth(row));
  // One value column for every row; it moves left before any value is cut.
  const labelColumn = Math.max(6, Math.min(Math.max(0, ...rows.map(row => displayWidth(indent(row) + row.label))) + 4,
    columns - MARGIN.length - 2 - widest));
  const drawRow = (row: SettingsRow, active: boolean) => {
    const pointer = active ? `${ACCENT}${GLYPHS.selection}${RESET}` : ' ';
    const value = valueOf(row);
    const valueStyled = `${active ? ACCENT : SECONDARY}${value}${RESET}`;
    const room = labelColumn - 2;
    const label = truncateAnsi(indent(row) + highlightMatches(row.label, query, active ? `${BOLD}${ACCENT}` : PRIMARY, SEARCH_MATCH) + RESET, room);
    const pad = Math.max(2, labelColumn - displayWidth(label));
    return truncateAnsi(`${MARGIN}${pointer} ${label}${' '.repeat(pad)}${valueStyled}`, columns);
  };
  if (grouped) {
    // Named groups over one continuous list: headings are not selectable and not part of the selection index.
    const lines = groupLines(rows, configGroup);
    const selectedLine = lines.findIndex(line => line.kind === 'item' && line.index === selected);
    let {start, end} = groupedWindow(lines, selectedLine >= 0 ? selectedLine : undefined, budget);
    // A "more" cue replaces the first or last line when rows are hidden; never the selected one.
    const itemsIn = (from: number, to: number) => lines.slice(from, to).filter(line => line.kind === 'item').length;
    if (start > 0 && selectedLine === start) start -= 1;
    if (end < lines.length && selectedLine === end - 1) end += 1;
    // The cue takes the last line, so the line above it must not be a heading with nothing left under it.
    while (end < lines.length && end - 2 > start && lines[end - 2]!.kind === 'header') end -= 1;
    const out = lines.slice(start, end).map(line => line.kind === 'header' ? `${MARGIN}${ACCENT}${line.title}${RESET}` : drawRow(line.item, line.index === selected));
    if (start > 0) out[0] = `${MARGIN}  ${SUBTLE}↑ ${itemsIn(0, start + 1)} more${RESET}`;
    if (end < lines.length) out[out.length - 1] = `${MARGIN}  ${SUBTLE}↓ ${itemsIn(end - 1, lines.length)} more${RESET}`;
    return out.slice(0, Math.max(1, budget));
  }
  const visible = Math.max(1, budget);
  const anchor = selected ?? 0;
  const start = Math.max(0, Math.min(anchor - Math.floor(visible / 2), rows.length - visible));
  const out = rows.slice(start, start + visible).map((row, offset) => drawRow(row, start + offset === selected));
  if (start > 0) out[0] = `${MARGIN}  ${SUBTLE}↑ ${start + 1} more${RESET}`;
  const below = rows.length - (start + visible);
  if (below > 0) out[out.length - 1] = `${MARGIN}  ${SUBTLE}↓ ${below + 1} more${RESET}`;
  return out;
}

function footerText(state: SettingsPanelState, row: SettingsRow | undefined, changedDefault?: string): string {
  const view = settingsView(state);
  if (state.searchFocused) return '↑↓ results · Enter select · Esc clear';
  if (view === 'status') return '←/→ to switch · ↑↓ to scroll · Esc to close';
  if (state.focus === 'tabs') return '←/→ to switch · ↓ to select · Esc to close';
  const search = view === 'config' ? ' · / to search' : '';
  const escape = state.searchQuery?.trim() ? 'Esc to clear' : 'Esc to close';
  const advanced = view === 'config' && !state.searchQuery?.trim() ? ` · A ${state.showAdvanced ? 'hide' : 'show'} advanced` : '';
  const reset = changedDefault !== undefined ? ` · R reset to ${changedDefault}` : '';
  if (isInlineEditable(row)) return `Enter/Space to change${reset}${search}${advanced} · ${escape}`;
  if (row) return `Enter to open · ←/→ to switch${search}${advanced} · ${escape}`;
  return `←/→ to switch${search}${advanced} · ${escape}`;
}

function toneColor(tone: StatusItem['tone']): string {
  return foregroundOf(tone === 'success' ? status('success')
    : tone === 'warning' ? status('failure')
      : theme(tone === 'muted' ? 'subtle' : 'primary'));
}

/** Typed Status display lines: a heading per titled section, its rows, and a blank between sections. */
type StatusLine = {kind: 'header'; title: string; text: string} | {kind: 'item'; text: string} | {kind: 'blank'; text: string};

function statusDisplay(sections: StatusSections, columns: number): StatusLine[] {
  const items = sections.flat();
  const labelColumn = Math.min(Math.max(...items.map(item => displayWidth(item.label)), 0) + 3, Math.floor(columns / 2));
  const out: StatusLine[] = [];
  sections.forEach((section, index) => {
    if (index > 0) out.push({kind: 'blank', text: ''});
    if (section.title) out.push({kind: 'header', title: section.title, text: truncateAnsi(`${MARGIN}${ACCENT}${section.title}${RESET}`, columns)});
    for (const item of section) {
      const label = `${item.label}:`;
      out.push({kind: 'item', text: truncateAnsi(`${MARGIN}${section.title ? '  ' : ''}${SECONDARY}${label}${' '.repeat(Math.max(1, labelColumn - displayWidth(label)))}${toneColor(item.tone)}${item.value}${RESET}`, columns)});
    }
  });
  return out;
}

/** Lines Status occupies (headings and the blank lines between sections included), so ↑↓ scrolling can clamp. */
export function statusLineCount(sections: StatusSections): number {
  return statusDisplay(sections, 80).length;
}

function renderGlyphPreview(state: SettingsPanelState, columns: number): string[] {
  const item = (selected: boolean, label: string) =>
    `${MARGIN}${selected ? `${ACCENT}${GLYPHS.selection}` : ' '} ${selected ? PRIMARY : SECONDARY}${label}${RESET}`;
  const rows = framePanel([
    `${BOLD}${PRIMARY}${MARGIN}${state.onboarding ? 'Terminal glyph style' : 'Glyph style'}${RESET}`, '',
    `${SUBTLE}${MARGIN}Choose the preview that renders correctly in this terminal.${RESET}`,
    `${SUBTLE}${MARGIN}NMSh cannot read the font selected by your terminal.${RESET}`, '',
    item(state.selectedIndex === 0, `Nerd Font    ~/Projects   main   node ${state.glyphStyle === 'nerd' ? '  ✓' : ''}`),
    item(state.selectedIndex === 1, `Safe / ASCII   < ~/Projects > git: main > node >${state.glyphStyle === 'safe' ? '  ✓' : ''}`),
    '', `${MARGIN}${SUBTLE}↑↓ to choose · Enter to save · Esc to ${state.onboarding ? 'use current' : 'go back'}${RESET}`,
  ], columns);
  return rows.map(row => truncateAnsi(row, columns));
}

export function renderSettingsPanel(state: SettingsPanelState, columns: number, maxRows = Infinity,
  context: SettingsRenderContext = {}): string[] {
  if (state.section === 'appearance') return renderGlyphPreview(state, columns);
  const config = context.configuration ?? {...DEFAULT_PROMPT_CONFIGURATION, glyphStyle: state.glyphStyle};
  const view = settingsView(state);
  const tabsFocused = state.focus === 'tabs';
  const header = [renderTabStrip(SETTINGS_VIEWS, VIEW_IDS.indexOf(view), columns, tabsFocused), ''];
  const rows = visibleSettingsRows(state, config);
  const selectedIndex = Math.min(state.contentIndex ?? 0, Math.max(0, rows.length - 1));
  const selectedRow = tabsFocused ? undefined : rows[selectedIndex];
  const changedDefault = view === 'config' && selectedRow && settingsRowChanged(selectedRow, config) ? settingsRowDefaultLabel(selectedRow) : undefined;
  const footer = ['', `${MARGIN}${SUBTLE}${footerText(state, selectedRow, changedDefault)}${RESET}`];
  // Separator + header + footer; short terminals drop the footer first.
  const chrome = 1 + header.length + footer.length;
  const tight = maxRows - chrome < 3;
  const available = Math.max(1, tight ? maxRows - 1 - header.length : maxRows - chrome);
  const body: string[] = [];

  if (view === 'status') {
    const lines = statusDisplay(context.status ?? [], columns);
    const {start, end} = groupedWindow(lines.map(line => ({kind: line.kind === 'header' ? 'header' as const : 'item' as const, title: '', item: line, index: 0})) as never, undefined, available, state.contentIndex ?? 0);
    const shown = lines.slice(start, end);
    while (shown.length > 1 && shown[shown.length - 1]!.kind === 'blank') shown.pop();
    body.push(...shown.map(line => line.text));
  } else if (view === 'settings') {
    body.push(...renderRows(rows, tabsFocused ? undefined : selectedIndex, columns, '',
      row => `${SUBTLE}${row.description}`, Math.max(1, available)));
  } else {
    const query = state.searchQuery?.trim() ?? '';
    body.push(...renderSearchField(state, columns));
    // The selected row's description gets its own two lines whenever the list keeps a useful size beside it.
    const describe = Boolean(selectedRow) && available - 3 >= 9;
    const listBudget = Math.max(1, available - 3 - (describe ? 2 : 0));
    if (rows.length) {
      body.push(...renderRows(rows, tabsFocused ? undefined : selectedIndex, columns, query,
        row => `${settingsRowValue(row, config) ?? ''}${settingsRowChanged(row, config) ? ` ${CHANGED_MARK()}` : ''}`, listBudget, true));
      if (selectedRow && describe) {
        body.push('', `${MARGIN}  ${highlightMatches(selectedRow.unavailable?.(config) ?? selectedRow.description, query, SUBTLE, SEARCH_MATCH)}${RESET}`);
      }
    } else body.push(`${MARGIN}  ${SUBTLE}No settings match "${query}"${RESET}`);
  }
  // Panel frames are ordinary UI chrome: they follow the UI chrome colors, never Chroma.
  const out = framePanel([...header, ...body, ...(tight ? [] : footer)], columns);
  return out.slice(0, Math.max(1, maxRows)).map(row => truncateAnsi(row, columns));
}
