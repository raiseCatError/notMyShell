import type {Key} from '../terminal/keys.js';
import {
  DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, WELCOME_PROVIDER_IDS,
  type PromptConfiguration, type PromptProviderId,
} from '../prompt/configuration.js';
import {STYLE_PROFILE_OPTIONS} from '../prompt/styles.js';
import {separatorLabel} from '../prompt/glyphChoices.js';
import {appearanceRows, PROMPT_PROVIDERS, type AppearanceRow} from '../prompt/PromptPanel.js';
import {WELCOME_PROVIDERS} from '../output/WelcomeProviders.js';
import {NAVIGATION_PROVIDERS} from '../shell/DirectoryService.js';
import {PICKER_PROVIDERS} from '../pickers/Picker.js';
import {HISTORY_PROVIDERS} from '../shell/historyProviders.js';
import {SUGGESTION_PROVIDERS} from '../suggestions/types.js';
import {lifecycleNote, type ProviderDescriptor, type ProviderStatus} from '../providers/providers.js';
import type {CompletionFacts} from '../shell/SemanticService.js';
import {
  adjustSettingsRow, enumRow, settingsRowApplies, settingsRowValue, SETTINGS_ROWS, type SettingsDestination, type SettingsRow,
} from '../ui/SettingsPanel.js';
import {framePanel, renderTabStrip} from '../ui/PanelShell.js';
import {renderTools, type ToolsPanel} from '../tools/ToolsPanel.js';
import {TOOLS} from '../tools/catalog.js';
import {renderControls} from '../ui/controls.js';
import {chooseBackend, currentCursorHost} from '../cursor/backends.js';
import type {CursorPanelState} from '../cursor/CursorPanel.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS, getCurrentGlyphMode} from '../ui/glyphs.js';
import {MOTION_ROWS} from '../motion/motionRows.js';
import {displayWidth, padCells, truncateAnsi} from '../util/text.js';

/**
 * Setup Cat: one rerunnable configuration wizard over one draft. Opening it
 * never resets anything: the draft starts as the saved configuration, every
 * row edits the draft through the same row definitions the Settings panel
 * uses, Esc discards the draft, and Apply persists through the ordinary
 * configuration path. Direct entries (`/setup prompt`, ...) are views into
 * this same model, not separate wizards. Vespyr stays the mascot and native
 * Welcome provider; Setup Cat is only the wizard.
 */

export const NATIVE_FIRST_MESSAGE = 'NMSh is complete out of the box. No external shell tools are required.';
export const NATIVE_FIRST_DETAIL = 'Optional providers and integrations can be added later, and you can switch between Native and external providers anytime from Settings or Setup Cat.';
/** Installs are real side effects; settings are not. Said wherever an install can start. */
export const INSTALL_DRAFT_NOTE = 'Tool installation happens immediately after confirmation. Your NMSh settings remain a draft until Apply.';
/** Prompt step: a neutral recommendation; external providers are first-class choices. */
export const NATIVE_PROMPT_RECOMMENDATION = 'NMSh Native is recommended for the full NMSh prompt experience. You can try it now and switch to Starship or Powerlevel10k anytime.';
export const NATIVE_ONLY_NOTE = 'Native prompt style settings apply only to NMSh Native.';
export {CHROMA_PREVIEW_NOTE, CHROMA_SCOPE_NOTE} from '../appearance/chromaNotes.js';
import {CHROMA_SCOPE_NOTE} from '../appearance/chromaNotes.js';
export const NATIVE_FIRST_SHORT = 'NMSh works fully with its Native providers. External tools are optional alternatives or enhancements. You can change providers anytime.';

/** What happens with optional tools after Apply. Installs are always separate, explicit confirmations. */
export const TOOL_CHOICES = ['keep', 'native', 'recommended', 'enhanced', 'individual'] as const;
export type ToolChoice = typeof TOOL_CHOICES[number];
export const TOOL_CHOICE_LABELS: Record<ToolChoice, string> = {
  keep: 'Keep current setup', native: 'Native only', recommended: 'Recommended tools',
  enhanced: 'Recommended + Enhanced', individual: 'Choose individually',
};

export interface SetupContext {
  /** Detected provider/tool state by executable name; filled asynchronously, never on render. */
  statuses: Readonly<Record<string, ProviderStatus>>;
  completion?: CompletionFacts;
  /**
   * The step's preview from the real renderers (prompt, theme and chrome,
   * syntax, idle visuals, Vespyr...), supplied by the app for the current
   * draft and shown below the pinned controls.
   */
  preview?: readonly string[];
  /** The title as painted by the app (a one-pass light sweep); plain when absent. */
  title?: string;
}

export interface SetupRow {
  row: SettingsRow;
  /** For provider rows: the executable of the selected external provider, if any. */
  provider?: (draft: PromptConfiguration) => string | undefined;
  /** A muted line under the row while it is selected. */
  note?: (draft: PromptConfiguration, context: SetupContext) => string | undefined;
}

export interface SetupSection {
  id: string;
  title: string;
  intro: readonly string[];
  rows: readonly SetupRow[];
  /** Rows that depend on the draft (the Native prompt style's own fields), appended after `rows`. */
  dynamicRows?: (draft: PromptConfiguration) => readonly SetupRow[];
  /** Muted informational lines after the rows. */
  facts?: (draft: PromptConfiguration, context: SetupContext) => string[];
}

/** Direct entry names to the section they open. */
export const SETUP_ENTRIES: Readonly<Record<string, string>> = {
  prompt: 'prompt', appearance: 'appearance', chroma: 'appearance', tools: 'tools', editor: 'editor', syntax: 'editor', transcript: 'transcript', shell: 'shell', ask: 'ask', cursor: 'cursor', motion: 'motion', sessions: 'sessions',
};

const configRow = (id: string): SettingsRow => {
  const row = SETTINGS_ROWS.find(item => item.id === id);
  if (!row) throw new Error(`Setup Cat references unknown setting ${id}`);
  return row;
};

/** Built in · no installation required, or the factual optional/install state of an external provider. */
export function providerNote(descriptor: ProviderDescriptor | undefined, status: ProviderStatus | undefined): string | undefined {
  if (!descriptor) return undefined;
  if (descriptor.kind === 'native') return 'Built in · no installation required';
  if (descriptor.kind === 'none') return 'Off';
  const family = descriptor.family === 'tool' ? 'tool' : `${descriptor.family} provider`;
  const lifecycle = lifecycleNote(descriptor);
  const state = !status ? 'checking…' : status.state === 'installed' ? 'installed'
    : 'not installed · NMSh keeps using Native until it is';
  return [`Optional external ${family}`, state, lifecycle].filter(Boolean).join(' · ');
}

function providerRow<Id extends string>(id: string, label: string, description: string, category: string,
  providers: readonly ProviderDescriptor<Id>[], get: (config: PromptConfiguration) => Id,
  set: (config: PromptConfiguration, value: Id) => PromptConfiguration): SetupRow {
  return {
    row: enumRow({id, label, description, category, values: providers.map(provider => provider.id),
      labels: providers.map(provider => provider.label), get, set}),
    note: (draft, context) => {
      const descriptor = providers.find(provider => provider.id === get(draft));
      const note = providerNote(descriptor, descriptor?.executable ? context.statuses[descriptor.executable] : undefined);
      const installable = descriptor?.executable && context.statuses[descriptor.executable]?.state === 'missing'
        && TOOLS.some(tool => tool.executable === descriptor.executable);
      return installable ? `${note} · I to install` : note;
    },
    provider: draft => providers.find(provider => provider.id === get(draft) && provider.kind === 'external')?.executable,
  };
}

/** Minimal and Breadcrumb draw a text separator; other styles keep their own geometry (custom glyphs live in /prompt). */
const separatorStyle = (config: PromptConfiguration): 'minimal' | 'breadcrumb' | undefined =>
  config.nmsh.style === 'minimal' || config.nmsh.style === 'breadcrumb' ? config.nmsh.style : undefined;
const separatorIds = (config: PromptConfiguration): string[] => {
  const style = separatorStyle(config);
  return style ? (STYLE_PROFILE_OPTIONS[style].separator as readonly string[]).filter(id => id !== 'custom') : [];
};
const SEPARATOR_ROW: SettingsRow = {id: 'setupSeparator', parent: 'promptStyle', when: config => separatorStyle(config) !== undefined,
  label: 'Separator', description: 'Only styles that draw a text separator offer one; custom glyphs are typed in /prompt', category: 'Prompt',
  control: 'enum', options: [], optionsFor: config => separatorIds(config).map(id => separatorLabel(id)),
  index: config => {
    const style = separatorStyle(config);
    return style ? Math.max(0, separatorIds(config).indexOf(config.nmsh.styleProfiles[style].separator)) : 0;
  },
  select: (config, index) => {
    const style = separatorStyle(config);
    if (!style) return config;
    const id = separatorIds(config)[index] ?? separatorIds(config)[0]!;
    return {...config, nmsh: {...config.nmsh, styleProfiles: {...config.nmsh.styleProfiles,
      [style]: {...config.nmsh.styleProfiles[style], separator: id}}}};
  }};

/** Rows that only affect the Native prompt disappear while an external prompt provider is selected. */
const nativeOnly = (row: SettingsRow): SettingsRow => ({...row, when: config => config.provider === 'nmsh' && (row.when?.(config) ?? true)});

const PROMPT_PROVIDER_ROW = providerRow<PromptProviderId>('setupPromptProvider', 'Prompt provider', 'Native prompt, or your existing Starship / Powerlevel10k', 'Prompt',
  PROMPT_PROVIDERS, config => config.provider, (config, provider) => ({...config, provider}));

/**
 * An editor Setup does not embed: Enter applies this Setup (so nothing is
 * lost), then opens the real editor. The row says so; it is a route, never a
 * second configuration path.
 */
function routeRow(id: string, label: string, description: string, destination: SettingsDestination, category: string): SetupRow {
  return {row: {id, label, description, category, control: 'action', actionLabel: 'Open ›', destination},
    note: () => 'Enter applies this Setup first, then opens it; it keeps the choices you made here'};
}

const PROMPT_FIELDS_EXCLUDED = new Set(['themeFamily', 'themeVariant', 'themeAccent', 'themeStudio', 'style', 'vibrance', 'promptSymbol', 'promptSymbolCustom', 'modules']);

/**
 * A /prompt appearance row (it edits a configuration through `change`) as a
 * Setup row, so the Native prompt style's own fields (edges, connector, gap,
 * padding, fills, text colors, icons...) are edited by the very same logic,
 * on the Setup draft. Options are found by cycling a copy, never by a second table.
 */
function adaptAppearanceRow(row: AppearanceRow): SettingsRow | undefined {
  const change = row.change;
  if (!change || row.edit || row.opens) return undefined;
  const cycleOf = (config: PromptConfiguration): string[] => {
    const probe = structuredClone(config);
    const first = row.value(probe);
    const seen = [first];
    for (let step = 0; step < 24; step += 1) {
      change(probe, 1);
      const value = row.value(probe);
      if (value === first) break;
      seen.push(value);
    }
    return seen;
  };
  return {id: `prompt:${row.id}`, label: row.label.trim(), description: row.note ? 'The Native prompt style\'s own setting; the same field /prompt edits' : 'The Native prompt style\'s own setting; the same field /prompt edits',
    category: 'Prompt', control: 'enum', options: [], optionsFor: cycleOf, index: () => 0,
    select: (config, index) => {
      const next = structuredClone(config);
      for (let step = 0; step < index; step += 1) change(next, 1);
      return next;
    }};
}

const promptStyleRows = (draft: PromptConfiguration): SetupRow[] => draft.provider !== 'nmsh' ? [] : appearanceRows(draft)
  .filter(row => !PROMPT_FIELDS_EXCLUDED.has(row.id) && !row.id.endsWith('.separator'))
  .flatMap(row => { const adapted = adaptAppearanceRow(row); return adapted ? [{row: adapted, note: () => row.note?.(draft)}] : []; });

/** Every Setup Cat row id, so callers (and tests) can find any row in the one model. */
export const SETUP_SECTIONS: readonly SetupSection[] = [
  {id: 'welcome', title: 'Start', intro: [
    'Setup Cat walks through NMSh settings with you; Vespyr, the NMSh cat, says hello.',
    NATIVE_FIRST_MESSAGE,
    NATIVE_FIRST_DETAIL,
    'Your current choices are already selected. Nothing changes until you apply on the last step.',
  ], rows: []},
  {id: 'terminal', title: 'Terminal', intro: ['Glyphs your terminal font can draw.'], rows: [
    {row: configRow('glyphStyle'), note: draft => draft.glyphStyle === 'nerd' ? 'Needs a Nerd Font in your terminal' : 'Works with any terminal font'},
  ]},
  // The same cursor rows as Settings; rich editing (the color picker, trail and particle colors, physics) is /cursor, opened over this draft.
  {id: 'cursor', title: 'Cursor', intro: ['The text caret and its optional effects, Off by default. Portable effects are built in; Ghostty and Kitty can add a GPU version via /cursor.'], rows: [
    {row: configRow('cursorShape'), note: draft => draft.cursor.shape === 'host' ? 'Host default: your terminal keeps its own cursor' : 'Applied while NMSh owns the composer; full-screen programs get your normal cursor'},
    {row: configRow('cursorBlink')},
    {row: configRow('cursorRenderer'), note: draft => chooseBackend(draft.cursor, currentCursorHost()).reason},
    {row: configRow('cursorMotion')},
    {row: configRow('cursorEffect')},
    {row: configRow('cursorIdle')},
    {row: configRow('cursorColor'), note: draft => draft.cursor.color.source === 'host' ? 'Host: your terminal draws the caret in its own color' : undefined},
    {row: configRow('cursorColorFamily')},
    {row: configRow('cursorColorVariant')},
    {row: configRow('cursorColorAccent')},
    {row: configRow('cursorColorCustom')},
    // Speed, intensity, trail length and particle amount, trail/particle colors and the physics live in /cursor, opened over this draft.
    {row: configRow('cursorAdvanced'), note: () => 'Speed, intensity, trail and particles, trail/particle colors and physics; changes stay in this Setup draft until Apply'},
  ], facts: draft => [`Renderer in use: ${chooseBackend(draft.cursor, currentCursorHost()).reason}`]},
  {id: 'prompt', title: 'Prompt', intro: [NATIVE_PROMPT_RECOMMENDATION, 'Deep prompt customization lives in /prompt.'], rows: [
    {...PROMPT_PROVIDER_ROW, note: (draft, context) => draft.provider === 'nmsh' ? 'Built in · no installation required'
      : `${PROMPT_PROVIDER_ROW.note!(draft, context)} · ${NATIVE_ONLY_NOTE}`},
    {row: nativeOnly(configRow('promptStyle'))},
    {row: nativeOnly(SEPARATOR_ROW)},
    {row: configRow('promptSymbol')},
    routeRow('setupPromptModules', 'Prompt modules & custom glyphs', 'Which modules show and in what order, and your own separator or prompt glyph, in /prompt', 'prompt', 'Prompt'),
  ], dynamicRows: draft => promptStyleRows(draft)},
  {id: 'appearance', title: 'Appearance', intro: [
    'Theme: the base NMSh prompt/UI palette · Theme text: whether it colors NMSh text · UI chrome: frames, tabs, selection, separators, accents.',
    'Chroma: an optional treatment over the Native prompt/effects and opted-in surfaces; Full Chroma may override the prompt\'s theme colors. Your terminal and editor keep their own colors.',
  ], rows: [
    {row: configRow('themeFamily'), note: () => '/theme makes your own'},
    {row: configRow('themeVariant')},
    {row: configRow('themeAccent')},
    {row: configRow('themeText')},
    {row: configRow('lavenderText')},
    {row: configRow('lavenderSurface')},
    {row: configRow('promptVibrance')},
    {row: configRow('uiChrome')},
    {row: configRow('uiChromePreset')},
    {row: configRow('treatmentPreset'), note: () => `${CHROMA_SCOPE_NOTE} /chroma has every option`},
    {row: configRow('treatmentIntensity')},
    {row: configRow('treatmentSemantic')},
    {row: configRow('treatmentScope')},
    {row: configRow('chromaRules')},
    {row: configRow('treatmentGeometry')},
    {row: configRow('treatmentMotion')},
    {row: configRow('treatmentSpeed')},
    {row: configRow('treatmentCurve')},
    {row: configRow('reducedMotion')},
    {row: configRow('effectsOff')},
    {row: configRow('shimmer')},
    {row: configRow('autoEffects')},
    routeRow('setupChromeColors', 'Edit UI chrome colors', 'Accent, text, separator, selection and status roles with the color picker', 'chromeColors', 'Appearance'),
    routeRow('setupThemeStudio', 'Theme Studio (custom themes)', 'Clone, edit, import and export your own theme', 'themeStudio', 'Appearance'),
    routeRow('setupHostWindow', 'Terminal window (opacity, blur)', 'Host window opacity and blur where your terminal supports it', 'appearance', 'Appearance'),
  ]},
  // General NMSh motion: the same rows /appearance → Motion edits, with the same real previews.
  {id: 'motion', title: 'Motion', intro: ['Short, finite presentations of real events. Each can be Off; Reduced Motion, Decorative Effects Off and NO_COLOR stop all of them.',
    'The preview below runs the selected one on sample content, once; it never touches your session.'], rows: MOTION_ROWS.map(item => ({row: configRow(`motion_${item.key}`)}))},
  {id: 'editor', title: 'Editor', intro: ['The composer, syntax colors and suggestions.'], rows: [
    {row: configRow('composerPosition')},
    {row: configRow('composerDividers')},
    {row: configRow('pastePreview')},
    {row: configRow('syntaxHighlighting')},
    {row: configRow('syntaxColors'), note: draft => draft.syntax.colors === 'followPrompt' ? 'Follows the Native prompt theme, even with Starship or Powerlevel10k' : draft.syntax.colors === 'grayscale' ? 'Brightness and weight only; no hue' : undefined},
    {row: configRow('syntaxThemeFamily')},
    {row: configRow('syntaxThemeVariant')},
    {row: configRow('syntaxThemeAccent')},
    providerRow('setupSuggestions', 'Suggestions', 'Ghost-text prediction', 'Suggestions', SUGGESTION_PROVIDERS,
      config => config.suggestions, (config, suggestions) => ({...config, suggestions})),
    {row: configRow('suggestionsOnEmpty')},
    routeRow('setupKeyboard', 'Keyboard bindings', 'Terminal key bindings, in /keyboard', 'keyboard', 'Keyboard'),
  ], facts: (_draft, context) => completionFacts(context.completion)},
  // The same transcript rows as Settings and /transcript; one draft, one save path.
  {id: 'transcript', title: 'Transcript', intro: ['How past commands look. Stored history is never changed; this is presentation only.'], rows: [
    {row: configRow('transcriptPresentation')},
    {row: configRow('historicalPrompt')},
    {row: configRow('historyColors')},
    {row: configRow('historyTheme')},
    {row: configRow('divider')},
    {row: configRow('dividerDensity')},
    {row: configRow('dividerColors'), note: () => 'Live composer dividers follow Appearance → Divider lines; past dividers never move'},
    {row: configRow('outputFolding')},
  ]},
  {id: 'history', title: 'History & navigation', intro: ['NMSh Native covers history, directory jumps and picking.', 'External providers are optional alternatives.'], rows: [
    providerRow('setupHistory', 'History', 'Command history source', 'History', HISTORY_PROVIDERS,
      config => config.history, (config, history) => ({...config, history})),
    {...providerRow('setupNavigation', 'Navigation', 'Directory navigation ranking', 'History', NAVIGATION_PROVIDERS,
      config => config.navigation, (config, navigation) => ({...config, navigation})),
    // zoxide provides its own `z` command; NMSh never defines one.
    note: (draft, context) => draft.navigation === 'zoxide'
      ? `${providerNote(NAVIGATION_PROVIDERS[1], context.statuses.zoxide)} · zoxide itself provides \`z\``
      : 'Built in · no installation required · use /dirs; NMSh does not define `z`'},
    providerRow('setupPicker', 'Picker', 'Interactive picker', 'History', PICKER_PROVIDERS,
      config => config.picker, (config, picker) => ({...config, picker})),
  ]},
  // The same shell rows as Settings: one configuration, one save path.
  {id: 'shell', title: 'Shell', intro: ['NMSh runs over a real shell; its composer, transcript and settings stay the same on each.'], rows: [
    {row: configRow('shellBackend'), note: () => 'Default shell: the real shell NMSh starts underneath new sessions. /shell switches this one.'},
    {row: configRow('showShell'), note: () => 'Show current shell: the active backend always, only when it differs from the default, or never.'},
  ]},
  // Sessions, notices, notifications and update checks: the same rows as Settings.
  {id: 'sessions', title: 'Sessions & alerts', intro: ['How live sessions restart, what other sessions tell you, and when NMSh checks for updates.',
    'Session notices are short events about another session (a finished command, a failure, a request for attention); /sessions keeps the state.'], rows: [
    {row: configRow('liveSessionStartup')},
    {row: configRow('liveSessionMultiple')},
    {row: configRow('sessionNotices'), note: draft => draft.sessionNotices ? 'Brief: a success fades in seconds, a failure lingers a little, a request for attention stays until you look' : 'Off: other sessions never add lines above the composer'},
    {row: configRow('agentActivity')},
    {row: configRow('openWith')},
    {row: configRow('notifications')},
    {row: configRow('notifyAfter')},
    {row: configRow('notifyOnSuccess')},
    {row: configRow('notifyOnFailure')},
    {row: configRow('notifyWhenFocused')},
    {row: configRow('updateChecks')},
  ]},
  // The same rows as Settings; nothing here implies NMSh needs a model.
  {id: 'ask', title: 'Ask & local understanding', intro: ['/ask: ask NMSh what it can do in plain English. Ask works without a language model,',
    'and so does NMSh\'s normal Smart Folding. Local understanding defaults to Auto: built-in understanding answers first, and a local model is only consulted when it is unsure and one is set up.'], rows: [
    {row: configRow('askPresentation')},
    {row: configRow('askRecord'), note: draft => draft.askRecord ? 'Keep Ask conversations in transcripts' : 'Ask conversations are not saved; approved commands still are'},
    {row: configRow('localUnderstanding'), note: draft => localUnderstandingNote(draft)},
    {row: configRow('localUnderstandingAsk'), note: () => 'Improve Ask understanding'},
    {row: configRow('localUnderstandingFolding'), note: () => 'Improve Smart Folding'},
  ]},
  {id: 'welcomeScreen', title: 'Welcome', intro: ['What a new session shows first. Vespyr is the NMSh cat.'], rows: [
    providerRow('setupWelcome', 'Welcome', 'New-session welcome', 'Welcome', WELCOME_PROVIDERS.filter(provider => WELCOME_PROVIDER_IDS.includes(provider.id)),
      config => config.welcome, (config, welcome) => ({...config, welcome})),
    {row: configRow('statusStrip'), note: draft => draft.statusStrip.enabled ? 'Minimal: clock, plus battery only when this machine has one' : 'Off: no extra row'},
    {row: configRow('stripClock')},
    {row: configRow('stripBattery')},
    {row: configRow('stripCpu')},
    {row: configRow('stripRam')},
    {row: configRow('stripRamDisplay')},
    {row: configRow('stripUptime')},
  ]},
  {id: 'idle', title: 'Idle & activity', intro: ['An optional screensaver inside NMSh, only while it owns the terminal and nothing is running.',
    'Off by default (Never). Any key, mouse or new output ends it and leaves everything exactly as it was.'], rows: [
    {row: configRow('idleTimeout')},
    {row: configRow('idleMode')},
    {row: configRow('idleColor')},
    routeRow('setupIdleColors', 'Edit idle colors', 'The idle visuals\' own gradient stops, with a live preview', 'idleColors', 'Idle visuals'),
    {row: configRow('activityColors'), note: () => 'The running-command line only; finished commands show their plain result'},
    routeRow('setupActivityColors', 'Edit live activity colors', 'Gradient stops for the live activity line', 'activityColors', 'Live activity'),
  ]},
  {id: 'tools', title: 'Optional tools', intro: [NATIVE_FIRST_SHORT, INSTALL_DRAFT_NOTE], rows: [
    {row: configRow('toolUpdateChecks'), note: draft => draft.toolUpdateChecks === 'off' ? 'Off: NMSh never checks unless you ask in /tools' : 'Checks run in the background at startup, never while typing'},
    {row: configRow('installSuggestions')},
    {row: configRow('resetInstallSuggestions'), note: () => 'Resets in this draft; nothing changes until Apply'},
    routeRow('setupToolConfig', 'Tool configuration', 'Review supported Starship module changes', 'toolConfig', 'Tools'),
  ], facts: (_draft, context) => completionFacts(context.completion)},
  {id: 'review', title: 'Review & Apply', intro: [], rows: []},
];

/** Factual Local understanding copy per mode; nothing here implies a model is installed or downloads on its own. */
function localUnderstandingNote(draft: PromptConfiguration): string {
  const {mode, model} = draft.localUnderstanding;
  if (mode === 'off') return 'Off: no local model is ever consulted, loaded or run';
  const setup = model ? `Model: ${model.label}` : 'No model is set up: built-in Ask works and Auto simply stays built-in; /llm can set one up, and nothing downloads without your Yes';
  return mode === 'auto' ? `Auto: built-in understanding first, a local model only when it is unsure. ${setup}`
    : `Always: a local model is consulted first when one is set up. ${setup}`;
}

/**
 * Settings rows that Setup edits through a differently named row (its provider
 * choices) or reaches through a labelled route. Anything else in SETTINGS_ROWS
 * must appear in a Setup section under its own id: a test enforces it, so a new
 * customization cannot silently become undiscoverable from Setup.
 */
export const SETUP_EQUIVALENTS: Readonly<Record<string, string>> = {
  provider: 'setupPromptProvider', welcome: 'setupWelcome', suggestions: 'setupSuggestions', history: 'setupHistory', navigation: 'setupNavigation', picker: 'setupPicker',
  cursorSpeed: 'cursorAdvanced', cursorIntensity: 'cursorAdvanced', cursorTrail: 'cursorAdvanced', cursorParticles: 'cursorAdvanced',
  tools: 'setupToolChoice', uiChromeColors: 'setupChromeColors', idleCustomColors: 'setupIdleColors', activityCustomColors: 'setupActivityColors',
};

/** Where each Settings entry point (a full panel) is reached from Setup: a section, or the route row that opens it. */
export const SETUP_ENTRY_COVERAGE: Readonly<Record<string, string>> = {
  appearance: 'setupHostWindow', glyph: 'glyphStyle', prompt: 'setupPromptModules', transcript: 'transcriptPresentation', syntax: 'syntaxHighlighting', keyboard: 'setupKeyboard',
  welcome: 'setupWelcome', suggestions: 'setupSuggestions', history: 'setupHistory', picker: 'setupPicker', navigation: 'setupNavigation', layout: 'composerPosition', toolConfig: 'setupToolConfig', tools: 'setupBrowseTools', screensaver: 'idleTimeout', setup: 'setupToolChoice',
  cursor: 'cursorAdvanced', themeStudio: 'setupThemeStudio', chromeColors: 'setupChromeColors', idleColors: 'setupIdleColors', activityColors: 'setupActivityColors', resetInstallSuggestions: 'resetInstallSuggestions',
};

function completionFacts(facts: CompletionFacts | undefined): string[] {
  if (!facts) return ['Configured zsh completion      Checking…'];
  const line = (label: string, value: string) => `${padCells(label, 29)}${value}`;
  return [
    line('Configured zsh completion', facts.completionSystem ? 'Detected' : 'Not detected · NMSh Native completion still works'),
    line('zsh-completions', facts.zshCompletions ? 'Detected · used as completion knowledge' : 'Not detected'),
    ...(facts.fzfTab ? [line('fzf-tab', 'Detected · NMSh keeps its own completion UI')] : []),
  ];
}

export interface SetupState {
  section: number;
  row: number;
  draft: PromptConfiguration;
  /** The configuration as saved when Setup Cat opened; Esc returns to exactly this. */
  saved: PromptConfiguration;
  tools: ToolChoice;
  /** Esc with unapplied edits asks first. */
  confirmDiscard?: boolean;
  /**
   * The optional-tool browser opened inside Setup Cat (the same /tools panel
   * and installer). The draft and section are untouched while it is open.
   */
  toolBrowser?: ToolsPanel;
  /**
   * The /cursor panel opened inside Setup Cat over the draft's cursor settings
   * (advanced tuning, the custom color picker). It applies to the draft only;
   * Esc returns here, and nothing is saved until Apply.
   */
  cursorPanel?: CursorPanelState;
  /** The cursor preview restarts when the selected row or the draft's cursor settings change. */
  previewKey?: string;
  previewStart?: number;
  /**
   * Enter on an option row lists every choice under it: ↑↓ preview each one
   * live in the draft, Enter keeps it, Esc restores the value it had.
   */
  chooser?: {rowId: string; index: number; before: PromptConfiguration};
  context: SetupContext;
}

export function sectionIndex(id: string): number {
  return Math.max(0, SETUP_SECTIONS.findIndex(section => section.id === id));
}

/** Opens Setup Cat over a copy of the current configuration; an entry name jumps to its section. */
export function createSetup(configuration: PromptConfiguration, entry?: string): SetupState {
  const target = entry ? SETUP_ENTRIES[entry] : undefined;
  const section = target ? sectionIndex(target) : 0;
  const rows = SETUP_SECTIONS[section]!.rows;
  const row = entry === 'chroma' ? Math.max(0, rows.findIndex(item => item.row.id === 'treatmentPreset')) : 0;
  return {section, row, draft: structuredClone(configuration), saved: structuredClone(configuration), tools: 'keep', context: {statuses: {}}};
}

export function parseSetupEntry(argument: string | undefined): string | undefined | false {
  if (!argument) return undefined;
  return SETUP_ENTRIES[argument] ? argument : false;
}

function rowValue(row: SettingsRow, config: PromptConfiguration): string {
  const value = settingsRowValue(row, config) ?? '';
  return row.control === 'boolean' ? (value === 'true' ? 'On' : 'Off') : value;
}

/** Changes between the saved configuration and the draft, by Setup Cat row, for the review step. */
export function setupChanges(state: SetupState): Array<{label: string; from: string; to: string}> {
  const changes: Array<{label: string; from: string; to: string}> = [];
  const seen = new Set<string>();
  for (const section of SETUP_SECTIONS) {
    for (const {row} of [...sectionRows(section, state.draft), ...sectionRows(section, state.saved)]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const from = rowValue(row, state.saved);
      const to = rowValue(row, state.draft);
      if (from !== to) changes.push({label: row.label, from, to});
    }
  }
  if (state.tools !== 'keep') changes.push({label: 'Optional tools', from: TOOL_CHOICE_LABELS.keep, to: TOOL_CHOICE_LABELS[state.tools]});
  // Edits made inside an embedded editor (advanced cursor tuning) that no row summarizes are still unapplied changes.
  if (!changes.some(change => change.label.startsWith('Cursor')) && JSON.stringify(state.draft.cursor) !== JSON.stringify(state.saved.cursor)) {
    changes.push({label: 'Advanced cursor tuning', from: 'saved', to: 'edited'});
  }
  return changes;
}

/** Native only puts every provider family back on Native in the draft (visible in review); it removes nothing. */
function applyToolChoice(draft: PromptConfiguration, choice: ToolChoice): PromptConfiguration {
  if (choice !== 'native') return draft;
  return {...draft, provider: 'nmsh', suggestions: 'nmsh', history: 'native', navigation: 'native', picker: 'native',
    welcome: draft.welcome === 'none' ? 'none' : 'vespyr'};
}

export type SetupResult =
  | {kind: 'cancel'}
  /** Open the shared tool browser inside Setup Cat, optionally on one tool. */
  | {kind: 'browseTools'; toolId?: string}
  /** Open the shared /cursor panel inside Setup Cat, over the draft. */
  | {kind: 'cursorEditor'; advanced: boolean; row?: string}
  /** `then`: an editor to open after Apply (a route row). */
  | {kind: 'apply'; configuration: PromptConfiguration; tools: ToolChoice; changed: boolean; then?: SettingsDestination};

/** Rows that apply to the draft (a child row disappears when its parent makes it meaningless). */
function sectionRows(section: SetupSection, draft: PromptConfiguration): readonly SetupRow[] {
  return [...section.rows, ...(section.dynamicRows?.(draft) ?? [])];
}

function currentRows(state: SetupState): readonly SetupRow[] {
  const rows = sectionRows(SETUP_SECTIONS[state.section]!, state.draft).filter(item => setupRowApplies(item.row, state.draft));
  return state.section === sectionIndex('tools') ? [...rows, TOOL_CHOICE_ROW, BROWSE_ROW] : rows;
}

/** The selected row of the current step (undefined on steps without rows). */
export function setupSelectedRow(state: SetupState): SetupRow | undefined {
  return currentRows(state)[state.row];
}

function setupRowApplies(row: SettingsRow, config: PromptConfiguration): boolean {
  if (row.when && !row.when(config)) return false;
  return SETTINGS_ROWS.some(item => item.id === row.id) ? settingsRowApplies(row, config) : true;
}

/** Rows that open an editor instead of changing a value (they are routes, or run on the draft). */
export const isRouteRow = (row: SettingsRow): boolean => row.control === 'action' && row.destination !== 'tools' && row.destination !== 'cursor' && !row.run;

/** Opens the shared tool browser in place; Enter on it never leaves the step. */
const BROWSE_ROW: SetupRow = {row: {id: 'setupBrowseTools', label: 'Browse optional tools',
  description: 'See what each tool does, whether it is installed, and install it with a previewed, confirmed command',
  category: 'Tools', control: 'action', actionLabel: 'Open ›', destination: 'tools'}};

/** The tools tier choice is a Setup Cat action, not a stored setting; it rides on the same row model. */
const TOOL_CHOICE_ROW: SetupRow = {
  row: {id: 'setupToolChoice', label: 'Optional tools', description: 'What to do about optional tools after Apply', category: 'Tools',
    control: 'enum', options: TOOL_CHOICES.map(choice => TOOL_CHOICE_LABELS[choice]), index: () => 0, select: config => config},
  note: () => undefined,
};

function toolChoiceNote(choice: ToolChoice): string {
  switch (choice) {
    case 'keep': return 'Installed tools and providers stay as they are';
    case 'native': return 'Every provider uses NMSh Native; nothing is uninstalled';
    case 'recommended': return 'Opens /tools on ripgrep, fd, fzf, zoxide and jq; each install asks first';
    case 'enhanced': return 'Also lists Enhanced CLI tools (bat, eza, delta, gh, …); not better for everyone';
    case 'individual': return 'Opens /tools on the full catalog; each install asks first';
  }
}

/**
 * ↑↓ rows · ←→ change · Tab / Shift+Tab sections · Enter next (Apply on
 * the last step) · Esc cancel (asks when there are unapplied edits).
 */
export function setupKey(state: SetupState, key: Key): SetupResult | undefined {
  const changes = () => setupChanges(state).length > 0;
  if (state.chooser) { chooserKey(state, state.chooser, key); return undefined; }
  if (state.confirmDiscard) {
    if (key.kind === 'enter' || (key.kind === 'text' && key.value.toLowerCase() === 'y')) return {kind: 'cancel'};
    if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value.toLowerCase() === 'n')) state.confirmDiscard = false;
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    if (changes()) { state.confirmDiscard = true; return undefined; }
    return {kind: 'cancel'};
  }
  const last = SETUP_SECTIONS.length - 1;
  const rows = currentRows(state);
  const go = (section: number) => { state.section = Math.max(0, Math.min(last, section)); state.row = 0; };
  if (key.kind === 'complete') go(state.section === last ? 0 : state.section + 1);
  else if (key.kind === 'focusPrevious') go(state.section === 0 ? last : state.section - 1);
  else if (key.kind === 'up') state.row = Math.max(0, state.row - 1);
  else if (key.kind === 'down') state.row = Math.min(Math.max(0, rows.length - 1), state.row + 1);
  else if ((key.kind === 'left' || key.kind === 'right' || (key.kind === 'text' && key.value === ' ')) && rows[state.row]) {
    const delta = key.kind === 'left' ? -1 : 1;
    const {row} = rows[state.row]!;
    if (row.id === TOOL_CHOICE_ROW.row.id) {
      state.tools = TOOL_CHOICES[(TOOL_CHOICES.indexOf(state.tools) + delta + TOOL_CHOICES.length) % TOOL_CHOICES.length]!;
      state.draft = applyToolChoice(state.draft, state.tools);
    } else {
      const next = adjustSettingsRow(row, state.draft, delta);
      if (next) state.draft = next;
    }
  } else if (key.kind === 'enter' && rows[state.row]?.row.control === 'action') {
    const row = rows[state.row]!.row;
    if (row.control === 'action' && row.destination === 'cursor') return {kind: 'cursorEditor', advanced: false, row: row.id === 'cursorAdvanced' ? 'speed' : 'colorCustom'};
    // An in-draft action (reset a list), or a route: apply this Setup, then open the real editor.
    if (row.control === 'action' && row.run) { state.draft = row.run(state.draft); return undefined; }
    if (row.control === 'action' && row.destination !== 'tools') return {kind: 'apply', configuration: normalizePromptConfiguration(state.draft), tools: state.tools, changed: changes(), then: row.destination};
    return {kind: 'browseTools'};
  } else if (key.kind === 'enter' && rows[state.row] && rows[state.row]!.row.id !== TOOL_CHOICE_ROW.row.id && !rows[state.row]!.row.unavailable?.(state.draft) && chooserOptions(rows[state.row]!.row, state.draft).length) {
    const {row} = rows[state.row]!;
    state.chooser = {rowId: row.id, index: row.control === 'enum' ? row.index(state.draft) : 0, before: state.draft};
  } else if (key.kind === 'text' && key.value.toLowerCase() === 'r' && ['cursor', 'motion'].includes(SETUP_SECTIONS[state.section]!.id)) {
    // Replay: the preview restarts from its first frame.
    state.previewKey = undefined;
  } else if (key.kind === 'text' && key.value.toLowerCase() === 'i' && rows[state.row]) {
    const tool = installableTool(rows[state.row]!, state);
    if (tool) return {kind: 'browseTools', toolId: tool};
  } else if (key.kind === 'enter') {
    if (state.section < last) go(state.section + 1);
    else {
      const configuration = normalizePromptConfiguration(state.draft);
      return {kind: 'apply', configuration, tools: state.tools, changed: changes()};
    }
  }
  return undefined;
}

/** The visible choices of an option row (enum rows only; booleans and actions have none to browse). */
export function chooserOptions(row: SettingsRow, config: PromptConfiguration): readonly string[] {
  return row.control === 'enum' ? row.optionsFor?.(config) ?? row.options : [];
}

function chooserKey(state: SetupState, chooser: NonNullable<SetupState['chooser']>, key: Key): void {
  const row = currentRows(state).find(item => item.row.id === chooser.rowId)?.row;
  const options = row ? chooserOptions(row, chooser.before) : [];
  if (!row || row.control !== 'enum' || !options.length || key.kind === 'escape' || key.kind === 'interrupt') {
    state.draft = chooser.before;
    state.chooser = undefined;
    return;
  }
  if (key.kind === 'enter' || key.kind === 'complete' || key.kind === 'focusPrevious') { state.chooser = undefined; return; }
  if (key.kind === 'up' || key.kind === 'down' || key.kind === 'left' || key.kind === 'right') {
    const delta = key.kind === 'up' || key.kind === 'left' ? -1 : 1;
    chooser.index = (chooser.index + delta + options.length) % options.length;
    // Preview the highlighted choice live; Esc puts the earlier value back.
    state.draft = row.select(chooser.before, chooser.index);
  }
}

/**
 * The catalog tool behind a selected external provider that is not installed
 * yet; `I` opens it in the shared tool browser (install still needs its own
 * preview and confirmation).
 */
export function installableTool(item: SetupRow, state: SetupState): string | undefined {
  const executable = item.provider?.(state.draft);
  if (!executable || state.context.statuses[executable]?.state !== 'missing') return undefined;
  return TOOLS.find(tool => tool.executable === executable)?.id;
}

/** The smallest size where Setup Cat shows its essential controls. */
export const SETUP_MIN_SIZE = {columns: 44, rows: 12} as const;

export function renderSetup(state: SetupState, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const success = foreground(UI_COLORS.success);
  const bold = '\u001B[1m';
  const reset = '\u001B[0m';
  const section = SETUP_SECTIONS[state.section]!;
  const nerd = getCurrentGlyphMode() === 'nerd';
  const title = `  ${bold}${state.context.title ?? `${primary}Setup Cat`}${reset}  ${subtle}${nerd ? '·' : '-'} ${state.section + 1}/${SETUP_SECTIONS.length} ${section.title}${reset}`;
  const head = [title, renderTabStrip(SETUP_SECTIONS.map(item => item.title), state.section, columns)];
  if (state.toolBrowser) {
    // The shared /tools browser, inside Setup Cat: the draft and step are kept underneath.
    const note = wrapWords(`${INSTALL_DRAFT_NOTE} Esc returns to Setup Cat.`, Math.max(10, columns - 4)).map(line => `  ${subtle}${line}${reset}`);
    const tools = renderTools(state.toolBrowser, columns, Math.max(4, height - head.length - note.length - 1));
    return [...framePanel([...head, ...note].map(row => truncateAnsi(row, columns)), columns), ...tools].slice(0, Math.max(1, height));
  }

  // Stable top area: intro, controls and the selected control's help.
  const top: string[] = [''];
  for (const line of section.intro) {
    for (const part of wrapWords(line, Math.max(10, columns - 4))) top.push(`  ${line === NATIVE_FIRST_MESSAGE ? primary : subtle}${part}${reset}`);
  }
  if (section.intro.length) top.push('');
  if (section.id === 'review') {
    const changes = setupChanges(state);
    if (!changes.length) top.push(`  ${secondary}No changes. Enter closes Setup Cat and keeps everything as it is.${reset}`);
    else {
      top.push(`  ${primary}Apply these changes?${reset}`, '');
      const labelWidth = Math.min(28, Math.max(...changes.map(change => displayWidth(change.label))) + 2);
      for (const change of changes) {
        top.push(`  ${secondary}${padCells(change.label, labelWidth - 2)}${subtle}${change.from} ${nerd ? '→' : '->'} ${reset}${success}${change.to}${reset}`);
      }
    }
  } else {
    const rows = currentRows(state);
    const indent = (row: SettingsRow) => row.parent ? '  ' : '';
    const labelWidth = Math.min(30, Math.max(0, ...rows.map(item => displayWidth(indent(item.row) + item.row.label))) + 3);
    rows.forEach((item, index) => {
      const selected = index === state.row;
      const value = item.row.id === TOOL_CHOICE_ROW.row.id ? TOOL_CHOICE_LABELS[state.tools] : rowValue(item.row, state.draft);
      const changed = item.row.id !== TOOL_CHOICE_ROW.row.id && item.row.control !== 'action' && rowValue(item.row, state.saved) !== value;
      const pointer = selected ? `${accent}${GLYPHS.selection}${reset}` : ' ';
      const unavailable = item.row.unavailable?.(state.draft);
      // An unavailable row has nothing to cycle: no arrows, and the reason is shown instead of the description.
      const control = item.row.control === 'action' ? `${selected ? accent : secondary}${value}${reset}`
        : unavailable ? `${subtle}${value}${reset}`
        : selected ? `${accent}${nerd ? '‹' : '<'} ${value} ${nerd ? '›' : '>'}${reset}` : `${secondary}${value}${reset}`;
      top.push(`  ${pointer} ${selected ? `${bold}${primary}` : primary}${padCells(indent(item.row) + item.row.label, labelWidth - 2)}${reset}${control}${changed ? ` ${subtle}${nerd ? '•' : '*'}${reset}` : ''}`);
      if (selected && state.chooser?.rowId === item.row.id) {
        // Every choice, visible: the highlighted one is previewed live below.
        const options = chooserOptions(item.row, state.chooser.before);
        const savedValue = rowValue(item.row, state.saved);
        options.forEach((option, optionIndex) => {
          const current = optionIndex === state.chooser!.index;
          top.push(`  ${' '.repeat(labelWidth + 2)}${current ? `${accent}${nerd ? '●' : '*'} ${bold}${primary}` : `${subtle}${nerd ? '○' : 'o'} ${secondary}`}${option}${reset}${option === savedValue ? ` ${subtle}${nerd ? '✓' : '(saved)'}${reset}` : ''}`);
        });
      }
    });
    const selected = rows[state.row];
    if (selected) {
      const note = selected.row.id === TOOL_CHOICE_ROW.row.id ? toolChoiceNote(state.tools) : selected.note?.(state.draft, state.context);
      const reason = selected.row.unavailable?.(state.draft);
      top.push('', `  ${subtle}${reason ?? selected.row.description}${reset}`);
      if (note && !reason) top.push(`  ${subtle}${note}${reset}`);
    }
  }
  if (state.confirmDiscard) top.push('', `  ${primary}Discard unapplied Setup Cat changes? Your saved settings stay exactly as they are.${reset}`);

  // Bottom area: the live preview starts below the controls and gives way first on short terminals.
  const facts = section.facts?.(state.draft, state.context) ?? [];
  const preview = [...(state.context.preview ?? []), ...facts.map(line => `  ${subtle}${line}${reset}`)];
  const selectedRow = section.id === 'review' ? undefined : currentRows(state)[state.row];
  const browsable = Boolean(selectedRow && selectedRow.row.id !== TOOL_CHOICE_ROW.row.id && !selectedRow.row.unavailable?.(state.draft) && chooserOptions(selectedRow.row, state.draft).length);
  const footer = state.confirmDiscard
    ? renderControls([['Enter', 'discard changes'], ['Esc', 'keep editing']])
    : state.chooser
      ? renderControls([['↑↓', 'preview choice'], ['Enter', 'keep'], ['Esc', 'restore']])
      : renderControls([
        ...(section.rows.length || section.id === 'tools' ? [['↑↓', 'select'] as [string, string], ['←→', 'change'] as [string, string]] : []),
        ...(['cursor', 'motion'].includes(section.id) ? [['R', 'replay preview'] as [string, string]] : []),
        ['Tab', 'next'], ['Shift+Tab', 'previous section'],
        ['Enter', browsable ? 'choices' : selectedRow && isRouteRow(selectedRow.row) ? 'apply & open' : selectedRow?.row.control === 'action' ? 'open'
          : state.section === SETUP_SECTIONS.length - 1 ? (setupChanges(state).length ? 'apply' : 'close') : 'next'],
        ['Esc', 'cancel']]);
  // Frame line, head, footer and its blank line are fixed; controls come next; the preview gets what is left.
  const budget = Math.max(1, height - 1 - head.length - 2);
  const controls = top.slice(0, budget);
  const room = budget - controls.length - 1;
  const shown = room >= 2 && preview.length ? ['', `  ${subtle}${nerd ? '─' : '-'} Preview${reset}`, ...preview].slice(0, room + 1) : [];
  return framePanel([...head, ...controls, ...shown, '', footer].map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
}

/** Plain word wrap for prose rows; long words are left for truncation. */
export function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u)) {
    if (line && displayWidth(line) + 1 + displayWidth(word) > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** True when no saved value would change: applying is then a no-op. */
export function setupIsIdempotent(state: SetupState): boolean {
  return JSON.stringify(normalizePromptConfiguration(state.draft)) === JSON.stringify(normalizePromptConfiguration(state.saved));
}

export {DEFAULT_PROMPT_CONFIGURATION};
