import type {GlyphStyle} from '../prompt/configuration.js';
import {foreground, UI_COLORS} from './palette.js';
import {renderControls} from './controls.js';
import {renderPanelShell} from './PanelShell.js';

export type SettingsSection = 'root' | 'appearance';
export interface SettingsPanelState {
  section: SettingsSection;
  /** Selected top tab in root, selected glyph choice in appearance. */
  selectedIndex: number;
  contentIndex?: number;
  searchQuery?: string;
  glyphStyle: GlyphStyle;
  onboarding: boolean;
}

export const SETTINGS_SECTIONS = [
  'General', 'Prompt', 'Transcript', 'Layout', 'Blocks', 'Syntax',
  'Tools', 'Completion', 'Chroma', 'Updates', 'Keyboard',
] as const;

export type SettingsDestination = 'glyph' | 'appearance' | 'prompt' | 'transcript' | 'keyboard' | 'planned';
export interface SettingsEntry {
  name: string;
  description: string;
  category: string;
  destination: SettingsDestination;
}

const ENTRIES: readonly SettingsEntry[] = [
  {name: 'Glyph style', description: 'Choose Nerd Font or safe terminal symbols', category: 'General', destination: 'glyph'},
  {name: 'Appearance', description: 'Terminal opacity and blur', category: 'General', destination: 'appearance'},
  {name: 'Prompt', description: 'Provider, theme, layout, and modules', category: 'Prompt', destination: 'prompt'},
  {name: 'Transcript', description: 'History colors, dividers, and prompt snapshots', category: 'Transcript', destination: 'transcript'},
  {name: 'Layout', description: 'Planned for v0.4', category: 'Layout', destination: 'planned'},
  {name: 'Blocks', description: 'Planned for v0.4', category: 'Blocks', destination: 'planned'},
  {name: 'Syntax', description: 'Planned for v0.4', category: 'Syntax', destination: 'planned'},
  {name: 'Tools', description: 'Planned for v0.4', category: 'Tools', destination: 'planned'},
  {name: 'Completion', description: 'Planned for v0.4', category: 'Completion', destination: 'planned'},
  {name: 'Chroma', description: 'Planned for v0.4', category: 'Chroma', destination: 'planned'},
  {name: 'Updates', description: 'Planned for v0.4', category: 'Updates', destination: 'planned'},
  {name: 'Keyboard', description: 'Terminal key bindings', category: 'Keyboard', destination: 'keyboard'},
];

const SECONDARY = foreground(UI_COLORS.secondary);
const ACCENT = foreground(UI_COLORS.accent);
const SUBTLE = foreground(UI_COLORS.subtle);
const RESET = '\u001B[0m';

export function visibleSettingsEntries(state: SettingsPanelState): SettingsEntry[] {
  const query = state.searchQuery?.trim().toLowerCase();
  if (query) return ENTRIES.filter(entry =>
    `${entry.name} ${entry.description} ${entry.category}`.toLowerCase().includes(query));
  return ENTRIES.filter(entry => entry.category === SETTINGS_SECTIONS[state.selectedIndex]);
}

export function settingsItemCount(state: SettingsPanelState): number {
  return state.section === 'root' ? visibleSettingsEntries(state).length : 2;
}

export function renderSettingsPanel(state: SettingsPanelState, columns: number, maxRows = Infinity): string[] {
  const item = (selected: boolean, label: string) =>
    `${selected ? ACCENT : SECONDARY}${selected ? '›' : ' '} ${label}${RESET}`;
  if (state.section === 'appearance') {
    const content = [
      `${SUBTLE}  Choose the preview that renders correctly in this terminal.${RESET}`,
      `${SUBTLE}  NMSh cannot read the font selected by your terminal.${RESET}`, '',
      item(state.selectedIndex === 0, `Nerd Font    ~/Projects   main   node ${state.glyphStyle === 'nerd' ? '  ✓' : ''}`),
      item(state.selectedIndex === 1, `Safe / ASCII   < ~/Projects > git: main > node >${state.glyphStyle === 'safe' ? '  ✓' : ''}`),
    ];
    return renderPanelShell({title: state.onboarding ? 'Terminal glyph style' : 'Glyph style', content, columns,
      footer: renderControls([['↑↓', 'move'], ['Enter', 'save'], ['Esc', state.onboarding ? 'use current' : 'back']])});
  }

  const entries = visibleSettingsEntries(state);
  const selected = Math.min(state.contentIndex ?? 0, Math.max(0, entries.length - 1));
  const available = Math.max(1, maxRows - 7);
  const start = Math.max(0, Math.min(selected, entries.length - available));
  const content = entries.length
    ? entries.slice(start, start + available).map((entry, offset) => item(start + offset === selected,
      `${entry.name}  ${SUBTLE}${entry.description}${SECONDARY}`))
    : [`${SUBTLE}  No matching settings${RESET}`];
  return renderPanelShell({title: 'Settings', tabs: SETTINGS_SECTIONS, selectedTab: state.selectedIndex,
    search: state.searchQuery ?? '', content, columns,
    footer: renderControls([['Tab/Shift+Tab', 'tabs'], ['↑↓', 'move'], ['Enter', 'open'], ['Esc', state.searchQuery ? 'clear search' : 'close']])});
}
