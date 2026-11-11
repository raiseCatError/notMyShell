import {formatAge} from './sessionList.js';
import type {SessionCleanup, SessionIdleExpiry} from '../prompt/configuration.js';

/**
 * Session lifecycle policy: what a live session is doing, from facts the service observed, and whether NMSh may end
 * it without being asked. One pure function decides it for the service (automatic cleanup, End All Eligible) and for
 * every surface that shows it, so the picker and the service can never disagree.
 *
 * The rules, smallest first:
 * - Anything attached to a window, ending, protected, or holding work (a running command, an input wait, queued
 *   commands, background tasks, shell jobs, child processes) is never eligible. Idle output alone proves nothing.
 * - A detached session that never ran a command is eligible after the unused grace period (default 10 minutes).
 * - A detached idle session is only suggested for review after a day; idle expiry ends it automatically only when
 *   the person turned that on.
 * - A session created before any lifecycle policy reached the service keeps the behaviour it was created with:
 *   nothing automatic.
 * - When a fact is unknown (child processes could not be read), the session is preserved.
 */

export interface LifecyclePolicy {
  /** End a detached, never-used session this long after it was detached; 0 is off. */
  unusedMs: number;
  /** End a detached idle session this long after its last activity; 0 is off (the default). */
  idleExpiryMs: number;
}

/** Long-idle detached sessions are suggested for review (never ended) after this. */
export const REVIEW_IDLE_MS = 24 * 60 * 60_000;
export const POLICY_OFF: LifecyclePolicy = {unusedMs: 0, idleExpiryMs: 0};

/** The bounded values a policy may hold; anything else is clamped to the nearest edge or read as off. */
export const UNUSED_BOUNDS = {min: 60_000, max: 24 * 60 * 60_000};
export const IDLE_EXPIRY_BOUNDS = {min: 60 * 60_000, max: 30 * 24 * 60 * 60_000};

const bounded = (value: number, bounds: {min: number; max: number}) => !Number.isFinite(value) || value <= 0 ? 0 : Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));

/** The policy as it travels in a hello: `unused=<seconds>;idle=<seconds>`, both bounded. */
export function encodePolicy(policy: LifecyclePolicy): string {
  return `unused=${Math.round(bounded(policy.unusedMs, UNUSED_BOUNDS) / 1000)};idle=${Math.round(bounded(policy.idleExpiryMs, IDLE_EXPIRY_BOUNDS) / 1000)}`;
}

/** Parse a hello's policy; undefined (keep what the service had) for anything malformed. */
export function decodePolicy(text: string | undefined): LifecyclePolicy | undefined {
  const match = /^unused=(\d{1,7});idle=(\d{1,8})$/u.exec(text ?? '');
  if (!match) return undefined;
  return {unusedMs: bounded(Number(match[1]) * 1000, UNUSED_BOUNDS), idleExpiryMs: bounded(Number(match[2]) * 1000, IDLE_EXPIRY_BOUNDS)};
}

/** What the service knows about one session at one moment. */
export interface LifecycleFacts {
  attached: boolean;
  /** A confirmed kill was sent and the shell has not exited yet. */
  ending: boolean;
  protected: boolean;
  /** A foreground command is running (preexec seen, no prompt since). */
  running: boolean;
  /** The running command credibly waits for input. */
  waiting: boolean;
  queued: number;
  /** Background tasks still running (or whose processes still run). */
  tasks: number;
  /** Background or stopped shell jobs, as the shell last reported them; undefined when it did not say. */
  jobs?: number;
  /** Child processes of the idle shell; undefined when not checked or unreadable. */
  children?: number;
  /** At least one command ran in this session (any exec, queued or typed). */
  used: boolean;
  /** When the session last lost its window; undefined while attached. */
  detachedSince?: number;
  /** Latest of: last prompt, last output, detach. */
  lastActivity: number;
  /** A lifecycle policy was in effect when the session was created. */
  policyAware: boolean;
}

export type LifecycleState = 'attached' | 'ending' | 'executing' | 'waiting' | 'unused' | 'idle';

export type Eligibility =
  /** NMSh may end it without asking (unused grace passed, or idle expiry on and passed); re-verified before ending. */
  | {kind: 'automatic'; why: 'unused' | 'idle-expired'; reason: string}
  /** Offered in End All Eligible and Review Idle Sessions, always behind a confirmation that lists it; `at` as for kept. */
  | {kind: 'review'; reason: string; at?: number}
  /** Kept. `at` is when it would next become eligible, if nothing changes. */
  | {kind: 'kept'; reason: string; at?: number};

export function lifecycleState(facts: LifecycleFacts): LifecycleState {
  if (facts.attached) return 'attached';
  if (facts.ending) return 'ending';
  if (facts.waiting) return 'waiting';
  if (facts.running || facts.queued > 0 || facts.tasks > 0 || (facts.jobs ?? 0) > 0) return 'executing';
  return facts.used ? 'idle' : 'unused';
}

/** Work that keeps a session alive regardless of any timer; undefined when none is known. */
export function heldWork(facts: LifecycleFacts): string | undefined {
  if (facts.waiting) return 'waiting for input';
  if (facts.running) return 'a command is running';
  if (facts.queued > 0) return `${facts.queued} queued command${facts.queued === 1 ? '' : 's'}`;
  if (facts.tasks > 0) return `${facts.tasks} background task${facts.tasks === 1 ? '' : 's'}`;
  if ((facts.jobs ?? 0) > 0) return `${facts.jobs} shell job${facts.jobs === 1 ? '' : 's'}`;
  if ((facts.children ?? 0) > 0) return `${facts.children} child process${facts.children === 1 ? '' : 'es'}`;
  return undefined;
}

export function eligibility(facts: LifecycleFacts, policy: LifecyclePolicy, now: number): Eligibility {
  if (facts.attached) return {kind: 'kept', reason: 'attached in a window'};
  if (facts.ending) return {kind: 'kept', reason: 'ending'};
  if (facts.protected) return {kind: 'kept', reason: 'protected'};
  const work = heldWork(facts);
  if (work) return {kind: 'kept', reason: work};
  const detachedFor = now - (facts.detachedSince ?? now);
  const idleFor = now - facts.lastActivity;
  // Idle expiry, when the person turned it on, applies to every detached session without work, used or not.
  const expiry = facts.policyAware && policy.idleExpiryMs > 0 ? facts.lastActivity + policy.idleExpiryMs : undefined;
  if (expiry !== undefined && now >= expiry) return {kind: 'automatic', why: 'idle-expired', reason: `idle ${formatAge(idleFor)}`};
  const until = (at: number | undefined) => (at === undefined ? {} : {at});
  if (!facts.used) {
    if (facts.policyAware && policy.unusedMs > 0) {
      if (detachedFor >= policy.unusedMs) return {kind: 'automatic', why: 'unused', reason: `never used; detached ${formatAge(detachedFor)}`};
      return {kind: 'kept', reason: `never used; cleanup in ${formatAge(policy.unusedMs - detachedFor)}`, at: (facts.detachedSince ?? now) + policy.unusedMs};
    }
    // Without automatic cleanup an unused session is still worth offering once it has sat for the grace period.
    if (detachedFor >= 10 * 60_000) return {kind: 'review', reason: `never used; detached ${formatAge(detachedFor)}`, ...until(expiry)};
    return {kind: 'kept', reason: 'never used', ...until(expiry)};
  }
  if (idleFor >= REVIEW_IDLE_MS) return {kind: 'review', reason: `idle ${formatAge(idleFor)}; cleanup suggested`, ...until(expiry)};
  return {kind: 'kept', reason: `idle ${formatAge(idleFor)}`, at: expiry ?? facts.lastActivity + REVIEW_IDLE_MS};
}

/** Eligible for End All Eligible: automatic or review, never kept. */
export const isEligible = (result: Eligibility) => result.kind !== 'kept';

const CLEANUP_MS: Record<SessionCleanup, number> = {off: 0, '10m': 10 * 60_000, '30m': 30 * 60_000, '1h': 60 * 60_000};
const IDLE_EXPIRY_MS: Record<SessionIdleExpiry, number> = {off: 0, '1d': 24 * 60 * 60_000, '3d': 3 * 24 * 60 * 60_000, '7d': 7 * 24 * 60 * 60_000};

/** The two Session Lifecycle settings as a policy; unknown values are off. */
export function policyFromSettings(settings: {sessionCleanup: SessionCleanup; sessionIdleExpiry: SessionIdleExpiry}): LifecyclePolicy {
  return {unusedMs: CLEANUP_MS[settings.sessionCleanup] ?? 0, idleExpiryMs: IDLE_EXPIRY_MS[settings.sessionIdleExpiry] ?? 0};
}
