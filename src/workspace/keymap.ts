import type {Key} from '../terminal/keys.js';

/**
 * Key → semantic workspace action, per context (#335 builds remapping on this
 * table). Controllers receive actions, never key sequences, and every action
 * also has a slash-command path (`/sidebar`, `/panel`), so a key the terminal
 * host or tmux consumes before NMSh sees it never makes an action unreachable.
 *
 * Contexts are the workspace owners plus `composerEmpty`: a binding there
 * applies only while the shell composer owns the keyboard with an empty draft.
 * The defaults bind nothing in the composer, because every key it receives
 * (arrows, Tab, Shift+Tab) already means something to the draft and the
 * transcript; a person can opt in through the keymap.
 */

export type WorkspaceActionId =
  | 'sidebar.toggle' | 'sidebar.focus' | 'panel.toggle' | 'panel.focus' | 'focus.return' | 'focus.cycle'
  | 'sidebar.up' | 'sidebar.down' | 'sidebar.first' | 'sidebar.last' | 'sidebar.expand' | 'sidebar.collapse' | 'sidebar.activate' | 'sidebar.search'
  | 'panel.up' | 'panel.down' | 'panel.pageUp' | 'panel.pageDown' | 'panel.close';

export type KeymapContext = 'composerEmpty' | 'sidebar' | 'panel';

/** A key as the input parser reports it: its kind, and for text the exact character. */
export interface KeyChord {
  kind: Key['kind'];
  text?: string;
}

export interface Binding {
  action: WorkspaceActionId;
  context: KeymapContext;
  key: KeyChord;
}

export const WORKSPACE_ACTIONS: Readonly<Record<WorkspaceActionId, {label: string; command?: string}>> = {
  'sidebar.toggle': {label: 'show or hide the sidebar', command: '/sidebar'},
  'sidebar.focus': {label: 'focus the sidebar', command: '/sidebar focus'},
  'panel.toggle': {label: 'show or hide the detail panel', command: '/panel'},
  'panel.focus': {label: 'focus the detail panel', command: '/panel focus'},
  'focus.return': {label: 'back to the composer'},
  'focus.cycle': {label: 'next region'},
  'sidebar.up': {label: 'previous'},
  'sidebar.down': {label: 'next'},
  'sidebar.first': {label: 'first'},
  'sidebar.last': {label: 'last'},
  'sidebar.expand': {label: 'expand'},
  'sidebar.collapse': {label: 'collapse'},
  'sidebar.activate': {label: 'open'},
  'sidebar.search': {label: 'filter'},
  'panel.up': {label: 'scroll up'},
  'panel.down': {label: 'scroll down'},
  'panel.pageUp': {label: 'page up'},
  'panel.pageDown': {label: 'page down'},
  'panel.close': {label: 'close panel'},
};

const bind = (context: KeymapContext, action: WorkspaceActionId, kind: Key['kind'], text?: string): Binding =>
  ({action, context, key: text === undefined ? {kind} : {kind, text}});

export const DEFAULT_BINDINGS: readonly Binding[] = [
  bind('sidebar', 'sidebar.up', 'up'), bind('sidebar', 'sidebar.down', 'down'),
  bind('sidebar', 'sidebar.first', 'bufferHome'), bind('sidebar', 'sidebar.last', 'bufferEnd'),
  bind('sidebar', 'sidebar.expand', 'right'), bind('sidebar', 'sidebar.collapse', 'left'),
  bind('sidebar', 'sidebar.activate', 'enter'), bind('sidebar', 'sidebar.search', 'text', '/'),
  bind('sidebar', 'focus.return', 'escape'), bind('sidebar', 'focus.cycle', 'complete'),
  bind('panel', 'panel.up', 'up'), bind('panel', 'panel.down', 'down'),
  bind('panel', 'panel.pageUp', 'pageUp'), bind('panel', 'panel.pageDown', 'pageDown'),
  bind('panel', 'focus.return', 'escape'), bind('panel', 'focus.cycle', 'complete'), bind('panel', 'panel.close', 'text', 'q'),
];

export function chordMatches(chord: KeyChord, key: Key): boolean {
  if (chord.kind !== key.kind) return false;
  return chord.text === undefined || (key.kind === 'text' && key.value === chord.text);
}

/** The action a key triggers in a context, or undefined when the key is not the workspace's to handle. */
export function resolveBinding(bindings: readonly Binding[], context: KeymapContext, key: Key): WorkspaceActionId | undefined {
  return bindings.find(binding => binding.context === context && chordMatches(binding.key, key))?.action;
}

/** How a chord is named in help (`↑`, `Enter`, `/`, `Shift+Tab`); derived, so help cannot drift from the table. */
export function chordLabel(chord: KeyChord): string {
  const names: Partial<Record<Key['kind'], string>> = {
    up: '↑', down: '↓', left: '←', right: '→', enter: 'Enter', escape: 'Esc', complete: 'Tab', focusPrevious: 'Shift+Tab',
    pageUp: 'PgUp', pageDown: 'PgDn', bufferHome: 'Home', bufferEnd: 'End', toggleDetails: 'Ctrl+O', palette: 'Ctrl+Shift+P',
    find: 'Ctrl+F', backspace: 'Backspace', lineHome: 'Ctrl+A', lineEnd: 'Ctrl+E', newline: 'Ctrl+J',
  };
  return chord.kind === 'text' ? chord.text ?? 'text' : names[chord.kind] ?? chord.kind;
}

/** Help rows for a context, from the bindings in effect: `[key, label]`. */
export function bindingHelp(bindings: readonly Binding[], context: KeymapContext): Array<[string, string]> {
  return bindings.filter(binding => binding.context === context).map(binding => [chordLabel(binding.key), WORKSPACE_ACTIONS[binding.action].label]);
}
