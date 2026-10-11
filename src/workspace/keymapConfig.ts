import type {Key} from '../terminal/keys.js';
import {chordLabel, DEFAULT_BINDINGS, WORKSPACE_ACTIONS, type Binding, type KeyChord, type KeymapContext, type WorkspaceActionId} from './keymap.js';

/**
 * A person's workspace keymap (#335): declarative data, validated before it
 * is used. Entries bind a named key to a semantic action in a context, or
 * unbind a default. Nothing in a keymap is executed.
 *
 *   {"version": 1,
 *    "bind": [{"key": "Left", "context": "composerEmpty", "action": "sidebar.focus", "replaces": true}],
 *    "unbind": [{"key": "q", "context": "panel"}]}
 *
 * Validation is honest about what NMSh can do:
 * - only keys NMSh's input parser can tell apart are bindable; others are
 *   refused with the reason (the terminal or OS may never send them);
 * - job control, paste and pointer events are never bindable, and in the
 *   composer neither are typing or Enter;
 * - a composer binding that would replace an existing meaning (Left with an
 *   empty draft opens Sessions) needs `"replaces": true`, so nothing is
 *   shadowed by accident;
 * - two bindings for one key in one context are a conflict, not "last wins";
 * - host notes say when a terminal or tmux usually consumes the key first.
 */

export const KEYMAP_VERSION = 1;
export const MAX_KEYMAP_ENTRIES = 128;

/** Named keys the parser reports as distinct kinds. Printable characters are bound by themselves (`/`, `q`). */
export const KEY_NAMES: Readonly<Record<string, KeyChord>> = {
  'Up': {kind: 'up'}, 'Down': {kind: 'down'}, 'Left': {kind: 'left'}, 'Right': {kind: 'right'},
  'Home': {kind: 'bufferHome'}, 'End': {kind: 'bufferEnd'}, 'PageUp': {kind: 'pageUp'}, 'PageDown': {kind: 'pageDown'},
  'Tab': {kind: 'complete'}, 'Shift+Tab': {kind: 'focusPrevious'}, 'Esc': {kind: 'escape'}, 'Enter': {kind: 'enter'},
  'Backspace': {kind: 'backspace'}, 'Ctrl+O': {kind: 'toggleDetails'}, 'Ctrl+F': {kind: 'find'}, 'Ctrl+G': {kind: 'latest'},
  'Ctrl+N': {kind: 'suggestNext'}, 'Ctrl+P': {kind: 'suggestPrevious'}, 'Ctrl+R': {kind: 'historySearch'}, 'Ctrl+X': {kind: 'historyDelete'},
  'F1': {kind: 'palette'},
};

/** Never bindable: they belong to the shell, job control, the clipboard or the pointer. */
const RESERVED: ReadonlySet<Key['kind']> = new Set(['interrupt', 'eof', 'suspend', 'paste', 'mouseMove', 'mouseClick', 'mouseDrag', 'mouseRelease',
  'wheelUp', 'wheelDown', 'focusIn', 'focusOut']);

/** What a key already does in the shell composer with an empty draft (TerminalApp's composer dispatch). */
export const COMPOSER_MEANINGS: Readonly<Partial<Record<Key['kind'], string>>> = {
  left: 'opens the Sessions view', right: 'accepts the inline suggestion', up: 'recalls history (or focuses a shown agent shelf)',
  down: 'reveals the agent shelf', complete: 'completes', focusPrevious: 'moves through transcript blocks', toggleDetails: 'toggles details',
  find: 'finds in the transcript', historySearch: 'searches history', historyDelete: 'deletes a history entry', latest: 'jumps to the newest output',
  pageUp: 'scrolls the transcript', pageDown: 'scrolls the transcript', bufferHome: 'moves to the start of the draft', bufferEnd: 'accepts the inline suggestion',
  escape: 'dismisses menus and suggestions', suggestNext: 'moves through suggestions', suggestPrevious: 'moves through suggestions',
  palette: 'opens the command palette', backspace: 'edits the draft',
};

const FOCUS_ACTIONS: ReadonlySet<WorkspaceActionId> = new Set(['sidebar.toggle', 'sidebar.focus', 'panel.toggle', 'panel.focus', 'focus.return', 'focus.cycle']);

function actionAllowed(action: WorkspaceActionId, context: KeymapContext): boolean {
  if (FOCUS_ACTIONS.has(action)) return context !== 'composerEmpty' || action !== 'focus.return';
  return context === 'sidebar' ? action.startsWith('sidebar.') : context === 'panel' ? action.startsWith('panel.') : false;
}

export function parseKeyName(name: string): KeyChord | {error: string} {
  if (typeof name !== 'string' || !name || name.length > 32) return {error: 'a key name is required'};
  if (Object.hasOwn(KEY_NAMES, name)) return KEY_NAMES[name]!;
  const characters = Array.from(name);
  if (characters.length === 1 && /^[\p{L}\p{N}\p{P}\p{S}]$/u.test(name)) return {kind: 'text', text: name};
  return {error: `${name} is not a key NMSh can tell apart (the terminal may send it as something else, or not at all); use one of ${Object.keys(KEY_NAMES).join(', ')} or a single printable character`};
}

export interface KeymapProblem {severity: 'error' | 'warning'; entry?: number; message: string}

export interface KeymapResult {bindings: Binding[]; problems: KeymapProblem[]}

const sameChord = (a: KeyChord, b: KeyChord) => a.kind === b.kind && a.text === b.text;
const CONTEXTS: readonly KeymapContext[] = ['composerEmpty', 'sidebar', 'panel'];

/**
 * The bindings in effect: defaults, minus valid `unbind` entries, plus valid `bind` entries. Invalid entries are
 * reported and skipped; a keymap with errors still yields a usable table (the defaults stand where it failed).
 */
export function applyKeymap(input: unknown, defaults: readonly Binding[] = DEFAULT_BINDINGS): KeymapResult {
  const problems: KeymapProblem[] = [];
  let bindings = [...defaults];
  if (input === undefined) return {bindings, problems};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {bindings, problems: [{severity: 'error', message: 'the keymap must be an object'}]};
  const data = input as Record<string, unknown>;
  for (const key of Object.keys(data)) if (!['version', 'bind', 'unbind'].includes(key)) problems.push({severity: 'error', message: `unknown field "${key.slice(0, 32)}"`});
  if (data.version !== KEYMAP_VERSION) return {bindings, problems: [...problems, {severity: 'error', message: `unsupported keymap version; expected ${KEYMAP_VERSION}`}]};
  const list = (value: unknown, name: string): Record<string, unknown>[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) { problems.push({severity: 'error', message: `"${name}" must be a list`}); return []; }
    if (value.length > MAX_KEYMAP_ENTRIES) problems.push({severity: 'error', message: `"${name}" has more than ${MAX_KEYMAP_ENTRIES} entries; the rest are ignored`});
    return value.slice(0, MAX_KEYMAP_ENTRIES).map(item => (typeof item === 'object' && item !== null && !Array.isArray(item) ? item as Record<string, unknown> : {}));
  };
  const context = (value: unknown, entry: number): KeymapContext | undefined => {
    if (CONTEXTS.includes(value as KeymapContext)) return value as KeymapContext;
    problems.push({severity: 'error', entry, message: `context must be one of ${CONTEXTS.join(', ')}`});
    return undefined;
  };

  list(data.unbind, 'unbind').forEach((item, entry) => {
    const where = context(item.context, entry);
    const chord = parseKeyName(item.key as string);
    if (!where) return;
    if ('error' in chord) { problems.push({severity: 'error', entry, message: chord.error}); return; }
    const before = bindings.length;
    bindings = bindings.filter(binding => !(binding.context === where && sameChord(binding.key, chord)));
    if (bindings.length === before) problems.push({severity: 'warning', entry, message: `${chordLabel(chord)} is not bound in ${where}`});
  });

  const added: Binding[] = [];
  list(data.bind, 'bind').forEach((item, entry) => {
    const where = context(item.context, entry);
    if (!where) return;
    const chord = parseKeyName(item.key as string);
    if ('error' in chord) { problems.push({severity: 'error', entry, message: chord.error}); return; }
    const action = item.action as WorkspaceActionId;
    if (typeof action !== 'string' || !Object.hasOwn(WORKSPACE_ACTIONS, action)) { problems.push({severity: 'error', entry, message: 'unknown action'}); return; }
    if (!actionAllowed(action, where)) { problems.push({severity: 'error', entry, message: `${action} does not apply in ${where}`}); return; }
    if (RESERVED.has(chord.kind)) { problems.push({severity: 'error', entry, message: `${chordLabel(chord)} belongs to the shell and is never bound`}); return; }
    if (where === 'composerEmpty') {
      if (chord.kind === 'text' || chord.kind === 'enter') { problems.push({severity: 'error', entry, message: 'typing and Enter always reach the shell'}); return; }
      const meaning = COMPOSER_MEANINGS[chord.kind];
      if (meaning && item.replaces !== true) {
        problems.push({severity: 'error', entry, message: `${String(item.key)} with an empty draft ${meaning}; add "replaces": true to use it for ${action} instead`});
        return;
      }
    }
    if (added.some(binding => binding.context === where && sameChord(binding.key, chord))) {
      problems.push({severity: 'error', entry, message: `${chordLabel(chord)} is bound twice in ${where}; the first binding is kept`});
      return;
    }
    bindings = bindings.filter(binding => !(binding.context === where && sameChord(binding.key, chord)));
    const binding: Binding = {action, context: where, key: chord};
    bindings.push(binding); added.push(binding);
  });

  // A region action with no key and no command is unreachable: say so rather than leave a dead feature.
  for (const [action, info] of Object.entries(WORKSPACE_ACTIONS) as Array<[WorkspaceActionId, {label: string; command?: string}]>) {
    if (info.command || FOCUS_ACTIONS.has(action)) continue;
    if (!bindings.some(binding => binding.action === action)) problems.push({severity: 'warning', message: `nothing triggers ${action} (${info.label}) now`});
  }
  if (!bindings.some(binding => binding.action === 'focus.return' && binding.context === 'sidebar')) problems.push({severity: 'warning', message: 'no key returns from the sidebar to the composer; /sidebar still closes it'});
  return {bindings, problems};
}

export interface HostProfile {
  host: 'ghostty' | 'apple-terminal' | 'other';
  /** Running inside tmux; `tmuxRootKeys` are the user's root-table keys (`bind -n`), in tmux's own names. */
  tmux: boolean;
  tmuxRootKeys?: ReadonlySet<string>;
  /** The terminal reports keys with the Kitty keyboard protocol (Ghostty does). */
  kittyKeyboard?: boolean;
}

const TMUX_NAMES: Partial<Record<Key['kind'], string>> = {
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', bufferHome: 'Home', bufferEnd: 'End', pageUp: 'PPage', pageDown: 'NPage',
  complete: 'Tab', focusPrevious: 'BTab', escape: 'Escape', enter: 'Enter', backspace: 'BSpace', toggleDetails: 'C-o', find: 'C-f', latest: 'C-g',
  suggestNext: 'C-n', suggestPrevious: 'C-p', historySearch: 'C-r', historyDelete: 'C-x', palette: 'F1',
};

/**
 * Known reasons a key may never reach NMSh in this host. These are notes, not guarantees in either direction: the
 * terminal, the OS and tmux decide, and the slash command remains the reliable path.
 */
export function hostNotes(chord: KeyChord, profile: HostProfile): string[] {
  const notes: string[] = [];
  if (profile.host === 'apple-terminal' && (chord.kind === 'pageUp' || chord.kind === 'pageDown')) {
    notes.push('Terminal.app scrolls its own window on Page Up/Down; Shift+Page Up/Down reaches NMSh');
  }
  if (profile.host === 'apple-terminal' && chord.kind === 'bufferHome') notes.push('Terminal.app scrolls its own window on Home/End unless they are remapped in its keyboard settings');
  if (chord.kind === 'palette' && profile.host === 'apple-terminal') notes.push('macOS may take F1 for brightness unless "Use F1, F2, etc. keys as standard function keys" is on');
  if (profile.tmux) {
    const name = chord.kind === 'text' ? chord.text : TMUX_NAMES[chord.kind];
    if (name && profile.tmuxRootKeys?.has(name)) notes.push(`your tmux configuration binds ${name} in its root table, so tmux takes it before NMSh`);
    if (chord.kind === 'escape') notes.push("inside tmux, Esc waits for tmux's escape-time before reaching NMSh");
  }
  return notes;
}

/** The keymap as help: every binding in effect per context, plus the commands that work regardless of keys. */
export function describeKeymap(bindings: readonly Binding[]): string[] {
  const lines: string[] = [];
  for (const context of CONTEXTS) {
    const rows = bindings.filter(binding => binding.context === context);
    lines.push(`${context === 'composerEmpty' ? 'Composer (empty draft)' : context === 'sidebar' ? 'Sidebar' : 'Detail panel'}${rows.length ? '' : ': no keys'}`);
    for (const binding of rows) lines.push(`  ${chordLabel(binding.key).padEnd(10)} ${WORKSPACE_ACTIONS[binding.action].label}`);
  }
  lines.push('Commands');
  for (const info of Object.values(WORKSPACE_ACTIONS)) if (info.command) lines.push(`  ${info.command.padEnd(15)} ${info.label}`);
  return lines;
}
