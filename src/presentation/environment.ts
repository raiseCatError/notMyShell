/**
 * Explicit clock helpers for NMSh-owned presentation. This seam must not be
 * used for shell events, command durations, timers, or persisted timestamps.
 */
export function isDeterministicPresentation(): boolean {
  return process.env.NMSH_DETERMINISTIC === '1';
}

/** Stable local wall time for display-only content; ordinary runs use real time. */
export function presentationNow(): Date {
  return isDeterministicPresentation() ? new Date(2026, 0, 1, 9, 41, 0) : new Date();
}

/** Keep the real event timestamp unless formatting it for deterministic presentation. */
export function presentationCompletionTime(completedAt: Date): Date {
  return isDeterministicPresentation() ? presentationNow() : completedAt;
}

/**
 * True when NMSh-owned decorative motion should stay still: the user asked for
 * reduced motion (NMSH_REDUCED_MOTION=1), or presentation is deterministic.
 * Measured durations and shell behavior are never affected.
 */
export function isReducedMotion(): boolean {
  return process.env.NMSH_REDUCED_MOTION === '1' || isDeterministicPresentation();
}

/** Stable shimmer/activity phase when motion is reduced, without changing measured durations. */
export function presentationAnimationElapsed(elapsedMs: number): number {
  return isReducedMotion() ? 0 : elapsedMs;
}
