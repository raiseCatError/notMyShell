import type {QueueState} from '../session/CommandQueue.js';
import type {RowTransitionPhase, Tone} from '../motion/transitions.js';

export type QueueRowKind = 'heading' | 'execution' | 'pending' | 'summary';
export const queueRowKey = (chain: number, kind: QueueRowKind, id?: number): string =>
  `queue:${chain}:${kind}${id === undefined ? '' : `:${id}`}`;

/** Presentation snapshots cannot rewind an observed execution or chain. Epoch clock changes are irrelevant. */
export function staleQueueSnapshot(previous: QueueState, next: QueueState): boolean {
  if (previous.revision !== undefined && next.revision !== undefined && next.revision < previous.revision) return true;
  const before = previous.timeline, after = next.timeline;
  if (!before || !after) return false;
  if (after.id < before.id) return true;
  if (after.id !== before.id) return false;
  if (before.status !== 'active' && after.status === 'active') return true;
  const ended = new Set(before.executions.filter(entry => entry.status !== 'running').map(entry => entry.id));
  return after.executions.some(entry => entry.status === 'running' && ended.has(entry.id));
}

/** Settled aggregate color never calls discarded, failed or unobserved work successful. */
export function queueOutcomeTone(state: QueueState): Tone {
  const chain = state.timeline;
  if (!chain) return 'muted';
  if (state.paused) return 'warning';
  if (chain.status === 'active') return 'accent';
  if (chain.counts.failed) return 'failure';
  return chain.status === 'finished' && chain.counts.succeeded > 0 && !chain.counts.interrupted && !chain.counts.skipped && !chain.counts.unobserved ? 'success' : 'warning';
}

export interface QueuePresentationChange {target: string; tone: Tone; phase: RowTransitionPhase}

/** Diff observed facts once, at receipt. Rendering, resize, replay and history review never create events. */
export function queuePresentationChanges(previous: QueueState, next: QueueState): QueuePresentationChange[] {
  const before = previous.timeline, after = next.timeline;
  if (!before || !after || before.id !== after.id || staleQueueSnapshot(previous, next)) return [];
  const changes: QueuePresentationChange[] = [];
  const oldExecutions = new Map(before.executions.map(entry => [entry.id, entry]));
  for (const entry of after.executions) {
    const old = oldExecutions.get(entry.id);
    if (old?.status === 'running' && entry.status !== 'running') changes.push({target: queueRowKey(after.id, 'execution', entry.id),
      tone: entry.status === 'succeeded' ? 'success' : entry.status === 'failed' ? 'failure' : 'warning', phase: 'completion'});
    else if (!old && entry.status === 'running' && entry.source === 'queue') changes.push({target: queueRowKey(after.id, 'execution', entry.id), tone: 'accent', phase: 'launch'});
  }
  const oldEntries = new Set(previous.entries.map(entry => entry.id));
  for (const entry of next.entries) if (!oldEntries.has(entry.id)) changes.push({target: queueRowKey(after.id, 'pending', entry.id), tone: next.paused ? 'warning' : 'accent', phase: 'launch'});
  if (previous.paused?.at !== next.paused?.at || previous.paused?.reason !== next.paused?.reason) {
    changes.push({target: queueRowKey(after.id, 'heading'), tone: next.paused || after.counts.skipped > before.counts.skipped ? 'warning' : 'accent', phase: 'event'});
  }
  if (before.status === 'active' && after.status !== 'active') changes.push({target: queueRowKey(after.id, 'summary'), tone: queueOutcomeTone(next), phase: 'event'});
  return changes;
}
