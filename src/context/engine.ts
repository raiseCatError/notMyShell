import type {CapabilityDefinition, CapabilityFamily, CapabilityScopeInput, InvalidationEvent} from './capability.js';
import {sanitizeFactValue, safeContextText, type ContextFact, type ContextFacts} from './facts.js';
import {environmentKey, restrictEnvironment} from './shellEnvironment.js';

/**
 * The Context Engine's scheduler: demand-driven, cached, bounded resolution of
 * trusted core capabilities into sanitized facts.
 *
 *   lifecycle (prompt, cd, env change)  → stage(scope) → demand(...) → settle() → commit()
 *   editor/settings change              → demand(...)
 *   render                              → facts()            (synchronous, no I/O, no scheduling)
 *
 * Only demanded capabilities ever run: a hidden or disabled module contributes
 * no demand and therefore costs nothing. Values are cached by capability,
 * scope (session / workspace / user / machine) and the allowlisted environment
 * the capability declares, so `cd` back and forth or re-typing a command reuses
 * work. Concurrent demand coalesces onto one in-flight task. Work is capped
 * globally and per family (probes tightest), every task has a timeout, and a
 * scope change cancels work that no longer matters. A failed or timed-out
 * refresh keeps the previous value visible as stale rather than inventing one,
 * and backs off before retrying. Late results for a superseded scope are dropped.
 */

/** Capability id → value fields wanted (empty: every field the capability declares). */
export type ContextDemand = ReadonlyMap<string, ReadonlySet<string>>;

export type CapabilityState = 'idle' | 'pending' | 'fresh' | 'stale' | 'absent' | 'failed' | 'timeout';

export interface CapabilityStatus {
  id: string;
  state: CapabilityState;
  collectedAt?: number;
  evidence?: string;
  error?: string;
  durationMs?: number;
}

export interface EngineStats {
  started: number;
  completed: number;
  cancelled: number;
  timedOut: number;
  failed: number;
  cacheHits: number;
  coalesced: number;
}

export interface ContextEngineOptions {
  capabilities: readonly CapabilityDefinition<unknown>[];
  /** Called (batched to one microtask) when a visible fact or status changed. */
  onUpdate?: () => void;
  now?: () => number;
  /** Global concurrent resolutions. */
  concurrency?: number;
  familyLimits?: Partial<Record<CapabilityFamily, number>>;
  maxEntries?: number;
}

interface Task {
  key: string;
  definition: CapabilityDefinition<unknown>;
  scope: CapabilityScopeInput;
  fields: Set<string>;
  controller: AbortController;
  started: boolean;
  cancelled: boolean;
  timedOut: boolean;
  done: Promise<void>;
  resolveDone: () => void;
}

interface Entry {
  key: string;
  definition: CapabilityDefinition<unknown>;
  present: boolean;
  value?: unknown;
  evidence?: string;
  fields: Set<string>;
  /** Undefined until the first resolution completes. */
  collectedAt?: number;
  status: 'idle' | 'resolved' | 'absent' | 'failed' | 'timeout';
  error?: string;
  durationMs?: number;
  dirty: boolean;
  failures: number;
  retryAt: number;
  lastUsed: number;
  task?: Task;
  followUp?: Set<string>;
}

const DEFAULT_FAMILY_LIMITS: Record<CapabilityFamily, number> = {metadata: 4, probe: 2, system: 2, agent: 1};
const COST_ORDER = {cheap: 0, 'bounded-async': 1, probe: 2} as const;
const BACKOFF_MS = [5_000, 15_000, 60_000];
/**
 * A capability's first resolution in an engine may include loading its
 * parsers, a cold filesystem cache and every other capability's first reads
 * competing for the same I/O threads. Timeouts exist to stop hung reads, not to
 * fail a slow cold start, so that first resolution gets this multiple of its
 * timeout; later ones keep the declared limit.
 */
const COLD_START_FACTOR = 3;

export class ContextEngine {
  readonly stats: EngineStats = {started: 0, completed: 0, cancelled: 0, timedOut: 0, failed: 0, cacheHits: 0, coalesced: 0};
  private readonly definitions = new Map<string, CapabilityDefinition<unknown>>();
  private readonly entries = new Map<string, Entry>();
  private readonly familyRunning = new Map<CapabilityFamily, number>();
  /** Capabilities that completed a resolution here: they no longer get the cold-start allowance. */
  private readonly warmed = new Set<string>();
  private readonly now: () => number;
  private readonly concurrency: number;
  private readonly familyLimits: Record<CapabilityFamily, number>;
  private readonly maxEntries: number;
  private queue: Task[] = [];
  private running = 0;
  private visible?: CapabilityScopeInput;
  private staged?: CapabilityScopeInput;
  private stagedGeneration = 0;
  private current: ContextDemand = new Map();
  private targets = new Set<string>();
  private disposed = false;
  private updateQueued = false;
  private version = 0;
  private memo?: {version: number; validUntil: number; facts: ContextFacts};

  constructor(private readonly options: ContextEngineOptions) {
    for (const definition of options.capabilities) {
      if (this.definitions.has(definition.id)) throw new Error(`Duplicate capability ${definition.id}`);
      this.definitions.set(definition.id, definition);
    }
    this.now = options.now ?? Date.now;
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.familyLimits = {...DEFAULT_FAMILY_LIMITS, ...options.familyLimits};
    this.maxEntries = Math.max(16, options.maxEntries ?? 256);
  }

  get capabilities(): readonly CapabilityDefinition<unknown>[] { return [...this.definitions.values()]; }
  capability(id: string): CapabilityDefinition<unknown> | undefined { return this.definitions.get(id); }
  get visibleScope(): CapabilityScopeInput | undefined { return this.visible; }

  /** Begin resolving for a new scope while the previous one stays visible; returns its generation. */
  stage(scope: CapabilityScopeInput): number {
    this.staged = scope;
    this.stagedGeneration += 1;
    if (!this.visible) this.visible = scope;
    this.demand(this.current);
    return this.stagedGeneration;
  }

  /** Make the staged scope visible. A superseded generation is refused. */
  commit(generation = this.stagedGeneration): boolean {
    if (this.disposed || !this.staged || generation !== this.stagedGeneration) return false;
    this.visible = this.staged;
    this.staged = undefined;
    this.changed(false);
    return true;
  }

  /** Replace the current demand. Never blocks; schedules missing, expired or invalidated values. */
  demand(next: ContextDemand): void {
    if (this.disposed) return;
    this.current = next;
    const scope = this.staged ?? this.visible;
    if (!scope) return;
    const wanted = new Map<string, {definition: CapabilityDefinition<unknown>; fields: Set<string>}>();
    for (const [id, fields] of next) {
      const definition = this.definitions.get(id);
      if (!definition) continue;
      const allowed = fields.size ? [...fields].filter(field => definition.fields.includes(field)) : [...definition.fields];
      wanted.set(this.key(definition, scope), {definition, fields: new Set(allowed)});
    }
    const targets = new Set(wanted.keys());
    // In-flight work for the still-visible scope is not cancelled while a stage is pending (typing during a cd).
    if (this.staged && this.visible && this.staged !== this.visible) {
      for (const [id] of next) {
        const definition = this.definitions.get(id);
        if (definition) targets.add(this.key(definition, this.visible));
      }
    }
    this.targets = targets;
    this.cancelOutside(targets);
    for (const [key, {definition, fields}] of wanted) this.ensure(key, definition, fields, scope);
    this.evict();
    this.pump();
  }

  /** Mark values that the event may have changed; the next demand refreshes them, showing the old value as stale meanwhile. */
  invalidate(event: InvalidationEvent): void {
    for (const entry of this.entries.values()) {
      if (event === 'refresh' || entry.definition.invalidateOn.includes(event)) {
        entry.dirty = true;
        if (event === 'refresh') { entry.failures = 0; entry.retryAt = 0; }
      }
    }
    this.changed(false);
  }

  /** Re-resolve everything currently demanded, ignoring caches and backoff. */
  refresh(): void {
    this.invalidate('refresh');
    this.demand(this.current);
  }

  /** Resolves when demanded work for the staged (or visible) scope finished, or after `timeoutMs`. */
  async settle(timeoutMs: number): Promise<void> {
    const pending = [...this.queue, ...[...this.entries.values()].map(entry => entry.task).filter((task): task is Task => Boolean(task))]
      .filter(task => this.targets.has(task.key)).map(task => task.done);
    if (!pending.length) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled(pending), new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, timeoutMs)); timer.unref?.(); })]);
    if (timer) clearTimeout(timer);
  }

  /** Synchronous, I/O-free view of the visible scope's facts for renderers. */
  facts(): ContextFacts {
    const scope = this.visible;
    if (!scope) return {};
    const now = this.now();
    if (this.memo && this.memo.version === this.version && now < this.memo.validUntil) return this.memo.facts;
    const facts: Record<string, ContextFact<unknown>> = {};
    // The view stays valid until the version changes or the earliest fresh value expires.
    let validUntil = Number.POSITIVE_INFINITY;
    for (const definition of this.definitions.values()) {
      const entry = this.entries.get(this.key(definition, scope));
      if (!entry?.present || entry.collectedAt === undefined) continue;
      const expires = entry.collectedAt + definition.ttlMs;
      const fresh = !entry.dirty && now <= expires;
      if (fresh) validUntil = Math.min(validUntil, expires + 1);
      facts[definition.id] = {value: entry.value, source: {capability: definition.id, evidence: entry.evidence ?? definition.title},
        collectedAt: entry.collectedAt, freshness: fresh ? 'fresh' : 'stale',
        trust: definition.trust, sensitivity: definition.sensitivity, persistence: definition.persistence, resolution: definition.cost,
        ...(definition.fieldPolicy ? {fieldPolicy: definition.fieldPolicy} : {})};
    }
    this.memo = {version: this.version, validUntil, facts: facts as ContextFacts};
    return this.memo.facts;
  }

  /** Disclosure for /prompt: what happened to this capability in the visible scope. */
  status(id: string): CapabilityStatus {
    const definition = this.definitions.get(id);
    const entry = definition && this.visible ? this.entries.get(this.key(definition, this.visible)) : undefined;
    if (!definition || !entry) return {id, state: 'idle'};
    const now = this.now();
    const state: CapabilityState = entry.task ? 'pending'
      : entry.status === 'failed' || entry.status === 'timeout' ? entry.status
        : entry.status === 'absent' ? 'absent'
          : entry.status === 'resolved' ? (entry.dirty || now - (entry.collectedAt ?? 0) > definition.ttlMs ? 'stale' : 'fresh') : 'idle';
    return {id, state, ...(entry.collectedAt !== undefined ? {collectedAt: entry.collectedAt} : {}), ...(entry.evidence ? {evidence: entry.evidence} : {}),
      ...(entry.error ? {error: entry.error} : {}), ...(entry.durationMs !== undefined ? {durationMs: entry.durationMs} : {})};
  }

  /**
   * Milliseconds until a demanded time-based capability should refresh, or
   * undefined when nothing visible depends on time: the frontend then schedules
   * no timer at all.
   */
  refreshDelay(): number | undefined {
    const scope = this.visible;
    if (!scope || this.disposed) return undefined;
    const now = this.now();
    let delay: number | undefined;
    for (const [id] of this.current) {
      const definition = this.definitions.get(id);
      if (!definition?.refreshMs) continue;
      const entry = this.entries.get(this.key(definition, scope));
      const due = entry?.collectedAt !== undefined ? Math.max(0, entry.collectedAt + definition.refreshMs - now) : 0;
      delay = Math.min(delay ?? due, due);
    }
    return delay === undefined ? undefined : Math.max(250, delay);
  }

  /** In-flight and queued work, for tests and diagnostics. */
  get pendingCount(): number { return this.running + this.queue.length; }

  dispose(): void {
    this.disposed = true;
    for (const task of this.queue) { task.cancelled = true; task.resolveDone(); }
    this.queue = [];
    for (const entry of this.entries.values()) if (entry.task) { entry.task.cancelled = true; entry.task.controller.abort(new Error('disposed')); }
  }

  private key(definition: CapabilityDefinition<unknown>, scope: CapabilityScopeInput): string {
    const base = definition.scope === 'workspace' ? `w\u0000${scope.cwd}\u0000${scope.root ?? ''}`
      : definition.scope === 'session' ? `s\u0000${scope.session}`
        : definition.scope === 'user' ? `u\u0000${scope.home}` : 'm';
    return `${definition.id}\u0000${base}\u0000${definition.env.length ? environmentKey(scope.env, definition.env) : ''}`;
  }

  private isVisibleKey(key: string): boolean {
    const scope = this.visible;
    if (!scope) return false;
    const id = key.slice(0, key.indexOf('\u0000'));
    const definition = this.definitions.get(id);
    return Boolean(definition && this.key(definition, scope) === key);
  }

  private ensure(key: string, definition: CapabilityDefinition<unknown>, fields: Set<string>, scope: CapabilityScopeInput): void {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {key, definition, present: false, fields: new Set(), status: 'idle', dirty: false, failures: 0, retryAt: 0, lastUsed: now};
      this.entries.set(key, entry);
    }
    entry.lastUsed = now;
    // A superseded task's result is discarded; demand for its key again starts fresh work.
    const task = entry.task?.cancelled ? undefined : entry.task;
    if (task) {
      if ([...fields].every(field => task.fields.has(field))) { this.stats.coalesced += 1; return; }
      if (!task.started) { for (const field of fields) task.fields.add(field); return; }
      entry.followUp = new Set([...(entry.followUp ?? []), ...fields]);
      return;
    }
    const missing = [...fields].some(field => !entry.fields.has(field));
    const expired = entry.collectedAt !== undefined && now - entry.collectedAt > Math.min(definition.ttlMs, definition.refreshMs ?? Number.POSITIVE_INFINITY);
    if ((entry.status === 'failed' || entry.status === 'timeout') && now < entry.retryAt && !entry.dirty) return;
    if (entry.collectedAt !== undefined && !missing && !expired && !entry.dirty) { this.stats.cacheHits += 1; return; }
    this.enqueue(entry, fields, scope);
  }

  private enqueue(entry: Entry, fields: Set<string>, scope: CapabilityScopeInput): void {
    let resolveDone!: () => void;
    const done = new Promise<void>(resolve => { resolveDone = resolve; });
    const task: Task = {key: entry.key, definition: entry.definition, scope, fields: new Set(fields), controller: new AbortController(),
      started: false, cancelled: false, timedOut: false, done, resolveDone};
    entry.task = task;
    const rank = COST_ORDER[entry.definition.cost];
    const index = this.queue.findIndex(item => COST_ORDER[item.definition.cost] > rank);
    if (index === -1) this.queue.push(task); else this.queue.splice(index, 0, task);
  }

  private cancelOutside(targets: ReadonlySet<string>): void {
    this.queue = this.queue.filter(task => {
      if (targets.has(task.key)) return true;
      task.cancelled = true;
      this.stats.cancelled += 1;
      const entry = this.entries.get(task.key);
      if (entry?.task === task) entry.task = undefined;
      task.resolveDone();
      return false;
    });
    for (const entry of this.entries.values()) {
      if (entry.task?.started && !targets.has(entry.key) && !entry.task.cancelled) {
        entry.task.cancelled = true;
        entry.followUp = undefined;
        entry.task.controller.abort(new Error('superseded'));
      }
    }
  }

  private pump(): void {
    while (!this.disposed && this.running < this.concurrency && this.queue.length) {
      const index = this.queue.findIndex(task => (this.familyRunning.get(task.definition.family) ?? 0) < this.familyLimits[task.definition.family]);
      if (index === -1) return;
      const [task] = this.queue.splice(index, 1);
      void this.run(task!);
    }
  }

  private async run(task: Task): Promise<void> {
    const {definition} = task;
    task.started = true;
    this.running += 1;
    this.familyRunning.set(definition.family, (this.familyRunning.get(definition.family) ?? 0) + 1);
    this.stats.started += 1;
    const started = this.now();
    const limit = this.warmed.has(definition.id) ? definition.timeoutMs : definition.timeoutMs * COLD_START_FACTOR;
    const timer = setTimeout(() => { task.timedOut = true; task.controller.abort(new Error('timeout')); }, limit);
    timer.unref?.();
    let result: Awaited<ReturnType<CapabilityDefinition<unknown>['resolve']>>;
    let failure: unknown;
    try {
      result = await definition.resolve({...task.scope, env: restrictEnvironment(task.scope.env, definition.env),
        fields: task.fields, signal: task.controller.signal, now: started});
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
      this.running -= 1;
      this.familyRunning.set(definition.family, (this.familyRunning.get(definition.family) ?? 1) - 1);
    }
    const entry = this.entries.get(task.key);
    try {
      if (task.cancelled) { this.stats.cancelled += 1; if (entry?.task === task) entry.task = undefined; return; }
      if (this.disposed || !entry || entry.task !== task) return;
      entry.task = undefined;
      const now = this.now();
      entry.durationMs = Math.max(0, now - started);
      const before = JSON.stringify([entry.present, entry.value, entry.status, entry.error]);
      if (task.timedOut || failure) {
        if (task.timedOut) this.stats.timedOut += 1; else this.stats.failed += 1;
        entry.status = task.timedOut ? 'timeout' : 'failed';
        entry.error = task.timedOut ? `timed out after ${limit} ms`
          : safeContextText(failure instanceof Error ? failure.message : String(failure), 160);
        entry.failures += 1;
        entry.retryAt = now + BACKOFF_MS[Math.min(BACKOFF_MS.length - 1, entry.failures - 1)]!;
      } else {
        this.stats.completed += 1;
        this.warmed.add(definition.id);
        entry.present = Boolean(result);
        entry.value = result ? sanitizeFactValue(result.value) : undefined;
        entry.evidence = result ? safeContextText(result.evidence, 200) : undefined;
        entry.fields = new Set(task.fields);
        entry.collectedAt = now;
        entry.status = result ? 'resolved' : 'absent';
        entry.error = undefined;
        entry.failures = 0;
        entry.retryAt = 0;
        entry.dirty = false;
      }
      const changed = before !== JSON.stringify([entry.present, entry.value, entry.status, entry.error]);
      this.changed(changed && this.isVisibleKey(entry.key));
      const followUp = entry.followUp;
      entry.followUp = undefined;
      if (followUp && this.targets.has(entry.key)) this.ensure(entry.key, definition, followUp, task.scope);
    } finally {
      task.resolveDone();
      this.pump();
    }
  }

  private changed(notify: boolean): void {
    this.version += 1;
    if (!notify || this.updateQueued || !this.options.onUpdate) return;
    this.updateQueued = true;
    queueMicrotask(() => {
      this.updateQueued = false;
      if (!this.disposed) this.options.onUpdate?.();
    });
  }

  private evict(): void {
    if (this.entries.size <= this.maxEntries) return;
    const candidates = [...this.entries.values()].filter(entry => !entry.task && !this.targets.has(entry.key) && !this.isVisibleKey(entry.key))
      .sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of candidates) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(entry.key);
    }
  }
}
