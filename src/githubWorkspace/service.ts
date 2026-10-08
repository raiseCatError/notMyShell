import {GithubError, type IssueDetail, type ItemRef, itemKey, LIMITS, type PrDetail, type SearchPage} from './model.js';
import type {GithubSource, PatchFetch} from './source.js';

/** Small LRU map; the only cache the workspace holds. */
export class BoundedCache<V> {
  private readonly entries = new Map<string, V>();
  constructor(private readonly capacity: number) {}
  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) { this.entries.delete(key); this.entries.set(key, value); }
    return value;
  }
  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
  delete(key: string): void { this.entries.delete(key); }
  get size(): number { return this.entries.size; }
}

/** Caps simultaneous GitHub requests; queued work runs in submission order. */
export class ConcurrencyLimit {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>(resolve => this.queue.push(resolve));
    this.active++;
    try { return await task(); }
    finally { this.active--; this.queue.shift()?.(); }
  }
  get inFlight(): number { return this.active; }
}

/**
 * Bounded, de-duplicated access to a GithubSource. Detail and patch data are
 * fetched lazily, one selected item at a time; listing never fetches details.
 */
export class GithubWorkspaceService {
  private readonly prs = new BoundedCache<PrDetail>(LIMITS.cacheEntries);
  private readonly issues = new BoundedCache<IssueDetail>(LIMITS.cacheEntries);
  private readonly patches = new BoundedCache<PatchFetch>(Math.max(4, LIMITS.cacheEntries / 4));
  private readonly pending = new Map<string, Promise<unknown>>();
  readonly limit = new ConcurrencyLimit(LIMITS.concurrentFetches);

  constructor(readonly source: GithubSource) {}

  private once<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise = this.limit.run(task).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  search(effectiveQuery: string, cursor?: string): Promise<SearchPage> {
    return this.once(`search:${effectiveQuery}:${cursor ?? ''}`, () => this.source.search(effectiveQuery, cursor));
  }

  cachedPullRequest(ref: ItemRef): PrDetail | undefined { return this.prs.get(itemKey(ref)); }
  cachedIssue(ref: ItemRef): IssueDetail | undefined { return this.issues.get(itemKey(ref)); }
  cachedPatches(ref: ItemRef, headSha: string | undefined): PatchFetch | undefined {
    return headSha ? this.patches.get(`${itemKey(ref)}@${headSha}`) : undefined;
  }

  /** An explicit refresh (R) must reach GitHub even when the head SHA is unchanged. */
  forgetPatches(ref: ItemRef, headSha: string | undefined): void {
    if (headSha) this.patches.delete(`${itemKey(ref)}@${headSha}`);
  }

  async pullRequest(ref: ItemRef): Promise<PrDetail> {
    if (ref.kind !== 'pr') throw new GithubError('invalid_query', 'Not a pull request');
    const detail = await this.once(`pr:${itemKey(ref)}`, () => this.source.pullRequest(ref));
    this.prs.set(itemKey(ref), detail);
    return detail;
  }

  /** Patches are keyed by head SHA, so a pushed PR never shows a cached diff for an older head. */
  async pullRequestPatches(ref: ItemRef, headSha: string | undefined, reportedFileCount?: number): Promise<PatchFetch> {
    const key = `${itemKey(ref)}@${headSha ?? 'unknown'}`;
    const fetched = await this.once(`patch:${key}`, () => this.source.pullRequestPatches(ref, reportedFileCount));
    if (headSha) this.patches.set(key, fetched);
    return fetched;
  }

  async issue(ref: ItemRef): Promise<IssueDetail> {
    if (ref.kind !== 'issue') throw new GithubError('invalid_query', 'Not an issue');
    const detail = await this.once(`issue:${itemKey(ref)}`, () => this.source.issue(ref));
    this.issues.set(itemKey(ref), detail);
    return detail;
  }
}
