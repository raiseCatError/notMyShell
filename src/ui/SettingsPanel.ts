import type {GlyphStyle} from '../prompt/configuration.js';
import {foreground, UI_COLORS} from './palette.js';
import {renderControls} from './controls.js';

export type SettingsSection = 'root' | 'appearance';
export interface SettingsPanelState {
  section: SettingsSection;
  selectedIndex: number;
  glyphStyle: GlyphStyle;
  onboarding: boolean;
}

export const SETTINGS_SECTIONS = [
  'Appearance', 'Prompt', 'Transcript', 'Layout', 'Blocks', 'Syntax',
  'Tools', 'Completion', 'Chroma', 'Updates', 'Keyboard',
] as const;

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const ACCENT = foreground(UI_COLORS.accent);
const SUBTLE = foreground(UI_COLORS.subtle);
const RESET = '\u001B[0m';

export function settingsItemCount(state: SettingsPanelState): number {
  return state.section === 'root' ? SETTINGS_SECTIONS.length : 2;
}

export function renderSettingsPanel(state: SettingsPanelState, maxRows = Infinity): string[] {
  const item = (index: number, label: string) =>
    `${index === state.selectedIndex ? ACCENT : SECONDARY}${index === state.selectedIndex ? '›' : ' '} ${label}${RESET}`;
  const rows = [`${PRIMARY}  ${state.onboarding ? 'Terminal glyph style' : state.section === 'root' ? 'Settings' : 'Appearance'}${RESET}`, ''];
  if (state.section === 'root') {
    const visibleCount = Math.max(1, Math.min(SETTINGS_SECTIONS.length, maxRows - 4));
    const start = Math.max(0, Math.min(state.selectedIndex, SETTINGS_SECTIONS.length - visibleCount));
    SETTINGS_SECTIONS.slice(start, start + visibleCount).forEach((section, offset) => {
      const index = start + offset;
      rows.push(item(index,
        `${section}${['Appearance', 'Prompt', 'Transcript', 'Keyboard'].includes(section) ? '' : `  ${SUBTLE}Planned for v0.4${SECONDARY}`}`));
    });
    rows.push('', renderControls([['↑↓', 'move'], ['Enter', 'open'], ['Esc', 'close']]));
  } else {
    rows.push(`${SUBTLE}  Choose the preview that renders correctly in this terminal.${RESET}`);
    rows.push(`${SUBTLE}  NMSh cannot read the font selected by your terminal.${RESET}`, '');
    rows.push(item(0, `Nerd Font    ~/Projects   main   node ${state.glyphStyle === 'nerd' ? '  ✓' : ''}`));
    rows.push(item(1, `Safe / ASCII   < ~/Projects > git: main > node >${state.glyphStyle === 'safe' ? '  ✓' : ''}`));
    rows.push('', renderControls([['↑↓', 'move'], ['Enter', 'save'], ['Esc', state.onboarding ? 'use current' : 'back']]));
  }
  return rows;
}
