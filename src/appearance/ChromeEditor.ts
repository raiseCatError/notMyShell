import type {Key} from '../terminal/keys.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {colorEscape} from '../chroma/escape.js';
import {hexColor, parseHexColor} from '../chroma/color.js';
import {colorPickerKey, createColorPicker, renderColorPicker, type ColorPickerState} from '../ui/ColorPicker.js';
import {framePanel} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {truncateAnsi} from '../util/text.js';
import {ROLE_LABELS, UI_THEME_ROLES, type UiThemeRole} from './customTheme.js';

/**
 * Custom UI chrome colors: the semantic interface roles NMSh derives its
 * frames, rules, tabs, selection and accents from. Edits stay a draft until
 * Save; Esc leaves the saved chrome untouched.
 */
export interface ChromeEditorState {
  colors: Record<UiThemeRole, string>;
  selected: number;
  picker?: {role: UiThemeRole; state: ColorPickerState};
}

export const CHROME_EDITOR_MIN_SIZE = {columns: 48, rows: 16} as const;

export function createChromeEditor(colors: Record<UiThemeRole, string>): ChromeEditorState {
  return {colors: {...colors}, selected: 0};
}

/** Rows: one per role, then Save. */
const ROW_COUNT = UI_THEME_ROLES.length + 1;

export function chromeEditorKey(state: ChromeEditorState, key: Key, level: ColorLevel): {kind: 'save'; colors: Record<UiThemeRole, string>} | {kind: 'cancel'} | undefined {
  if (state.picker) {
    const outcome = colorPickerKey(state.picker.state, key, level);
    if (outcome === 'confirm') { state.colors[state.picker.role] = hexColor(state.picker.state.color); state.picker = undefined; }
    else if (outcome === 'cancel') state.picker = undefined;
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'cancel'};
  if (key.kind === 'up') state.selected = (state.selected + ROW_COUNT - 1) % ROW_COUNT;
  else if (key.kind === 'down') state.selected = (state.selected + 1) % ROW_COUNT;
  else if (key.kind === 'enter') {
    const role = UI_THEME_ROLES[state.selected];
    if (!role) return {kind: 'save', colors: {...state.colors}};
    state.picker = {role, state: createColorPicker(state.colors[role], level)};
  }
  return undefined;
}

export function renderChromeEditor(state: ChromeEditorState, columns: number, height: number, level: ColorLevel): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001B[0m';
  const out = [`  ${primary}UI chrome colors${reset}  ${subtle}frames, rules, tabs, selection and accents · NMSh only${reset}`, ''];
  if (state.picker) {
    out.push(...renderColorPicker(state.picker.state, ROLE_LABELS[state.picker.role], columns, level,
      {columns: Math.min(40, columns - 8), rows: Math.max(3, Math.min(8, height - 16))}));
  } else {
    UI_THEME_ROLES.forEach((role, index) => {
      const selected = index === state.selected;
      const swatch = level === 'none' ? '' : `${colorEscape(48, parseHexColor(state.colors[role])!, level)}  ${reset} `;
      out.push(`${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${selected ? primary : secondary}${ROLE_LABELS[role].padEnd(16)}${reset}${swatch}${state.colors[role]}`);
    });
    const onSave = state.selected === UI_THEME_ROLES.length;
    out.push(`${onSave ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${onSave ? primary : secondary}Save & use${reset}  ${subtle}applies to NMSh chrome now${reset}`);
    out.push('', renderControls([['↑↓', 'select'], ['Enter', 'edit / save'], ['Esc', 'cancel']]));
  }
  return framePanel(out.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
}
