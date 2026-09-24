import {
  DEFAULT_PROMPT_CONFIGURATION,
  type DividerDensity,
  type GlyphStyle,
  type HistoryColorMode,
  type PromptConfiguration,
  type TranscriptAppearance,
} from '../prompt/configuration.js';
import {providerLabel} from '../prompt/PromptPanel.js';
import {background, foreground, UI_COLORS} from './palette.js';
import {renderHints} from './controls.js';
import {GLYPHS} from './glyphs.js';
import {framePanel, renderPanelShell, renderTabStrip} from './PanelShell.js';
import {displayWidth, highlightMatches, truncateAnsi} from '../util/text.js';

export type SettingsSection = 'root' | 'appearance';
export interface SettingsPanelState {
  section: SettingsSection;
  /** Selected top tab in root, selected glyph choice in appearance. */
  selectedIndex: number;
  contentIndex?: number;
  searchQuery?: string;
  /** Keystrokes edit the query while focused; arrows still move results. */
  searchFocused?: boolean;
  glyphStyle: GlyphStyle;
  onboarding: boolean;
}

export const SETTINGS_SECTIONS = [
  'General', 'Prompt', 'Transcript', 'Layout', 'Blocks', 'Syntax',
  'Tools', 'Completion', 'Chroma', 'Updates', 'Keyboard',
] as const;
export type SettingsCategory = typeof SETTINGS_SECTIONS[number];

/** Where Enter leads: `glyph` is the rich glyph preview inside Settings, the rest are full panels. */
export type SettingsDestination = 'glyph' | 'appearance' | 'prompt' | 'transcript' | 'keyboard';

interface SettingsRowBase {
  id: string;
  label: string;
  description: string;
  category: SettingsCategory;
}

/**
 * The control a row exposes. `enum` and `boolean` edit a real configuration
 * value inline; `child` opens a full panel; `action` runs on Enter only;
 * `planned` is a truthful placeholder that never mutates anything.
 */
export type SettingsRow = SettingsRowBase & (
  | {control: 'enum'; options: readonly string[]; index: (config: PromptConfiguration) => number;
    select: (config: PromptConfiguration, index: number) => PromptConfiguration; destination?: SettingsDestination}
  | {control: 'boolean'; get: (config: PromptConfiguration) => boolean;
    set: (config: PromptConfiguration, value: boolean) => PromptConfiguration}
  | {control: 'child'; destination: SettingsDestination; value?: (config: PromptConfiguration) => string}
  | {control: 'action'; actionLabel: string; destination: SettingsDestination}
  | {control: 'planned'}
);

function withTranscript(config: PromptConfiguration, patch: Partial<TranscriptAppearance>): PromptConfiguration {
  return {...config, transcript: {...config.transcript, ...patch}};
}

function enumRow<T>(row: SettingsRowBase & {values: readonly T[]; labels: readonly string[];
  get: (config: PromptConfiguration) => T; set: (config: PromptConfiguration, value: T) => PromptConfiguration;
  destination?: SettingsDestination}): SettingsRow {
  const {values, labels, get, set, ...base} = row;
  return {...base, control: 'enum', options: labels,
    index: config => Math.max(0, values.indexOf(get(config))),
    select: (config, index) => set(config, values[index]!)};
}

function planned(category: SettingsCategory): SettingsRow {
  return {id: category.toLowerCase(), label: category, description: 'Planned for v0.4', category, control: 'planned'};
}

const GLYPH_STYLES: readonly GlyphStyle[] = ['nerd', 'safe'];
const DENSITIES: readonly DividerDensity[] = ['normal', 'compact'];
const COLOR_MODES: readonly HistoryColorMode[] = ['followPrompt', 'theme', 'grayscale'];

export const SETTINGS_ROWS: readonly SettingsRow[] = [
  enumRow({id: 'glyphStyle', label: 'Glyph style', description: 'Choose Nerd Font or safe terminal symbols', category: 'General',
    values: GLYPH_STYLES, labels: ['Nerd Font', 'Safe / ASCII'], destination: 'glyph',
    get: config => config.glyphStyle, set: (config, glyphStyle) => ({...config, glyphStyle, glyphChoiceComplete: true})}),
  {id: 'appearance', label: 'Appearance', description: 'Terminal opacity and blur', category: 'General',
    control: 'child', destination: 'appearance'},
  {id: 'prompt', label: 'Prompt', description: 'Provider, theme, layout, and modules', category: 'Prompt',
    control: 'child', destination: 'prompt', value: config => providerLabel(config.provider)},
  {id: 'transcript', label: 'Transcript', description: 'History colors, dividers, and prompt snapshots', category: 'Transcript',
    control: 'child', destination: 'transcript'},
  {id: 'divider', label: 'History divider', description: 'Rule drawn above each past command', category: 'Transcript',
    control: 'boolean', get: config => config.transcript.divider, set: (config, divider) => withTranscript(config, {divider})},
  enumRow({id: 'dividerDensity', label: 'Divider density', description: 'Spacing around history dividers', category: 'Transcript',
    values: DENSITIES, labels: ['Normal', 'Compact'],
    get: config => config.transcript.dividerDensity, set: (config, dividerDensity) => withTranscript(config, {dividerDensity})}),
  {id: 'historicalPrompt', label: 'Prompt snapshots', description: 'Show the prompt each past command ran under', category: 'Transcript',
    control: 'boolean', get: config => config.transcript.historicalPrompt,
    set: (config, historicalPrompt) => withTranscript(config, {historicalPrompt})},
  enumRow({id: 'historyColors', label: 'History colors', description: 'How past prompt snapshots are colored', category: 'Transcript',
    values: COLOR_MODES, labels: ['Follow prompt', 'Theme', 'Grayscale'],
    get: config => config.transcript.historyColors, set: (config, historyColors) => withTranscript(config, {historyColors})}),
  planned('Layout'), planned('Blocks'), planned('Syntax'), planned('Tools'),
  planned('Completion'), planned('Chroma'), planned('Updates'),
  {id: 'keyboard', label: 'Keyboard', description: 'Terminal key bindings', category: 'Keyboard',
    control: 'child', destination: 'keyboard'},
];

/** Current tab rows, or every row whose label, description, or category matches the query. */
export function visibleSettingsRows(state: SettingsPanelState, rows: readonly SettingsRow[] = SETTINGS_ROWS): SettingsRow[] {
  const query = state.searchQuery?.trim().toLowerCase();
  if (query) return rows.filter(row =>
    [row.label, row.description, row.category].some(text => text.toLowerCase().includes(query)));
  return rows.filter(row => row.category === SETTINGS_SECTIONS[state.selectedIndex]);
}

export function selectedSettingsRow(state: SettingsPanelState): SettingsRow | undefined {
  return visibleSettingsRows(state)[state.contentIndex ?? 0];
}

export function settingsItemCount(state: SettingsPanelState): number {
  return state.section === 'root' ? visibleSettingsRows(state).length : 2;
}

/** ←/→ on an enum or boolean row; undefined when the row has nothing to change inline. */
export function adjustSettingsRow(row: SettingsRow, config: PromptConfiguration, delta: -1 | 1): PromptConfiguration | undefined {
  if (row.control === 'boolean') return row.set(config, !row.get(config));
  if (row.control !== 'enum') return undefined;
  return row.select(config, (row.index(config) + delta + row.options.length) % row.options.length);
}

/** Space: booleans only. */
export function toggleSettingsRow(row: SettingsRow, config: PromptConfiguration): PromptConfiguration | undefined {
  return row.control === 'boolean' ? row.set(config, !row.get(config)) : undefined;
}

/** Enter: where a row leads, if anywhere. Booleans toggle instead; planned rows do nothing. */
export function settingsRowDestination(row: SettingsRow): SettingsDestination | undefined {
  return row.control === 'child' || row.control === 'action' || row.control === 'enum' ? row.destination : undefined;
}

export function settingsRowValue(row: SettingsRow, config: PromptConfiguration): string | undefined {
  switch (row.control) {
    case 'enum': return row.options[row.index(config)];
    case 'boolean': return row.get(config) ? 'On' : 'Off';
    case 'child': return row.value?.(config);
    case 'action': return row.actionLabel;
    case 'planned': return 'Planned';
  }
}

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const ACCENT = foreground(UI_COLORS.accent);
const SUBTLE = foreground(UI_COLORS.subtle);
const BOLD = '\u001B[1m';
const ITALIC = '\u001B[3m';
const INVERSE = '\u001B[7m';
const RESET = '\u001B[0m';
/** Search matches: a lavender wash, deliberately unlike the accent-bold selected row. */
export const SEARCH_MATCH = `${background(UI_COLORS.selection)}${PRIMARY}`;

/** The value/affordance cell at the right edge of a row. */
function renderValue(row: SettingsRow, config: PromptConfiguration, selected: boolean): string {
  const value = settingsRowValue(row, config) ?? '';
  switch (row.control) {
    case 'enum':
      return selected
        ? `${SUBTLE}‹ ${BOLD}${ACCENT}${value}${RESET}${SUBTLE} ›${RESET}`
        : `${SECONDARY}${value}${RESET}`;
    case 'boolean':
      return `${selected ? BOLD : ''}${row.get(config) ? ACCENT : SUBTLE}${value}${RESET}`;
    case 'child':
      return `${SECONDARY}${value}${value ? ' ' : ''}${selected ? ACCENT : SUBTLE}›${RESET}`;
    case 'action':
      return `${selected ? ACCENT : SUBTLE}${value} ↵${RESET}`;
    case 'planned':
      return `${ITALIC}${SUBTLE}${value}${RESET}`;
  }
}

/**
 * A two-level row: label and right-aligned value, then a muted description.
 * The value survives narrow widths; the label and description truncate first.
 */
function renderRow(row: SettingsRow, config: PromptConfiguration, selected: boolean, columns: number,
  query: string, withDescription: boolean): string[] {
  const planned = row.control === 'planned';
  const marker = selected ? `${ACCENT}${GLYPHS.selection}${RESET}` : ' ';
  const labelStyle = planned ? SUBTLE : selected ? `${BOLD}${ACCENT}` : PRIMARY;
  const value = renderValue(row, config, selected);
  const valueWidth = displayWidth(value);
  const labelRoom = Math.max(1, columns - 4 - valueWidth - 3);
  const label = truncateAnsi(highlightMatches(row.label, query, labelStyle, SEARCH_MATCH) + RESET, labelRoom);
  const pad = Math.max(1, columns - 4 - displayWidth(label) - valueWidth - 1);
  const first = `  ${marker} ${label}${' '.repeat(pad)}${value}`;
  if (!withDescription) return [first];
  const category = query ? `${highlightMatches(row.category, query, SUBTLE, SEARCH_MATCH)}${SUBTLE} · ` : '';
  const description = `    ${category}${highlightMatches(row.description, query, SUBTLE, SEARCH_MATCH)}${RESET}`;
  return [first, truncateAnsi(description, columns)];
}

function renderSearchRow(state: SettingsPanelState, columns: number, matches: number): string {
  const query = state.searchQuery ?? '';
  const count = query.trim() ? `${SUBTLE}${matches} ${matches === 1 ? 'result' : 'results'}${RESET}` : '';
  let field: string;
  if (state.searchFocused) {
    field = `  ${ACCENT}${GLYPHS.search}  ${PRIMARY}${query}${INVERSE} ${RESET}${query ? '' : `${SUBTLE}Search settings…${RESET}`}`;
  } else if (query) {
    field = `  ${SUBTLE}${GLYPHS.search}  ${SECONDARY}${query}${RESET}`;
  } else {
    field = `  ${SUBTLE}${GLYPHS.search}  Search settings…${RESET}`;
  }
  const pad = columns - displayWidth(field) - displayWidth(count) - 2;
  return pad >= 2 && count ? `${field}${' '.repeat(pad)}${count}` : field;
}

function settingsHints(state: SettingsPanelState, row: SettingsRow | undefined): string {
  const query = Boolean(state.searchQuery?.trim());
  if (state.searchFocused) {
    const hints: Array<[string, string]> = [['Type', 'Search'], ['↑↓', 'Results']];
    if (row && settingsRowDestination(row)) hints.push(['Enter', row.control === 'enum' ? 'Preview' : 'Open']);
    hints.push(['Esc', 'Clear']);
    return renderHints(hints);
  }
  const hints: Array<[string, string]> = [['↑↓', 'Navigate']];
  if (row?.control === 'enum') hints.push(['←→', 'Change']);
  if (row?.control === 'boolean') hints.push(['Space', 'Toggle']);
  if (row && settingsRowDestination(row)) hints.push(['Enter', row.control === 'enum' ? 'Preview' : row.control === 'action' ? row.actionLabel : 'Open']);
  hints.push(['Tab', 'Tabs'], ['/', 'Search'], ['Esc', query ? 'Clear' : 'Close']);
  return renderHints(hints);
}

export function renderSettingsPanel(state: SettingsPanelState, columns: number, maxRows = Infinity,
  configuration: PromptConfiguration = {...DEFAULT_PROMPT_CONFIGURATION, glyphStyle: state.glyphStyle}): string[] {
  if (state.section === 'appearance') {
    const item = (selected: boolean, label: string) =>
      `${selected ? ACCENT : SECONDARY}${selected ? '›' : ' '} ${label}${RESET}`;
    const content = [
      `${SUBTLE}  Choose the preview that renders correctly in this terminal.${RESET}`,
      `${SUBTLE}  NMSh cannot read the font selected by your terminal.${RESET}`, '',
      item(state.selectedIndex === 0, `Nerd Font    ~/Projects   main   node ${state.glyphStyle === 'nerd' ? '  ✓' : ''}`),
      item(state.selectedIndex === 1, `Safe / ASCII   < ~/Projects > git: main > node >${state.glyphStyle === 'safe' ? '  ✓' : ''}`),
    ];
    return renderPanelShell({title: state.onboarding ? 'Terminal glyph style' : 'Glyph style', content, columns,
      footer: renderHints([['↑↓', 'Choose'], ['Enter', 'Save'], ['Esc', state.onboarding ? 'Use current' : 'Back']])});
  }

  const rows = visibleSettingsRows(state);
  const selected = Math.min(state.contentIndex ?? 0, Math.max(0, rows.length - 1));
  const query = state.searchQuery?.trim() ?? '';
  // Separator, title, tabs, search, and footer, each with a spacer: 10 rows.
  // Short terminals drop spacers, then the footer, then descriptions.
  const spacious = maxRows - 10 >= 2;
  const budget = spacious ? maxRows - 10 : Math.max(1, maxRows - 4);
  const perRow = (description: boolean, gap: boolean) => (description ? 2 : 1) + (gap ? 1 : 0);
  const withDescription = budget >= 2;
  const gap = spacious && rows.length * perRow(withDescription, true) - 1 <= budget;
  const size = perRow(withDescription, gap);
  const visible = Math.max(1, Math.floor((budget + (gap ? 1 : 0)) / size));
  const start = Math.max(0, Math.min(selected - Math.floor(visible / 2), rows.length - visible));
  const content: string[] = [];
  rows.slice(start, start + visible).forEach((row, offset) => {
    if (gap && offset > 0) content.push('');
    content.push(...renderRow(row, configuration, start + offset === selected, columns, query, withDescription));
  });
  if (rows.length === 0) content.push(`    ${SUBTLE}No settings match "${state.searchQuery?.trim()}"${RESET}`);
  if (!spacious) {
    const compact = framePanel([`${BOLD}${PRIMARY}  Settings${RESET}`,
      renderTabStrip(SETTINGS_SECTIONS, state.selectedIndex, columns),
      renderSearchRow(state, columns, rows.length), ...content], columns);
    return compact.slice(0, Math.max(1, maxRows)).map(row => truncateAnsi(row, columns));
  }
  return renderPanelShell({title: 'Settings', tabs: SETTINGS_SECTIONS, selectedTab: state.selectedIndex,
    searchRow: renderSearchRow(state, columns, rows.length), content, columns,
    footer: settingsHints(state, rows[selected])});
}
