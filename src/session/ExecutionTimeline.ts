/** Observed queue facts only. No output, input responses, dispatch or timers live here. */
export type QueueFailurePolicy = 'pause' | 'continue';
export interface QueueExecution {
  id: number;
  text: string;
  source: 'manual' | 'queue';
  entryId?: number;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  /** Monotonic duration sampled alongside the enclosing active snapshot. */
  runningMs?: number;
  inputWaitMs?: number;
  status: 'running' | 'succeeded' | 'failed' | 'interrupted';
  exitCode?: number;
}
export interface QueueTimeline {
  id: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  observedAt: number;
  elapsedMs: number;
  failurePolicy: QueueFailurePolicy;
  status: 'active' | 'finished' | 'cleared' | 'shell-ended';
  executions: QueueExecution[];
  counts: {succeeded: number; failed: number; interrupted: number; skipped: number; unobserved: number};
}
export interface QueueClock {now(): number; monotonic(): number}
export const TIMELINE_RESULTS_LIMIT = 500;
export const TIMELINE_TEXT_LIMIT = 512;
export const systemQueueClock: QueueClock = {now: Date.now, monotonic: () => performance.now()};

export class ExecutionTimeline {
  private value?: QueueTimeline;
  private nextChain = 1;
  private nextExecution = 1;
  private startedMono?: number;
  private activeMono?: number;
  private terminalCause: 'cleared' | 'shell-ended' | undefined;
  constructor(private readonly clock: QueueClock) {}
  get state(): QueueTimeline | undefined {
    if (!this.value) return undefined;
    const snapshot = structuredClone(this.value);
    if (this.active) {
      const running = snapshot.executions.at(-1);
      if (running?.status === 'running') running.runningMs = Math.max(0, this.clock.monotonic() - this.activeMono!);
      snapshot.observedAt = this.clock.now();
      snapshot.elapsedMs = this.startedMono === undefined ? 0 : Math.max(0, this.clock.monotonic() - this.startedMono);
    }
    return snapshot;
  }
  get policy(): QueueFailurePolicy { return this.value?.failurePolicy ?? 'pause'; }
  get active(): boolean { return this.value?.status === 'active'; }
  get running(): boolean { return this.value?.executions.at(-1)?.status === 'running'; }
  open(policy: QueueFailurePolicy): void {
    if (this.active) return;
    const at = this.clock.now();
    this.value = {id: this.nextChain++, createdAt: at, observedAt: at, elapsedMs: 0, failurePolicy: policy, status: 'active',
      executions: [], counts: {succeeded: 0, failed: 0, interrupted: 0, skipped: 0, unobserved: 0}};
    this.startedMono = undefined; this.terminalCause = undefined;
  }
  begin(text: string, at: number, mono: number, entryId?: number): void {
    if (!this.value || !this.active || this.running) return;
    if (this.startedMono === undefined) { this.startedMono = mono; this.value.startedAt = at; }
    this.activeMono = mono;
    this.value.executions.push({id: this.nextExecution++, text: text.slice(0, TIMELINE_TEXT_LIMIT), source: entryId === undefined ? 'manual' : 'queue',
      ...(entryId === undefined ? {} : {entryId}), startedAt: at, status: 'running'});
    if (this.value.executions.length > TIMELINE_RESULTS_LIMIT) this.value.executions.shift();
    this.observe();
  }
  complete(exitCode: number, interrupted: boolean, at: number, inputWaitMs?: number): void {
    const entry = this.value?.executions.at(-1);
    if (!entry || entry.status !== 'running') return;
    entry.endedAt = at; entry.durationMs = Math.max(0, this.clock.monotonic() - this.activeMono!);
    entry.exitCode = exitCode; entry.status = interrupted ? 'interrupted' : exitCode ? 'failed' : 'succeeded';
    if (inputWaitMs !== undefined) entry.inputWaitMs = Math.max(0, inputWaitMs);
    this.value!.counts[entry.status]++; this.observe();
  }
  abort(at: number): void {
    const entry = this.value?.executions.at(-1);
    if (!entry || entry.status !== 'running') return;
    entry.endedAt = at; entry.durationMs = Math.max(0, this.clock.monotonic() - this.activeMono!);
    entry.status = 'interrupted'; this.value!.counts.interrupted++; this.observe();
  }
  skip(count: number, cause?: 'cleared' | 'shell-ended'): void {
    if (!this.value || !this.active) return;
    this.value.counts.skipped += count;
    if (cause) this.terminalCause = cause;
    this.observe();
  }
  unobserved(): void { if (this.value && this.active) { this.value.counts.unobserved++; this.observe(); } }
  settle(): void {
    if (!this.value || !this.active || this.running) return;
    this.observe(); this.value.status = this.terminalCause ?? 'finished'; this.value.endedAt = this.clock.now();
  }
  private observe(): void {
    if (!this.value) return;
    this.value.observedAt = this.clock.now();
    this.value.elapsedMs = this.startedMono === undefined ? 0 : Math.max(0, this.clock.monotonic() - this.startedMono);
  }
}

/** Optional protocol metadata fails closed; bounds apply before trusting any renderer input. */
export function queueTimelineFrom(raw: unknown): QueueTimeline | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as QueueTimeline;
  const nonnegative = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const id = (n: unknown) => nonnegative(n) && Number.isSafeInteger(n);
  if (!id(value.id) || !nonnegative(value.createdAt) || !nonnegative(value.observedAt) || !nonnegative(value.elapsedMs)
    || !['pause', 'continue'].includes(value.failurePolicy) || !['active', 'finished', 'cleared', 'shell-ended'].includes(value.status)
    || (value.startedAt !== undefined && !nonnegative(value.startedAt)) || (value.endedAt !== undefined && !nonnegative(value.endedAt))
    || !value.counts || !['succeeded','failed','interrupted','skipped','unobserved'].every(key => id(value.counts[key as keyof QueueTimeline['counts']]))
    || !Array.isArray(value.executions) || value.executions.length > TIMELINE_RESULTS_LIMIT) return undefined;
  const ids = new Set<number>();
  for (const entry of value.executions) {
    if (!entry || !id(entry.id) || ids.has(entry.id) || typeof entry.text !== 'string' || entry.text.length > TIMELINE_TEXT_LIMIT
      || !['manual', 'queue'].includes(entry.source) || !nonnegative(entry.startedAt)
      || !['running', 'succeeded', 'failed', 'interrupted'].includes(entry.status)
      || (entry.entryId !== undefined && !id(entry.entryId)) || (entry.endedAt !== undefined && !nonnegative(entry.endedAt))
      || (entry.durationMs !== undefined && !nonnegative(entry.durationMs)) || (entry.runningMs !== undefined && !nonnegative(entry.runningMs)) || (entry.inputWaitMs !== undefined && !nonnegative(entry.inputWaitMs))
      || (entry.exitCode !== undefined && !Number.isSafeInteger(entry.exitCode))) return undefined;
    ids.add(entry.id);
  }
  return structuredClone(value);
}
