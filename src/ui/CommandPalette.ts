import type {BlockActionId} from './BlockActions.js';
import {slashCommands} from '../commands/slashCommands.js';
import {NATIVE_PALETTE_IDS} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';
import {fuzzyMatch} from '../suggestions/NativeSuggestions.js';
import type {Key} from '../terminal/keys.js';
import {renderActionHelp, resolveAction, type UiAction} from './actions.js';
import {focusForeground, foreground, UI_COLORS, lazyForeground} from './palette.js';
import {SEARCH_MATCH, SETTINGS_ENTRIES, SETTINGS_ROWS, type SettingsDestination} from './SettingsPanel.js';
import {highlightMatches, truncateAnsi} from '../util/text.js';

/**
 * Every palette entry is a declared NMSh action. Nothing here is a shell
 * command: shell work only ever happens as a visible command the user runs.
 */
export type PaletteAction =
  | {kind: 'slash'; command: string}
  | {kind: 'open'; destination: SettingsDestination}
  | {kind: 'config'; rowId: string}
  | {kind: 'toggleComposerPosition'}
  | {kind: 'toggleTranscriptPresentation'}
  | {kind: 'cycleOutputFolding'}
  | {kind: 'theme'; palette: (typeof NATIVE_PALETTE_IDS)[number]}
  | {kind: 'latest'}
  | {kind: 'toggleDetails'}
  | {kind: 'toggleInspector'}
  | {kind: 'block'; id: BlockActionId; startId: number};

export interface PaletteItem {
  id: string;
  label: string;
  detail: string;
  category: 'Command' | 'Settings' | 'Config' | 'Layout' | 'Theme' | 'Transcript';
  action: PaletteAction;
}

/** Slash commands that need an argument stay in the slash menu, where it can be typed. */
const ARGUMENT_COMMANDS = new Set(['/copy N']);

/** The single registry: slash commands, settings pages, Config rows and explicit actions. */
export function paletteItems(): PaletteItem[] {
  const items: PaletteItem[] = [{id: 'inspector:toggle', label: 'Toggle command inspector', detail: 'Local token knowledge at the composer cursor', category: 'Command', action: {kind: 'toggleInspector'}}];
  for (const command of slashCommands) {
    // Aliases resolve to the same surface as their canonical command: one palette entry each.
    if (ARGUMENT_COMMANDS.has(command.name) || command.alias) continue;
    items.push({id: `slash:${command.name}`, label: command.title ? `${command.title} · ${command.name}` : command.name, detail: command.description, category: 'Command',
      action: {kind: 'slash', command: command.insertion.trim()}});
  }
  for (const entry of SETTINGS_ENTRIES) {
    if (entry.control !== 'child') continue;
    items.push({id: `open:${entry.id}`, label: `Open ${entry.label}`, detail: entry.description, category: 'Settings',
      action: {kind: 'open', destination: entry.destination}});
  }
  for (const row of SETTINGS_ROWS) {
    items.push({id: `config:${row.id}`, label: `Config: ${row.label}`, detail: row.description, category: 'Config',
      action: {kind: 'config', rowId: row.id}});
  }
  items.push(
    {id: 'layout:position', label: 'Toggle composer position', detail: 'Cycle Bottom, Top, and Flow after the newest output', category: 'Layout',
      action: {kind: 'toggleComposerPosition'}},
    {id: 'layout:presentation', label: 'Toggle Chat presentation', detail: 'Switch transcript between Normal and Chat', category: 'Layout',
      action: {kind: 'toggleTranscriptPresentation'}},
    {id: 'transcript:folding', label: 'Cycle output folding', detail: 'Off → Smart → Always', category: 'Transcript',
      action: {kind: 'cycleOutputFolding'}},
    {id: 'transcript:details', label: 'Expand or collapse output', detail: 'Same as Ctrl+O on the latest block', category: 'Transcript',
      action: {kind: 'toggleDetails'}},
    {id: 'awake:idle', label: 'Keep computer awake', detail: '/caffeinate idle · Keep Awake (awake, zoomies): prevent idle sleep', category: 'Command', action: {kind: 'slash', command: '/caffeinate idle'}},
    {id: 'awake:display', label: 'Keep display awake', detail: '/caffeinate display · Keep Awake: display and machine stay awake (sleep)', category: 'Command', action: {kind: 'slash', command: '/caffeinate display'}},
    {id: 'awake:status', label: 'Keep-awake status', detail: '/caffeinate status · caffeinate, awake, zoomies', category: 'Command', action: {kind: 'slash', command: '/caffeinate status'}},
    {id: 'awake:stop', label: 'Stop keep-awake', detail: '/caffeinate stop · normal sleep returns', category: 'Command', action: {kind: 'slash', command: '/caffeinate stop'}},
    {id: 'transcript:latest', label: 'Jump to latest output', detail: 'Same as Ctrl+End', category: 'Transcript', action: {kind: 'latest'}},
  );
  for (const palette of NATIVE_PALETTE_IDS) {
    items.push({id: `theme:${palette}`, label: `Prompt theme: ${NATIVE_PROMPT_THEMES[palette].label}`, detail: 'NMSh Native prompt colors',
      category: 'Theme', action: {kind: 'theme', palette}});
  }
  return items;
}

export interface PaletteState {
  query: string;
  selectedIndex: number;
  /** First visible result; moves only when the selection would leave the window. */
  viewportStart: number;
  items: readonly PaletteItem[];
}

/** Clamp selection and scroll the minimum needed to keep it visible in `height` rows. */
export function reconcilePaletteViewport(state: PaletteState, count: number, height: number): void {
  const rows = Math.max(1, height);
  state.selectedIndex = count === 0 ? 0 : Math.max(0, Math.min(count - 1, state.selectedIndex));
  if (state.selectedIndex < state.viewportStart) state.viewportStart = state.selectedIndex;
  else if (state.selectedIndex >= state.viewportStart + rows) state.viewportStart = state.selectedIndex - rows + 1;
  state.viewportStart = Math.max(0, Math.min(state.viewportStart, Math.max(0, count - rows)));
}

export function createPalette(items: readonly PaletteItem[] = paletteItems()): PaletteState {
  return {query: '', selectedIndex: 0, viewportStart: 0, items};
}

/** Recent entries first when empty; otherwise substring before fuzzy, then recency. */
export function filterPalette(state: PaletteState, recent: readonly string[] = []): PaletteItem[] {
  const query = state.query.trim().toLowerCase();
  const recency = (item: PaletteItem) => {
    const index = recent.indexOf(item.id);
    return index === -1 ? recent.length : index;
  };
  if (!query) return [...state.items].sort((a, b) => recency(a) - recency(b));
  const scored: Array<{item: PaletteItem; score: number}> = [];
  for (const item of state.items) {
    const haystack = `${item.label} ${item.category}`.toLowerCase();
    const substring = haystack.indexOf(query);
    const fuzzy = substring === -1 ? fuzzyMatch(query, `${item.label} ${item.detail}`) : undefined;
    if (substring === -1 && fuzzy === undefined) continue;
    scored.push({item, score: substring !== -1 ? 10 - substring / 100 : fuzzy!});
  }
  return scored.sort((a, b) => b.score - a.score || recency(a.item) - recency(b.item)).map(entry => entry.item);
}

/** Run needs a result to run; move needs more than nothing to move over. */
export function paletteActions(resultCount: number): UiAction[] {
  return [
    {id: 'search', label: 'search', keyLabel: 'type', kinds: []},
    {id: 'move', label: 'move', keyLabel: '↑↓', kinds: ['up', 'down'], enabled: resultCount > 1},
    {id: 'run', label: 'run', keyLabel: 'Enter', kinds: ['enter'], enabled: resultCount > 0},
    {id: 'close', label: 'close', keyLabel: 'Esc', kinds: ['escape']},
  ];
}

/** Returns the chosen item on Enter; edits the query and selection otherwise. */
export function handlePaletteKey(key: Key, state: PaletteState, recent: readonly string[] = []): PaletteItem | 'changed' | undefined {
  const visible = filterPalette(state, recent);
  if (resolveAction(paletteActions(visible.length), key)?.id === 'run') return visible[Math.min(state.selectedIndex, visible.length - 1)];
  if (key.kind === 'up') state.selectedIndex = visible.length ? (state.selectedIndex - 1 + visible.length) % visible.length : 0;
  else if (key.kind === 'down') state.selectedIndex = visible.length ? (state.selectedIndex + 1) % visible.length : 0;
  else if (key.kind === 'text' || key.kind === 'paste') { state.query += key.value.replace(/[\r\n]/gu, ''); state.selectedIndex = 0; state.viewportStart = 0; }
  else if (key.kind === 'backspace') { state.query = [...state.query].slice(0, -1).join(''); state.selectedIndex = 0; state.viewportStart = 0; }
  else if (key.kind === 'deleteWord' || key.kind === 'deleteLineBefore') { state.query = ''; state.selectedIndex = 0; state.viewportStart = 0; }
  else return undefined;
  return 'changed';
}

const PRIMARY = lazyForeground(UI_COLORS.primary);
const SECONDARY = lazyForeground(UI_COLORS.secondary);
const ACCENT = lazyForeground(UI_COLORS.accent);
const SUBTLE = lazyForeground(UI_COLORS.subtle);
const RESET = '\u001B[0m';

export function renderPalette(state: PaletteState, columns: number, rowsAvailable: number, recent: readonly string[] = []): string[] {
  const visible = filterPalette(state, recent);
  const rows = [`${PRIMARY}  Command palette${RESET}  ${SUBTLE}NMSh actions only${RESET}`,
    `${SECONDARY}  › ${state.query}${ACCENT}▏${RESET}`, ''];
  const budget = Math.max(1, rowsAvailable - rows.length - 2);
  reconcilePaletteViewport(state, visible.length, budget);
  const selected = state.selectedIndex;
  const start = state.viewportStart;
  if (visible.length === 0) rows.push(`${SUBTLE}  No matching NMSh action${RESET}`);
  visible.slice(start, start + budget).forEach((item, offset) => {
    const active = start + offset === selected;
    const label = state.query ? highlightMatches(item.label, state.query, focusForeground(active), SEARCH_MATCH) : item.label;
    rows.push(`${active ? `${ACCENT}›` : ' '} ${focusForeground(active)}${label}${RESET}  ${SUBTLE}${item.category} · ${item.detail}${RESET}`);
  });
  rows.push('', renderActionHelp(paletteActions(visible.length)));
  return rows.map(row => truncateAnsi(row, columns));
}
