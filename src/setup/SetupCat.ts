import {TREATMENT_PRESET_LABELS} from '../chroma/treatment.js';
import {isReducedMotion} from '../presentation/environment.js';
import {colorLevel} from '../presentation/capabilities.js';
import type {Key} from '../terminal/keys.js';
import {
  DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, WELCOME_PROVIDER_IDS,
  type OnboardingBackdrop, type PromptConfiguration, type PromptProviderId, type StartingPointId,
} from '../prompt/configuration.js';
import {STARTING_POINTS, startingPointAt, startingPointDraft} from './startup/startingPoints.js';
import {createSelector, cycleStartupTools, highlightChoice, nextBackdrop, resumeSky, startupToolOption, type StartupSelectorState} from './startup/selector.js';
import {createStartupContext, renderStartup, type StartupContext} from './startup/view.js';
import {StartupCanvas} from './startup/canvas.js';
import {guidedFooter, guidedHairline, guidedMargin, guidedRoute, guidedRow, guidedStepHeader, guidedText, guidedValueColumn, type GuidedKey} from './startup/guided.js';
import type {EnvironmentEvidence} from './environment/detect.js';
import {keepExistingPlan} from './environment/keepExisting.js';
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
import {Transitions, transitionPaint, progress} from '../motion/transitions.js';
import {overlayRow} from '../presentation/cellOverlay.js';
import {buildContextLine, themePreviewContext} from '../prompt/prompt.js';
import {vespyrSprite} from '../output/Welcome.js';
import {renderTools, type ToolsPanel} from '../tools/ToolsPanel.js';
import {TOOLS} from '../tools/catalog.js';
import {caretColorNote, chooseBackend, currentCursorHost} from '../cursor/backends.js';
import type {CursorPanelState} from '../cursor/CursorPanel.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
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
import {librarySummary} from '../appearance/themeLibrary.js';
import {BRIDGE_TARGET_LABELS, type BridgeTargetId} from '../themeBridge/model.js';
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
  /** Theme Bridge targets found on this system (local PATH facts), so Setup shows only relevant ones. */
  bridgeTargets?: readonly BridgeTargetId[];
  /** The starting-point selector's sky grid, cached ground, composer preview and Keep Existing sample. */
  startup?: StartupContext;
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
  dynamicRows?: (draft: PromptConfiguration, context?: SetupContext) => readonly SetupRow[];
  /** Muted informational lines after the rows. */
  facts?: (draft: PromptConfiguration, context: SetupContext) => string[];
}

/** Direct entry names to the section they open. */
export const SETUP_ENTRIES: Readonly<Record<string, string>> = {
  quick: 'welcome', manual: 'welcome', prompt: 'prompt', look: 'appearance', appearance: 'appearance', chroma: 'appearance', tools: 'tools', editor: 'editor', syntax: 'editor', transcript: 'transcript', shell: 'shell', ask: 'ask', cursor: 'cursor', motion: 'motion', sessions: 'sessions',
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

const PROMPT_PROVIDER_ROW = providerRow<PromptProviderId>('setupPromptProvider', 'Prompt provider', 'Native prompt, your existing Starship / Powerlevel10k, or None (composer only)', 'Prompt',
  PROMPT_PROVIDERS, config => config.provider, (config, provider) => ({...config, provider}));

/**
 * An editor Setup does not embed: Enter applies this Setup (so nothing is
 * lost), then opens the real editor. The row says so; it is a route, never a
 * second configuration path.
 */
/** Setup's single Theme Bridge question; Yes only reveals the detected tools, each still Independent. */
const THEME_BRIDGE_ROW: SettingsRow = {id: 'setupThemeBridge', label: 'Extend colors to tools?', description: 'Theme Bridge: opt-in colors for fzf, less/man, LS_COLORS, tmux, Neovim and Vim',
  category: 'Appearance', control: 'enum', options: ['No', 'Yes'], index: c => c.themeBridge.enabled ? 1 : 0,
  select: (c, index) => ({...c, themeBridge: {...c.themeBridge, enabled: index === 1}})};

const SETUP_BRIDGE_TARGETS: readonly BridgeTargetId[] = ['fzf', 'pager', 'lsColors', 'tmux', 'neovim', 'vim', 'helix'];

function bridgeTargetRows(draft: PromptConfiguration, context: SetupContext | undefined): SetupRow[] {
  if (!draft.themeBridge.enabled) return [];
  const found = new Set(context?.bridgeTargets ?? []);
  return SETUP_BRIDGE_TARGETS.filter(target => found.has(target)).map(target => ({
    row: {id: `setupBridge:${target}`, parent: 'setupThemeBridge', label: `  ${BRIDGE_TARGET_LABELS[target]}`, description: 'Independent, or follow the active NMSh theme', category: 'Appearance',
      control: 'enum', options: ['Independent', 'Follow NMSh'], index: c => c.themeBridge.targets[target].mode === 'independent' ? 0 : c.themeBridge.targets[target].mode === 'follow' ? 1 : 1,
      select: (c, index) => ({...c, themeBridge: {...c.themeBridge, targets: {...c.themeBridge.targets, [target]: {...c.themeBridge.targets[target], mode: index === 1 ? (c.themeBridge.targets[target].mode === 'choose' ? 'choose' : 'follow') : 'independent'}}}})},
    note: () => target === 'tmux' || target === 'neovim' || target === 'vim' || target === 'helix'
      ? 'NMSh generates its own color file; adding it to your config is a separate, reviewed step in /theme-bridge'
      : target === 'fzf' ? 'Only fzf launched by NMSh; FZF_DEFAULT_OPTS and your rc files are untouched' : 'Applied in NMSh shells at the next prompt; no rc file is edited',
  } satisfies SetupRow));
}

/**
 * Prompt's view of Chroma: read-only, because Chroma is chosen in exactly one place (Look, with the rows that depend on
 * it and a live preview). Enter goes there, on the Chroma row; it never changes the draft.
 */
export const CHROMA_IN_LOOK_ROW: SetupRow = {
  row: {id: 'setupChromaInLook', label: 'Chroma', description: 'Chroma colors the Native prompt; it is chosen in Look, beside the theme it recolors. Enter goes there',
    category: 'Prompt', control: 'action', actionLabel: 'Look ›', destination: 'appearance', run: config => config,
    value: config => `${config.presentation.preset === 'off' ? 'Off' : TREATMENT_PRESET_LABELS[config.presentation.preset]} · change it in Look ›`},
  note: draft => chromaVisibilityNote(draft),
};

function routeRow(id: string, label: string, description: string, destination: SettingsDestination, category: string): SetupRow {
  return {row: {id, label, description, category, control: 'action', actionLabel: 'Open ›', destination},
    note: () => 'Opens it here. Esc comes back to this step; your unapplied choices wait'};
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
  ], rows: [
    routeRow('setupPresets', 'Starting point', 'NMSh Recommended, Minimal Terminal, Customize Everything or Keep Existing · /startup', 'setupQuick', 'General'),
    {row: configRow('panelPosition'), note: draft => draft.panelPosition === 'top' ? 'Panels like this one sit at the top of the screen' : 'Panels like this one sit at the bottom of the screen'},
  ]},
  {id: 'terminal', title: 'Terminal', intro: ['Glyphs your terminal font can draw.'], rows: [
    {row: configRow('glyphStyle'), note: draft => draft.glyphStyle === 'nerd' ? 'Needs a Nerd Font in your terminal' : 'Works with any terminal font'},
  ]},
  // Look: the theme first, then what depends on it (text, chrome), then Chroma, the one place it is chosen, with its
  // own rows under it. Motion-wide switches (Reduced Motion, Decorative effects) are on the Motion step.
  {id: 'appearance', title: 'Look', intro: [
    'Theme: the base NMSh prompt/UI palette · Theme text: whether it colors NMSh text · UI chrome: frames, tabs, selection, separators, accents.',
    'Chroma: an optional treatment over the Native prompt/effects and opted-in surfaces; Full Chroma may override the prompt\'s theme colors. Your terminal and editor keep their own colors.',
  ], rows: [
    {row: configRow('themeFamily'), note: () => 'Built-in, Imported and Custom themes; /theme creates, imports and edits them'},
    {row: configRow('themeVariant')},
    {row: configRow('themeAccent')},
    {row: configRow('themeText')},
    {row: configRow('lavenderText')},
    {row: configRow('lavenderSurface')},
    {row: configRow('promptVibrance')},
    {row: configRow('uiChrome')},
    {row: configRow('uiChromePreset')},
    {row: configRow('treatmentPreset'), note: draft => chromaVisibilityNote(draft)},
    {row: configRow('treatmentIntensity')},
    {row: configRow('treatmentSemantic')},
    {row: configRow('treatmentScope')},
    {row: configRow('chromaRules')},
    {row: configRow('treatmentGeometry')},
    {row: configRow('treatmentMotion')},
    {row: configRow('treatmentSpeed')},
    {row: configRow('treatmentCurve')},
    routeRow('setupChromeColors', 'Edit UI chrome colors', 'Accent, text, separator, selection and status roles with the color picker', 'chromeColors', 'Appearance'),
    {...routeRow('setupThemeStudio', 'Theme Studio', 'Create, edit, import, export and manage Native themes; selection is above', 'themeStudio', 'Appearance'),
      row: {id: 'setupThemeStudio', label: 'Theme Studio', description: 'Create, edit, import, export and manage Native themes; selection is above', category: 'Appearance',
        control: 'action', actionLabel: 'Open ›', destination: 'themeStudio', value: draft => [librarySummary(draft.themes), 'Open ›'].filter(Boolean).join('  ')}},
    {row: THEME_BRIDGE_ROW, note: draft => draft.themeBridge.enabled
      ? 'Only tools found on this system are listed; each starts Independent. Choose theme and includes for tmux/Neovim/Vim are in /theme-bridge'
      : 'No: every tool keeps its own colors; NMSh injects and changes nothing'},
    routeRow('setupHostWindow', 'Terminal window (opacity, blur)', 'Host window opacity and blur where your terminal supports it', 'appearance', 'Appearance'),
  ], dynamicRows: (draft, context) => bridgeTargetRows(draft, context)},
  {id: 'prompt', title: 'Prompt', intro: [NATIVE_PROMPT_RECOMMENDATION, 'Deep prompt customization lives in /prompt.'], rows: [
    {...PROMPT_PROVIDER_ROW, note: (draft, context) => draft.provider === 'nmsh' ? 'Built in · no installation required'
      : draft.provider === 'none' ? 'None · composer only · themes still style NMSh UI, syntax and Theme Bridge' : `${PROMPT_PROVIDER_ROW.note!(draft, context)} · ${NATIVE_ONLY_NOTE}`},
    {row: nativeOnly(configRow('promptStyle'))},
    {row: nativeOnly(SEPARATOR_ROW)},
    {row: configRow('promptSymbol')},
    // Chroma is chosen only in Look; here it is a read-only line that goes there.
    CHROMA_IN_LOOK_ROW,
    routeRow('setupPromptModules', 'Prompt modules & custom glyphs', 'Which modules show and in what order, and your own separator or prompt glyph, in /prompt', 'prompt', 'Prompt'),
  ], dynamicRows: draft => promptStyleRows(draft)},
  // General NMSh motion: Reduced Motion and Decorative effects first (they govern every row after them, and Chroma's
  // motion in Look), then the same rows /appearance → Motion edits, with the same real previews.
  {id: 'motion', title: 'Motion', intro: ['Short, finite presentations of real events. Each can be Off; Reduced Motion, Decorative Effects Off and NO_COLOR stop all of them.',
    'The preview below runs the selected one on sample content, once; it never touches your session.'], rows: [
    {row: configRow('reducedMotion'), note: draft => draft.presentation.reducedMotion ? 'On: everything below, Chroma motion and the cursor effects stay still; colors stay' : undefined},
    {row: configRow('effectsOff')},
    {row: configRow('shimmer')},
    {row: configRow('autoEffects')},
    {row: configRow('motion_rendering')}, ...MOTION_ROWS.map(item => ({row: configRow(`motion_${item.key}`)})), {row: configRow('motion_intensity')}, {row: configRow('motion_speed')}]},
  // The same cursor rows as Settings; rich editing (the color picker, trail and particle colors, physics) is /cursor, opened over this draft.
  {id: 'cursor', title: 'Cursor', intro: ['The text caret and its optional effects, Off by default; Fire starts on the Classic flame. Portable effects are built in; Ghostty and Kitty can add a GPU version via /cursor.'], rows: [
    {row: configRow('cursorShape'), note: draft => draft.cursor.shape === 'host' ? 'Host default: your terminal keeps its own cursor' : 'Applied while NMSh owns the composer; full-screen programs get your normal cursor'},
    {row: configRow('cursorBlink')},
    {row: configRow('cursorRenderer'), note: draft => chooseBackend(draft.cursor, currentCursorHost()).reason},
    {row: configRow('cursorMotion')},
    {row: configRow('cursorEffect')},
    {row: configRow('cursorFireColor')},
    {row: configRow('cursorFireCustom')},
    {row: configRow('cursorIdle')},
    {row: configRow('cursorColor'), note: draft => caretColorNote(currentCursorHost(), draft.cursor.color.source)},
    {row: configRow('cursorColorFamily')},
    {row: configRow('cursorColorVariant')},
    {row: configRow('cursorColorAccent')},
    {row: configRow('cursorColorCustom')},
    // Speed, intensity, trail length and particle amount, trail/particle colors and the physics live in /cursor, opened over this draft.
    {row: configRow('cursorAdvanced'), note: () => 'Speed, intensity, trail and particles, trail/particle colors and physics; changes stay in this Setup draft until Apply'},
  ], facts: draft => [`Renderer in use: ${chooseBackend(draft.cursor, currentCursorHost()).reason}`]},
  {id: 'editor', title: 'Editor', intro: ['The composer, syntax colors and suggestions.'], rows: [
    {row: configRow('composerPosition')},
    {row: configRow('composerDividers')},
    {row: configRow('workspacePanels'), note: draft => draft.workspacePanels
      ? 'Experimental: /sidebar and /panel open beside the transcript and narrow it while docked'
      : 'Off (default): /sidebar and /panel stay closed; /worktrees, /sessions, /github and /background are unaffected'},
    {row: configRow('pastePreview')},
    {row: configRow('copyMode'), note: draft => draft.copy.mode === 'picker' ? '/copy opens a list of recent outputs to choose from; /copy latest still copies at once' : '/copy copies the latest output at once; /copy ui opens the picker'},
    {row: configRow('copyAutoExpand'), note: draft => draft.copy.autoExpand ? 'A copied block unfolds so you can see what was copied' : 'Copying never changes what is folded'},
    {row: configRow('copyIncludeStatus'), note: draft => draft.copy.includeStatus ? 'Copies end each output with its completion status (✔ Completed · 1.4s · 10:04)' : 'Copies hold only what the command printed'},
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
    {row: configRow('dividerColors'), note: () => 'Live composer dividers follow Divider lines (Look, under Chroma); past dividers never move'},
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
    {row: configRow('commandQueue'), note: draft => draft.commandQueue ? 'On: while a command runs, Enter queues the next one; a program waiting for input still gets your answer' : 'Off: Enter while a command runs goes to the program, as in a plain terminal'},
    {row: configRow('queueFailurePolicy'), note: () => 'Applies to new execution chains; existing reviewed work keeps its policy. Ctrl+C always pauses.'},
    {row: configRow('queueTimeline'), note: draft => draft.queue.liveTimeline ? 'On: queued work shows as a chronological timeline — recent results, the running command and what runs next' : 'Off: the one-line queue row and pending list, as before'},
    {row: configRow('queueRecentResults')},
    {row: configRow('queueUpcoming')},
    {row: configRow('queueTransient'), note: draft => draft.queue.transient ? `On: a finished chain stays visible for ${draft.queue.transientSeconds}s, then dismisses` : 'Off: a finished chain dismisses as soon as it ends'},
    {row: configRow('queueTransientSeconds')},
    {row: configRow('queueOutputDisplay')},
    {row: configRow('queueSummaryAutoSave'), note: draft => draft.queue.autoSaveSummary
      ? 'On: each finished chain saves one typed summary — observed outcomes, durations and counts only, never output, prompts or hidden input'
      : 'Off: summaries are saved only when you ask, with an explicit redacted review'},
    {row: configRow('queueSummaryDetail')},
    {row: configRow('queueSummaryPlacement')},
    {row: configRow('queueSummaryAlign')},
    {row: configRow('queueSummaryDurations')},
    {row: configRow('queueSummaryExitCodes')},
    {row: configRow('queueSummaryInputWaits'), note: () => 'Only waits that were actually observed are ever shown; nothing is guessed'},
    {row: configRow('sessionNotices'), note: draft => draft.sessionNotices ? 'Brief: a success fades in seconds, a failure lingers a little, a request for attention stays until you look' : 'Off: other sessions never add lines above the composer'},
    {row: configRow('terminalTitle'), note: draft => draft.terminalTitle === 'off' ? 'Off: the terminal keeps its own window title'
      : 'NMSh titles the window while it owns the screen; programs keep their own title while they run'},
    {row: configRow('agentActivity')},
    {row: configRow('openWith')},
    {row: configRow('notifications')},
    {row: configRow('notifyAfter')},
    {row: configRow('notifyOnSuccess')},
    {row: configRow('notifyOnFailure')},
    {row: configRow('notifyWhenFocused')},
    {row: configRow('updateMode')},
    {row: configRow('updateFrequency')},
  ]},
  // The same rows as Settings; nothing here implies NMSh needs a model.
  {id: 'ask', title: 'Ask & local understanding', intro: ['/btw: ask NMSh what it can do in plain English. Ask works without a language model,',
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
    {row: configRow('stripEdge')},
    {row: configRow('stripStyle')},
    {row: configRow('stripSeparator')},
    {row: configRow('stripNativeZone')},
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
    {row: configRow('idleRunBusy')},
    {row: configRow('idleColor')},
    routeRow('setupIdleColors', 'Edit idle colors', 'The idle visuals\' own gradient stops, with a live preview', 'idleColors', 'Idle visuals'),
    {row: configRow('activityStyle'), note: draft => draft.liveActivity.style === 'expressive' ? 'Cooking… while it runs, Cooked for 18s when done; failures stay factual' : 'Running npm test, then Completed; plain words'},
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

/**
 * What a Chroma choice will visibly do with the rest of this draft, said where Chroma is chosen: Off (the default) and
 * every setting that hides it or stills it, so a choice is never made without a visible result and no reason.
 */
export function chromaVisibilityNote(draft: PromptConfiguration, colors = colorLevel() !== 'none'): string {
  const presentation = draft.presentation;
  if (presentation.preset === 'off') return 'Off (the default): the prompt shows its theme colors. Choose a Chroma and the preview shows it at once';
  if (!colors) return 'NO_COLOR is set: nothing is drawn in color, so Chroma has no visible effect here';
  if (draft.provider !== 'nmsh') return `Chroma colors the Native prompt; ${draft.provider === 'none' ? 'with Prompt None there is no prompt to color' : 'your external prompt keeps its own colors'}, so the prompt will not change`;
  const parts = [`${TREATMENT_PRESET_LABELS[presentation.preset]} on the ${presentation.scope === 'identity' ? 'identity modules only (the rest keeps theme colors)' : 'whole Native prompt'}`];
  if (presentation.effectsOff) parts.push('Decorative effects Off: its colors show, its motion stays still');
  else if (presentation.reducedMotion || isReducedMotion()) parts.push('Reduced Motion: its colors show, its motion stays still');
  return `${parts.join(' · ')}; P compares with the base theme`;
}

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
  tools: 'setupToolChoice', themeStudio: 'setupThemeStudio', onboardingBackdrop: 'setupPresets', themeBridge: 'setupThemeBridge', uiChromeColors: 'setupChromeColors', idleCustomColors: 'setupIdleColors', activityCustomColors: 'setupActivityColors',
};

/** Where each Settings entry point (a full panel) is reached from Setup: a section, or the route row that opens it. */
export const SETUP_ENTRY_COVERAGE: Readonly<Record<string, string>> = {
  appearance: 'setupHostWindow', glyph: 'glyphStyle', prompt: 'setupPromptModules', transcript: 'transcriptPresentation', syntax: 'syntaxHighlighting', keyboard: 'setupKeyboard',
  welcome: 'setupWelcome', suggestions: 'setupSuggestions', history: 'setupHistory', picker: 'setupPicker', navigation: 'setupNavigation', layout: 'composerPosition', toolConfig: 'setupToolConfig', tools: 'setupBrowseTools', screensaver: 'idleTimeout', setup: 'setupToolChoice',
  cursor: 'cursorAdvanced', themeStudio: 'setupThemeStudio', themeBridge: 'setupThemeBridge', chromeColors: 'setupChromeColors', idleColors: 'setupIdleColors', activityColors: 'setupActivityColors', resetInstallSuggestions: 'resetInstallSuggestions',
  queue: 'queueTimeline', setupQuick: 'setupPresets',
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
  message?: string;
  /**
   * The starting-point selector (first run, `/startup`, `/setup quick`): four choices over the
   * saved configuration, an explicit review and Apply. `confirm` is the Leave setup? sheet and
   * `manual` is the guided setup opened over the selector.
   */
  quick?: StartupSelectorState;
  /** Initial discovery uses the same draft and marks completion only on Apply. */
  onboarding?: boolean;
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
  /**
   * Local preview only (P on Look/Prompt): show the preview through the
   * draft's Chroma. Off by default so the base theme colors are visible; it
   * never changes the draft or the saved Chroma.
   */
  /** P's override of the Chroma preview (undefined: follow the Chroma setting; see setupShowsChroma). */
  previewChroma?: boolean;
  /** The Chroma choice the override was made for; a new choice returns the preview to following it. */
  previewChromaFor?: string;
  /** The first visible content line of the guided setup, kept per step so the view never jumps. */
  scroll?: number;
  scrollSection?: number;
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
  const state: SetupState = {section, row: 0, draft: structuredClone(configuration), saved: structuredClone(configuration), tools: 'keep', context: {statuses: {}}};
  // The row index counts only the rows shown for this draft (hidden theme rows come before Chroma).
  if (entry === 'chroma') state.row = Math.max(0, currentRows(state).findIndex(item => item.row.id === 'treatmentPreset'));
  return state;
}


/** The highlighted starting point's draft; the saved configuration is never touched. */
function selectorDraft(state: SetupState): PromptConfiguration {
  const quick = state.quick!;
  return startingPointDraft(startingPointAt(quick.choice), state.saved, {layout: quick.layout, keep: quick.keep, ...(quick.evidence ? {evidence: quick.evidence} : {})});
}

/** Keep Existing's read-only evidence arrived (or was re-detected): its answer stays in range and the draft follows. */
export function setStartupEvidence(state: SetupState, evidence: EnvironmentEvidence): void {
  const quick = state.quick;
  if (!quick) return;
  quick.evidence = evidence;
  const options = keepExistingPlan(evidence, state.saved, quick.keep.redetect).question?.options.length ?? 0;
  quick.keep.answer = Math.max(0, Math.min(Math.max(0, options - 1), quick.keep.answer));
  if (!quick.manual) state.draft = selectorDraft(state);
}

/** The starting-point selector over a copy of the saved configuration; it opens on the current starting point. */
export function createQuickSetup(configuration: PromptConfiguration, now = Date.now()): SetupState {
  const state = createSetup(configuration);
  state.quick = createSelector(state.saved, now);
  state.draft = selectorDraft(state);
  return state;
}

/** One finite installation scene over existing wordmark, Powerline tabs and Vespyr assets. */
export function renderSetupIntro(columns: number, height: number, elapsed: number, still: boolean): {rows: string[]; busy: boolean} {
  const t = still ? 2600 : Math.max(0, elapsed);
  const rows: string[] = [];
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  config.modules = [{id: 'project', visible: true, condition: 'always'}];
  const context = themePreviewContext('/demo'); context.project = 'notMyShell';
  let wordmark = columns < 24 ? 'notMyShell' : buildContextLine(context, columns, config, 'composer');
  if (!still) {
    const motion = new Transitions(() => config.motion, () => ({reducedMotion: false, effectsOff: false, color: colorLevel() !== 'none'}));
    motion.launch(0);
    for (const event of motion.live(t)) if (event.kind === 'launch') wordmark = overlayRow(wordmark, transitionPaint.launch(event.style, columns, progress(event, t), false, event.look), columns);
  }
  rows.push(wordmark);
  if (t > 450) rows.push('Welcome to notMyShell.');
  if (t > 900 && height >= 14) rows.push(...vespyrSprite(t >= 1200 && t < 1450 ? 'blink' : 'open'));
  if (t > 1550) rows.push("We're glad you're here.", 'Your shell is still yours.', 'This is just a nicer place to use it.');
  const footer = ['Any key: choose your setup', ...wrapWords('Docs · Report a bug · Request a feature', columns), '/setup · customize anytime'];
  const content = rows.flatMap(row => row.includes('\u001b') ? [row] : wrapWords(row, columns));
  return {rows: [...content.slice(0, Math.max(1, height - footer.length)), ...footer].slice(0, height).map(row => truncateAnsi(row, columns)), busy: !still && t < 2600};
}

const SWITCH_KEYS: ReadonlySet<Key['kind']> = new Set(['left', 'right', 'complete', 'focusPrevious']);

/** Applying a starting point: the reviewed draft, with completion and the starting-point label. */
function applyStartingPoint(state: SetupState, draft: PromptConfiguration, startingPoint: StartingPointId,
  guided?: {tools: ToolChoice; changed: boolean}): Extract<SetupResult, {kind: 'apply'}> {
  // The backdrop chosen with A is kept even if saving it on its own failed.
  const backdrop = state.quick ? {onboardingBackdrop: state.quick.backdrop} : {};
  // The review's Tools line: Skip keeps tools as they are; the others open the shared tools panel after Apply.
  // Customize brings its own tools step's choice instead.
  const tools = !guided && state.quick ? startupToolOption(state.quick) : undefined;
  return {kind: 'apply', configuration: normalizePromptConfiguration({...draft, ...backdrop, startingPoint, onboardingComplete: true,
    glyphChoiceComplete: true, toolsSetupComplete: true}), tools: guided?.tools ?? tools?.choice ?? 'keep',
    ...(guided ? {} : {preselect: tools?.preselect ?? false}), changed: guided?.changed ?? true, startingPoint};
}

/**
 * Choices: ↑↓ move, 1–4 jump, ←→/Tab Minimal's layout, Enter review (Customize: the guided setup), Esc Leave setup?, A backdrop.
 * Review: Enter Apply, Esc/← back, A backdrop. Leave setup?: ←→/Tab choose, Enter confirm, Esc Stay (focused first).
 * While the one-time window offer shows: M maximize for setup, K keep the current size.
 */
function quickKey(state: SetupState, key: Key, now: number): SetupResult | undefined {
  const quick = state.quick!;
  resumeSky(quick, now);
  if (quick.confirm) {
    if (SWITCH_KEYS.has(key.kind)) { quick.confirmIndex = quick.confirmIndex === 1 ? 0 : 1; return undefined; }
    if (key.kind === 'enter') {
      if (quick.confirmIndex === 1) return {kind: 'cancel'};
      quick.confirm = false; quick.confirmIndex = 0;
      return undefined;
    }
    if (key.kind === 'escape' || key.kind === 'interrupt') { quick.confirm = false; quick.confirmIndex = 0; }
    return undefined;
  }
  if (key.kind === 'text' && key.value.toLowerCase() === 'a') {
    quick.backdrop = nextBackdrop(quick.backdrop);
    return {kind: 'backdrop', backdrop: quick.backdrop};
  }
  // The one-time window offer: M maximizes for setup, K keeps the size; either answers it.
  if (quick.windowOffer && key.kind === 'text' && /^[mk]$/iu.test(key.value)) {
    quick.windowOffer = false;
    return {kind: key.value.toLowerCase() === 'm' ? 'maximize' : 'keepSize'};
  }
  if (quick.review) {
    const keeping = startingPointAt(quick.choice) === 'existing';
    if (key.kind === 'enter') {
      // A first run applies Keep Existing only from evidence; a configured install keeps everything without it.
      if (keeping && !quick.evidence && (!state.saved.onboardingComplete || quick.keep.redetect)) return undefined;
      return applyStartingPoint(state, state.draft, startingPointAt(quick.choice));
    }
    if (key.kind === 'escape' || key.kind === 'interrupt' || key.kind === 'left') { quick.review = false; return undefined; }
    if (key.kind === 'text' && key.value.toLowerCase() === 't') { cycleStartupTools(quick); return undefined; }
    if (keeping && (key.kind === 'up' || key.kind === 'down')) {
      const options = keepExistingPlan(quick.evidence, state.saved, quick.keep.redetect).question?.options.length ?? 0;
      if (options > 1) {
        quick.keep.answer = Math.max(0, Math.min(options - 1, quick.keep.answer + (key.kind === 'up' ? -1 : 1)));
        state.draft = selectorDraft(state);
      }
      return undefined;
    }
    if (keeping && key.kind === 'text' && key.value.toLowerCase() === 'r' && state.saved.onboardingComplete) {
      quick.keep = {answer: 0, redetect: true};
      state.draft = selectorDraft(state);
      return {kind: 'redetect'};
    }
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') { quick.confirm = true; quick.confirmIndex = 0; return undefined; }
  if (key.kind === 'enter') {
    if (startingPointAt(quick.choice) === 'customize') {
      quick.manual = true; quick.review = false;
      state.section = 0; state.row = 0; state.chooser = undefined; state.confirmDiscard = undefined;
      state.draft = structuredClone(state.saved);
      return {kind: 'manual'};
    }
    quick.review = true;
    return undefined;
  }
  let next: number | undefined;
  if (key.kind === 'down' || key.kind === 'up') next = (quick.choice + (key.kind === 'up' ? STARTING_POINTS.length - 1 : 1)) % STARTING_POINTS.length;
  else if (key.kind === 'text' && /^[1-4]$/u.test(key.value)) next = Number(key.value) - 1;
  if (next !== undefined) {
    if (highlightChoice(quick, next, now)) state.draft = selectorDraft(state);
  } else if (startingPointAt(quick.choice) === 'minimal' && SWITCH_KEYS.has(key.kind)) {
    quick.layout = quick.layout === 'oneLine' ? 'twoLine' : 'oneLine';
    state.draft = selectorDraft(state);
  }
  return undefined;
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
      if (seen.has(row.id) || row.id === CHROMA_IN_LOOK_ROW.row.id) continue;
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
  | {kind: 'manual'}
  /** The selector's backdrop changed (A): saved at once, never part of the draft. */
  | {kind: 'backdrop'; backdrop: OnboardingBackdrop}
  /** Keep Existing on a configured install: read the environment again (R). */
  | {kind: 'redetect'}
  /** The one-time window offer was answered (M or K). */
  | {kind: 'maximize'}
  | {kind: 'keepSize'}
  /** Open the shared tool browser inside Setup Cat, optionally on one tool. */
  | {kind: 'browseTools'; toolId?: string}
  /** Open the shared /cursor panel inside Setup Cat, over the draft. */
  | {kind: 'cursorEditor'; advanced: boolean; row?: string}
  /** A route row: its editor opens over Setup Cat, which waits with its draft unapplied and returns on Esc. */
  | {kind: 'open'; destination: SettingsDestination}
  /** `startingPoint`: applied from the starting-point selector; `preselect` ticks the missing recommended tools once verified. */
  | {kind: 'apply'; configuration: PromptConfiguration; tools: ToolChoice; changed: boolean; startingPoint?: StartingPointId; preselect?: boolean};

/** Rows that apply to the draft (a child row disappears when its parent makes it meaningless). */
function sectionRows(section: SetupSection, draft: PromptConfiguration, context?: SetupContext): readonly SetupRow[] {
  return [...section.rows, ...(section.dynamicRows?.(draft, context) ?? [])];
}

function currentRows(state: SetupState): readonly SetupRow[] {
  const rows = sectionRows(SETUP_SECTIONS[state.section]!, state.draft, state.context).filter(item => setupRowApplies(item.row, state.draft));
  return state.section === sectionIndex('tools') ? [...rows, TOOL_CHOICE_ROW, BROWSE_ROW] : rows;
}

/**
 * Whether Setup's Look and Prompt previews show Chroma: by default whenever the draft's Chroma is on, so choosing
 * one is seen at once; P overrides it to compare with the base theme until the Chroma choice changes again.
 */
export function setupShowsChroma(state: SetupState): boolean {
  const preset = state.draft.presentation.preset;
  if (state.previewChromaFor !== preset) { state.previewChroma = undefined; state.previewChromaFor = preset; }
  return preset !== 'off' && (state.previewChroma ?? true);
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
    case 'recommended': return 'Opens /tools with the missing recommended tools selected; nothing installs until you confirm';
    case 'enhanced': return 'Also lists Enhanced CLI tools (bat, eza, delta, gh, …); not better for everyone';
    case 'individual': return 'Opens /tools on the full catalog; each install asks first';
  }
}

/**
 * ↑↓ rows · ←→ change · Tab / Shift+Tab sections · Enter next (Apply on
 * the last step) · Esc cancel (asks when there are unapplied edits).
 */
export function setupKey(state: SetupState, key: Key, now = Date.now()): SetupResult | undefined {
  if (state.quick && !state.quick.manual) return quickKey(state, key, now);
  const changes = () => setupChanges(state).length > 0;
  /** Leaving the guided setup opened from the selector returns to the choices instead of closing setup. */
  const leaveQuickManual = (): boolean => {
    if (!state.quick?.manual) return false;
    state.quick.manual = false;
    state.confirmDiscard = undefined;
    state.chooser = undefined;
    state.tools = 'keep';
    state.draft = selectorDraft(state);
    return true;
  };
  /** The guided setup opened from the selector applies as the Customize starting point. */
  const applied = (configuration: PromptConfiguration): SetupResult => state.quick?.manual
    ? applyStartingPoint(state, configuration, 'customize', {tools: state.tools, changed: changes()})
    : {kind: 'apply', configuration: normalizePromptConfiguration(configuration), tools: state.tools, changed: changes()};
  if (state.chooser) { chooserKey(state, state.chooser, key); return undefined; }
  if (state.confirmDiscard) {
    if (key.kind === 'enter' || (key.kind === 'text' && key.value.toLowerCase() === 'y')) return leaveQuickManual() ? undefined : {kind: 'cancel'};
    if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value.toLowerCase() === 'n')) state.confirmDiscard = false;
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    if (changes()) { state.confirmDiscard = true; return undefined; }
    return leaveQuickManual() ? undefined : {kind: 'cancel'};
  }
  const sectionId = SETUP_SECTIONS[state.section]?.id;
  if (key.kind === 'text' && key.value.toLowerCase() === 'p' && (sectionId === 'appearance' || sectionId === 'prompt')) {
    // The preview follows the Chroma setting; P compares it with the base theme (and back).
    state.previewChroma = !setupShowsChroma(state);
    return undefined;
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
    if (row.id === CHROMA_IN_LOOK_ROW.row.id) {
      go(sectionIndex('appearance'));
      state.row = Math.max(0, currentRows(state).findIndex(item => item.row.id === 'treatmentPreset'));
      return undefined;
    }
    if (row.control === 'action' && row.destination === 'cursor') return {kind: 'cursorEditor', advanced: false, row: row.id === 'cursorAdvanced' ? 'speed' : row.id === 'cursorFireCustom' ? 'fireEdit' : 'colorCustom'};
    // An in-draft action (reset a list), or a route: the real editor opens over this Setup, which waits unapplied.
    if (row.control === 'action' && row.run) { state.draft = row.run(state.draft); return undefined; }
    if (row.control === 'action' && row.destination !== 'tools' && row.destination) return {kind: 'open', destination: row.destination};
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
    else return applied(state.draft);
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

/** The steps as the guided setup's route names them, Start through Review. */
export const GUIDED_ROUTE: readonly string[] = SETUP_SECTIONS.map(section => section.title.replace(/ &.*$/u, '').replace(/^Optional (\w)/u, (_, first: string) => first.toUpperCase()));

/** The guided setup's steps, as Customize's tiles name them (Start and Review & Apply are not steps of their own). */
export const GUIDED_STEPS: readonly string[] = GUIDED_ROUTE.slice(1, -1);

/** What each step covers, beside its name. */
const SECTION_SUMMARIES: Readonly<Record<string, string>> = {
  welcome: 'how this tour works', terminal: 'glyphs your font can draw', appearance: 'theme, text and chrome', prompt: 'what your prompt shows',
  motion: 'how events move', cursor: 'the caret and its effects', editor: 'composer, syntax and suggestions', transcript: 'how past commands look',
  history: 'history, jumps and picking', shell: 'the shell underneath', sessions: 'restarts, alerts and updates', ask: 'plain-English help',
  welcomeScreen: 'what a new session shows', idle: 'screensaver and activity', tools: 'optional helpers', review: 'everything you changed',
};

export function renderSetup(state: SetupState, columns: number, height: number, now = Date.now()): string[] {
  if (state.quick && !state.quick.manual) {
    // The starting-point selector; the app supplies a themed context (its composer preview, Keep Existing's sample).
    const startup = state.context.startup ??= createStartupContext({reopened: !state.onboarding, steps: GUIDED_STEPS});
    startup.reduced = isReducedMotion() || state.saved.presentation.reducedMotion || state.saved.presentation.effectsOff;
    return renderStartup(state, columns, height, now, startup);
  }
  const subtle = foreground(UI_COLORS.subtle);
  const success = foreground(UI_COLORS.success);
  const reset = '\u001B[0m';
  const section = SETUP_SECTIONS[state.section]!;
  const nerd = getCurrentGlyphMode() === 'nerd';
  const width = Math.max(1, Math.floor(columns));
  const tall = Math.max(1, Math.floor(height));
  const margin = guidedMargin(width);
  // One fixed frame for every step, whatever the composer or panel position: the head, then the intro, the rows from
  // the same line every time, the help and the keys pinned to the bottom. Content scrolls; nothing above it moves.
  const head = [guidedHairline(width), guidedRoute(GUIDED_ROUTE, state.section, width, margin), '',
    guidedStepHeader(state.context.title ?? section.title, SECTION_SUMMARIES[section.id] ?? '', state.section, SETUP_SECTIONS.length, width, margin), ''];
  const frame = (body: readonly string[], below: readonly string[]): string[] => {
    const room = Math.max(0, tall - head.length - below.length);
    const rows = [...head, ...body.slice(0, room), ...Array<string>(Math.max(0, room - body.length)).fill(''), ...below];
    return rows.slice(0, tall).map(row => truncateAnsi(row, width));
  };
  if (state.toolBrowser) {
    // The shared /tools browser, inside Setup Cat: the draft and step are kept underneath; Esc returns to them.
    const note = wrapWords(`${INSTALL_DRAFT_NOTE} Esc returns to Setup Cat.`, Math.max(10, width - margin * 2)).map(line => guidedText(line, width, margin));
    const tools = renderTools(state.toolBrowser, width, Math.max(4, tall - head.length - note.length));
    return frame([...note, ...tools], []);
  }

  const introLines = tall >= 24 ? 2 : tall >= 18 ? 1 : 0;
  const helpLines = tall >= 20 ? 2 : 1;
  const split = guidedColumns(state, width);
  const preview = state.context.preview ?? [];
  const columnsSplit = split && preview.length ? split : undefined;
  const textWidth = Math.max(10, columnsSplit ? columnsSplit.left : width - margin * 2);
  const rowsWidth = columnsSplit ? margin * 2 + columnsSplit.left : width;
  const facts = (section.facts?.(state.draft, state.context) ?? []).map(line => `${' '.repeat(margin)}${subtle}${line}${reset}`);
  // The intro's first lines sit in a fixed band; any more follow the rows, so the rows always start on the same line.
  const introText = section.intro.flatMap(line => wrapWords(line, Math.max(10, width - margin * 2)).map(part => ({part, primary: line === NATIVE_FIRST_MESSAGE})));
  const intro = introText.slice(0, introLines).map(({part, primary}) => guidedText(part, width, margin, primary ? 'primary' : 'subtle'));
  const overflow = introText.slice(introLines).flatMap(({part, primary}) => wrapWords(part, textWidth).map(line => guidedText(line, rowsWidth, margin, primary ? 'primary' : 'subtle')));

  const lines: string[] = [];
  let focus = 0, span = 1;
  if (section.id === 'review') {
    const changes = setupChanges(state);
    if (!changes.length) {
      lines.push(...wrapWords(state.onboarding ? 'Your current choices are ready. Enter completes setup; you can return with /setup anytime.' : 'No changes. Enter closes Setup Cat and keeps everything as it is.', textWidth)
        .map(line => guidedText(line, rowsWidth, margin, 'secondary')));
    } else {
      lines.push(guidedText('Apply these changes?', rowsWidth, margin, 'primary'), '');
      const labelWidth = Math.min(28, Math.max(...changes.map(change => displayWidth(change.label))) + 2);
      for (const change of changes) {
        lines.push(`${' '.repeat(margin)}${foreground(UI_COLORS.secondary)}${padCells(change.label, labelWidth - 2)}${subtle}${change.from} ${nerd ? '→' : '->'} ${reset}${success}${change.to}${reset}`);
      }
    }
  } else {
    const rows = currentRows(state);
    const labelWidth = Math.min(30, Math.max(0, ...rows.map(item => displayWidth(`${item.row.parent ? '  ' : ''}${item.row.label}`))) + 1);
    const valueX = guidedValueColumn(margin, labelWidth);
    rows.forEach((item, index) => {
      const selected = index === state.row;
      const value = item.row.id === TOOL_CHOICE_ROW.row.id ? TOOL_CHOICE_LABELS[state.tools] : rowValue(item.row, state.draft);
      const changed = item.row.id !== TOOL_CHOICE_ROW.row.id && item.row.control !== 'action' && rowValue(item.row, state.saved) !== value;
      // An unavailable row has nothing to cycle: no arrows, and the reason is shown instead of the description.
      const kind = item.row.control === 'action' ? 'action' : item.row.unavailable?.(state.draft) ? 'unavailable' : 'value';
      if (selected) focus = lines.length;
      lines.push(guidedRow({label: item.row.label, child: Boolean(item.row.parent), value, selected, kind, changed}, rowsWidth, margin, labelWidth));
      if (selected && state.chooser?.rowId === item.row.id) {
        // Every choice, visible under the row; the highlighted one is previewed live.
        const options = chooserOptions(item.row, state.chooser.before);
        const savedValue = rowValue(item.row, state.saved);
        options.forEach((option, optionIndex) => {
          const current = optionIndex === state.chooser!.index;
          const mark = current ? (nerd ? '●' : '*') : (nerd ? '○' : 'o');
          lines.push(guidedText(`${mark} ${option}${option === savedValue ? ` ${nerd ? '✓' : '(saved)'}` : ''}`, rowsWidth, margin, current ? 'primary' : 'secondary', valueX));
        });
        span = 1 + options.length;
      }
    });
  }
  if (overflow.length) lines.push('', ...overflow);
  if (!columnsSplit && facts.length) lines.push('', ...facts);
  if (!columnsSplit && preview.length) lines.push('', guidedText('Live preview', width, margin, 'subtle'), ...preview);

  // The help band: the selected row's help, or what needs an answer now (a discard question, a message).
  const selectedRow = section.id === 'review' ? undefined : currentRows(state)[state.row];
  const reason = selectedRow?.row.unavailable?.(state.draft);
  const note = selectedRow ? selectedRow.row.id === TOOL_CHOICE_ROW.row.id ? toolChoiceNote(state.tools) : selectedRow.note?.(state.draft, state.context) : undefined;
  const helpText = state.confirmDiscard ? {text: 'Discard unapplied Setup Cat changes? Your saved settings stay as they are.', tone: 'primary' as const}
    : state.message ? {text: state.message, tone: 'warning' as const}
      : {text: [reason ?? selectedRow?.row.description, !reason ? note : undefined].filter(Boolean).join('. '), tone: 'subtle' as const};
  const help = wrapWords(helpText.text, Math.max(10, width - margin * 2)).slice(0, helpLines).map(line => guidedText(line, width, margin, helpText.tone));

  const browsable = Boolean(selectedRow && selectedRow.row.id !== TOOL_CHOICE_ROW.row.id && !selectedRow.row.unavailable?.(state.draft) && chooserOptions(selectedRow.row, state.draft).length);
  const back = state.quick?.manual ? 'back to start' : state.onboarding ? 'skip for now' : 'cancel';
  const keys: GuidedKey[] = state.confirmDiscard
    ? [{key: '⏎', action: 'discard changes', primary: true, keep: 9}, {key: 'esc', action: 'keep editing', keep: 9}]
    : state.chooser
      ? [{key: '↑↓', action: 'preview choice', keep: 5}, {key: '⏎', action: 'keep', primary: true, keep: 9}, {key: 'esc', action: 'restore', keep: 8}]
      : [
        ...(section.rows.length || section.id === 'tools' ? [{key: '↑↓', action: 'select', short: '', keep: 3}, {key: '←→', action: 'change', short: '', keep: 4}] : []),
        ...(['cursor', 'motion'].includes(section.id) ? [{key: 'R', action: 'replay preview', short: 'replay', keep: 1}] : []),
        {key: 'Tab', action: 'next step', short: 'next', keep: 6}, {key: '⇧Tab', action: 'previous step', short: 'back', keep: 2},
        {key: '⏎', primary: true, keep: 9, action: browsable ? 'choices' : selectedRow?.row.control === 'action' ? 'open'
          : state.section === SETUP_SECTIONS.length - 1 ? (setupChanges(state).length || state.onboarding ? 'apply' : 'close') : 'next',
        short: browsable ? 'choose' : undefined},
        {key: 'esc', action: back, short: state.quick?.manual ? 'start' : undefined, keep: 8}];
  const footer = guidedFooter(keys, width, margin);

  // The content region between the intro band and the help band; the selected row (and its open choices) stays in view.
  const introBand = introLines ? [...intro, ...Array<string>(introLines - intro.length).fill(''), ''] : [];
  const below = [...help, ...Array<string>(helpLines - help.length).fill(''), '', footer];
  const region = Math.max(1, tall - head.length - introBand.length - 1 - below.length);
  if (state.scrollSection !== state.section) { state.scroll = 0; state.scrollSection = state.section; }
  let offset = Math.max(0, Math.min(state.scroll ?? 0, Math.max(0, lines.length - region)));
  if (focus < offset) offset = focus;
  if (focus + span > offset + region) offset = Math.min(focus, focus + span - region);
  state.scroll = offset;
  const shown = lines.slice(offset, offset + region);
  let content: string[];
  if (columnsSplit) {
    const right = [guidedText('Live preview', columnsSplit.preview, 0, 'subtle', 0), '', ...preview, ...(facts.length ? ['', ...facts.map(line => line.replace(/^ +/u, ''))] : [])].slice(0, region);
    content = Array.from({length: Math.max(shown.length, right.length)}, (_, index) => besides(shown[index] ?? '', right[index] ?? '', columnsSplit.previewX, width));
  } else content = shown;
  // What is out of view is counted on the quiet rows around the region, never over a setting.
  const above = offset, after = Math.max(0, lines.length - offset - region);
  const more = (count: number, arrow: string) => guidedText(`${arrow} ${count} more`, width, margin, 'subtle', Math.max(margin, width - margin - 12));
  const top = [...introBand.slice(0, -1), introLines ? (above ? more(above, nerd ? '↑' : '^') : '') : ''];
  const bodyRows = [...(introLines ? top : []), ...content, ...Array<string>(Math.max(0, region - content.length)).fill(''), after ? more(after, nerd ? '↓' : 'v') : ''];
  return frame(bodyRows, below);
}

/**
 * Two columns from 96 columns (as the selector): the rows on the left (44 to 60 columns, fixed per step), the live
 * preview from `previewX`.
 */
function guidedColumns(state: SetupState, columns: number): {left: number; previewX: number; preview: number} | undefined {
  if (columns < 96 || SETUP_SECTIONS[state.section]?.id === 'review') return undefined;
  const margin = guidedMargin(columns);
  const rows = currentRows(state);
  const labelWidth = Math.min(30, Math.max(0, ...rows.map(item => displayWidth(`${item.row.parent ? '  ' : ''}${item.row.label}`))) + 1);
  // Labels plus a fixed allowance for values: a value that grows never moves the preview.
  const left = Math.max(44, Math.min(60, labelWidth + 6 + 28));
  const previewX = margin + left + 4;
  const preview = columns - previewX - margin;
  return preview >= 36 ? {left, previewX, preview} : undefined;
}

/** The width the app renders Setup Cat's live preview at: the right column when two fit, the full width otherwise. */
export function guidedPreviewWidth(state: SetupState, columns: number): number {
  return guidedColumns(state, columns)?.preview ?? columns;
}

/** The rows' column clipped at `x` (padding only: its text is wrapped to fit), then the preview's. */
function besides(left: string, right: string, x: number, width: number): string {
  if (!right) return left;
  const canvas = new StartupCanvas(width, 1);
  canvas.ansi(0, 0, left, x);
  canvas.ansi(x, 0, right, width - x);
  return canvas.rows()[0]!;
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
