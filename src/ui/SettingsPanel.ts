import {
  DEFAULT_PROMPT_CONFIGURATION,
  type DividerDensity,
  type GlyphStyle,
  type HistoryColorMode,
  type PromptConfiguration,
  type TranscriptAppearance,
} from '../prompt/configuration.js';
import {providerLabel} from '../prompt/PromptPanel.js';
import {foreground, UI_COLORS} from './palette.js';
import {GLYPHS, getCurrentGlyphMode} from './glyphs.js';
import {framePanel, renderTabStrip} from './PanelShell.js';
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
export type SettingsDestination = 'glyph' | 'appearance' | 'prompt' | 'transcript' | 'keyboard';

interface SettingsRowBase {
  id: string;
  label: string;
  description: string;
  /** Search also matches the area a row belongs to. */
  category: string;
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

/** Config: the flat list of real, inline-editable values (plus the prompt provider, edited in its panel). */
export const SETTINGS_ROWS: readonly SettingsRow[] = [
  enumRow({id: 'glyphStyle', label: 'Glyph style', description: 'Nerd Font or safe terminal symbols', category: 'General',
    values: GLYPH_STYLES, labels: ['Nerd Font', 'Safe / ASCII'],
    get: config => config.glyphStyle, set: (config, glyphStyle) => ({...config, glyphStyle, glyphChoiceComplete: true})}),
  {id: 'provider', label: 'Prompt provider', description: 'Provider, theme, layout, and modules', category: 'Prompt',
    control: 'child', destination: 'prompt', value: config => providerLabel(config.provider)},
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
];

/** Settings: entry points to the richer panels. Their values live in Config / the panels themselves. */
export const SETTINGS_ENTRIES: readonly SettingsRow[] = [
  {id: 'appearance', label: 'Appearance', description: 'Terminal opacity and blur', category: 'General', control: 'child', destination: 'appearance'},
  {id: 'glyphPreview', label: 'Glyph style', description: 'Compare Nerd Font and safe symbols', category: 'General', control: 'child', destination: 'glyph'},
  {id: 'prompt', label: 'Prompt', description: 'Provider, theme, layout, and modules', category: 'Prompt', control: 'child', destination: 'prompt'},
  {id: 'transcript', label: 'Transcript', description: 'History colors, dividers, and prompt snapshots', category: 'Transcript', control: 'child', destination: 'transcript'},
  {id: 'keyboard', label: 'Keyboard', description: 'Terminal key bindings', category: 'Keyboard', control: 'child', destination: 'keyboard'},
];

export const PLANNED_AREAS = ['Layout', 'Blocks', 'Syntax', 'Tools', 'Completion', 'Chroma', 'Updates'] as const;

export function visibleSettingsRows(state: SettingsPanelState): SettingsRow[] {
  const view = settingsView(state);
  if (view === 'status') return [];
  if (view === 'settings') return [...SETTINGS_ENTRIES];
  const query = state.searchQuery?.trim().toLowerCase();
  if (!query) return [...SETTINGS_ROWS];
  return SETTINGS_ROWS.filter(row => [row.label, row.description, row.category].some(text => text.toLowerCase().includes(query)));
}

export function selectedSettingsRow(state: SettingsPanelState): SettingsRow | undefined {
  return state.focus === 'tabs' ? undefined : visibleSettingsRows(state)[state.contentIndex ?? 0];
}

export function settingsItemCount(state: SettingsPanelState): number {
  return state.section === 'root' ? visibleSettingsRows(state).length : 2;
}

export function isInlineEditable(row: SettingsRow | undefined): boolean {
  return row?.control === 'enum' || row?.control === 'boolean';
}

/** ←/→ on an enum or boolean row; undefined when the row has nothing to change inline. */
export function adjustSettingsRow(row: SettingsRow, config: PromptConfiguration, delta: -1 | 1): PromptConfiguration | undefined {
  if (row.control === 'boolean') return row.set(config, !row.get(config));
  if (row.control !== 'enum') return undefined;
  return row.select(config, (row.index(config) + delta + row.options.length) % row.options.length);
}

/** Enter/Space: toggle a boolean or step an enum forward. */
export function toggleSettingsRow(row: SettingsRow, config: PromptConfiguration): PromptConfiguration | undefined {
  return adjustSettingsRow(row, config, 1);
}

/** Enter on a row that opens something. */
export function settingsRowDestination(row: SettingsRow): SettingsDestination | undefined {
  return row.control === 'child' || row.control === 'action' ? row.destination : undefined;
}

export function settingsRowValue(row: SettingsRow, config: PromptConfiguration): string | undefined {
  switch (row.control) {
    case 'enum': return row.options[row.index(config)];
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
/** Search matches: lavender bold text only, unlike the pointer + bright label of the selected row. */
export const SEARCH_MATCH = `${BOLD}${ACCENT}`;

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
    const label = truncateAnsi(highlightMatches(row.label, query, active ? `${BOLD}${PRIMARY}` : PRIMARY, SEARCH_MATCH) + RESET, room);
    const pad = Math.max(2, labelColumn - displayWidth(label));
    out.push(truncateAnsi(`${MARGIN}${pointer} ${label}${' '.repeat(pad)}${valueStyled}`, columns));
  });
  if (start > 0) out[0] = `${MARGIN}  ${SUBTLE}↑ ${start + 1} more${RESET}`;
  const below = rows.length - (start + visible);
  if (below > 0) out[out.length - 1] = `${MARGIN}  ${SUBTLE}↓ ${below + 1} more${RESET}`;
  return out;
}

function footerText(state: SettingsPanelState, row: SettingsRow | undefined): string {
  const view = settingsView(state);
  if (state.searchFocused) return '↑↓ results · Enter select · Esc clear';
  if (view === 'status') return '←/→ to switch · ↑↓ to scroll · Esc to close';
  if (state.focus === 'tabs') return '←/→ to switch · ↓ to select · Esc to close';
  const search = view === 'config' ? ' · / to search' : '';
  const escape = state.searchQuery?.trim() ? 'Esc to clear' : 'Esc to close';
  if (isInlineEditable(row)) return `Enter/Space to change${search} · ${escape}`;
  if (row) return `Enter to open · ←/→ to switch${search} · ${escape}`;
  return `←/→ to switch${search} · ${escape}`;
}

function toneColor(tone: StatusItem['tone']): string {
  return tone === 'success' ? foreground(UI_COLORS.success)
    : tone === 'warning' ? foreground(UI_COLORS.failure)
      : tone === 'muted' ? SUBTLE : PRIMARY;
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
  const footer = ['', `${MARGIN}${SUBTLE}${footerText(state, selectedRow)}${RESET}`];
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
        row => settingsRowValue(row, config) ?? '', listBudget));
      if (selectedRow && listBudget - rows.length >= 2) {
        body.push('', `${MARGIN}  ${highlightMatches(selectedRow.description, query, SUBTLE, SEARCH_MATCH)}${RESET}`);
      }
    } else body.push(`${MARGIN}  ${SUBTLE}No settings match "${query}"${RESET}`);
  }
  const out = framePanel([...header, ...body, ...(tight ? [] : footer)], columns);
  return out.slice(0, Math.max(1, maxRows)).map(row => truncateAnsi(row, columns));
}
