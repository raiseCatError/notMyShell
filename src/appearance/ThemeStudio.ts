import {mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import type {Key} from '../terminal/keys.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {colorEscape} from '../chroma/escape.js';
import {parseHexColor} from '../chroma/color.js';
import {THEME_PALETTE_IDS, type NativePaletteId} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {editText} from '../ui/formControls.js';
import {framePanel} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {colorPickerKey, createColorPicker, renderColorPicker, type ColorPickerState} from '../ui/ColorPicker.js';
import {padCells, truncateAnsi} from '../util/text.js';
import {
  exportTheme, importTheme, PROMPT_THEME_ROLES, ROLE_LABELS, themeSlug, UI_THEME_ROLES, type CustomTheme, type PromptThemeRole,
  type ThemeImport, type UiThemeRole,
} from './customTheme.js';
import {cloneFromPalette} from './themeSelection.js';
import {defaultUiColors} from './uiTheme.js';
import {hexColor} from '../chroma/color.js';

/**
 * Theme Studio: the custom Native theme editor behind /theme. It edits a
 * draft; Save applies it as the Custom theme through the normal configuration
 * path, Esc discards. Import validates and previews before anything is used;
 * Export writes NMSh Theme JSON. Imported data is never executed.
 */

type StudioRow =
  | {kind: 'name'}
  | {kind: 'basedOn'}
  | {kind: 'dark'}
  | {kind: 'role'; group: 'prompt' | 'ui'; role: PromptThemeRole | UiThemeRole}
  | {kind: 'import'}
  | {kind: 'export'}
  | {kind: 'reset'}
  | {kind: 'save'};

export const STUDIO_ROWS: readonly StudioRow[] = [
  {kind: 'name'}, {kind: 'basedOn'}, {kind: 'dark'},
  ...PROMPT_THEME_ROLES.map(role => ({kind: 'role' as const, group: 'prompt' as const, role})),
  ...UI_THEME_ROLES.map(role => ({kind: 'role' as const, group: 'ui' as const, role})),
  {kind: 'import'}, {kind: 'export'}, {kind: 'reset'}, {kind: 'save'},
];

export interface ThemeStudioState {
  draft: CustomTheme;
  /** The custom theme in effect when the studio opened, if any. */
  saved?: CustomTheme;
  selected: number;
  /** The clone source shown on the Based on row; Enter clones it. */
  base: NativePaletteId;
  picker?: {row: StudioRow & {kind: 'role'}; state: ColorPickerState};
  editingName?: string;
  importPath?: string;
  importPreview?: ThemeImport;
  message?: string;
  /** A pending Reset to base that would discard unsaved draft edits. */
  confirmReset?: boolean;
}

export const STUDIO_MIN_SIZE = {columns: 56, rows: 18} as const;

export function createThemeStudio(current: CustomTheme | undefined, palette: NativePaletteId): ThemeStudioState {
  const draft = current ? structuredClone(current) : cloneFromPalette(palette);
  // An existing custom theme resets to the theme it was based on, found by its recorded name.
  const recorded = current?.basedOn ? THEME_PALETTE_IDS.find(id => id !== 'custom' && NATIVE_PROMPT_THEMES[id].label === current.basedOn) : undefined;
  return {draft, ...(current ? {saved: structuredClone(current)} : {}), selected: 0, base: recorded ?? (palette === 'custom' ? 'lavender' : palette)};
}

export function themeDefaults(): Record<UiThemeRole, string> {
  const ui = defaultUiColors();
  return {accent: hexColor(ui.accent), primary: hexColor(ui.primary), secondary: hexColor(ui.secondary), subtle: hexColor(ui.subtle),
    separator: hexColor(ui.separator), selection: hexColor(ui.selection), success: hexColor(ui.success), warning: '#d99a3e',
    failure: hexColor(ui.failure), info: '#4fb3c4'};
}

/** Where exports go: the NMSh config directory, never anywhere the user did not choose. */
export function themesDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return join(nmshConfigDirectory(env), 'themes');
}

export function writeThemeExport(theme: CustomTheme, directory = themesDirectory()): string {
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const path = join(directory, `${themeSlug(theme.name)}.nmsh-theme.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, exportTheme(theme), {encoding: 'utf8', mode: 0o600});
  renameSync(temporary, path);
  return path;
}

function expandPath(input: string, cwd: string): string {
  const text = input.trim();
  if (text === '~' || text.startsWith('~/')) return join(homedir(), text.slice(1));
  return isAbsolute(text) ? text : resolve(cwd, text);
}

/** Reads a theme file for preview: bounded size, parsed as data only. */
export function readThemeImport(input: string, cwd: string): ThemeImport | {errors: string[]} {
  const path = expandPath(input, cwd);
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return {errors: [`${path} is not a file.`]};
    if (stat.size > 256 * 1024) return {errors: ['File is larger than 256 KiB.']};
    return importTheme(readFileSync(path, 'utf8'), themeDefaults());
  } catch (error) {
    return {errors: [`Could not read ${path}: ${(error as NodeJS.ErrnoException).code ?? 'error'}.`]};
  }
}

/** The selected base theme's colors, keeping the draft's name. */
function baseTheme(state: ThemeStudioState): CustomTheme {
  return cloneFromPalette(state.base, undefined, state.draft.name);
}

/** Draft colors differ from the base: a reset would discard edits. */
export function draftDiffersFromBase(state: ThemeStudioState): boolean {
  const base = baseTheme(state);
  return JSON.stringify([state.draft.prompt, state.draft.ui, state.draft.dark]) !== JSON.stringify([base.prompt, base.ui, base.dark]);
}

/**
 * Reset to base: the draft's colors become the selected Based on theme again.
 * Only the draft changes; Save & use stays the one persistence point and Esc
 * still abandons everything, leaving the saved custom theme untouched.
 */
export function resetDraftToBase(state: ThemeStudioState): void {
  const base = baseTheme(state);
  state.draft = {...state.draft, prompt: base.prompt, ui: base.ui, dark: base.dark, basedOn: base.basedOn};
  state.confirmReset = false;
  state.message = `Draft reset to ${NATIVE_PROMPT_THEMES[state.base].label}. Save & use to keep it; Esc abandons the draft.`;
}

/** One role back to its base color (R on a color row). */
export function resetRoleToBase(state: ThemeStudioState, row: StudioRow & {kind: 'role'}): void {
  const base = baseTheme(state);
  if (row.group === 'prompt') state.draft.prompt[row.role as PromptThemeRole] = base.prompt[row.role as PromptThemeRole];
  else state.draft.ui[row.role as UiThemeRole] = base.ui[row.role as UiThemeRole];
  state.message = `${ROLE_LABELS[row.role]} reset to ${NATIVE_PROMPT_THEMES[state.base].label}.`;
}

export type StudioResult = {kind: 'cancel'} | {kind: 'save'; theme: CustomTheme} | {kind: 'export'} | undefined;

function roleColor(theme: CustomTheme, row: StudioRow & {kind: 'role'}): string {
  return row.group === 'prompt' ? theme.prompt[row.role as PromptThemeRole] : theme.ui[row.role as UiThemeRole];
}

export function studioKey(state: ThemeStudioState, key: Key, level: ColorLevel, cwd: string): StudioResult {
  state.message = undefined;
  if (state.picker) {
    const outcome = colorPickerKey(state.picker.state, key, level);
    if (outcome === 'confirm') {
      const hex = hexColor(state.picker.state.color);
      const row = state.picker.row;
      if (row.group === 'prompt') state.draft.prompt[row.role as PromptThemeRole] = hex;
      else state.draft.ui[row.role as UiThemeRole] = hex;
      state.picker = undefined;
    } else if (outcome === 'cancel') state.picker = undefined;
    return undefined;
  }
  if (state.editingName !== undefined) {
    if (key.kind === 'escape' || key.kind === 'interrupt') state.editingName = undefined;
    else if (key.kind === 'enter') {
      const name = state.editingName.trim();
      if (name && name.length <= 48) { state.draft.name = name; state.editingName = undefined; }
      else state.message = 'Name must be 1–48 characters.';
    } else {
      const next = editText(state.editingName, key);
      if (next !== undefined) state.editingName = next.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').slice(0, 48);
    }
    return undefined;
  }
  if (state.importPath !== undefined) {
    if (state.importPreview) {
      if (key.kind === 'enter') {
        state.draft = state.importPreview.theme;
        state.message = `Imported ${state.importPreview.theme.name}. Save to use it.`;
        state.importPreview = undefined; state.importPath = undefined;
      } else if (key.kind === 'escape' || key.kind === 'interrupt') { state.importPreview = undefined; }
      return undefined;
    }
    if (key.kind === 'escape' || key.kind === 'interrupt') state.importPath = undefined;
    else if (key.kind === 'enter') {
      const result = readThemeImport(state.importPath, cwd);
      if ('errors' in result) state.message = result.errors.join(' ');
      else state.importPreview = result;
    } else {
      const next = editText(state.importPath, key);
      if (next !== undefined) state.importPath = next;
    }
    return undefined;
  }
  if (state.confirmReset) {
    if (key.kind === 'enter' || (key.kind === 'text' && key.value.toLowerCase() === 'y')) resetDraftToBase(state);
    else if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value.toLowerCase() === 'n')) state.confirmReset = false;
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'cancel'};
  if (key.kind === 'text' && key.value.toLowerCase() === 'r' && STUDIO_ROWS[state.selected]?.kind === 'role') {
    resetRoleToBase(state, STUDIO_ROWS[state.selected] as StudioRow & {kind: 'role'});
    return undefined;
  }
  if (key.kind === 'up') state.selected = (state.selected + STUDIO_ROWS.length - 1) % STUDIO_ROWS.length;
  else if (key.kind === 'down') state.selected = (state.selected + 1) % STUDIO_ROWS.length;
  const row = STUDIO_ROWS[state.selected]!;
  if ((key.kind === 'left' || key.kind === 'right') && row.kind === 'basedOn') {
    const sources: NativePaletteId[] = THEME_PALETTE_IDS.filter(id => id !== 'custom');
    state.base = sources[(sources.indexOf(state.base) + (key.kind === 'left' ? -1 : 1) + sources.length) % sources.length]!;
  } else if ((key.kind === 'left' || key.kind === 'right' || (key.kind === 'text' && key.value === ' ')) && row.kind === 'dark') {
    state.draft.dark = !state.draft.dark;
  } else if (key.kind === 'enter') {
    switch (row.kind) {
      case 'name': state.editingName = state.draft.name; break;
      case 'basedOn':
      case 'reset':
        // Same operation from either row; unsaved edits are confirmed first.
        if (draftDiffersFromBase(state)) state.confirmReset = true;
        else resetDraftToBase(state);
        break;
      case 'dark': state.draft.dark = !state.draft.dark; break;
      case 'role': state.picker = {row, state: createColorPicker(roleColor(state.draft, row), level)}; break;
      case 'import': state.importPath = ''; break;
      case 'export': return {kind: 'export'};
      case 'save': return {kind: 'save', theme: structuredClone(state.draft)};
    }
  }
  return undefined;
}

export function renderThemeStudio(state: ThemeStudioState, columns: number, height: number, level: ColorLevel, preview: readonly string[]): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001B[0m';
  const out: string[] = [`  ${primary}Theme Studio${reset}  ${subtle}custom Native theme · colors NMSh-owned UI only${reset}`, ''];
  if (state.picker) {
    const label = `${ROLE_LABELS[state.picker.row.role]} ${subtle}(${state.picker.row.group === 'prompt' ? 'prompt' : 'interface'})${reset}`;
    out.push(...renderColorPicker(state.picker.state, label, columns, level, {columns: Math.min(40, columns - 8), rows: Math.max(3, Math.min(8, height - 16))}));
    return framePanel(out.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
  }
  if (state.importPreview) {
    const theme = state.importPreview.theme;
    out.push(`  ${primary}Import preview · ${theme.name}${reset}  ${subtle}${state.importPreview.format === 'nmsh' ? 'NMSh Theme JSON' : state.importPreview.format === 'base16' ? 'Base16' : 'Windows Terminal scheme'}${reset}`, '');
    out.push(`  ${PROMPT_THEME_ROLES.map(role => `${colorEscape(48, parseHexColor(theme.prompt[role])!, level)}  ${reset}`).join('')}  ${subtle}prompt roles${reset}`);
    out.push(`  ${UI_THEME_ROLES.map(role => `${colorEscape(48, parseHexColor(theme.ui[role])!, level)}  ${reset}`).join('')}  ${subtle}interface roles${reset}`);
    for (const warning of state.importPreview.warnings) out.push(`  ${subtle}${warning}${reset}`);
    out.push('', renderControls([['Enter', 'use as draft'], ['Esc', 'back']]));
    return framePanel(out.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
  }
  if (state.importPath !== undefined) {
    out.push(`  ${primary}Import a theme file${reset}`, `  ${subtle}NMSh Theme JSON, Base16 (YAML/JSON) or a Windows Terminal color scheme. Nothing is applied until you save.${reset}`, '',
      `  Path  ${primary}${state.importPath}${reset}${accent}_${reset}`);
    if (state.message) out.push('', `  ${secondary}${state.message}${reset}`);
    out.push('', renderControls([['Enter', 'preview'], ['Esc', 'back']]));
    return framePanel(out.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
  }
  const swatch = (hex: string) => `${colorEscape(48, parseHexColor(hex)!, level)}  ${reset}`;
  const lines = STUDIO_ROWS.map((row, index) => {
    const pointer = index === state.selected ? `${accent}${GLYPHS.selection}${reset}` : ' ';
    const label = (text: string) => `${index === state.selected ? primary : secondary}${padCells(text, 16)}${reset}`;
    switch (row.kind) {
      case 'name': return `${pointer} ${label('Name')}${state.editingName !== undefined ? `${primary}${state.editingName}${accent}_${reset}` : state.draft.name}`;
      case 'basedOn': return `${pointer} ${label('Based on')}${NATIVE_PROMPT_THEMES[state.base].label}  ${subtle}←→ choose · Enter reset draft to it${reset}`;
      case 'dark': return `${pointer} ${label('Text tiers')}${state.draft.dark ? 'Dark terminal' : 'Keep NMSh text colors'}`;
      case 'role': {
        const hex = roleColor(state.draft, row);
        return `${pointer} ${label(`${row.group === 'ui' ? 'UI ' : ''}${ROLE_LABELS[row.role]}`)}${level === 'none' ? '' : `${swatch(hex)} `}${hex}`;
      }
      case 'import': return `${pointer} ${label('Import')}${subtle}NMSh Theme JSON, Base16, Windows Terminal ›${reset}`;
      case 'export': return `${pointer} ${label('Export')}${subtle}${themesDirectory()} ›${reset}`;
      case 'reset': return `${pointer} ${label('Reset to base')}${subtle}draft colors back to ${NATIVE_PROMPT_THEMES[state.base].label}; saved theme unchanged${reset}`;
      case 'save': return `${pointer} ${label('Save & use')}${subtle}apply as the Custom theme${reset}`;
    }
  });
  // A window around the selection keeps the list usable on short terminals.
  const budget = Math.max(3, height - 7 - preview.length - (state.message ? 2 : 0));
  const start = Math.max(0, Math.min(state.selected - Math.floor(budget / 2), lines.length - budget));
  out.push(...lines.slice(start, start + budget));
  if (preview.length) out.push('', ...preview);
  if (state.confirmReset) {
    out.push('', `  ${primary}Reset the draft to ${NATIVE_PROMPT_THEMES[state.base].label}? Unsaved color edits are discarded; the saved theme is unchanged.${reset}`);
    out.push('', renderControls([['Enter', 'reset draft'], ['Esc', 'keep editing']]));
    return framePanel(out.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
  }
  if (state.message) out.push('', `  ${secondary}${state.message}${reset}`);
  const onRole = STUDIO_ROWS[state.selected]?.kind === 'role';
  out.push('', renderControls([['↑↓', 'select'], ['Enter', 'edit/open'], ['←→', 'change'], ...(onRole ? [['R', 'reset role'] as [string, string]] : []), ['Esc', 'cancel']]));
  return framePanel(out.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
}
