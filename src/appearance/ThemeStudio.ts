import {chromaPreviewNote} from './chromaNotes.js';
import {mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename, isAbsolute, join, resolve} from 'node:path';
import type {Key} from '../terminal/keys.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {colorEscape} from '../chroma/escape.js';
import {parseHexColor} from '../chroma/color.js';
import {THEME_PALETTE_IDS, type NativePaletteId} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {editText} from '../ui/formControls.js';
import {framePanel, renderTabStrip} from '../ui/PanelShell.js';
import {renderControls} from '../ui/controls.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {colorPickerKey, createColorPicker, renderColorPicker, type ColorPickerState} from '../ui/ColorPicker.js';
import {padCells, truncateAnsi, truncateText} from '../util/text.js';
import {
  exportTheme, PROMPT_THEME_ROLES, ROLE_LABELS, themeSlug, UI_THEME_ROLES, type CustomTheme, type PromptThemeRole, type UiThemeRole,
} from './customTheme.js';
import {cloneFromPalette} from './themeSelection.js';
import {defaultUiColors} from './uiTheme.js';
import {hexColor} from '../chroma/color.js';
import {categoryOf, findTheme, IMPORTER_VERSION, provenanceLabel, type ThemeAsset, type ThemeOrigin} from './themeLibrary.js';
import {assetRef, builtinRef, builtinTheme, type ThemeRef} from './themeRefs.js';
import {IMPORT_FORMAT_CHOICES, IMPORT_SIZE_LIMIT, importFormatLabel, importThemeSource, type ImportOutcome, type ImportPreview} from './themeImporters.js';
import {BRIDGE_TARGET_LABELS, type BridgeTargetId} from '../themeBridge/model.js';
import type {CatppuccinAccent} from './themeFamilies.js';

/**
 * Theme Studio (/theme): create, edit, import, manage and select NMSh Native
 * theme assets. Built-in themes are immutable; Imported and Custom themes
 * are the same Native assets edited by the same editor and rendered by the
 * same renderer (imported is provenance only). The studio never writes the
 * configuration itself: it returns actions that TerminalApp applies through
 * the library actions and the normal configuration path. Import parses and
 * previews first; cancel stores nothing.
 */

// ---- Color editor -----------------------------------------------------------

type EditorRow =
  | {kind: 'name'}
  | {kind: 'basedOn'}
  | {kind: 'dark'}
  | {kind: 'role'; group: 'prompt' | 'ui'; role: PromptThemeRole | UiThemeRole}
  | {kind: 'reset'}
  | {kind: 'save'};

export const STUDIO_ROWS: readonly EditorRow[] = [
  {kind: 'name'}, {kind: 'basedOn'}, {kind: 'dark'},
  ...PROMPT_THEME_ROLES.map(role => ({kind: 'role' as const, group: 'prompt' as const, role})),
  ...UI_THEME_ROLES.map(role => ({kind: 'role' as const, group: 'ui' as const, role})),
  {kind: 'reset'}, {kind: 'save'},
];

export interface ThemeEditorState {
  draft: CustomTheme;
  /** The asset being edited; undefined creates a new Custom theme on save. */
  assetId?: string;
  /** The asset's saved theme, if any. */
  saved?: CustomTheme;
  /** Provenance line for imported assets (display only). */
  provenance?: string;
  selected: number;
  /** The clone source shown on the Based on row; Enter clones it. */
  base: NativePaletteId;
  picker?: {row: EditorRow & {kind: 'role'}; state: ColorPickerState};
  editingName?: string;
  message?: string;
  /** A pending Reset to base that would discard unsaved draft edits. */
  confirmReset?: boolean;
}

export const STUDIO_MIN_SIZE = {columns: 56, rows: 18} as const;

/** An editor over a theme; `current` undefined starts a new Custom theme cloned from `palette`. */
export function createThemeEditor(current: CustomTheme | undefined, palette: NativePaletteId, asset?: ThemeAsset): ThemeEditorState {
  const draft = current ? structuredClone(current) : cloneFromPalette(palette);
  // An existing theme resets to the theme it was based on, found by its recorded name.
  const recorded = current?.basedOn ? THEME_PALETTE_IDS.find(id => id !== 'custom' && NATIVE_PROMPT_THEMES[id].label === current.basedOn) : undefined;
  return {draft, ...(current ? {saved: structuredClone(current)} : {}), ...(asset ? {assetId: asset.id, provenance: provenanceLabel(asset)} : {}),
    selected: 0, base: recorded ?? (palette === 'custom' ? 'lavender' : palette)};
}

/** Back-compatible name for a single editor (tests and callers that only edit). */
export const createThemeStudioEditor = createThemeEditor;

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

/**
 * Portable NMSh Theme JSON for a theme: the Native theme itself. Library
 * provenance (and so any local source path) is not part of the theme data,
 * so it can never leak into an export.
 */
export function writeThemeExport(theme: CustomTheme, directory = themesDirectory()): string {
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const path = join(directory, `${themeSlug(theme.name)}.nmsh-theme.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, exportTheme(theme), {encoding: 'utf8', mode: 0o600});
  renameSync(temporary, path);
  return path;
}

export function expandPath(input: string, cwd: string): string {
  const text = input.trim();
  if (text === '~' || text.startsWith('~/')) return join(homedir(), text.slice(1));
  return isAbsolute(text) ? text : resolve(cwd, text);
}

/** Reads a local theme file for preview: bounded size, parsed as data only, never stored here. */
export function readThemeImport(input: string, cwd: string, format: (typeof IMPORT_FORMAT_CHOICES)[number] = 'auto'): (ImportPreview & {path: string}) | {errors: string[]} {
  const path = expandPath(input, cwd);
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return {errors: [`${path} is not a file.`]};
    if (stat.size > IMPORT_SIZE_LIMIT) return {errors: ['File is larger than 256 KiB.']};
    const outcome: ImportOutcome = importThemeSource(readFileSync(path, 'utf8'), basename(path), themeDefaults(), builtinTheme('lavender'), format);
    return 'errors' in outcome ? outcome : {...outcome, path};
  } catch (error) {
    return {errors: [`Could not read ${path}: ${(error as NodeJS.ErrnoException).code ?? 'error'}.`]};
  }
}

/** Provenance recorded for an import; the path stays local (never exported). */
export function importOrigin(preview: ImportPreview & {path: string}, now = new Date()): ThemeOrigin {
  return {kind: preview.format, ...(preview.sourceName ? {sourceName: preview.sourceName} : {}), sourcePath: preview.path,
    importerVersion: IMPORTER_VERSION, importedAt: now.toISOString()};
}

function baseTheme(state: ThemeEditorState): CustomTheme {
  return cloneFromPalette(state.base, undefined, state.draft.name);
}

/** Draft colors differ from the base: a reset would discard edits. */
export function draftDiffersFromBase(state: ThemeEditorState): boolean {
  const base = baseTheme(state);
  return JSON.stringify([state.draft.prompt, state.draft.ui, state.draft.dark]) !== JSON.stringify([base.prompt, base.ui, base.dark]);
}

/** Reset to base: only the draft changes; Save stays the one persistence point and Esc abandons everything. */
export function resetDraftToBase(state: ThemeEditorState): void {
  const base = baseTheme(state);
  state.draft = {...state.draft, prompt: base.prompt, ui: base.ui, dark: base.dark, basedOn: base.basedOn};
  state.confirmReset = false;
  state.message = `Draft reset to ${NATIVE_PROMPT_THEMES[state.base].label}. Save to keep it; Esc abandons the draft.`;
}

export function resetRoleToBase(state: ThemeEditorState, row: EditorRow & {kind: 'role'}): void {
  const base = baseTheme(state);
  if (row.group === 'prompt') state.draft.prompt[row.role as PromptThemeRole] = base.prompt[row.role as PromptThemeRole];
  else state.draft.ui[row.role as UiThemeRole] = base.ui[row.role as UiThemeRole];
  state.message = `${ROLE_LABELS[row.role]} reset to ${NATIVE_PROMPT_THEMES[state.base].label}.`;
}

export type EditorResult = {kind: 'cancel'} | {kind: 'save'; theme: CustomTheme} | undefined;

function roleColor(theme: CustomTheme, row: EditorRow & {kind: 'role'}): string {
  return row.group === 'prompt' ? theme.prompt[row.role as PromptThemeRole] : theme.ui[row.role as UiThemeRole];
}

export function editorKey(state: ThemeEditorState, key: Key, level: ColorLevel): EditorResult {
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
  if (state.confirmReset) {
    if (key.kind === 'enter' || (key.kind === 'text' && key.value.toLowerCase() === 'y')) resetDraftToBase(state);
    else if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value.toLowerCase() === 'n')) state.confirmReset = false;
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'cancel'};
  if (key.kind === 'text' && key.value.toLowerCase() === 'r' && STUDIO_ROWS[state.selected]?.kind === 'role') {
    resetRoleToBase(state, STUDIO_ROWS[state.selected] as EditorRow & {kind: 'role'});
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
        if (draftDiffersFromBase(state)) state.confirmReset = true;
        else resetDraftToBase(state);
        break;
      case 'dark': state.draft.dark = !state.draft.dark; break;
      case 'role': state.picker = {row, state: createColorPicker(roleColor(state.draft, row), level)}; break;
      case 'save': return {kind: 'save', theme: structuredClone(state.draft)};
    }
  }
  return undefined;
}

const RESET = '\u001B[0m';

function swatches(colors: readonly string[], level: ColorLevel): string {
  if (level === 'none') return '';
  return colors.map(hex => `${colorEscape(48, parseHexColor(hex)!, level)}  ${RESET}`).join('');
}

export function renderThemeEditor(state: ThemeEditorState, columns: number, height: number, level: ColorLevel, preview: readonly string[], title = 'Theme Studio'): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const heading = state.assetId ? `Edit · ${state.draft.name}` : 'New custom theme';
  const out: string[] = [`  ${primary}${title} › ${heading}${RESET}  ${subtle}${state.provenance ?? 'NMSh Native theme · colors NMSh-owned UI only'}${RESET}`, ''];
  if (state.picker) {
    const label = `${ROLE_LABELS[state.picker.row.role]} ${subtle}(${state.picker.row.group === 'prompt' ? 'prompt' : 'interface'})${RESET}`;
    out.push(...renderColorPicker(state.picker.state, label, columns, level, {columns: Math.min(40, columns - 8), rows: Math.max(3, Math.min(8, height - 16))}));
    return out.map(row => truncateAnsi(row, columns));
  }
  const lines = STUDIO_ROWS.map((row, index) => {
    const pointer = index === state.selected ? `${accent}${GLYPHS.selection}${RESET}` : ' ';
    const label = (text: string) => `${focusForeground(index === state.selected)}${padCells(text, 16)}${RESET}`;
    switch (row.kind) {
      case 'name': return `${pointer} ${label('Name')}${state.editingName !== undefined ? `${primary}${state.editingName}${accent}_${RESET}` : state.draft.name}`;
      case 'basedOn': return `${pointer} ${label('Based on')}${NATIVE_PROMPT_THEMES[state.base].label}  ${subtle}←→ choose · Enter reset draft to it${RESET}`;
      case 'dark': return `${pointer} ${label('Text tiers')}${state.draft.dark ? 'Dark terminal' : 'Keep NMSh text colors'}`;
      case 'role': {
        const hex = roleColor(state.draft, row);
        return `${pointer} ${label(`${row.group === 'ui' ? 'UI ' : ''}${ROLE_LABELS[row.role]}`)}${level === 'none' ? '' : `${swatches([hex], level)} `}${hex}`;
      }
      case 'reset': return `${pointer} ${label('Reset to base')}${subtle}draft colors back to ${NATIVE_PROMPT_THEMES[state.base].label}; saved theme unchanged${RESET}`;
      case 'save': return `${pointer} ${label('Save')}${subtle}${state.assetId ? 'save this theme' : 'add to Custom themes'}${RESET}`;
    }
  });
  // A window around the selection keeps the list usable on short terminals.
  const budget = Math.max(3, height - 5 - preview.length - (state.message ? 2 : 0));
  const start = Math.max(0, Math.min(state.selected - Math.floor(budget / 2), lines.length - budget));
  out.push(...lines.slice(start, start + budget));
  if (preview.length && height - 5 - preview.length >= 3) out.push('', ...preview);
  if (state.confirmReset) {
    out.push('', `  ${primary}Reset the draft to ${NATIVE_PROMPT_THEMES[state.base].label}? Unsaved color edits are discarded; the saved theme is unchanged.${RESET}`);
    out.push('', renderControls([['Enter', 'reset draft'], ['Esc', 'keep editing']]));
    return out.map(row => truncateAnsi(row, columns));
  }
  if (state.message) out.push('', `  ${secondary}${state.message}${RESET}`);
  const onRole = STUDIO_ROWS[state.selected]?.kind === 'role';
  out.push('', renderControls([['↑↓', 'select'], ['Enter', 'edit'], ['←→', 'change'], ...(onRole ? [['R', 'reset role'] as [string, string]] : []), ['Esc', 'back']]));
  return out.map(row => truncateAnsi(row, columns));
}

// ---- Library (tabs) ---------------------------------------------------------

export const STUDIO_TABS = ['Built-in', 'Imported', 'Custom', 'Import'] as const;
export type StudioTab = 'builtin' | 'imported' | 'custom' | 'import';
const TAB_IDS: readonly StudioTab[] = ['builtin', 'imported', 'custom', 'import'];

/** What the studio sees of the configuration; it never edits it. */
export interface StudioContext {
  themes: readonly ThemeAsset[];
  activeRef?: ThemeRef;
  accent: CatppuccinAccent;
  /** Theme Bridge targets pinned to each reference, for delete warnings and labels. */
  pinnedTo: (ref: ThemeRef) => BridgeTargetId[];
  /** The persisted global Chroma, described (for the local preview switch). */
  chroma?: string;
  /** The active theme's display name (for Duplicate current). */
  activeName?: string;
}

export interface ThemeStudioState {
  tab: StudioTab;
  focus: 'tabs' | 'list';
  /** Selected row per library tab. */
  selected: Record<Exclude<StudioTab, 'import'>, number>;
  editor?: ThemeEditorState;
  rename?: {id: string; text: string};
  confirmDelete?: {id: string; name: string; pinned: BridgeTargetId[]};
  /** Import tab: format choice, path, and the parsed preview awaiting confirmation. */
  importFormat: number;
  importField: 'format' | 'path';
  importPath: string;
  importPreview?: ImportPreview & {path: string};
  message?: string;
  /**
   * Local preview only: render the preview through the user's current Chroma.
   * Off by default so the real theme colors are visible; never persisted and
   * never changes the global Chroma setting.
   */
  previewChroma: boolean;
}

export type StudioAction =
  | {kind: 'close'}
  | {kind: 'activate'; ref: ThemeRef}
  | {kind: 'saveTheme'; id?: string; theme: CustomTheme}
  | {kind: 'importTheme'; theme: CustomTheme; origin: ThemeOrigin}
  | {kind: 'rename'; id: string; name: string}
  | {kind: 'duplicate'; id: string}
  | {kind: 'duplicateBuiltin'; ref: ThemeRef}
  | {kind: 'duplicateCurrent'}
  | {kind: 'delete'; id: string; confirmIndependent: boolean}
  | {kind: 'export'; id: string};

const BUILTIN_PALETTES = THEME_PALETTE_IDS.filter((id): id is Exclude<NativePaletteId, 'custom'> => id !== 'custom');

export function createThemeStudio(context: StudioContext, tab: StudioTab = 'builtin'): ThemeStudioState {
  const state: ThemeStudioState = {tab, focus: 'list', selected: {builtin: 0, imported: 0, custom: 0}, importFormat: 0, importField: 'path', importPath: '', previewChroma: false};
  // Open on the active theme where it lives.
  const active = context.activeRef;
  const asset = active?.startsWith('asset:') ? findTheme(context.themes, active.slice(6)) : undefined;
  if (asset) {
    state.tab = categoryOf(asset);
    state.selected[state.tab] = libraryItems(context, state.tab).findIndex(item => item.id === asset.id) + (state.tab === 'custom' ? CUSTOM_ACTIONS : 0);
  } else if (active?.startsWith('builtin:')) {
    const palette = active.slice(8).split('@')[0];
    state.selected.builtin = Math.max(0, BUILTIN_PALETTES.indexOf(palette as Exclude<NativePaletteId, 'custom'>));
  }
  if (tab !== 'builtin') state.tab = tab;
  return state;
}

function libraryItems(context: StudioContext, tab: 'imported' | 'custom'): ThemeAsset[] {
  return context.themes.filter(asset => categoryOf(asset) === tab);
}

function rowCount(state: ThemeStudioState, context: StudioContext): number {
  if (state.tab === 'builtin') return BUILTIN_PALETTES.length;
  if (state.tab === 'imported') return libraryItems(context, 'imported').length;
  if (state.tab === 'custom') return libraryItems(context, 'custom').length + CUSTOM_ACTIONS;
  return 0;
}

/** The asset under the selection on the Imported/Custom tabs (Custom row 0 is "New custom theme"). */
export function selectedAsset(state: ThemeStudioState, context: StudioContext): ThemeAsset | undefined {
  if (state.tab === 'imported') return libraryItems(context, 'imported')[state.selected.imported];
  if (state.tab === 'custom') return state.selected.custom < CUSTOM_ACTIONS ? undefined : libraryItems(context, 'custom')[state.selected.custom - CUSTOM_ACTIONS];
  return undefined;
}

export function selectedBuiltinRef(state: ThemeStudioState, context: StudioContext): ThemeRef {
  return builtinRef(BUILTIN_PALETTES[state.selected.builtin] ?? 'lavender', context.accent);
}

/** The theme the studio is showing: the editor draft, the import preview, or the selected row. */
export function previewTheme(state: ThemeStudioState, context: StudioContext): {theme: CustomTheme; palette?: Exclude<NativePaletteId, 'custom'>} | undefined {
  if (state.editor) return {theme: state.editor.draft};
  if (state.tab === 'import') return state.importPreview ? {theme: state.importPreview.theme} : undefined;
  if (state.tab === 'builtin') {
    const palette = BUILTIN_PALETTES[state.selected.builtin] ?? 'lavender';
    return {theme: builtinTheme(palette, context.accent), palette};
  }
  const asset = selectedAsset(state, context);
  return asset ? {theme: asset.theme} : undefined;
}

function switchTab(state: ThemeStudioState, delta: number): void {
  state.tab = TAB_IDS[(TAB_IDS.indexOf(state.tab) + delta + TAB_IDS.length) % TAB_IDS.length]!;
  state.message = undefined;
}

/** Custom tab: two action rows (New, Duplicate current) before the themes. */
const CUSTOM_ACTIONS = 2;

/** C toggles the local preview Chroma wherever no text is being typed. */
function typing(state: ThemeStudioState): boolean {
  return Boolean(state.rename || state.editor?.picker || state.editor?.editingName !== undefined || (state.tab === 'import' && state.importField === 'path' && state.focus === 'list' && !state.importPreview && !state.editor));
}

export function studioKey(state: ThemeStudioState, key: Key, level: ColorLevel, cwd: string, context: StudioContext): StudioAction | undefined {
  if (key.kind === 'text' && key.value.toLowerCase() === 'c' && !typing(state) && !state.confirmDelete) {
    state.previewChroma = !state.previewChroma;
    return undefined;
  }
  if (state.editor) {
    const result = editorKey(state.editor, key, level);
    if (result?.kind === 'cancel') { state.editor = undefined; return undefined; }
    if (result?.kind === 'save') {
      const id = state.editor.assetId;
      state.editor = undefined;
      return {kind: 'saveTheme', ...(id ? {id} : {}), theme: result.theme};
    }
    return undefined;
  }
  if (state.rename) {
    if (key.kind === 'escape' || key.kind === 'interrupt') state.rename = undefined;
    else if (key.kind === 'enter') {
      const {id, text} = state.rename;
      state.rename = undefined;
      return {kind: 'rename', id, name: text};
    } else {
      const next = editText(state.rename.text, key);
      if (next !== undefined) state.rename.text = next.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').slice(0, 48);
    }
    return undefined;
  }
  if (state.confirmDelete) {
    const {id, pinned} = state.confirmDelete;
    if (key.kind === 'enter' || (key.kind === 'text' && key.value.toLowerCase() === 'y')) {
      state.confirmDelete = undefined;
      return {kind: 'delete', id, confirmIndependent: pinned.length > 0};
    }
    if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value.toLowerCase() === 'n')) state.confirmDelete = undefined;
    return undefined;
  }
  state.message = undefined;
  if (state.tab === 'import') return importKey(state, key, cwd);
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'left' || key.kind === 'right') { switchTab(state, key.kind === 'left' ? -1 : 1); return undefined; }
  if (state.focus === 'tabs') {
    if (key.kind === 'down' || key.kind === 'enter') state.focus = 'list';
    return undefined;
  }
  const count = rowCount(state, context);
  const tab = state.tab;
  if (key.kind === 'up' || key.kind === 'down') {
    if (key.kind === 'up' && state.selected[tab] === 0) { state.focus = 'tabs'; return undefined; }
    if (count) state.selected[tab] = Math.max(0, Math.min(count - 1, state.selected[tab] + (key.kind === 'up' ? -1 : 1)));
    return undefined;
  }
  const letter = key.kind === 'text' ? key.value.toLowerCase() : '';
  if (tab === 'builtin') {
    const ref = selectedBuiltinRef(state, context);
    if (key.kind === 'enter') return {kind: 'activate', ref};
    if (letter === 'd') return {kind: 'duplicateBuiltin', ref};
    if (letter === 'e') {
      // Built-ins are immutable: editing starts a new Custom theme from it.
      const palette = BUILTIN_PALETTES[state.selected.builtin] ?? 'lavender';
      state.editor = createThemeEditor(undefined, palette);
      state.editor.draft = {...builtinTheme(palette, context.accent), name: `My ${builtinTheme(palette, context.accent).name}`.slice(0, 48)};
    }
    return undefined;
  }
  if (tab === 'custom' && state.selected.custom === 1) {
    if (key.kind === 'enter') return {kind: 'duplicateCurrent'};
    return undefined;
  }
  if (tab === 'custom' && state.selected.custom === 0) {
    if (key.kind === 'enter' || letter === 'n') {
      const base = context.activeRef?.startsWith('builtin:') ? context.activeRef.slice(8).split('@')[0] as NativePaletteId : 'lavender';
      state.editor = createThemeEditor(undefined, base);
    }
    return undefined;
  }
  const asset = selectedAsset(state, context);
  if (!asset) {
    if (key.kind === 'enter' && tab === 'imported') { state.tab = 'import'; }
    return undefined;
  }
  if (key.kind === 'enter') return {kind: 'activate', ref: assetRef(asset.id)};
  if (letter === 'e') state.editor = createThemeEditor(asset.theme, 'lavender', asset);
  else if (letter === 'n') state.rename = {id: asset.id, text: asset.theme.name};
  else if (letter === 'd') return {kind: 'duplicate', id: asset.id};
  else if (letter === 'x') return {kind: 'export', id: asset.id};
  else if (key.kind === 'delete' || key.kind === 'backspace' || letter === 'r') {
    if (context.activeRef === assetRef(asset.id)) state.message = `${asset.theme.name} is the active theme. Set another theme active first.`;
    else state.confirmDelete = {id: asset.id, name: asset.theme.name, pinned: context.pinnedTo(assetRef(asset.id))};
  }
  return undefined;
}

function importKey(state: ThemeStudioState, key: Key, cwd: string): StudioAction | undefined {
  if (state.importPreview) {
    if (key.kind === 'enter') {
      const preview = state.importPreview;
      state.importPreview = undefined;
      state.importPath = '';
      return {kind: 'importTheme', theme: preview.theme, origin: importOrigin(preview)};
    }
    // Cancel stores nothing: the parsed preview is simply dropped.
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.importPreview = undefined; state.message = 'Import cancelled; nothing was saved.'; }
    return undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (state.focus === 'tabs') {
    if (key.kind === 'left' || key.kind === 'right') switchTab(state, key.kind === 'left' ? -1 : 1);
    else if (key.kind === 'down' || key.kind === 'enter') { state.focus = 'list'; state.importField = 'format'; }
    return undefined;
  }
  if (key.kind === 'up' || key.kind === 'down') {
    if (key.kind === 'up' && state.importField === 'format') state.focus = 'tabs';
    else state.importField = key.kind === 'up' ? 'format' : 'path';
    return undefined;
  }
  if (state.importField === 'format') {
    if (key.kind === 'left' || key.kind === 'right') {
      state.importFormat = (state.importFormat + (key.kind === 'left' ? -1 : 1) + IMPORT_FORMAT_CHOICES.length) % IMPORT_FORMAT_CHOICES.length;
    } else if (key.kind === 'enter') state.importField = 'path';
    return undefined;
  }
  if (key.kind === 'enter') {
    if (!state.importPath.trim()) { state.message = 'Type the path of a local theme file.'; return undefined; }
    const result = readThemeImport(state.importPath, cwd, IMPORT_FORMAT_CHOICES[state.importFormat]);
    if ('errors' in result) state.message = result.errors.join(' ');
    else state.importPreview = result;
    return undefined;
  }
  if ((key.kind === 'left' || key.kind === 'right') && !state.importPath) { switchTab(state, key.kind === 'left' ? -1 : 1); return undefined; }
  const next = editText(state.importPath, key);
  if (next !== undefined) state.importPath = next.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').slice(0, 1024);
  return undefined;
}

/**
 * The /theme panel. `preview` rows come from TerminalApp's real Native
 * renderer for whatever previewTheme() returns, so every category previews
 * identically.
 */
export function renderThemeStudio(state: ThemeStudioState, context: StudioContext, columns: number, height: number, level: ColorLevel, preview: readonly string[]): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const finish = (rows: string[]) => framePanel(rows.map(row => truncateAnsi(row, columns)), columns).slice(0, Math.max(1, height));
  const chromaNote = `  ${subtle}${chromaPreviewNote(state.previewChroma && (context.chroma ?? 'Off') !== 'Off')}${RESET}`;
  const chromaLine = `  ${primary}\u001b[1mPreview Chroma${RESET}  ${subtle}${state.previewChroma ? `${accent}On${RESET}${subtle}` : 'Off'}  ·  Global Chroma  ${context.chroma ?? 'Off'}  ·  C toggles the preview only${RESET}`;
  if (state.editor) return finish(renderThemeEditor(state.editor, columns, height - 2, level, preview.length ? [chromaLine, chromaNote, ...preview] : preview));
  const head = [renderTabStrip(STUDIO_TABS, TAB_IDS.indexOf(state.tab), columns, state.focus === 'tabs'), ''];
  const body: string[] = [];
  const controls: Array<[string, string]> = [];
  const active = (ref: ThemeRef) => context.activeRef === ref ? `  ${accent}● active${RESET}` : '';
  const pinned = (ref: ThemeRef) => {
    const targets = context.pinnedTo(ref);
    return targets.length ? `  ${subtle}bridge: ${targets.map(target => BRIDGE_TARGET_LABELS[target]).join(', ')}${RESET}` : '';
  };
  const listBudget = Math.max(2, height - head.length - preview.length - 6);
  const window = <T,>(items: readonly T[], selected: number) => {
    const start = Math.max(0, Math.min(selected - Math.floor(listBudget / 2), items.length - listBudget));
    return {start, items: items.slice(start, start + listBudget)};
  };
  const mark = (selected: boolean) => selected && state.focus === 'list' ? `${accent}${GLYPHS.selection}${RESET}` : ' ';

  if (state.tab === 'builtin') {
    body.push(`  ${subtle}NMSh and bundled theme families. Built-ins are immutable; duplicate one to edit it.${RESET}`);
    const {start, items} = window(BUILTIN_PALETTES, state.selected.builtin);
    items.forEach((palette, offset) => {
      const index = start + offset;
      const theme = builtinTheme(palette, context.accent);
      const ref = builtinRef(palette, context.accent);
      body.push(`${mark(index === state.selected.builtin)} ${focusForeground(index === state.selected.builtin)}${padCells(theme.name, 26)}${RESET}${swatches(Object.values(theme.prompt).slice(0, 6), level)}${active(ref)}${pinned(ref)}`);
    });
    controls.push(['Enter', 'set active'], ['D', 'duplicate to Custom'], ['E', 'edit a copy']);
  } else if (state.tab === 'imported' || state.tab === 'custom') {
    const items = libraryItems(context, state.tab);
    const rows: Array<{label: string; detail: string; ref?: ThemeRef; colors?: string[]}> = state.tab === 'custom'
      ? [{label: '＋ New custom theme', detail: 'from the active built-in theme'},
        {label: `⧉ Duplicate current theme → Custom${context.activeName ? ` (${context.activeName})` : ''}`, detail: 'copies the active theme'}] : [];
    rows.push(...items.map(asset => ({label: asset.theme.name, detail: provenanceLabel(asset), ref: assetRef(asset.id), colors: Object.values(asset.theme.prompt).slice(0, 6)})));
    if (!rows.length) body.push(`  ${subtle}No imported themes yet. Open the Import tab to bring in a theme file.${RESET}`);
    const selected = state.selected[state.tab];
    const {start, items: shown} = window(rows, selected);
    shown.forEach((row, offset) => {
      const index = start + offset;
      body.push(`${mark(index === selected)} ${focusForeground(index === selected)}${padCells(truncateText(row.label, row.ref ? 26 : 60), row.ref ? 26 : 60)}${RESET}${row.colors ? swatches(row.colors, level) : ''}${row.ref ? `${active(row.ref)}${pinned(row.ref)}` : ''}`);
    });
    const asset = selectedAsset(state, context);
    if (asset) body.push('', `  ${subtle}${provenanceLabel(asset)}${RESET}`);
    if (asset) controls.push(['Enter', 'set active'], ['E', 'edit'], ['N', 'rename'], ['D', 'duplicate'], ['X', 'export'], ['Del', 'delete']);
    else if (state.tab === 'custom') controls.push(['Enter', 'create']);
  } else {
    const format = IMPORT_FORMAT_CHOICES[state.importFormat]!;
    if (state.importPreview) {
      const p = state.importPreview;
      body.push(`  ${primary}Import preview · ${p.theme.name}${RESET}  ${subtle}${importFormatLabel(p.format)} · ${p.theme.dark ? 'dark' : 'light'}${RESET}`);
      body.push(`  ${swatches(PROMPT_THEME_ROLES.map(role => p.theme.prompt[role]), level)}  ${subtle}prompt roles${RESET}`);
      body.push(`  ${swatches(UI_THEME_ROLES.map(role => p.theme.ui[role]), level)}  ${subtle}interface roles${RESET}`);
      for (const mapping of p.mapping.slice(0, 6)) body.push(`  ${secondary}${padCells(mapping.role, 18)}${RESET}${subtle}← ${mapping.from}${RESET}`);
      for (const warning of p.warnings) body.push(`  ${subtle}• ${warning}${RESET}`);
      controls.push(['Enter', 'save as Imported theme'], ['Esc', 'cancel (nothing saved)']);
    } else {
      body.push(`  ${subtle}Parse a local theme file into an NMSh Native theme. Nothing is executed or fetched; you preview before anything is saved.${RESET}`, '');
      const focusFormat = state.focus === 'list' && state.importField === 'format';
      const focusPath = state.focus === 'list' && state.importField === 'path';
      body.push(`${mark(focusFormat)} ${focusFormat ? primary : secondary}${padCells('Format', 10)}${RESET}${focusFormat ? `${accent}‹ ${importFormatLabel(format)} ›${RESET}` : importFormatLabel(format)}`);
      body.push(`${mark(focusPath)} ${focusPath ? primary : secondary}${padCells('Path', 10)}${RESET}${primary}${state.importPath}${RESET}${focusPath ? `${accent}_${RESET}` : ''}`);
      body.push('', `  ${subtle}NMSh JSON · Base16/Base24 · Windows Terminal · Oh My Posh (JSON/YAML/TOML) · Kitty · Ghostty · iTerm2 · WezTerm TOML${RESET}`);
      controls.push(['Enter', focusFormat ? 'to path' : 'preview'], ['↑↓', 'field'], ['Esc', 'close']);
    }
  }
  if (state.rename) body.push('', `  ${primary}Rename${RESET}  ${primary}${state.rename.text}${accent}_${RESET}  ${subtle}Enter save · Esc cancel${RESET}`);
  if (state.confirmDelete) {
    const {name, pinned: targets} = state.confirmDelete;
    body.push('', targets.length
      ? `  ${primary}Delete ${name}? Theme Bridge ${targets.map(target => BRIDGE_TARGET_LABELS[target]).join(', ')} ${targets.length === 1 ? 'is' : 'are'} pinned to it and will become Independent.${RESET}`
      : `  ${primary}Delete ${name}? This removes it from NMSh; exported files are kept.${RESET}`, `  ${subtle}Enter delete · Esc keep${RESET}`);
  }
  if (state.message) body.push('', `  ${secondary}${state.message}${RESET}`);
  if (preview.length && !state.rename && !state.confirmDelete) {
    body.push('', chromaLine, chromaNote, ...preview);
  }
  const help = state.focus === 'tabs' ? renderControls([['←→', 'switch'], ['↓', 'select'], ['Esc', 'close']])
    : renderControls([...controls, ['←→', 'tabs'], ...(state.tab === 'import' ? [] : [['Esc', 'close'] as [string, string]])]);
  return finish([...head, ...body, '', help]);
}
