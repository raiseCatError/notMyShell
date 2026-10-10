import {EventEmitter} from 'node:events';
import {shouldPassthrough} from '../passthrough/PassthroughPolicy.js';
import {OpenLine, promptShaped, promptText} from './openLine.js';
import {AlternateScreenTracker} from './TerminalModes.js';
import type {ForegroundProcess, TerminalProbe, TerminalSample} from './terminalProbe.js';
import {type InputMode, type InputRequest, type InputState} from './inputState.js';

/**
 * Watches one session's running command for a credible request for input. Lives beside the PTY (in the session
 * service, or in-process), so every frontend and /sessions read the same state.
 *
 * Evidence, strongest first; nothing is concluded from silence alone:
 *  1. Linux: the kernel reports a foreground thread blocked in read() on this terminal → confirmed.
 *  2. The terminal's line settings: echo off with line input (a password read) → confirmed hidden input; line input
 *     off with a prompt left open on the cursor's line (e2fsck's "Fix<y>? ", `read -k`) → confirmed key input.
 *     Raw mode alone is not enough: spinners and terminal proxies (docker -it) set it without asking anything.
 *  3. Ordinary line input: a question-shaped line left open, output quiet, the foreground group idle across two
 *     samples (no CPU, nothing running) → likely. A long build, `sleep`, a stalled download or a log stream does
 *     not leave a question open, rewrites its line, or is busy.
 * A program that owns the terminal (full screen, or input modes such as bracketed paste) draws and reads its own
 * interface; it is never reported as waiting. The kernel saying the group is blocked elsewhere vetoes 2 and 3.
 *
 * Observation only: probes read the terminal's settings and the process table, never input, and never pause,
 * signal or write to the program.
 */
export interface InputWatchOptions {
  probe?: TerminalProbe;
  /** The terminal device path, once known. */
  tty?: () => string | undefined;
  now?: () => number;
  /** Timer seam for tests. */
  setTimer?: (callback: () => void, ms: number) => () => void;
}

interface InputWatchEvents {
  change: [InputState];
}

/** Quiet time before the first look: short when a line was left open (a prompt is likely), longer otherwise. */
const FIRST_LOOK_OPEN_MS = 150;
const FIRST_LOOK_MS = 400;
/** Later looks back off: a long quiet command costs a few cheap probes a minute. */
const LOOKS_MS = [600, 1200, 2500];
const STEADY_LOOK_MS = 3000;
const SLOW_LOOK_AFTER_MS = 60_000;
const SLOW_LOOK_MS = 10_000;
/**
 * With no line left open, only a hidden-line read (a password with no prompt text) or the kernel's report can say
 * anything, so a slow stream (a log line every second) is looked at no more often than this.
 */
const CLOSED_LINE_INTERVAL_MS = 2000;
/** Ordinary line input is only "likely" after the output has been quiet this long. */
const LIKELY_QUIET_MS = 700;
/** CPU share across two samples above which a foreground process is computing, not waiting. */
const BUSY_SHARE = 0.25;

const defaultTimer = (callback: () => void, ms: number) => {
  const timer = setTimeout(callback, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
};

export class InputWatch extends EventEmitter<InputWatchEvents> {
  private running?: {command: string; since: number};
  private readonly line = new OpenLine();
  private readonly screen = new AlternateScreenTracker();
  private request?: InputRequest;
  private waitedMs = 0;
  private waits = 0;
  /**
   * Changes with every output and every input: one prompt is one epoch. Evidence that lapses and returns within an
   * epoch (a resize waking the program for a moment) continues the same prompt; it is never counted twice.
   */
  private epoch = 0;
  private requestEpoch = -1;
  private countedEpoch = -1;
  /** When the last wait ended: a new wait never starts earlier, so no time is counted twice. */
  private lastWaitEnd = 0;
  private lastActivity = 0;
  private lastOutput = 0;
  /** Bumped by every stream event; a probe that started before the latest event is stale. */
  private generation = 0;
  private looks = 0;
  private cancelTimer?: () => void;
  private probing = false;
  private lastProbeAt = -Infinity;
  private previous = new Map<number, {cpuMs: number; at: number}>();
  private disposed = false;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => () => void;

  constructor(private readonly options: InputWatchOptions = {}) {
    super();
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? defaultTimer;
  }

  get state(): InputState {
    return {...(this.request ? {request: {...this.request}} : {}), timing: {waitedMs: this.waitedMs, waits: this.waits}};
  }

  /** Whether the current command's program owns the terminal (and so its own input). */
  get ownsTerminal(): boolean {
    return Boolean(this.running && (this.screen.ownsTerminal || shouldPassthrough(this.running.command)));
  }

  onExec(command: string, at = this.now()): void {
    this.closeWait(at, false);
    this.running = {command, since: at};
    this.waitedMs = 0;
    this.waits = 0;
    this.epoch += 1;
    this.lastWaitEnd = 0;
    this.line.reset();
    this.screen.reset();
    this.previous.clear();
    this.lastOutput = at;
    this.touch(at);
    this.emit('change', this.state);
  }

  onOutput(data: string, at = this.now()): void {
    if (!this.running) return;
    this.screen.observeModes(data);
    this.screen.push(data);
    this.line.push(data);
    this.lastOutput = at;
    this.epoch += 1;
    // Output after the prompt: the program moved on (or asks again, which the next look sees).
    if (this.request) this.closeWait(at, true);
    this.touch(at);
  }

  /** Bytes NMSh wrote to the program. An answer ends a wait; typing inside a hidden line does not. */
  onInput(data: string, at = this.now()): void {
    if (!this.running) return;
    const request = this.request;
    if (request && (request.mode === 'key' || /[\r\n\u0003\u0004\u001a]/u.test(data))) this.closeWait(at, true);
    this.epoch += 1;
    this.touch(at);
  }

  /** The command finished (the shell is back at its prompt): close any wait; the final timing stays readable. */
  onPrompt(at = this.now()): void {
    if (!this.running) return;
    this.closeWait(at, false);
    this.running = undefined;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.generation += 1;
    this.emit('change', this.state);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.removeAllListeners();
  }

  private closeWait(at: number, emit: boolean): void {
    const request = this.request;
    if (!request) return;
    this.request = undefined;
    this.waitedMs += Math.max(0, at - request.since);
    this.lastWaitEnd = Math.max(this.lastWaitEnd, at);
    if (this.requestEpoch !== this.countedEpoch) { this.waits += 1; this.countedEpoch = this.requestEpoch; }
    if (emit) this.emit('change', this.state);
  }

  private touch(at: number): void {
    this.lastActivity = at;
    this.generation += 1;
    this.looks = 0;
    this.schedule();
  }

  private schedule(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    if (this.disposed || !this.running || !this.options.probe) return;
    const quiet = this.now() - this.lastActivity;
    const planned = this.looks === 0 ? (this.line.open ? FIRST_LOOK_OPEN_MS : FIRST_LOOK_MS)
      : LOOKS_MS[this.looks - 1] ?? (quiet > SLOW_LOOK_AFTER_MS ? SLOW_LOOK_MS : STEADY_LOOK_MS);
    const delay = this.line.open ? planned : Math.max(planned, this.lastProbeAt + CLOSED_LINE_INTERVAL_MS - this.now());
    this.cancelTimer = this.setTimer(() => { this.cancelTimer = undefined; void this.look(); }, delay);
  }

  private async look(): Promise<void> {
    if (this.disposed || !this.running || this.probing) return;
    this.looks += 1;
    if (this.ownsTerminal) {
      if (this.request) this.closeWait(this.now(), true);
      this.schedule();
      return;
    }
    const tty = this.options.tty?.();
    if (!tty || !this.options.probe) return;
    const generation = this.generation;
    this.probing = true;
    this.lastProbeAt = this.now();
    let sample: TerminalSample | undefined;
    try { sample = await this.options.probe({tty}); } catch { sample = undefined; } finally { this.probing = false; }
    if (this.disposed || !this.running) return;
    if (generation === this.generation && sample) this.apply(sample, this.now());
    this.schedule();
  }

  /** Decide from one sample. Exposed for tests through InputWatch.evaluate. */
  apply(sample: TerminalSample, now: number): void {
    if (!this.running || this.ownsTerminal) return;
    const busy = this.busy(sample.foreground, now);
    const next = this.decide(sample, busy, now);
    const current = this.request;
    if (!next) {
      // The evidence went away without input or output (a timed-out read, a restored terminal): the wait ended no
      // later than now.
      if (current) this.closeWait(now, true);
      return;
    }
    const program = sample.foreground.find(item => item.command)?.command;
    const request: InputRequest = {since: current?.since ?? Math.max(this.running.since, this.lastOutput, this.lastWaitEnd), confidence: next.confidence, mode: next.mode,
      ...(promptText(this.line.line) ? {prompt: promptText(this.line.line)} : {}), ...(program ? {program: program.slice(0, 64)} : {})};
    if (current && current.confidence === request.confidence && current.mode === request.mode && current.prompt === request.prompt
      && current.program === request.program) return;
    if (!current) this.requestEpoch = this.epoch;
    this.request = request;
    this.emit('change', this.state);
  }

  private decide(sample: TerminalSample, busy: boolean | undefined, now: number): {confidence: 'confirmed' | 'likely'; mode: InputMode} | undefined {
    const modes = sample.modes;
    const mode: InputMode = !modes ? 'line' : !modes.canonical ? 'key' : !modes.echo ? 'hidden' : 'line';
    if (sample.readingTerminal === true) return {confidence: 'confirmed', mode};
    // The kernel says every foreground thread is blocked on something other than the terminal.
    if (sample.readingTerminal === false || busy === true) return undefined;
    if (modes && modes.canonical && !modes.echo) return {confidence: 'confirmed', mode: 'hidden'};
    if (modes && !modes.canonical) return this.line.open ? {confidence: 'confirmed', mode: 'key'} : undefined;
    // Ordinary line input: only a question left open, quiet output, and an idle group seen across two samples.
    if (busy === false && this.line.open && promptShaped(this.line.line) && now - this.lastOutput >= LIKELY_QUIET_MS) return {confidence: 'likely', mode: 'line'};
    return undefined;
  }

  /** true: computing; false: idle between this sample and the previous one; undefined: not yet known. */
  private busy(foreground: ForegroundProcess[], now: number): boolean | undefined {
    if (!foreground.length) return undefined;
    let known = !foreground.some(item => item.state.startsWith('R')) ? true : undefined;
    let busy = known === undefined;
    for (const item of foreground) {
      const before = this.previous.get(item.pid);
      if (item.cpuMs === undefined || !before) { if (known) known = false; continue; }
      const elapsed = now - before.at;
      if (elapsed > 0 && (item.cpuMs - before.cpuMs) / elapsed > BUSY_SHARE) busy = true;
    }
    this.remember(foreground, now);
    if (busy) return true;
    return known ? false : undefined;
  }

  private remember(foreground: ForegroundProcess[], now: number): void {
    this.previous = new Map(foreground.flatMap(item => item.cpuMs === undefined ? [] : [[item.pid, {cpuMs: item.cpuMs, at: now}] as const]));
  }
}
