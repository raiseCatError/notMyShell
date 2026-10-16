import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import type {Key} from '../terminal/keys.js';
import {applyFocusAction, isFocusAction, regionOf, routeWorkspaceKey, type WorkspaceFocusState, type WorkspaceOwner} from '../workspace/focus.js';
import {DEFAULT_BINDINGS, type Binding, type WorkspaceActionId} from '../workspace/keymap.js';
import {applyKeymap, type KeymapProblem} from '../workspace/keymapConfig.js';
import {planWorkspaceColumns, type WorkspaceColumns} from '../workspace/layout.js';
import {PanelController, renderPanel, resourceDetail} from '../workspace/panel.js';
import type {ActivationIntent, WorkspaceResource} from '../workspace/resources.js';
import {renderSidebar, SidebarController} from '../workspace/sidebar.js';
import {managerLinks, worktreeSection} from '../workspace/sources.js';
import {tmuxNavigationArgs, tmuxResources, type TmuxListing, type TmuxRunner, type TmuxServer} from '../workspace/tmux.js';
import type {WorktreeSnapshot} from '../worktrees/model.js';

/**
 * The frontend's side of the workspace (#330): one focus state, the sidebar
 * and detail panel controllers, the keymap in effect and the listings the
 * sidebar shows. It performs no terminal I/O and never touches the shell:
 * keys and pointer hits come in, and what the frontend must do comes out as an
 * intent (stage a `cd`, open a manager, navigate tmux), performed by the
 * frontend through the same paths its other commands use.
 */

export type WorkspaceEffect =
  | {kind: 'none'}
  /** The experimental regions are Off: nothing opened; the frontend says how to turn them on. */
  | {kind: 'disabled'}
  | {kind: 'render'}
  | {kind: 'refresh'}
  | {kind: 'intent'; intent: ActivationIntent; resource: WorkspaceResource};

/** Keys a focused region never takes: job control and the palette always keep their meaning. */
const ALWAYS_THROUGH: ReadonlySet<Key['kind']> = new Set(['interrupt', 'suspend', 'eof', 'palette', 'focusIn', 'focusOut']);

export interface WorkspaceSources {
  tmux?: {server: TmuxServer; listing?: TmuxListing; runner?: TmuxRunner};
  worktrees?: WorktreeSnapshot;
  cwd: string;
}

/** Actions that open or focus a region: the only ways in, so the experimental switch gates exactly these. */
const OPENING: ReadonlySet<WorkspaceActionId> = new Set(['sidebar.toggle', 'sidebar.focus', 'panel.toggle', 'panel.focus']);

export const WORKSPACE_DISABLED_MESSAGE = 'The workspace sidebar and detail panel are experimental and Off. Turn them on in Settings → Layout → Workspace sidebar & panel (or Setup → Editor). /worktrees, /sessions, /github and /background work without them.';

export class WorkspaceHost {
  state: WorkspaceFocusState = {owner: 'COMPOSER', sidebarOpen: false, panelOpen: false};
  /** `enabled`: the experimental setting (the frontend passes its configuration; on by default for the host alone). */
  constructor(private readonly enabled: () => boolean = () => true) {}
  get available(): boolean { return this.enabled(); }
  /** Close both regions and give the keyboard back to the composer (the setting was turned Off). */
  close(): void { this.state = {owner: 'COMPOSER', sidebarOpen: false, panelOpen: false}; this.message = undefined; }
  readonly sidebar = new SidebarController();
  readonly panel = new PanelController();
  bindings: readonly Binding[] = DEFAULT_BINDINGS;
  problems: KeymapProblem[] = [];
  /** A one-line note in the sidebar (an unavailable item, a failed navigation). */
  message?: string;
  sources: WorkspaceSources = {cwd: ''};

  /** Read `keymap.json` beside NMSh's other configuration. A missing file is the defaults; anything else is validated. */
  loadKeymap(env: NodeJS.ProcessEnv = process.env): void {
    let input: unknown;
    try { input = JSON.parse(readFileSync(join(nmshConfigDirectory(env), 'keymap.json'), 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') input = undefined;
      else { this.bindings = DEFAULT_BINDINGS; this.problems = [{severity: 'error', message: 'keymap.json could not be read as JSON; the defaults are in effect'}]; return; }
    }
    const result = applyKeymap(input);
    this.bindings = result.bindings;
    this.problems = result.problems;
  }

  /** The owner whose region typing goes to: a protected owner always wins, then an open, focused region, then the composer. */
  owner(protectedOwner: WorkspaceOwner | undefined): WorkspaceOwner {
    if (protectedOwner) return protectedOwner;
    if (this.state.owner === 'LEFT_SIDEBAR' && this.state.sidebarOpen) return 'LEFT_SIDEBAR';
    if (this.state.owner === 'RIGHT_PANEL' && this.state.panelOpen) return 'RIGHT_PANEL';
    return 'COMPOSER';
  }

  /** The frame's column plan: the one geometry every consumer (render, cursor, pointer, PTY size) uses. */
  plan(columns: number, suppressed: boolean, owner: WorkspaceOwner): WorkspaceColumns {
    return planWorkspaceColumns({columns, sidebarOpen: this.state.sidebarOpen, panelOpen: this.state.panelOpen, suppressed, focus: regionOf(owner)});
  }

  /** Whether the frontend has anything to compose: a region is open (it may still be suppressed or tucked). */
  get open(): boolean { return this.state.sidebarOpen || this.state.panelOpen; }

  /**
   * A key, before the composer's own handling. `undefined`: not the workspace's, handle it as before. A focused region
   * keeps its keys (an unbound key does nothing there), except job control and the palette.
   */
  handleKey(key: Key, context: {owner: WorkspaceOwner; composerIdle: boolean; columns: number; viewRows: number}): WorkspaceEffect | undefined {
    const {owner} = context;
    if (owner === 'LEFT_SIDEBAR' && this.sidebar.searching && this.sidebar.handleSearchKey(key)) return {kind: 'render'};
    const action = routeWorkspaceKey(key, {owner, composerEmpty: context.composerIdle, sidebarOpen: this.state.sidebarOpen,
      panelOpen: this.state.panelOpen, bindings: this.bindings});
    if (!action) {
      if ((owner === 'LEFT_SIDEBAR' || owner === 'RIGHT_PANEL') && !ALWAYS_THROUGH.has(key.kind)) return {kind: 'none'};
      return undefined;
    }
    return this.perform(action, context.columns, context.viewRows);
  }

  perform(action: WorkspaceActionId, columns: number, viewRows = 10): WorkspaceEffect {
    if (!this.enabled() && OPENING.has(action) && !this.open) return {kind: 'disabled'};
    this.message = undefined;
    if (isFocusAction(action)) {
      const before = this.state;
      this.state = applyFocusAction(this.state, action, columns);
      const opened = (!before.sidebarOpen && this.state.sidebarOpen) || (before.owner !== 'LEFT_SIDEBAR' && this.state.owner === 'LEFT_SIDEBAR');
      if (this.state.panelOpen && !before.panelOpen) this.previewSelection();
      return opened ? {kind: 'refresh'} : {kind: 'render'};
    }
    if (action.startsWith('panel.')) { this.panel.dispatch(action, viewRows); return {kind: 'render'}; }
    const outcome = this.sidebar.dispatch(action);
    if (outcome.kind === 'preview') this.previewSelection();
    else if (outcome.kind === 'unavailable') this.message = outcome.reason;
    else if (outcome.kind === 'activate') return {kind: 'intent', intent: outcome.intent, resource: outcome.resource};
    return {kind: 'render'};
  }

  /** The selected resource in the panel, from what the sidebar already holds; nothing is asked of any owner. */
  previewSelection(): void {
    const row = this.sidebar.selected();
    if (row && this.state.panelOpen) this.panel.show(resourceDetail(row.resource));
  }

  /** Replace the listings and rebuild the sidebar from them. */
  setSources(sources: WorkspaceSources, now = Date.now()): void {
    this.sources = sources;
    const sections: WorkspaceResource[] = [];
    if (sources.tmux) sections.push(tmuxResources(sources.tmux.listing?.panes ?? [], sources.tmux.server, sources.tmux.listing?.observedAt ?? now));
    sections.push(worktreeSection(sources.worktrees, sources.cwd), managerLinks());
    this.sidebar.setResources(sections);
    if (sources.tmux?.listing?.error) this.message = sources.tmux.listing.error;
    this.previewSelection();
  }

  /** tmux navigation arguments for an intent from the current listing, or why it cannot be done. */
  tmuxArgs(intent: Extract<ActivationIntent, {kind: 'tmux'}>): string[] | {error: string} {
    return tmuxNavigationArgs(intent, this.sources.tmux?.listing?.panes ?? []);
  }

  sidebarRows(plan: WorkspaceColumns, rows: number, owner: WorkspaceOwner, style: {safe: boolean; color: boolean; now: number}): string[] | undefined {
    const {sidebar} = plan;
    if (sidebar.mode === 'hidden' || !sidebar.region) return undefined;
    return renderSidebar(this.sidebar, {width: sidebar.region.width, rows, focused: owner === 'LEFT_SIDEBAR', mode: sidebar.mode, ...style,
      bindings: this.bindings, ...(this.message ? {message: this.message} : {})});
  }

  panelRows(plan: WorkspaceColumns, rows: number, owner: WorkspaceOwner, style: {safe: boolean; color: boolean; now: number}): string[] | undefined {
    const {panel} = plan;
    if (panel.mode === 'hidden' || !panel.region) return undefined;
    return renderPanel(this.panel, {width: panel.region.width, rows, focused: owner === 'RIGHT_PANEL', ...style, bindings: this.bindings});
  }
}
