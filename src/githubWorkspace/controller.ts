import {buildDiffModel, type DiffDepth, type DiffModel, externalReviewIntent, type ExternalReviewIntent} from './diff.js';
import {GithubError, type IssueDetail, type ItemRef, itemKey, LIMITS, type MergeMethod, type PrDetail, type SearchItem} from './model.js';
import {type MergePlan, type OpenRelatedWorktreeIntent, planMerge, relatedWorktreeIntent} from './mergePlan.js';
import {type PreparedQuery, prepareQuery, type QueryNotice, type QueryScope, rememberQuery} from './query.js';
import type {GithubWorkspaceService} from './service.js';
import {redactMessage} from './transport.js';

/**
 * Keyboard-first state machine for the GitHub workspace. It owns navigation
 * state and asks the service for data only in response to explicit actions
 * (open, submit, refresh, more). Rendering is a separate pure function of the
 * state snapshot. Selection never causes a remote mutation.
 */

export type WorkspaceKey =
  | 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end' | 'enter' | 'escape' | 'tab' | 'shiftTab' | 'backspace'
  | {char: string};

export type ListTab = 'prs' | 'issues' | 'search';
export const LIST_TABS: readonly ListTab[] = ['prs', 'issues', 'search'];
export const LIST_TAB_LABELS: Record<ListTab, string> = {prs: 'PRs', issues: 'Issues', search: 'Search'};
const TAB_SCOPE: Record<ListTab, QueryScope> = {prs: 'pr', issues: 'issue', search: 'all'};

export type PrTab = 'overview' | 'diff' | 'checks' | 'comments' | 'commits' | 'files';
export type IssueTab = 'overview' | 'comments' | 'related';
export const PR_TABS: readonly PrTab[] = ['overview', 'diff', 'checks', 'comments', 'commits', 'files'];
export const ISSUE_TABS: readonly IssueTab[] = ['overview', 'comments', 'related'];

/** Which region owns the keyboard. Exactly one at a time. */
export type FocusRegion = 'list' | 'query' | 'detail' | 'merge';

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface ListState {
  query?: PreparedQuery;
  /** Text shown in the query editor before submission. */
  draft: string;
  status: LoadStatus;
  refreshing: boolean;
  loadingMore: boolean;
  items: SearchItem[];
  total?: number;
  cursor?: string;
  hasNextPage: boolean;
  pages: number;
  fetchedAt?: number;
  error?: GithubError;
  warnings: string[];
  notices: QueryNotice[];
  selectedKey?: string;
  selectedIndex: number;
  /** Set when a refresh no longer contains the previously selected item. */
  selectionLost: boolean;
  rateRemaining?: number;
}

export interface DiffState {
  status: LoadStatus;
  model?: DiffModel;
  error?: GithubError;
  depth: Exclude<DiffDepth, 'external'>;
}

export interface DetailState {
  ref: ItemRef;
  status: LoadStatus;
  refreshing: boolean;
  pr?: PrDetail;
  issue?: IssueDetail;
  error?: GithubError;
  tab: PrTab | IssueTab;
  scroll: number;
  fileIndex: number;
  diff: DiffState;
}

export interface MergePreviewState {
  method: MergeMethod;
  deleteBranch: boolean;
  plan: MergePlan;
}

export type WorkspaceIntent =
  | {type: 'OpenExternal'; url: string}
  | ExternalReviewIntent
  | OpenRelatedWorktreeIntent
  | {type: 'Exit'};

export interface WorkspaceState {
  title: string;
  tab: ListTab;
  lists: Record<ListTab, ListState>;
  focus: FocusRegion;
  /** Focus to return to when the query editor closes. */
  queryReturn: FocusRegion;
  detail?: DetailState;
  merge?: MergePreviewState;
  history: string[];
  historyIndex: number;
  message?: string;
  lastIntent?: WorkspaceIntent;
}

export interface ControllerOptions {
  title?: string;
  initialQueries?: Partial<Record<ListTab, string>>;
  clock?: () => number;
  /** Data older than this is labelled stale. */
  staleAfterMs?: number;
}

function emptyList(draft: string): ListState {
  return {draft, status: 'idle', refreshing: false, loadingMore: false, items: [], hasNextPage: false, pages: 0, warnings: [], notices: [],
    selectedIndex: 0, selectionLost: false};
}

export class GithubWorkspaceController {
  private state: WorkspaceState;
  private readonly listeners = new Set<() => void>();
  private readonly generations = new Map<string, number>();
  private readonly clock: () => number;
  readonly staleAfterMs: number;
  private rows = 24;
  private columns = 80;
  /** Lines in the current detail body for the given width; supplied by the renderer (pure). */
  bodyLineCount: (state: WorkspaceState, columns: number) => number = () => Number.MAX_SAFE_INTEGER;

  constructor(private readonly service: GithubWorkspaceService, options: ControllerOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.staleAfterMs = options.staleAfterMs ?? 120_000;
    const queries = options.initialQueries ?? {};
    this.state = {
      title: options.title ?? 'GitHub',
      tab: 'prs',
      lists: {prs: emptyList(queries.prs ?? 'is:open'), issues: emptyList(queries.issues ?? 'is:open'), search: emptyList(queries.search ?? '')},
      focus: 'list', queryReturn: 'list', history: [], historyIndex: -1,
    };
  }

  get snapshot(): Readonly<WorkspaceState> { return this.state; }
  now(): number { return this.clock(); }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(mutator: (state: WorkspaceState) => void): void {
    mutator(this.state);
    for (const listener of this.listeners) listener();
  }

  /** Shows a transient, already-trusted host message (e.g. an intent the host did not execute). */
  notify(message: string | undefined): void {
    this.update(state => { state.message = message; });
  }

  setViewport(columns: number, rows: number): void {
    this.columns = Math.max(1, columns);
    this.rows = Math.max(1, rows);
  }

  private get pageRows(): number { return Math.max(1, this.rows - 6); }

  private generation(key: string): number {
    const next = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, next);
    return next;
  }
  private current(key: string, generation: number): boolean { return this.generations.get(key) === generation; }

  /** Submit (or re-submit) the active list's draft. Explicit only: never per keystroke. */
  submitQuery(tab: ListTab = this.state.tab, raw = this.state.lists[tab].draft): Promise<void> {
    const prepared = prepareQuery(raw, TAB_SCOPE[tab]);
    if (!prepared.ok) {
      this.update(state => { state.message = prepared.error; state.lists[tab].draft = raw; });
      return Promise.resolve();
    }
    this.update(state => {
      const list = state.lists[tab];
      const sameQuery = list.query?.effective === prepared.query.effective;
      list.draft = raw;
      list.query = prepared.query;
      list.notices = prepared.query.notices;
      list.error = undefined;
      list.warnings = [];
      if (sameQuery && list.items.length) list.refreshing = true;
      else { list.status = 'loading'; list.items = []; list.selectedIndex = 0; list.selectedKey = undefined; list.cursor = undefined; list.pages = 0; }
      list.selectionLost = false;
      state.history = rememberQuery(state.history, raw);
      state.historyIndex = -1;
      state.message = undefined;
    });
    return this.loadFirstPage(tab, prepared.query.effective);
  }

  private async loadFirstPage(tab: ListTab, effective: string): Promise<void> {
    const generation = this.generation(`list:${tab}`);
    try {
      const page = await this.service.search(effective);
      if (!this.current(`list:${tab}`, generation)) return;
      this.update(state => {
        const list = state.lists[tab];
        const previousKey = list.selectedKey;
        list.items = page.items.slice(0, LIMITS.maxResults);
        list.total = page.total;
        list.cursor = page.endCursor;
        list.hasNextPage = page.hasNextPage;
        list.pages = 1;
        list.status = 'loaded';
        list.refreshing = false;
        list.fetchedAt = this.clock();
        list.warnings = page.warnings ?? [];
        list.rateRemaining = page.rateLimit?.remaining;
        this.restoreSelection(list, previousKey);
      });
    } catch (error) {
      if (!this.current(`list:${tab}`, generation)) return;
      this.update(state => {
        const list = state.lists[tab];
        list.error = asGithubError(error);
        list.refreshing = false;
        // Previously loaded results stay visible, labelled stale, rather than being discarded.
        list.status = list.items.length ? 'loaded' : 'error';
      });
    }
  }

  private restoreSelection(list: ListState, previousKey: string | undefined): void {
    if (previousKey) {
      const index = list.items.findIndex(item => itemKey(item.ref) === previousKey);
      if (index >= 0) { list.selectedIndex = index; list.selectionLost = false; return; }
      list.selectionLost = true;
    }
    list.selectedIndex = Math.min(list.selectedIndex, Math.max(0, list.items.length - 1));
    list.selectedKey = list.items[list.selectedIndex] ? itemKey(list.items[list.selectedIndex].ref) : undefined;
  }

  async loadMore(tab: ListTab = this.state.tab): Promise<void> {
    const list = this.state.lists[tab];
    if (!list.query || !list.hasNextPage || list.loadingMore || list.status !== 'loaded') return;
    if (list.pages >= LIMITS.maxPages || list.items.length >= LIMITS.maxResults) {
      this.update(state => { state.message = `Result bound reached (${LIMITS.maxResults} items). Narrow the query to see more.`; });
      return;
    }
    const generation = this.generation(`list:${tab}`);
    this.update(() => { list.loadingMore = true; });
    try {
      const page = await this.service.search(list.query.effective, list.cursor);
      if (!this.current(`list:${tab}`, generation)) return;
      this.update(() => {
        const seen = new Set(list.items.map(item => itemKey(item.ref)));
        for (const item of page.items) if (!seen.has(itemKey(item.ref)) && list.items.length < LIMITS.maxResults) list.items.push(item);
        list.cursor = page.endCursor;
        list.hasNextPage = page.hasNextPage;
        list.pages++;
        list.loadingMore = false;
        list.rateRemaining = page.rateLimit?.remaining ?? list.rateRemaining;
      });
    } catch (error) {
      if (!this.current(`list:${tab}`, generation)) return;
      this.update(state => { list.loadingMore = false; state.message = `Could not load more: ${asGithubError(error).message}`; });
    }
  }

  selectedItem(tab: ListTab = this.state.tab): SearchItem | undefined {
    const list = this.state.lists[tab];
    return list.items[list.selectedIndex];
  }

  private moveSelection(delta: number): void {
    this.update(state => {
      const list = state.lists[state.tab];
      if (!list.items.length) return;
      list.selectedIndex = Math.max(0, Math.min(list.items.length - 1, list.selectedIndex + delta));
      list.selectedKey = itemKey(list.items[list.selectedIndex].ref);
      list.selectionLost = false;
    });
  }

  /** Opens the selected item's detail; fetches lazily (cache first, then GitHub). */
  openDetail(ref: ItemRef | undefined = this.selectedItem()?.ref): Promise<void> {
    if (!ref) return Promise.resolve();
    const pr = ref.kind === 'pr' ? this.service.cachedPullRequest(ref) : undefined;
    const issue = ref.kind === 'issue' ? this.service.cachedIssue(ref) : undefined;
    this.update(state => {
      state.detail = {ref, status: pr || issue ? 'loaded' : 'loading', refreshing: false, pr, issue, tab: 'overview', scroll: 0, fileIndex: 0,
        diff: {status: 'idle', depth: 'review'}};
      state.focus = 'detail';
      state.merge = undefined;
      state.message = undefined;
    });
    if (pr || issue) return Promise.resolve();
    return this.loadDetail();
  }

  async loadDetail(): Promise<void> {
    const detail = this.state.detail;
    if (!detail) return;
    const key = `detail:${itemKey(detail.ref)}`;
    const generation = this.generation(key);
    this.update(() => {
      if (detail.pr || detail.issue) detail.refreshing = true; else detail.status = 'loading';
      detail.error = undefined;
    });
    try {
      if (detail.ref.kind === 'pr') {
        const pr = await this.service.pullRequest(detail.ref);
        if (!this.current(key, generation) || this.state.detail !== detail) return;
        this.update(state => {
          const headChanged = detail.pr?.headSha !== undefined && detail.pr.headSha !== pr.headSha;
          detail.pr = pr;
          if (headChanged) { detail.diff = {status: 'idle', depth: detail.diff.depth}; detail.fileIndex = 0; }
          detail.status = 'loaded';
          detail.refreshing = false;
          if (state.merge) state.merge.plan = planMerge(pr, state.merge, this.clock(), this.staleAfterMs);
        });
        if (detail.tab === 'diff' && detail.diff.status === 'idle') await this.loadDiff();
      } else {
        const issue = await this.service.issue(detail.ref);
        if (!this.current(key, generation) || this.state.detail !== detail) return;
        this.update(() => { detail.issue = issue; detail.status = 'loaded'; detail.refreshing = false; });
      }
    } catch (error) {
      if (!this.current(key, generation) || this.state.detail !== detail) return;
      this.update(() => {
        detail.error = asGithubError(error);
        detail.refreshing = false;
        detail.status = detail.pr || detail.issue ? 'loaded' : 'error';
      });
    }
  }

  /** Patches load only when the Diff tab is opened for a selected PR. */
  async loadDiff(): Promise<void> {
    const detail = this.state.detail;
    const pr = detail?.pr;
    if (!detail || !pr || detail.diff.status === 'loading') return;
    const source = {repository: `${pr.summary.ref.owner}/${pr.summary.ref.repo}`, number: pr.summary.ref.number,
      baseRef: pr.summary.baseRef, headRef: pr.summary.headRef, headSha: pr.headSha};
    const cached = this.service.cachedPatches(detail.ref, pr.headSha);
    if (cached) { this.update(() => { detail.diff = {status: 'loaded', model: buildDiffModel(source, cached), depth: detail.diff.depth}; }); return; }
    const key = `diff:${itemKey(detail.ref)}`;
    const generation = this.generation(key);
    this.update(() => { detail.diff = {status: 'loading', depth: detail.diff.depth}; });
    try {
      const fetched = await this.service.pullRequestPatches(detail.ref, pr.headSha, pr.summary.changedFiles);
      if (!this.current(key, generation) || this.state.detail !== detail) return;
      this.update(() => { detail.diff = {status: 'loaded', model: buildDiffModel(source, fetched), depth: detail.diff.depth}; });
    } catch (error) {
      if (!this.current(key, generation) || this.state.detail !== detail) return;
      this.update(() => { detail.diff = {status: 'error', error: asGithubError(error), depth: detail.diff.depth}; });
    }
  }

  private detailTabs(): readonly (PrTab | IssueTab)[] {
    return this.state.detail?.ref.kind === 'pr' ? PR_TABS : ISSUE_TABS;
  }

  private setDetailTab(delta: number): void {
    const detail = this.state.detail;
    if (!detail) return;
    const tabs = this.detailTabs();
    const index = (tabs.indexOf(detail.tab) + delta + tabs.length) % tabs.length;
    this.update(() => { detail.tab = tabs[index]; detail.scroll = 0; });
    if (detail.tab === 'diff' && detail.diff.status === 'idle') void this.loadDiff();
  }

  private scrollDetail(delta: number): void {
    const detail = this.state.detail;
    if (!detail) return;
    const max = Math.max(0, this.bodyLineCount(this.state, this.columns) - this.pageRows);
    this.update(() => { detail.scroll = Math.max(0, Math.min(max, detail.scroll + delta)); });
  }

  private fileCount(): number {
    const detail = this.state.detail;
    if (!detail) return 0;
    return detail.diff.model?.files.length ?? detail.pr?.files.length ?? 0;
  }

  private stepFile(delta: number): void {
    const detail = this.state.detail;
    const count = this.fileCount();
    if (!detail || !count) return;
    this.update(() => { detail.fileIndex = Math.max(0, Math.min(count - 1, detail.fileIndex + delta)); if (detail.tab === 'diff') detail.scroll = 0; });
  }

  openMergePreview(method?: MergeMethod): void {
    const pr = this.state.detail?.pr;
    if (!pr) return;
    const support = pr.policy;
    const chosen = method ?? (['squash', 'merge', 'rebase'] as const).find(m => support[m] === true) ?? 'merge';
    this.update(state => {
      state.merge = {method: chosen, deleteBranch: false, plan: planMerge(pr, {method: chosen, deleteBranch: false}, this.clock(), this.staleAfterMs)};
      state.focus = 'merge';
      if (state.detail) state.detail.scroll = 0;
    });
  }

  private replan(mutate: (merge: MergePreviewState) => void): void {
    const pr = this.state.detail?.pr;
    const merge = this.state.merge;
    if (!pr || !merge) return;
    this.update(() => { mutate(merge); merge.plan = planMerge(pr, merge, this.clock(), this.staleAfterMs); });
  }

  private emit(intent: WorkspaceIntent): WorkspaceIntent {
    this.update(state => { state.lastIntent = intent; });
    return intent;
  }

  /** The current item's GitHub URL, if GitHub reported one. */
  private currentUrl(): string | undefined {
    const detail = this.state.detail;
    if (this.state.focus === 'detail' && detail) return detail.pr?.summary.url ?? detail.issue?.summary.url;
    return this.selectedItem()?.url;
  }

  /** Keys that do something right now: drives contextual help. */
  availableActions(): Array<{key: string; label: string}> {
    const state = this.state;
    const actions: Array<{key: string; label: string}> = [];
    const add = (key: string, label: string) => actions.push({key, label});
    if (state.focus === 'query') {
      add('Enter', 'search'); add('Esc', 'cancel');
      if (state.history.length) add('Up/Down', 'history');
      return actions;
    }
    if (state.focus === 'merge') {
      add('Esc', 'close'); add('Tab', 'method'); add('Up/Down', 'scroll'); add('B', 'delete branch'); add('R', 'refresh');
      return actions;
    }
    if (state.focus === 'detail' && state.detail) {
      const detail = state.detail;
      add('Esc', 'back'); add('Tab', 'section'); add('Up/Down', detail.tab === 'files' ? 'file' : 'scroll'); add('PgUp/PgDn', 'page');
      if ((detail.tab === 'diff' || detail.tab === 'files') && this.fileCount() > 1) add('N/P', 'file');
      if (detail.tab === 'files' && this.fileCount()) add('Enter', 'diff');
      if (detail.tab === 'diff' && detail.diff.model) add('D', detail.diff.depth === 'review' ? 'compact' : 'review');
      add('R', 'refresh');
      if (detail.pr && detail.pr.summary.state === 'open') add('M', 'merge preview');
      if (detail.pr) add('W', 'worktree');
      if (this.currentUrl()) add('O', 'open on GitHub');
      return actions;
    }
    const list = state.lists[state.tab];
    add('Q', 'quit');
    if (list.items.length) add('Up/Down', 'select');
    if (list.items.length) add('Enter', 'inspect');
    add('/', 'search'); add('Tab', 'view');
    if (list.query) add('R', 'refresh');
    if (list.hasNextPage) add('N', 'more');
    if (this.currentUrl()) add('O', 'open');
    return actions;
  }

  /** Handles one semantic key. Returns an intent when the action leaves the workspace's scope. */
  handleKey(key: WorkspaceKey): WorkspaceIntent | undefined {
    const state = this.state;
    if (state.message && state.focus !== 'query') this.update(s => { s.message = undefined; });
    switch (state.focus) {
      case 'query': return this.handleQueryKey(key);
      case 'merge': return this.handleMergeKey(key);
      case 'detail': return this.handleDetailKey(key);
      default: return this.handleListKey(key);
    }
  }

  private openQuery(): void {
    this.update(state => {
      state.queryReturn = state.focus;
      state.focus = 'query';
      const list = state.lists[state.tab];
      list.draft = list.query?.original ?? list.draft;
      state.historyIndex = -1;
    });
  }

  private handleQueryKey(key: WorkspaceKey): WorkspaceIntent | undefined {
    const list = this.state.lists[this.state.tab];
    if (typeof key === 'object') {
      if (key.char.length !== 1 || /[\u0000-\u001f\u007f]/u.test(key.char)) return undefined;
      if (list.draft.length < LIMITS.queryLength) this.update(() => { list.draft += key.char; });
      return undefined;
    }
    switch (key) {
      case 'backspace': this.update(() => { list.draft = Array.from(list.draft).slice(0, -1).join(''); }); break;
      case 'escape': this.update(state => { state.focus = state.detail && state.queryReturn === 'detail' ? 'detail' : 'list'; list.draft = list.query?.original ?? list.draft; }); break;
      case 'enter':
        this.update(state => { state.focus = 'list'; state.detail = undefined; });
        void this.submitQuery();
        break;
      case 'up': case 'down': {
        const history = this.state.history;
        if (!history.length) break;
        this.update(state => {
          state.historyIndex = Math.max(-1, Math.min(history.length - 1, state.historyIndex + (key === 'up' ? 1 : -1)));
          list.draft = state.historyIndex === -1 ? list.query?.original ?? '' : history[state.historyIndex];
        });
        break;
      }
      default: break;
    }
    return undefined;
  }

  private handleListKey(key: WorkspaceKey): WorkspaceIntent | undefined {
    if (typeof key === 'object') {
      switch (key.char) {
        case '/': this.openQuery(); return undefined;
        case 'r': case 'R': if (this.state.lists[this.state.tab].query) void this.submitQuery(); return undefined;
        case 'n': case 'N': void this.loadMore(); return undefined;
        case 'j': this.moveSelection(1); return undefined;
        case 'k': this.moveSelection(-1); return undefined;
        case 'o': case 'O': { const url = this.currentUrl(); return url ? this.emit({type: 'OpenExternal', url}) : undefined; }
        case 'q': case 'Q': return this.emit({type: 'Exit'});
        default: return undefined;
      }
    }
    switch (key) {
      case 'up': this.moveSelection(-1); break;
      case 'down': this.moveSelection(1); break;
      case 'pageUp': this.moveSelection(-this.pageRows); break;
      case 'pageDown': this.moveSelection(this.pageRows); break;
      case 'home': this.moveSelection(-Number.MAX_SAFE_INTEGER); break;
      case 'end': this.moveSelection(Number.MAX_SAFE_INTEGER); break;
      case 'enter': void this.openDetail(); break;
      case 'escape': return this.emit({type: 'Exit'});
      case 'tab': case 'shiftTab': {
        const index = (LIST_TABS.indexOf(this.state.tab) + (key === 'tab' ? 1 : -1) + LIST_TABS.length) % LIST_TABS.length;
        this.update(state => { state.tab = LIST_TABS[index]; });
        const list = this.state.lists[this.state.tab];
        // First visit of a view with a query runs it once; an empty query opens the editor instead.
        if (list.status === 'idle') { if (list.draft.trim()) void this.submitQuery(); else this.openQuery(); }
        break;
      }
      default: break;
    }
    return undefined;
  }

  private handleDetailKey(key: WorkspaceKey): WorkspaceIntent | undefined {
    const detail = this.state.detail!;
    if (typeof key === 'object') {
      switch (key.char) {
        case 'r': case 'R':
          if (detail.tab === 'diff') {
            this.service.forgetPatches(detail.ref, detail.pr?.headSha);
            this.update(() => { detail.diff = {status: 'idle', depth: detail.diff.depth}; });
          }
          void this.loadDetail();
          return undefined;
        case 'n': case 'N': this.stepFile(1); return undefined;
        case 'p': case 'P': this.stepFile(-1); return undefined;
        case 'j': this.scrollDetail(1); return undefined;
        case 'k': this.scrollDetail(-1); return undefined;
        case 'd': case 'D':
          if (detail.tab === 'diff' && detail.diff.model) this.update(() => { detail.diff.depth = detail.diff.depth === 'review' ? 'compact' : 'review'; detail.scroll = 0; });
          return undefined;
        case 'm': case 'M': if (detail.pr?.summary.state === 'open') this.openMergePreview(); return undefined;
        case 'w': case 'W': return detail.pr ? this.emit(relatedWorktreeIntent(detail.pr)) : undefined;
        case 'o': case 'O': {
          if (detail.tab === 'diff' && detail.pr && detail.diff.model) {
            const intent = externalReviewIntent(detail.diff.model.source, detail.pr.summary.url);
            if (intent) return this.emit(intent);
          }
          const url = this.currentUrl();
          return url ? this.emit({type: 'OpenExternal', url}) : undefined;
        }
        case '/': this.openQuery(); return undefined;
        default: return undefined;
      }
    }
    const filesTab = detail.tab === 'files';
    switch (key) {
      case 'tab': this.setDetailTab(1); break;
      case 'shiftTab': this.setDetailTab(-1); break;
      case 'up': if (filesTab) this.stepFile(-1); else this.scrollDetail(-1); break;
      case 'down': if (filesTab) this.stepFile(1); else this.scrollDetail(1); break;
      case 'pageUp': if (filesTab) this.stepFile(-this.pageRows); else this.scrollDetail(-this.pageRows); break;
      case 'pageDown': if (filesTab) this.stepFile(this.pageRows); else this.scrollDetail(this.pageRows); break;
      case 'home': this.update(() => { detail.scroll = 0; }); break;
      case 'end': this.scrollDetail(Number.MAX_SAFE_INTEGER); break;
      case 'enter':
        if (filesTab && this.fileCount()) {
          this.update(() => { detail.tab = 'diff'; detail.scroll = 0; });
          if (detail.diff.status === 'idle') void this.loadDiff();
        }
        break;
      case 'escape': case 'backspace': this.update(state => { state.detail = undefined; state.focus = 'list'; }); break;
      default: break;
    }
    return undefined;
  }

  private handleMergeKey(key: WorkspaceKey): WorkspaceIntent | undefined {
    const methods: MergeMethod[] = ['merge', 'squash', 'rebase'];
    if (typeof key === 'object') {
      if (key.char === 'b' || key.char === 'B') this.replan(merge => { merge.deleteBranch = !merge.deleteBranch; });
      else if (key.char === 'r' || key.char === 'R') void this.loadDetail();
      return undefined;
    }
    switch (key) {
      case 'up': this.scrollDetail(-1); break;
      case 'down': this.scrollDetail(1); break;
      case 'pageUp': this.scrollDetail(-this.pageRows); break;
      case 'pageDown': this.scrollDetail(this.pageRows); break;
      case 'tab': case 'shiftTab':
        this.replan(merge => {
          const step = key === 'tab' ? 1 : -1;
          merge.method = methods[(methods.indexOf(merge.method) + step + methods.length) % methods.length];
        });
        break;
      case 'enter':
        // Never a merge: this phase has no executable remote write.
        this.update(state => { state.message = state.merge?.plan.disabledReason; });
        break;
      case 'escape': this.update(state => { state.merge = undefined; state.focus = 'detail'; if (state.detail) state.detail.scroll = 0; }); break;
      default: break;
    }
    return undefined;
  }
}

export function asGithubError(error: unknown): GithubError {
  if (error instanceof GithubError) return error;
  return new GithubError('unknown', error instanceof Error ? redactMessage(error.message) : 'GitHub request failed');
}
