import type {Key} from '../terminal/keys.js';
import type {GitRunner} from './git.js';
import {discoverWorktrees, type DiscoveryOptions} from './discovery.js';
import {checkoutLabel, displayText, stateWords, type WorktreeRecord, type WorktreeSnapshot} from './model.js';
import {
  applyNewWorktree, applyRemoval, planNewWorktree, planRemoval, removalAvailability,
  type NewWorktreePlan, type NewWorktreeRequest, type RemovalPlan,
} from './mutations.js';

/**
 * Typed intents a future host (TerminalApp, #331 sidebar) acts on. The core
 * never performs navigation itself and never claims a resource it cannot prove.
 */
export type NavigationIntent =
  | {readonly kind: 'cd'; readonly path: string}
  | {readonly kind: 'focusExistingResource'; readonly resourceId: string; readonly path: string};

export interface DiffIntent {
  readonly kind: 'diff';
  readonly repository: string;
  readonly worktreePath: string;
  readonly ref?: string;
  readonly head: string;
}

/** Resources the host can prove represent a worktree path (e.g. an NMSh session whose cwd is it). Optional. */
export type ResourceResolver = (path: string) => {readonly resourceId: string} | undefined;

export type ActionId = 'navigate' | 'new' | 'diff' | 'relatedPr' | 'remove' | 'refresh' | 'search';
export type ActionState = {readonly id: ActionId; readonly available: true} | {readonly id: ActionId; readonly available: false; readonly reason: string};

export type KeyOutcome =
  | {readonly kind: 'none'}
  | {readonly kind: 'changed'}
  | {readonly kind: 'navigate'; readonly intent: NavigationIntent}
  /** The host collects destination/branch input, then calls {@link WorktreeManagerController.planNew}. */
  | {readonly kind: 'requestNewWorktree'}
  | {readonly kind: 'removed'; readonly path: string}
  | {readonly kind: 'created'; readonly path: string}
  | {readonly kind: 'back'};

export type Review =
  | {readonly kind: 'remove'; readonly plan: RemovalPlan}
  | {readonly kind: 'new'; readonly plan: NewWorktreePlan};

export interface WorktreeManagerState {
  readonly snapshot?: WorktreeSnapshot;
  /** Last refresh failed; `snapshot` (if any) is the last successful one and is shown as stale. */
  readonly error?: string;
  readonly loading: boolean;
  readonly selectedId?: string;
  readonly query: string;
  readonly searching: boolean;
  readonly review?: Review;
  /** One-line factual outcome or refusal of the last action. */
  readonly message?: string;
}

export interface ControllerOptions {
  readonly git: GitRunner;
  readonly repository: string;
  /** The managed shell's cwd, if known: never offered for removal. */
  readonly currentPath?: () => string | undefined;
  readonly resources?: ResourceResolver;
  readonly discovery?: DiscoveryOptions;
}

export function searchText(worktree: WorktreeRecord): string {
  return [checkoutLabel(worktree), displayText(worktree.path), ...stateWords(worktree)].join(' ').toLowerCase();
}

export class WorktreeManagerController {
  private current: WorktreeManagerState = {loading: false, query: '', searching: false};
  private generation = 0;

  constructor(private readonly options: ControllerOptions) {}

  get state(): WorktreeManagerState { return this.current; }

  private set(patch: Partial<WorktreeManagerState>): void { this.current = {...this.current, ...patch}; }

  /** Explicit refresh. A failure keeps the previous snapshot visibly stale. Overlapping refreshes: last one wins. */
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.set({loading: true});
    try {
      const snapshot = await discoverWorktrees(this.options.git, this.options.repository, this.options.discovery);
      if (generation !== this.generation) return;
      const keep = snapshot.worktrees.some(worktree => worktree.id === this.current.selectedId);
      this.set({snapshot, error: undefined, loading: false, selectedId: keep ? this.current.selectedId : snapshot.worktrees[0]?.id});
    } catch (error) {
      if (generation !== this.generation) return;
      this.set({error: displayText((error as Error).message, 400), loading: false});
    }
  }

  /** Rows after local search: loaded metadata only, no I/O per keystroke. */
  visible(): readonly WorktreeRecord[] {
    const rows = this.current.snapshot?.worktrees ?? [];
    const query = this.current.query.trim().toLowerCase();
    return query ? rows.filter(row => searchText(row).includes(query)) : rows;
  }

  selected(): WorktreeRecord | undefined {
    const rows = this.visible();
    return rows.find(row => row.id === this.current.selectedId) ?? rows[0];
  }

  select(id: string): boolean {
    if (!this.visible().some(row => row.id === id)) return false;
    this.set({selectedId: id});
    return true;
  }

  move(delta: number): void {
    const rows = this.visible();
    if (!rows.length) return;
    const index = Math.max(0, rows.findIndex(row => row.id === this.selected()?.id));
    this.set({selectedId: rows[Math.max(0, Math.min(rows.length - 1, index + delta))]!.id});
  }

  navigationIntent(worktree = this.selected()): NavigationIntent | undefined {
    if (!worktree || worktree.bare || worktree.prunable || worktree.pathState !== 'present') return undefined;
    const resource = this.options.resources?.(worktree.path);
    return resource ? {kind: 'focusExistingResource', resourceId: resource.resourceId, path: worktree.path} : {kind: 'cd', path: worktree.path};
  }

  diffIntent(worktree = this.selected()): DiffIntent | undefined {
    const repository = this.current.snapshot?.commonDir;
    if (!worktree || !repository || !worktree.head || worktree.bare || worktree.pathState !== 'present') return undefined;
    return {kind: 'diff', repository, worktreePath: worktree.path, ref: worktree.ref, head: worktree.head};
  }

  /** Availability from current facts only; drives footers and key dispatch alike. */
  actions(): ActionState[] {
    const worktree = this.selected();
    const none = (id: ActionId, reason: string): ActionState => ({id, available: false, reason});
    const stale = this.current.error !== undefined;
    const removal = worktree ? removalAvailability(worktree, this.options.currentPath?.()) : {available: false as const, reason: 'Nothing selected'};
    return [
      this.navigationIntent() ? {id: 'navigate', available: true} : none('navigate', 'Path is not available'),
      this.current.snapshot && !stale ? {id: 'new', available: true} : none('new', 'Refresh first'),
      this.diffIntent() ? {id: 'diff', available: true} : none('diff', 'No HEAD or path'),
      none('relatedPr', 'No pull request evidence yet'),
      stale ? none('remove', 'List is stale; refresh first') : removal.available ? {id: 'remove', available: true} : none('remove', removal.reason),
      {id: 'refresh', available: true},
      this.current.snapshot ? {id: 'search', available: true} : none('search', 'Nothing loaded'),
    ];
  }

  available(id: ActionId): boolean {
    return this.actions().some(action => action.id === id && action.available);
  }

  async planNew(request: NewWorktreeRequest): Promise<boolean> {
    const plan = await planNewWorktree(this.options.git, this.options.repository, request);
    this.set(plan.ok ? {review: {kind: 'new', plan: plan.value}, message: undefined} : {review: undefined, message: plan.reason});
    return plan.ok;
  }

  async previewRemoval(): Promise<boolean> {
    const worktree = this.selected();
    if (!worktree || !this.available('remove')) {
      const reason = this.actions().find(action => action.id === 'remove');
      this.set({message: reason && !reason.available ? reason.reason : 'Removal is not available'});
      return false;
    }
    const plan = await planRemoval(this.options.git, this.options.repository, worktree.id, this.options.currentPath?.());
    this.set(plan.ok ? {review: {kind: 'remove', plan: plan.value}, message: undefined} : {review: undefined, message: plan.reason});
    return plan.ok;
  }

  /** The explicit confirmation step. apply() revalidates; on any change the review is dropped and must be redone. */
  async confirm(): Promise<KeyOutcome> {
    const review = this.current.review;
    if (!review) return {kind: 'none'};
    const result = review.kind === 'remove'
      ? await applyRemoval(this.options.git, this.options.repository, review.plan, {confirmed: true}, this.options.currentPath?.())
      : await applyNewWorktree(this.options.git, this.options.repository, review.plan, {confirmed: true});
    this.set({review: undefined, message: result.ok ? undefined : result.reason});
    if (!result.ok) return {kind: 'changed'};
    await this.refresh();
    if (review.kind === 'new') this.select(result.value);
    this.set({message: review.kind === 'remove' ? `Removed ${displayText(result.value)}` : `Created ${displayText(result.value)}`});
    return review.kind === 'remove' ? {kind: 'removed', path: result.value} : {kind: 'created', path: result.value};
  }

  cancelReview(): void { this.set({review: undefined}); }

  /**
   * Keyboard model: ↑/↓ select, Enter navigate, n new, x preview removal,
   * r refresh, / search, Esc clears search, then review, then goes back.
   */
  async handleKey(key: Key): Promise<KeyOutcome> {
    if (this.current.review) {
      if (key.kind === 'enter') return this.confirm();
      if (key.kind === 'escape') { this.cancelReview(); return {kind: 'changed'}; }
      return {kind: 'none'};
    }
    if (this.current.searching) {
      if (key.kind === 'escape') { this.set({searching: false, query: ''}); return {kind: 'changed'}; }
      if (key.kind === 'backspace') { this.set({query: [...this.current.query].slice(0, -1).join('')}); return {kind: 'changed'}; }
      if (key.kind === 'text' || key.kind === 'paste') {
        const text = displayText(key.value, 128).replace(/\s+/gu, ' ');
        this.set({query: (this.current.query + text).slice(0, 128)});
        return {kind: 'changed'};
      }
      if (key.kind === 'enter') { this.set({searching: false}); return {kind: 'changed'}; }
    }
    switch (key.kind) {
      case 'up': this.move(-1); return {kind: 'changed'};
      case 'down': this.move(1); return {kind: 'changed'};
      case 'enter': {
        const intent = this.navigationIntent();
        return intent ? {kind: 'navigate', intent} : {kind: 'none'};
      }
      case 'escape':
        if (this.current.query) { this.set({query: '', searching: false}); return {kind: 'changed'}; }
        return {kind: 'back'};
      case 'text': {
        const value = key.value.toLowerCase();
        if (value === 'r') { await this.refresh(); return {kind: 'changed'}; }
        if (value === 'n') return this.available('new') ? {kind: 'requestNewWorktree'} : {kind: 'none'};
        if (value === 'x') { await this.previewRemoval(); return {kind: 'changed'}; }
        if (value === '/' && this.available('search')) { this.set({searching: true}); return {kind: 'changed'}; }
        return {kind: 'none'};
      }
      default: return {kind: 'none'};
    }
  }
}
