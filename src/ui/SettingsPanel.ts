import {TREATMENT_PRESETS, TREATMENT_GEOMETRIES, TREATMENT_MOTIONS} from '../chroma/treatment.js';
import {OUTPUT_FOLDING_MODES} from '../output/FoldPolicy.js';
import {UPDATE_CHECK_FREQUENCIES} from '../update/update.js';
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
import {foreground, UI_COLORS} from './palette.js';
import {GLYPHS, getCurrentGlyphMode} from './glyphs.js';
import {framePanel, renderTabStrip} from './PanelShell.js';
import {stepIndex, toggleValue} from './formControls.js';
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
export type SettingsDestination = 'glyph' | 'appearance' | 'prompt' | 'transcript' | 'syntax' | 'layout' | 'keyboard' | 'welcome' | 'suggestions' | 'history' | 'picker' | 'navigation' | 'toolConfig' | 'tools';

interface SettingsRowBase {
  id: string;
  label: string;
  description: string;
  /** Search also matches the area a row belongs to. */
  category: string;
  /** Advanced rows stay out of the default Config list until the user asks for them (or searches). */
  level?: 'advanced';
}

/**
 * The control a row exposes. `enum` and `boolean` edit a real configuration
 * value inline; `child` opens a full panel; `action` runs on Enter only.
 */
export type SettingsRow = SettingsRowBase & (
  | {control: 'enum'; options: readonly string[]; index: (config: PromptConfiguration) => number;
    select: (config: PromptConfiguration, index: number) => PromptConfiguration}
  | {control: 'boolean'; get: (config: PromptConfiguration) => boolean;
    set: (config: PromptConfiguration, value: boolean) => PromptConfiguration}
  | {control: 'stepper'; steps: readonly number[]; format: (value: number) => string;
    get: (config: PromptConfiguration) => number; set: (config: PromptConfiguration, value: number) => PromptConfiguration}
  | {control: 'child'; destination: SettingsDestination; value?: (config: PromptConfiguration) => string}
  | {control: 'action'; actionLabel: string; destination: SettingsDestination}
);

function withTranscript(config: PromptConfiguration, patch: Partial<TranscriptAppearance>): PromptConfiguration {
  return {...config, transcript: {...config.transcript, ...patch}};
}

function enumRow<T>(row: SettingsRowBase & {values: readonly T[]; labels: readonly string[];
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

export const SETTINGS_ROWS: readonly SettingsRow[] = [
  enumRow({id: 'glyphStyle', label: 'Glyph style', description: 'Nerd Font or safe terminal symbols', category: 'General',
    values: GLYPH_STYLES, labels: ['Nerd Font', 'Safe / ASCII'],
    get: config => config.glyphStyle, set: (config, glyphStyle) => ({...config, glyphStyle, glyphChoiceComplete: true})}),
  {id: 'provider', label: 'Prompt provider', description: 'Provider, theme, layout, and modules', category: 'Prompt',
    control: 'child', destination: 'prompt', value: config => providerLabel(config.provider)},
  {id: 'divider', label: 'History divider', description: 'Rule drawn above each past command', category: 'Transcript',
    control: 'boolean', get: config => config.transcript.divider, set: (config, divider) => withTranscript(config, {divider})},
  enumRow({id: 'dividerDensity', level: 'advanced', label: 'Divider density', description: 'Spacing around history dividers', category: 'Transcript',
    values: DENSITIES, labels: ['Normal', 'Compact'],
    get: config => config.transcript.dividerDensity, set: (config, dividerDensity) => withTranscript(config, {dividerDensity})}),
  {id: 'historicalPrompt', label: 'Prompt snapshots', description: 'Show the prompt each past command ran under', category: 'Transcript',
    control: 'boolean', get: config => config.transcript.historicalPrompt,
    set: (config, historicalPrompt) => withTranscript(config, {historicalPrompt})},
  enumRow({id: 'historyColors', level: 'advanced', label: 'History colors', description: 'How past prompt snapshots are colored', category: 'Transcript',
    values: COLOR_MODES, labels: ['Follow prompt', 'Theme', 'Grayscale'],
    get: config => config.transcript.historyColors, set: (config, historyColors) => withTranscript(config, {historyColors})}),
  {id: 'syntaxHighlighting', label: 'Syntax highlighting', description: 'Color commands while typing and in new history', category: 'Syntax',
    control: 'boolean', get: config => config.syntax.highlighting, set: (config, highlighting) => ({...config, syntax: {...config.syntax, highlighting}})},
  enumRow({id: 'syntaxColors', level: 'advanced', label: 'Syntax colors', description: 'Follow prompt theme, a chosen theme, or grayscale', category: 'Syntax',
    values: COLOR_MODES, labels: ['Follow prompt', 'Theme', 'Grayscale'],
    get: config => config.syntax.colors, set: (config, colors) => ({...config, syntax: {...config.syntax, colors}})}),
  enumRow({id: 'promptStyle', label: 'Prompt style', description: 'NMSh Native look: Powerline, Soft, Minimal, or Outline', category: 'Prompt',
    values: PROMPT_STYLES, labels: PROMPT_STYLES.map(style => PROMPT_STYLE_LABELS[style]),
    get: config => config.nmsh.style, set: (config, style) => ({...config, nmsh: {...config.nmsh, style}})}),
  enumRow({id: 'composerPosition', label: 'Composer position', description: 'Dock the composer at the bottom or top, or Flow it after the newest output', category: 'Layout',
    values: COMPOSER_POSITIONS, labels: COMPOSER_POSITIONS.map(position => COMPOSER_POSITION_LABELS[position]),
    get: config => config.composerPosition, set: (config, composerPosition) => ({...config, composerPosition})}),
  enumRow({id: 'transcriptPresentation', label: 'Transcript presentation', description: 'Normal rows, or Chat with commands on the right', category: 'Layout',
    values: TRANSCRIPT_PRESENTATIONS, labels: TRANSCRIPT_PRESENTATIONS.map(presentation => TRANSCRIPT_PRESENTATION_LABELS[presentation]),
    get: config => config.transcriptPresentation, set: (config, transcriptPresentation) => ({...config, transcriptPresentation})}),
  enumRow({id: 'outputFolding', level: 'advanced', label: 'Output folding', description: 'Off, Smart (long repetitive successes), or Always (every long block)', category: 'Transcript',
    values: OUTPUT_FOLDING_MODES, labels: ['Off', 'Smart', 'Always'],
    get: config => config.outputFolding, set: (config, outputFolding) => ({...config, outputFolding})}),
  enumRow({id: 'updateChecks', label: 'Update checks', description: 'Quietly check GitHub for new releases; /update checks on demand', category: 'Updates',
    values: UPDATE_CHECK_FREQUENCIES, labels: ['Off', 'Daily', 'Weekly'],
    get: config => config.updateChecks, set: (config, updateChecks) => ({...config, updateChecks})}),
  enumRow({id: 'liveSessionStartup', label: 'Startup restore', description: 'Resume a detached live session at launch: Ask, Always, or Never (never ends none)', category: 'Sessions',
    values: LIVE_SESSION_STARTUP, labels: ['Ask', 'Always', 'Never'],
    get: config => config.liveSessionStartup, set: (config, liveSessionStartup) => ({...config, liveSessionStartup})}),
  enumRow({id: 'liveSessionMultiple', level: 'advanced', label: 'Multiple detached sessions', description: 'At launch with several: ask which, or open all in new windows', category: 'Sessions',
    values: LIVE_SESSION_MULTIPLE, labels: ['Ask which', 'Open all'],
    get: config => config.liveSessionMultiple, set: (config, liveSessionMultiple) => ({...config, liveSessionMultiple})}),
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
  {id: 'notifyAfter', label: 'Notify after', description: 'Minimum command duration before notifying', category: NOTIFICATION_CATEGORY,
    control: 'stepper', steps: NOTIFICATION_THRESHOLD_STEPS, format: formatThreshold,
    get: config => config.notifications.thresholdSeconds,
    set: (config, thresholdSeconds) => withNotifications(config, {thresholdSeconds})},
  enumRow({id: 'notifyOnSuccess', label: 'On success', description: 'Notify when a long command exits 0', category: NOTIFICATION_CATEGORY,
    values: ON_OFF, labels: ['On', 'Off'],
    get: config => config.notifications.onSuccess, set: (config, onSuccess) => withNotifications(config, {onSuccess})}),
  enumRow({id: 'notifyOnFailure', label: 'On failure', description: 'Notify when a long command fails or is interrupted', category: NOTIFICATION_CATEGORY,
    values: ON_OFF, labels: ['On', 'Off'],
    get: config => config.notifications.onFailure, set: (config, onFailure) => withNotifications(config, {onFailure})}),
  enumRow({id: 'notifyWhenFocused', label: 'When focused', description: 'Suppress notifications while this terminal is focused', category: NOTIFICATION_CATEGORY,
    values: FOCUS_POLICIES, labels: ['Suppress', 'Notify'],
    get: config => config.notifications.whenFocused, set: (config, whenFocused) => withNotifications(config, {whenFocused})}),
  {id: 'tools', label: 'Tools', description: 'Optional discovery, installed state, installation previews and supported configuration', category: 'Tools', control: 'child', destination: 'tools'},
  enumRow({id: 'treatmentPreset', label: 'Visual treatment', description: 'Native Minimal/Outline identity, history rules and Settings frame; external prompts retain their colors', category: 'Presentation',
    values: TREATMENT_PRESETS, labels: ['Off', 'Lavender', 'Aurora', 'Theme', 'Custom'],
    get: c => c.presentation.preset, set: (c, preset) => ({...c, presentation: {...c.presentation, preset: preset === 'custom' && !c.presentation.customStops.length ? 'off' : preset}})}),
  enumRow({id: 'treatmentGeometry', level: 'advanced', label: 'Gradient geometry', description: 'Independent gradient direction', category: 'Presentation',
    values: TREATMENT_GEOMETRIES, labels: ['Left to right', 'Center outward', 'Outside inward'],
    get: c => c.presentation.geometry, set: (c, geometry) => ({...c, presentation: {...c.presentation, geometry}})}),
  enumRow({id: 'treatmentMotion', level: 'advanced', label: 'Decorative motion', description: 'Live separator motion; history stays static', category: 'Presentation',
    values: TREATMENT_MOTIONS, labels: ['Static', 'Travel', 'Breathe'],
    get: c => c.presentation.motion, set: (c, motion) => ({...c, presentation: {...c.presentation, motion}})}),
  {id: 'treatmentIntensity', level: 'advanced', label: 'Treatment intensity', description: 'Blend with ordinary surface foreground', category: 'Presentation',
    control: 'stepper', steps: [0, 0.25, 0.5, 0.65, 1], format: v => `${Math.round(v * 100)}%`,
    get: c => c.presentation.intensity, set: (c, intensity) => ({...c, presentation: {...c.presentation, intensity}})},
  {id: 'reducedMotion', label: 'Reduced Motion', description: 'Static colors; no decorative movement or effects', category: 'Presentation', control: 'boolean',
    get: c => c.presentation.reducedMotion, set: (c, reducedMotion) => ({...c, presentation: {...c.presentation, reducedMotion}})},
  {id: 'effectsOff', label: 'Effects Off', description: 'Disable decorative animation and transient effects', category: 'Presentation', control: 'boolean',
    get: c => c.presentation.effectsOff, set: (c, effectsOff) => ({...c, presentation: {...c.presentation, effectsOff}})},


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
];

/** Text cue (not color) that a value differs from its default. */
const CHANGED_MARK = () => (getCurrentGlyphMode() === 'nerd' ? '•' : '*');

export const PLANNED_AREAS = ['Layout', 'Blocks', 'Tools', 'Completion', 'Chroma'] as const;

export function visibleSettingsRows(state: SettingsPanelState): SettingsRow[] {
  const view = settingsView(state);
  if (view === 'status') return [];
  if (view === 'settings') return [...SETTINGS_ENTRIES];
  const query = state.searchQuery?.trim().toLowerCase();
  if (!query) return SETTINGS_ROWS.filter(row => state.showAdvanced || row.level !== 'advanced');
  return SETTINGS_ROWS.filter(row => [row.label, row.description, row.category].some(text => text.toLowerCase().includes(query)));
}

export function selectedSettingsRow(state: SettingsPanelState): SettingsRow | undefined {
  return state.focus === 'tabs' ? undefined : visibleSettingsRows(state)[state.contentIndex ?? 0];
}

export function settingsItemCount(state: SettingsPanelState): number {
  return state.section === 'root' ? visibleSettingsRows(state).length : 2;
}

export function isInlineEditable(row: SettingsRow | undefined): boolean {
  return row?.control === 'enum' || row?.control === 'boolean' || row?.control === 'stepper';
}

/** ←/→ on an enum or boolean row; undefined when the row has nothing to change inline. */
export function adjustSettingsRow(row: SettingsRow, config: PromptConfiguration, delta: -1 | 1): PromptConfiguration | undefined {
  if (row.control === 'boolean') return row.set(config, toggleValue(row.get(config)));
  if (row.control === 'stepper') return row.set(config, stepPreset(row.steps, row.get(config), delta));
  if (row.control !== 'enum') return undefined;
  return row.select(config, stepIndex(row.options.length, row.index(config), delta));
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
  switch (row.control) {
    case 'enum': return row.options[row.index(config)];
    case 'stepper': return row.format(row.get(config));
    case 'boolean': return row.get(config) ? 'true' : 'false';
    case 'child': return row.value?.(config);
    case 'action': return row.actionLabel;
  }
}

/** One Status line; `tone` maps to NMSh semantic colors. */
export interface StatusItem {
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'muted';
}
/** Status groups render with a blank line between them. */
export type StatusSections = readonly (readonly StatusItem[])[];

export interface SettingsRenderContext {
  configuration?: PromptConfiguration;
  status?: StatusSections;
}

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const ACCENT = foreground(UI_COLORS.accent);
const SUBTLE = foreground(UI_COLORS.subtle);
const BORDER = foreground(UI_COLORS.separator);
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
  columns: number, query: string, valueOf: (row: SettingsRow) => string, budget: number): string[] {
  const widest = Math.max(0, ...rows.map(row => displayWidth(valueOf(row))));
  // One value column for every row; it moves left before any value is cut.
  const labelColumn = Math.max(6, Math.min(Math.max(0, ...rows.map(row => displayWidth(row.label))) + 4,
    columns - MARGIN.length - 2 - widest));
  const visible = Math.max(1, budget);
  const anchor = selected ?? 0;
  const start = Math.max(0, Math.min(anchor - Math.floor(visible / 2), rows.length - visible));
  const out: string[] = [];
  rows.slice(start, start + visible).forEach((row, offset) => {
    const active = start + offset === selected;
    const pointer = active ? `${ACCENT}${GLYPHS.selection}${RESET}` : ' ';
    const value = valueOf(row);
    const valueStyled = `${active ? ACCENT : SECONDARY}${value}${RESET}`;
    const room = labelColumn - 2;
    const label = truncateAnsi(highlightMatches(row.label, query, active ? `${BOLD}${ACCENT}` : PRIMARY, SEARCH_MATCH) + RESET, room);
    const pad = Math.max(2, labelColumn - displayWidth(label));
    out.push(truncateAnsi(`${MARGIN}${pointer} ${label}${' '.repeat(pad)}${valueStyled}`, columns));
  });
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

function statusLines(sections: StatusSections, columns: number): string[] {
  const items = sections.flat();
  const labelColumn = Math.min(Math.max(...items.map(item => displayWidth(item.label)), 0) + 3, Math.floor(columns / 2));
  const lines: string[] = [];
  sections.forEach((section, index) => {
    if (index > 0) lines.push('');
    for (const item of section) {
      const label = `${item.label}:`;
      lines.push(truncateAnsi(`${MARGIN}${SECONDARY}${label}${' '.repeat(Math.max(1, labelColumn - displayWidth(label)))}${toneColor(item.tone)}${item.value}${RESET}`, columns));
    }
  });
  return lines;
}

/** Lines Status occupies, so ↑↓ scrolling can clamp. */
export function statusLineCount(sections: StatusSections): number {
  return sections.reduce((sum, section) => sum + section.length, 0) + Math.max(0, sections.length - 1);
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
  const rows = visibleSettingsRows(state);
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
    const lines = statusLines(context.status ?? [], columns);
    const start = Math.max(0, Math.min(state.contentIndex ?? 0, lines.length - available));
    body.push(...lines.slice(start, start + available));
  } else if (view === 'settings') {
    body.push(...renderRows(rows, tabsFocused ? undefined : selectedIndex, columns, '',
      row => `${SUBTLE}${row.description}`, Math.max(1, available)));
    if (available >= rows.length + 3) {
      body.push('', `${MARGIN}${SECONDARY}Planned for v0.4${RESET}`, `${MARGIN}${SUBTLE}${PLANNED_AREAS.join(' · ')}${RESET}`);
    }
  } else {
    const query = state.searchQuery?.trim() ?? '';
    body.push(...renderSearchField(state, columns));
    const listBudget = Math.max(1, available - 3);
    if (rows.length) {
      body.push(...renderRows(rows, tabsFocused ? undefined : selectedIndex, columns, query,
        row => `${settingsRowValue(row, config) ?? ''}${settingsRowChanged(row, config) ? ` ${CHANGED_MARK()}` : ''}`, listBudget));
      if (selectedRow && listBudget - rows.length >= 2) {
        body.push('', `${MARGIN}  ${highlightMatches(selectedRow.description, query, SUBTLE, SEARCH_MATCH)}${RESET}`);
      }
    } else body.push(`${MARGIN}  ${SUBTLE}No settings match "${query}"${RESET}`);
  }
  const out = framePanel([...header, ...body, ...(tight ? [] : footer)], columns, config.presentation);
  return out.slice(0, Math.max(1, maxRows)).map(row => truncateAnsi(row, columns));
}
