import type {InputOwner} from '../agents/input/controller.js';
import type {Key} from '../terminal/keys.js';
import {DEFAULT_BINDINGS, resolveBinding, type Binding, type WorkspaceActionId} from './keymap.js';
import {planWorkspaceColumns, type FocusRegion} from './layout.js';

/**
 * Regional keyboard ownership for the workspace (#330 regional focus
 * contract). It extends the Managed Target owners (#329 `InputOwner`) with
 * the two workspace regions instead of adding a second dispatcher: exactly one
 * owner holds the keyboard, and the frontend asks `routeWorkspaceKey` first
 * only while that owner is a workspace region or the shell composer.
 *
 * Protected owners are never intercepted: raw/fullscreen passthrough, an
 * approval or choice, search, and an agent message draft keep every key. In
 * the composer only explicit `composerEmpty` bindings apply, and only with an
 * empty draft, so an active shell draft always wins Left/Right/number keys.
 */

export type WorkspaceOwner = InputOwner | 'LEFT_SIDEBAR' | 'RIGHT_PANEL';

const PROTECTED: ReadonlySet<WorkspaceOwner> = new Set(['PASSTHROUGH', 'APPROVAL', 'CHOICE', 'SEARCH', 'AGENT_MESSAGE', 'PANEL', 'TRANSCRIPT']);

export interface WorkspaceKeyContext {
  owner: WorkspaceOwner;
  /** The shell composer's draft is empty (no text, no selection). */
  composerEmpty: boolean;
  sidebarOpen: boolean;
  panelOpen: boolean;
  bindings?: readonly Binding[];
}

/** The workspace action a key triggers now, or undefined: the key is not the workspace's and goes where it went before. */
export function routeWorkspaceKey(key: Key, context: WorkspaceKeyContext): WorkspaceActionId | undefined {
  const bindings = context.bindings ?? DEFAULT_BINDINGS;
  if (PROTECTED.has(context.owner)) return undefined;
  if (context.owner === 'LEFT_SIDEBAR') return context.sidebarOpen ? resolveBinding(bindings, 'sidebar', key) : undefined;
  if (context.owner === 'RIGHT_PANEL') return context.panelOpen ? resolveBinding(bindings, 'panel', key) : undefined;
  // COMPOSER: only opt-in bindings, only with an empty draft, and never plain text or paste (typing always reaches the shell).
  if (!context.composerEmpty || key.kind === 'text' || key.kind === 'paste') return undefined;
  return resolveBinding(bindings, 'composerEmpty', key);
}

export interface WorkspaceFocusState {
  owner: WorkspaceOwner;
  sidebarOpen: boolean;
  panelOpen: boolean;
}

/** The column-plan region an owner types into: a workspace region, or the center for every other owner. */
export function regionOf(owner: WorkspaceOwner): FocusRegion {
  return owner === 'LEFT_SIDEBAR' ? 'sidebar' : owner === 'RIGHT_PANEL' ? 'panel' : 'center';
}

/**
 * Focus transitions for the focus/visibility actions. Region-internal actions (moving, scrolling, activating) belong to
 * the sidebar and panel controllers and leave focus unchanged. Closing a focused region returns focus to the
 * composer, so the keyboard never belongs to something that is not drawn.
 *
 * Opening a docked region does not take focus. With `columns`, opening a region that can only be a drawer at that
 * width focuses it: an unfocused drawer is not drawn (the column plan tucks it away), so opening it without focus
 * would show nothing. Toggling a tucked drawer brings it forward rather than closing it.
 */
export function applyFocusAction(state: WorkspaceFocusState, action: WorkspaceActionId, columns?: number): WorkspaceFocusState {
  if (columns !== undefined && (action === 'sidebar.toggle' || action === 'panel.toggle')) {
    // Toggling a tucked drawer (open, not drawn) brings it forward; closing what cannot be seen would look like nothing.
    const current = planWorkspaceColumns({columns, sidebarOpen: state.sidebarOpen, panelOpen: state.panelOpen});
    if (action === 'sidebar.toggle' && state.sidebarOpen && state.owner !== 'LEFT_SIDEBAR' && current.sidebar.mode === 'drawer') return {...state, owner: 'LEFT_SIDEBAR'};
    if (action === 'panel.toggle' && state.panelOpen && state.owner !== 'RIGHT_PANEL' && current.panel.mode === 'drawer') return {...state, owner: 'RIGHT_PANEL'};
  }
  const next = focusTransition(state, action);
  if (columns === undefined) return next;
  const plan = planWorkspaceColumns({columns, sidebarOpen: next.sidebarOpen, panelOpen: next.panelOpen});
  if (!state.sidebarOpen && next.sidebarOpen && plan.sidebar.mode === 'drawer') return {...next, owner: 'LEFT_SIDEBAR'};
  if (!state.panelOpen && next.panelOpen && plan.panel.mode === 'drawer') return {...next, owner: 'RIGHT_PANEL'};
  return next;
}

function focusTransition(state: WorkspaceFocusState, action: WorkspaceActionId): WorkspaceFocusState {
  switch (action) {
    case 'sidebar.toggle': {
      const sidebarOpen = !state.sidebarOpen;
      return {...state, sidebarOpen, owner: !sidebarOpen && state.owner === 'LEFT_SIDEBAR' ? 'COMPOSER' : state.owner};
    }
    case 'panel.toggle': {
      const panelOpen = !state.panelOpen;
      return {...state, panelOpen, owner: !panelOpen && state.owner === 'RIGHT_PANEL' ? 'COMPOSER' : state.owner};
    }
    case 'panel.close': return {...state, panelOpen: false, owner: state.owner === 'RIGHT_PANEL' ? 'COMPOSER' : state.owner};
    case 'sidebar.focus': return {...state, sidebarOpen: true, owner: 'LEFT_SIDEBAR'};
    case 'panel.focus': return {...state, panelOpen: true, owner: 'RIGHT_PANEL'};
    case 'focus.return': return {...state, owner: 'COMPOSER'};
    case 'focus.cycle': {
      // Composer → sidebar → panel → composer, skipping closed regions.
      const order: WorkspaceOwner[] = ['COMPOSER', ...(state.sidebarOpen ? ['LEFT_SIDEBAR' as const] : []), ...(state.panelOpen ? ['RIGHT_PANEL' as const] : [])];
      const index = order.indexOf(state.owner);
      return {...state, owner: order[(index + 1) % order.length] ?? 'COMPOSER'};
    }
    default: return state;
  }
}

/** Whether an action changes focus or visibility (handled by applyFocusAction) rather than acting inside a region. */
export function isFocusAction(action: WorkspaceActionId): boolean {
  return ['sidebar.toggle', 'panel.toggle', 'panel.close', 'sidebar.focus', 'panel.focus', 'focus.return', 'focus.cycle'].includes(action);
}

/**
 * Fullscreen/raw passthrough and idle screens own the whole pane: the frontend switches the owner to PASSTHROUGH (or
 * its idle owner) and keeps the previous state. On return the previous owner comes back if its region is still open;
 * otherwise the composer. Selection, expansion and scroll positions live in the region controllers and are untouched.
 */
export function resumeFocus(previous: WorkspaceFocusState, current: Pick<WorkspaceFocusState, 'sidebarOpen' | 'panelOpen'>): WorkspaceFocusState {
  const owner = previous.owner === 'LEFT_SIDEBAR' && !current.sidebarOpen ? 'COMPOSER'
    : previous.owner === 'RIGHT_PANEL' && !current.panelOpen ? 'COMPOSER' : previous.owner;
  return {...current, owner};
}
