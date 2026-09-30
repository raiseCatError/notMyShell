import type {Key} from '../terminal/keys.js';
import {renderControls} from './controls.js';

/**
 * A panel action: one place that says what the action is called, which keys
 * trigger it and whether it currently applies. Panel footers are derived from
 * the actions that are enabled, so help cannot drift from the real bindings.
 * Every action is keyboard-reachable; pointer input may only add shortcuts.
 */
export interface UiAction {
  readonly id: string;
  readonly label: string;
  /** Key as shown in help, e.g. `↑↓`. */
  readonly keyLabel: string;
  /** Key kinds (from the input parser) that trigger the action. Empty for display-only entries such as free typing. */
  readonly kinds: readonly Key['kind'][];
  /** Defaults to enabled; disabled actions are neither dispatched nor shown in help. */
  readonly enabled?: boolean;
}

export function enabledActions(actions: readonly UiAction[]): UiAction[] {
  return actions.filter(action => action.enabled !== false);
}

/** The enabled action bound to this key, if any. */
export function resolveAction(actions: readonly UiAction[], key: Key): UiAction | undefined {
  return enabledActions(actions).find(action => action.kinds.includes(key.kind));
}

export function actionControls(actions: readonly UiAction[]): Array<[string, string]> {
  return enabledActions(actions).map(action => [action.keyLabel, action.label]);
}

/** Footer row for the actions currently available in a surface. */
export function renderActionHelp(actions: readonly UiAction[]): string {
  return renderControls(actionControls(actions));
}

/** Shared by the draft-and-save panels (layout, syntax, transcript): move between rows, change a value, save or cancel. */
export const DRAFT_PANEL_ACTIONS: readonly UiAction[] = [
  {id: 'move', label: 'move', keyLabel: '↑↓', kinds: ['up', 'down']},
  {id: 'change', label: 'change', keyLabel: '←→', kinds: ['left', 'right']},
  {id: 'save', label: 'save', keyLabel: 'Enter', kinds: ['enter']},
  {id: 'cancel', label: 'cancel', keyLabel: 'Esc', kinds: ['escape']},
];
