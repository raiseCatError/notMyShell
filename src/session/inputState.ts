/**
 * The one shared description of "a command needs the person": produced next to the PTY (InputWatch), carried by the
 * session protocol, and only rendered by frontends. No surface guesses on its own.
 */

/** How the foreground program reads: a line until Enter, a hidden line (password), or single keys. */
export type InputMode = 'line' | 'hidden' | 'key';
export const INPUT_MODES: readonly InputMode[] = ['line', 'hidden', 'key'];

/**
 * confirmed: the terminal or the kernel says a program is reading input (hidden or key input set on the terminal
 * with a prompt left on screen, or a blocked read of the terminal). likely: a question-shaped line was left open,
 * the output is quiet and the foreground processes are idle, but nothing proves they are reading.
 */
export type InputConfidence = 'confirmed' | 'likely';
export const INPUT_CONFIDENCES: readonly InputConfidence[] = ['confirmed', 'likely'];

export interface InputRequest {
  /** When the program started waiting: when it wrote the prompt it is waiting on (epoch ms). */
  since: number;
  confidence: InputConfidence;
  mode: InputMode;
  /** The open prompt line, sanitized and bounded; absent when the program left none. */
  prompt?: string;
  /** Foreground program name, when the platform reports it. */
  program?: string;
}

/** Waiting time of the current (or just finished) command; only intervals whose boundaries NMSh saw. */
export interface InputTiming {
  waitedMs: number;
  waits: number;
}

export interface InputState {
  request?: InputRequest;
  timing: InputTiming;
}

export const NO_INPUT_TIMING: InputTiming = Object.freeze({waitedMs: 0, waits: 0});

/** Waiting time including an open wait up to now. */
export function waitedSoFar(state: InputState | undefined, now: number): number {
  if (!state) return 0;
  return state.timing.waitedMs + (state.request ? Math.max(0, now - state.request.since) : 0);
}

/** Keys go to the program one by one (hidden line or key input) instead of through the composer's line editor. */
export function directInput(request: InputRequest | undefined): boolean {
  return request?.confidence === 'confirmed' && (request.mode === 'hidden' || request.mode === 'key');
}
