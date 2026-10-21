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
  /** The shell explicitly entered its interactive reader; ownership lasts until the next prompt. */
  terminalOwner?: true;
  /**
   * The shell's authenticated done marker: the command has finished and its prompt hooks run (#436). Nothing begun
   * after this is the command's input; it is type-ahead for the prompt (#426). Absent from older services.
   */
  done?: true;
  request?: InputRequest;
  timing: InputTiming;
}

export const NO_INPUT_TIMING: InputTiming = Object.freeze({waitedMs: 0, waits: 0});

/** Waiting time including an open wait up to now. */
export function waitedSoFar(state: InputState | undefined, now: number): number {
  if (!state) return 0;
  return state.timing.waitedMs + (state.request ? Math.max(0, now - state.request.since) : 0);
}

/**
 * Keys go to the program one by one (hidden line or key input) instead of through the composer's line editor. A
 * hidden line does so even when it is only likely: the terminal echoes nothing typed, so NMSh draws nothing (#426).
 */
export function directInput(request: InputRequest | undefined): boolean {
  return request?.mode === 'hidden' || (request?.confidence === 'confirmed' && request.mode === 'key');
}

/**
 * What an on-demand look saw of the terminal (#426). hidden: echo is off for line input, so nothing typed may be
 * drawn; visible: the terminal echoes, so typing may be shown; unknown: no sample said how it echoes (a probe failed or
 * timed out); idle: nothing was running; unavailable: this platform has no way to look.
 */
export type LookResult = 'hidden' | 'visible' | 'unknown' | 'idle' | 'unavailable';
export const LOOK_RESULTS: readonly LookResult[] = ['hidden', 'visible', 'unknown', 'idle', 'unavailable'];

/** A look result from the wire: one of the known values, else no answer (never guessed). */
export function lookResultFrom(value: unknown): LookResult | undefined {
  return typeof value === 'string' && (LOOK_RESULTS as readonly string[]).includes(value) ? value as LookResult : undefined;
}
