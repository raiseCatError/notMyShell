import type {Key} from '../terminal/keys.js';
import {
  DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, WELCOME_PROVIDER_IDS,
  type PromptConfiguration, type PromptProviderId,
} from '../prompt/configuration.js';
import {STYLE_PROFILE_OPTIONS} from '../prompt/styles.js';
import {separatorLabel} from '../prompt/glyphChoices.js';
import {PROMPT_PROVIDERS} from '../prompt/PromptPanel.js';
import {WELCOME_PROVIDERS} from '../output/WelcomeProviders.js';
import {NAVIGATION_PROVIDERS} from '../shell/DirectoryService.js';
import {PICKER_PROVIDERS} from '../pickers/Picker.js';
import {HISTORY_PROVIDERS} from '../shell/historyProviders.js';
import {SUGGESTION_PROVIDERS} from '../suggestions/types.js';
import {lifecycleNote, type ProviderDescriptor, type ProviderStatus} from '../providers/providers.js';
import type {CompletionFacts} from '../shell/SemanticService.js';
import {
  adjustSettingsRow, enumRow, settingsRowApplies, settingsRowValue, SETTINGS_ROWS, type SettingsRow,
} from '../ui/SettingsPanel.js';
import {framePanel, renderTabStrip} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS, getCurrentGlyphMode} from '../ui/glyphs.js';
import {displayWidth, truncateAnsi} from '../util/text.js';

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
  /** A live frame of the draft's idle visual from the real renderer, supplied while that step is shown. */
  idlePreview?: readonly string[];
}

export interface SetupRow {
  row: SettingsRow;
  /** A muted line under the row while it is selected. */
  note?: (draft: PromptConfiguration, context: SetupContext) => string | undefined;
}

export interface SetupSection {
  id: string;
  title: string;
  intro: readonly string[];
  rows: readonly SetupRow[];
  /** Muted informational lines after the rows. */
  facts?: (draft: PromptConfiguration, context: SetupContext) => string[];
}

/** Direct entry names to the section they open. */
export const SETUP_ENTRIES: Readonly<Record<string, string>> = {
  prompt: 'prompt', appearance: 'appearance', chroma: 'appearance', tools: 'tools', editor: 'editor',
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
      return providerNote(descriptor, descriptor?.executable ? context.statuses[descriptor.executable] : undefined);
    },
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

const PROMPT_PROVIDER_ROW = providerRow<PromptProviderId>('setupPromptProvider', 'Prompt provider', 'Native prompt, or your existing Starship / Powerlevel10k', 'Prompt',
  PROMPT_PROVIDERS, config => config.provider, (config, provider) => ({...config, provider}));

/** Every Setup Cat row id, so callers (and tests) can find any row in the one model. */
export const SETUP_SECTIONS: readonly SetupSection[] = [
  {id: 'welcome', title: 'Start', intro: [
    'Hi, I am Setup Cat. I walk through NMSh settings with you.',
    NATIVE_FIRST_MESSAGE,
    NATIVE_FIRST_DETAIL,
    'Your current choices are already selected. Nothing changes until you apply on the last step.',
  ], rows: []},
  {id: 'terminal', title: 'Terminal', intro: ['Glyphs your terminal font can draw.'], rows: [
    {row: configRow('glyphStyle'), note: draft => draft.glyphStyle === 'nerd' ? 'Needs a Nerd Font in your terminal' : 'Works with any terminal font'},
    {row: configRow('cursorShape'), note: () => 'Applied only while NMSh owns the composer; full-screen programs get your normal cursor'},
    {row: configRow('cursorBlink')},
  ]},
  {id: 'prompt', title: 'Prompt', intro: ['How the prompt above the composer looks.'], rows: [
    {...PROMPT_PROVIDER_ROW, note: (draft, context) => draft.provider === 'nmsh' ? 'Built in · no installation required'
      : `${PROMPT_PROVIDER_ROW.note!(draft, context)} · details in /prompt`},
    {row: configRow('promptStyle')},
    {row: SEPARATOR_ROW},
    {row: configRow('promptSymbol')},
  ]},
  {id: 'appearance', title: 'Appearance', intro: ['Theme and Chroma color NMSh-owned UI only; your terminal and editor keep their own colors.'], rows: [
    {row: configRow('themeFamily'), note: () => 'Themes NMSh-owned UI only; your terminal and editor keep their colors. /theme makes your own'},
    {row: configRow('themeVariant')},
    {row: configRow('themeAccent')},
    {row: configRow('promptVibrance')},
    {row: configRow('treatmentPreset'), note: () => 'Chroma colors NMSh-owned prompt, rules and frames; /chroma has every option'},
    {row: configRow('treatmentMotion')},
    {row: configRow('reducedMotion')},
    {row: configRow('effectsOff')},
  ]},
  {id: 'editor', title: 'Editor', intro: ['The composer, syntax colors and suggestions.'], rows: [
    {row: configRow('composerPosition')},
    {row: configRow('transcriptPresentation')},
    {row: configRow('syntaxHighlighting')},
    providerRow('setupSuggestions', 'Suggestions', 'Ghost-text prediction', 'Suggestions', SUGGESTION_PROVIDERS,
      config => config.suggestions, (config, suggestions) => ({...config, suggestions})),
    {row: configRow('suggestionsOnEmpty')},
    {row: configRow('outputFolding')},
  ], facts: (_draft, context) => completionFacts(context.completion)},
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
  {id: 'welcomeScreen', title: 'Welcome', intro: ['What a new session shows first. Vespyr is the NMSh cat.'], rows: [
    providerRow('setupWelcome', 'Welcome', 'New-session welcome', 'Welcome', WELCOME_PROVIDERS.filter(provider => WELCOME_PROVIDER_IDS.includes(provider.id)),
      config => config.welcome, (config, welcome) => ({...config, welcome})),
    {row: configRow('statusStrip'), note: draft => draft.statusStrip.enabled ? 'Minimal: clock, plus battery only when this machine has one; more in /settings' : 'Off: no extra row'},
  ]},
  {id: 'idle', title: 'Idle visuals', intro: ['An optional screensaver inside NMSh, only while it owns the terminal and nothing is running.',
    'Off by default (Never). Any key, mouse or new output ends it and leaves everything exactly as it was.'], rows: [
    {row: configRow('idleTimeout')},
    {row: configRow('idleMode')},
    {row: configRow('idleColor'), note: () => 'Follow Appearance uses Chroma when it is on, otherwise your theme'},
  ], facts: (_draft, context) => context.idlePreview?.length ? ['', ...context.idlePreview] : []},
  {id: 'tools', title: 'Optional tools', intro: [NATIVE_FIRST_SHORT, 'Installing is never automatic: each install is previewed and confirmed in /tools.'], rows: [
    {row: configRow('toolUpdateChecks'), note: draft => draft.toolUpdateChecks === 'off' ? 'Off: NMSh never checks unless you ask in /tools' : 'Checks run in the background at startup, never while typing'},
    {row: configRow('installSuggestions')},
  ], facts: (_draft, context) => completionFacts(context.completion)},
  {id: 'review', title: 'Review & Apply', intro: [], rows: []},
];

function completionFacts(facts: CompletionFacts | undefined): string[] {
  if (!facts) return ['Configured zsh completion      Checking…'];
  const line = (label: string, value: string) => `${label.padEnd(31)}${value}`;
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
    for (const {row} of section.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const from = rowValue(row, state.saved);
      const to = rowValue(row, state.draft);
      if (from !== to) changes.push({label: row.label, from, to});
    }
  }
  if (state.tools !== 'keep') changes.push({label: 'Optional tools', from: TOOL_CHOICE_LABELS.keep, to: TOOL_CHOICE_LABELS[state.tools]});
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
  | {kind: 'apply'; configuration: PromptConfiguration; tools: ToolChoice; changed: boolean};

/** Rows that apply to the draft (a child row disappears when its parent makes it meaningless). */
function currentRows(state: SetupState): readonly SetupRow[] {
  const rows = SETUP_SECTIONS[state.section]!.rows.filter(item => setupRowApplies(item.row, state.draft));
  return state.section === sectionIndex('tools') ? [...rows, TOOL_CHOICE_ROW] : rows;
}

function setupRowApplies(row: SettingsRow, config: PromptConfiguration): boolean {
  if (row.when && !row.when(config)) return false;
  return SETTINGS_ROWS.some(item => item.id === row.id) ? settingsRowApplies(row, config) : true;
}

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
  } else if (key.kind === 'enter') {
    if (state.section < last) go(state.section + 1);
    else {
      const configuration = normalizePromptConfiguration(state.draft);
      return {kind: 'apply', configuration, tools: state.tools, changed: changes()};
    }
  }
  return undefined;
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
  const title = `  ${bold}${primary}Setup Cat${reset}  ${subtle}${nerd ? '·' : '-'} ${state.section + 1}/${SETUP_SECTIONS.length} ${section.title}${reset}`;
  const out: string[] = [title, renderTabStrip(SETUP_SECTIONS.map(item => item.title), state.section, columns), ''];
  for (const line of section.intro) {
    for (const part of wrapWords(line, Math.max(10, columns - 4))) out.push(`  ${line === NATIVE_FIRST_MESSAGE ? primary : subtle}${part}${reset}`);
  }
  if (section.intro.length) out.push('');

  if (section.id === 'review') {
    const changes = setupChanges(state);
    if (!changes.length) out.push(`  ${secondary}No changes. Enter closes Setup Cat and keeps everything as it is.${reset}`);
    else {
      out.push(`  ${primary}Apply these changes?${reset}`, '');
      const labelWidth = Math.min(28, Math.max(...changes.map(change => displayWidth(change.label))) + 2);
      for (const change of changes) {
        out.push(`  ${secondary}${change.label.padEnd(labelWidth)}${subtle}${change.from} ${nerd ? '→' : '->'} ${reset}${success}${change.to}${reset}`);
      }
    }
  } else {
    const rows = currentRows(state);
    const indent = (row: SettingsRow) => row.parent ? '  ' : '';
    const labelWidth = Math.min(30, Math.max(0, ...rows.map(item => displayWidth(indent(item.row) + item.row.label))) + 3);
    rows.forEach((item, index) => {
      const selected = index === state.row;
      const value = item.row.id === TOOL_CHOICE_ROW.row.id ? TOOL_CHOICE_LABELS[state.tools] : rowValue(item.row, state.draft);
      const changed = item.row.id !== TOOL_CHOICE_ROW.row.id && rowValue(item.row, state.saved) !== value;
      const pointer = selected ? `${accent}${GLYPHS.selection}${reset}` : ' ';
      const control = selected ? `${accent}${nerd ? '‹' : '<'} ${value} ${nerd ? '›' : '>'}${reset}` : `${secondary}${value}${reset}`;
      out.push(`  ${pointer} ${selected ? `${bold}${primary}` : primary}${(indent(item.row) + item.row.label).padEnd(labelWidth)}${reset}${control}${changed ? ` ${subtle}${nerd ? '•' : '*'}${reset}` : ''}`);
    });
    const selected = rows[state.row];
    if (selected) {
      const note = selected.row.id === TOOL_CHOICE_ROW.row.id ? toolChoiceNote(state.tools) : selected.note?.(state.draft, state.context);
      out.push('', `  ${subtle}${selected.row.description}${reset}`);
      if (note) out.push(`  ${subtle}${note}${reset}`);
    }
    const facts = section.facts?.(state.draft, state.context) ?? [];
    if (facts.length) out.push('', ...facts.map(line => `  ${subtle}${line}${reset}`));
  }
  const footer = state.confirmDiscard
    ? renderControls([['Enter', 'discard changes'], ['Esc', 'keep editing']])
    : renderControls([
      ...(section.rows.length || section.id === 'tools' ? [['↑↓', 'select'] as [string, string], ['←→', 'change'] as [string, string]] : []),
      ['Tab', 'next section'],
      ['Enter', state.section === SETUP_SECTIONS.length - 1 ? (setupChanges(state).length ? 'apply' : 'close') : 'next'],
      ['Esc', 'cancel']]);
  if (state.confirmDiscard) out.push('', `  ${primary}Discard unapplied Setup Cat changes? Your saved settings stay exactly as they are.${reset}`);
  // Keep the footer: trim the body first on short terminals.
  const budget = Math.max(1, height - 3);
  const body = out.slice(0, Math.max(1, budget - 2));
  return framePanel([...body, '', footer].map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
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
