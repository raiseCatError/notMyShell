import type {Key} from '../terminal/keys.js';
import {renderControlRows} from '../ui/controls.js';
import {focusForeground, foreground, UI_COLORS} from '../ui/palette.js';
import {GLYPHS} from '../ui/glyphs.js';
import {displaySafe} from '../input/PasteReview.js';
import {inScope, type Pin, type PinData, type Recipe} from './PinStore.js';
import {placeholdersIn, valueProblem} from './recipes.js';
import {displayWidth, padCells, truncateAnsi, truncateText} from '../util/text.js';

/**
 * `/pins`: the commands and recipes the person chose to keep, as one keyboard-first list. It stores nothing itself
 * (every change is an action the app applies to pins.json) and runs nothing: Enter on a pin puts its command in the
 * composer for review, and Enter on a recipe asks for its values, shows the expanded commands, and only queues them
 * when the person confirms there.
 */
export type PanelItem = {kind: 'pin'; pin: Pin} | {kind: 'recipe'; recipe: Recipe};

export interface PinsPanelState {
  data: PinData;
  cwd: string;
  /** Show items kept for other directories too. */
  all: boolean;
  selected: number;
  mode: 'list' | 'rename' | 'delete' | 'fill' | 'name';
  /** The text being typed in rename / fill / name. */
  input: string;
  /** Asking for a recipe's values, one at a time. */
  fill?: {recipe: Recipe; names: string[]; index: number; values: Record<string, string>};
  /** Steps waiting for a name (a queue saved as a recipe). */
  naming?: {steps: string[]};
  /** What the last action did or why it could not. */
  message?: {text: string; error: boolean};
  /** The composer has text a new pin could keep; an editor can edit a recipe. */
  composerText: string;
  canEdit: boolean;
}

export type PinsPanelAction =
  | {kind: 'close'}
  | {kind: 'stage'; command: string}
  | {kind: 'use'; recipe: Recipe; values: Record<string, string>}
  | {kind: 'rename'; id: string; name: string}
  | {kind: 'scope'; id: string; scope: 'global' | 'directory'}
  | {kind: 'delete'; id: string}
  | {kind: 'pinComposer'}
  | {kind: 'edit'; recipe: Recipe}
  | {kind: 'saveRecipe'; name: string; steps: string[]};

export function createPinsPanel(data: PinData, cwd: string, options: {composerText?: string; canEdit?: boolean; naming?: string[]} = {}): PinsPanelState {
  const state: PinsPanelState = {data, cwd, all: false, selected: 0, mode: 'list', input: '', composerText: options.composerText ?? '', canEdit: options.canEdit ?? false};
  if (options.naming?.length) { state.mode = 'name'; state.naming = {steps: options.naming}; }
  return state;
}

export function panelItems(state: PinsPanelState): PanelItem[] {
  const pins = inScope(state.data.pins, state.cwd, state.all).map((pin): PanelItem => ({kind: 'pin', pin}));
  const recipes = inScope(state.data.recipes, state.cwd, state.all).map((recipe): PanelItem => ({kind: 'recipe', recipe}));
  return [...recipes, ...pins];
}

/** Items kept for other directories and not shown, for the header. */
export const hiddenCount = (state: PinsPanelState): number => state.data.pins.length + state.data.recipes.length - panelItems({...state, all: false}).length;

const idOf = (item: PanelItem) => item.kind === 'pin' ? item.pin.id : item.recipe.id;
const text = (key: Key): string | undefined => key.kind === 'text' ? key.value : key.kind === 'paste' ? key.value.replace(/\s+/gu, ' ') : undefined;

export function pinsPanelKey(state: PinsPanelState, key: Key): PinsPanelAction | undefined {
  const items = panelItems(state);
  state.selected = Math.max(0, Math.min(state.selected, items.length - 1));
  const item = items[state.selected];
  if (state.mode === 'delete') {
    state.mode = 'list';
    if (key.kind === 'text' && key.value.toLowerCase() === 'y' && item) return {kind: 'delete', id: idOf(item)};
    return undefined;
  }
  if (state.mode === 'rename' || state.mode === 'name' || state.mode === 'fill') return inputKey(state, key, item);
  state.message = undefined;
  if (key.kind === 'escape' || key.kind === 'interrupt' || (key.kind === 'text' && key.value === 'q')) return {kind: 'close'};
  if (key.kind === 'up' || key.kind === 'down') {
    if (items.length) state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + items.length) % items.length;
    return undefined;
  }
  if (key.kind === 'text' && key.value === 'a') { state.all = !state.all; state.selected = 0; return undefined; }
  if (key.kind === 'text' && key.value === 'n') return state.composerText.trim() ? {kind: 'pinComposer'} : (state.message = {text: 'Type or recall a command in the composer first; n pins what is there.', error: false}, undefined);
  if (!item) return undefined;
  if (key.kind === 'enter') {
    if (item.kind === 'pin') return {kind: 'stage', command: item.pin.command};
    const names = placeholdersIn(item.recipe.steps);
    if (!names.length) return {kind: 'use', recipe: item.recipe, values: {}};
    state.mode = 'fill';
    state.fill = {recipe: item.recipe, names, index: 0, values: {}};
    state.input = '';
    return undefined;
  }
  if (key.kind === 'text' && key.value === 'r') { state.mode = 'rename'; state.input = item.kind === 'pin' ? item.pin.name : item.recipe.name; return undefined; }
  if (key.kind === 'text' && key.value === 's' && item.kind === 'pin') {
    return {kind: 'scope', id: item.pin.id, scope: item.pin.scope === 'global' ? 'directory' : 'global'};
  }
  if (key.kind === 'text' && key.value === 's' && item.kind === 'recipe') return {kind: 'scope', id: item.recipe.id, scope: item.recipe.scope === 'global' ? 'directory' : 'global'};
  if (key.kind === 'text' && key.value === 'e' && item.kind === 'recipe' && state.canEdit) return {kind: 'edit', recipe: item.recipe};
  if (key.kind === 'delete' || key.kind === 'backspace' || (key.kind === 'text' && key.value === 'x')) { state.mode = 'delete'; return undefined; }
  return undefined;
}

function inputKey(state: PinsPanelState, key: Key, item: PanelItem | undefined): PinsPanelAction | undefined {
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    state.mode = 'list';
    state.input = '';
    state.fill = undefined;
    state.naming = undefined;
    return undefined;
  }
  if (key.kind === 'backspace') { state.input = Array.from(state.input).slice(0, -1).join(''); return undefined; }
  const typed = text(key);
  if (typed !== undefined) { state.input = (state.input + typed.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')).slice(0, 500); return undefined; }
  if (key.kind !== 'enter') return undefined;
  const value = state.input.trim();
  if (state.mode === 'rename' && item) {
    state.mode = 'list';
    state.input = '';
    return {kind: 'rename', id: idOf(item), name: value};
  }
  if (state.mode === 'name' && state.naming) {
    const steps = state.naming.steps;
    state.mode = 'list';
    state.naming = undefined;
    state.input = '';
    return {kind: 'saveRecipe', name: value, steps};
  }
  if (state.mode === 'fill' && state.fill) {
    const problem = valueProblem(value);
    if (problem) { state.message = {text: problem, error: true}; return undefined; }
    state.message = undefined;
    const fill = state.fill;
    fill.values[fill.names[fill.index]!] = value;
    fill.index += 1;
    state.input = '';
    if (fill.index >= fill.names.length) { state.mode = 'list'; state.fill = undefined; return {kind: 'use', recipe: fill.recipe, values: fill.values}; }
  }
  return undefined;
}

function label(item: PanelItem): string {
  if (item.kind === 'recipe') return item.recipe.name;
  return item.pin.name || item.pin.command.split('\n')[0]!.trim();
}

/** The panel's rows (unframed). */
export function renderPinsPanel(state: PinsPanelState, columns: number, height: number): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const failure = foreground(UI_COLORS.failure);
  const reset = '\u001b[0m';
  const width = Math.max(10, columns - 4);
  const items = panelItems(state);
  const hidden = hiddenCount(state);
  const out = [`  ${primary}Pins and recipes${reset}  ${subtle}${truncateText(`${items.length} here${hidden && !state.all ? `, ${hidden} kept for other folders (a)` : ''}`, Math.max(4, width - 20))}${reset}`, ''];
  if (!items.length) out.push(`  ${secondary}${truncateText(state.all ? 'Nothing kept yet.' : 'Nothing kept for this folder. a shows the other folders\' items.', width)}${reset}`,
    `  ${subtle}${truncateText('Pin a command from its block (Actions → Pin command), or n pins what is in the composer. A recipe is saved from the queue.', width)}${reset}`);
  const controls = renderControlRows(state.mode === 'list'
    ? [['↑↓', 'select'], ['Enter', 'use'], ['r', 'rename'], ['s', 'scope'], ['x', 'remove'], ['n', 'pin composer'], ['a', 'all folders'], ...(state.canEdit ? [['e', 'edit recipe'] as const] : []), ['Esc', 'close']]
    : [['Enter', state.mode === 'fill' ? 'next' : 'save'], ['Esc', 'cancel']], width);
  const listRoom = Math.max(1, height - out.length - controls.length - 7);
  const first = Math.max(0, Math.min(state.selected - Math.floor(listRoom / 2), items.length - listRoom));
  items.slice(first, first + listRoom).forEach((item, offset) => {
    const index = first + offset;
    const selected = index === state.selected;
    const owner = item.kind === 'pin' ? item.pin : item.recipe;
    const kind = item.kind === 'recipe' ? `recipe · ${item.recipe.steps.length} step${item.recipe.steps.length === 1 ? '' : 's'}` : 'pin';
    const where = owner.scope === 'directory' ? ' · this folder' : '';
    const tail = `${kind}${where}`;
    const body = truncateText(displaySafe(label(item)), Math.max(8, width - displayWidth(tail) - 6));
    out.push(truncateAnsi(`${selected ? `${accent}${GLYPHS.selection}${reset}` : ' '} ${focusForeground(selected)}${padCells(body, Math.max(8, width - displayWidth(tail) - 4))}${reset}  ${subtle}${tail}${reset}`, columns));
  });
  const selected = items[state.selected];
  if (selected && state.mode === 'list') {
    out.push('');
    if (selected.kind === 'pin') {
      out.push(`  ${subtle}Stays as written; Enter puts it in the composer, it does not run:${reset}`);
      for (const line of selected.pin.command.split('\n').slice(0, 4)) out.push(`    ${secondary}${truncateText(displaySafe(line), width - 2)}${reset}`);
      if (selected.pin.cwd) out.push(`  ${subtle}${truncateText(`Pinned in ${selected.pin.cwd}`, width)}${reset}`);
    } else {
      const names = placeholdersIn(selected.recipe.steps);
      out.push(`  ${subtle}${truncateText(`Enter asks for ${names.length ? names.map(name => `{{${name}}}`).join(', ') : 'nothing'}, then shows the commands before anything is queued:`, width)}${reset}`);
      for (const [index, step] of selected.recipe.steps.slice(0, 3).entries()) out.push(`    ${secondary}${truncateText(`${index + 1}  ${displaySafe(step.split('\n')[0]!)}`, width - 2)}${reset}`);
      if (selected.recipe.steps.length > 3) out.push(`    ${subtle}… ${selected.recipe.steps.length - 3} more${reset}`);
    }
  }
  out.push('');
  if (state.mode === 'delete' && selected) out.push(`  ${failure}Remove “${truncateText(label(selected), Math.max(4, width - 24))}”? y / n${reset}`);
  else if (state.mode === 'rename') out.push(`  ${accent}Name${reset} ${state.input}${accent}▏${reset}${subtle}  (empty clears a pin's name)${reset}`);
  else if (state.mode === 'name') out.push(`  ${accent}Recipe name${reset} ${state.input}${accent}▏${reset}${subtle}  (${state.naming?.steps.length ?? 0} command${state.naming?.steps.length === 1 ? '' : 's'})${reset}`);
  else if (state.mode === 'fill' && state.fill) out.push(`  ${accent}{{${state.fill.names[state.fill.index]}}}${reset} ${state.input}${accent}▏${reset}${subtle}  (${state.fill.index + 1} of ${state.fill.names.length}; used as one quoted word)${reset}`);
  if (state.message) out.push(`  ${state.message.error ? failure : subtle}${truncateText(state.message.text, width)}${reset}`);
  out.push(...controls.map(row => `  ${row}`));
  return out.map(row => truncateAnsi(row, columns)).slice(0, Math.max(4, height));
}
