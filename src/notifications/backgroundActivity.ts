import {commandWord} from '../session/liveStatus.js';
import {formatDuration} from '../status/commandTiming.js';

/**
 * Presentation-only news about shell work that continues while a full-screen NMSh experience (the Arcade) owns the
 * viewport. One manager owns toasts, coalescing, expiry and unread state; the shell, queue and journal stay the source
 * of truth and never read from it. Nothing here is written to the transcript, journal, history or clipboard, and no
 * text is ever taken from command output: a toast carries a short program label, a status and a duration only.
 */

export type ActivityTone = 'ok' | 'fail' | 'attention' | 'info';

export type ActivityEvent =
  | {kind: 'command'; key: string; command: string; elapsedMs: number; exitCode: number; interrupted: boolean}
  | {kind: 'queue-finished'; key: string; count: number; failed: number}
  /** Persistent states: shown until `cleared`. */
  | {kind: 'attention'; key: string; state: 'approval' | 'paused' | 'input'; program?: string; confirmed?: boolean}
  | {kind: 'cleared'; state: 'approval' | 'paused' | 'input'};

export interface ActivityEntry {
  id: number;
  at: number;
  tone: ActivityTone;
  /** Short facts only, no glyph: "npm run build finished · 42s". */
  text: string;
}

export interface ActivityToast {
  tone: ActivityTone;
  text: string;
  /** in: arriving; steady: shown; out: leaving. Always `steady` when motion is reduced. */
  phase: 'in' | 'steady' | 'out';
  /** 0..1 through the current phase. */
  progress: number;
}

export interface ActivityView {
  toast?: ActivityToast;
  /** A persistent state that needs the person, until it clears. */
  attention?: {state: 'approval' | 'paused' | 'input'; tone: 'attention'; text: string};
  unread: number;
}

export const TOAST_MS = 3600;
export const TOAST_IN_MS = 180;
export const TOAST_OUT_MS = 240;
/** A burst keeps extending one toast, but never past this total. */
export const TOAST_MAX_MS = 8000;
export const HISTORY_LIMIT = 24;
const SEEN_LIMIT = 64;
const UNREAD_LIMIT = 99;

const PACKAGE_TOOLS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const SAFE_VERBS = new Set(['test', 'build', 'install', 'ci', 'start', 'lint', 'check', 'typecheck', 'dev', 'format', 'verify']);
const SCRIPT = /^[a-z][a-z0-9:_-]{0,23}$/iu;
const WORD = /^[A-Za-z0-9._+-]{1,24}$/u;

/**
 * A short, safe name for a command: its program word, and for a package manager the script or verb it runs
 * ("npm run build", "npm test"). Never other arguments: they can carry tokens, URLs and paths.
 */
export function safeCommandLabel(command: string): string {
  const word = commandWord(command);
  if (!word || !WORD.test(word)) return 'Command';
  if (!PACKAGE_TOOLS.has(word)) return word;
  const args = command.trim().split(/\s+/u).filter(part => !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(part)).slice(1);
  const first = args[0];
  if (first && SAFE_VERBS.has(first)) return `${word} ${first}`;
  if (first === 'run' && args[1] && SCRIPT.test(args[1])) return `${word} run ${args[1]}`;
  return word;
}

/** The completed-command line for a toast or history row. */
export function commandActivityText(event: Extract<ActivityEvent, {kind: 'command'}>): {tone: ActivityTone; text: string} {
  const label = safeCommandLabel(event.command);
  const duration = Number.isFinite(event.elapsedMs) ? formatDuration(Math.max(0, event.elapsedMs)) : undefined;
  const tail = duration ? ` · ${duration}` : '';
  if (event.interrupted) return {tone: 'info', text: `${label} interrupted${tail}`};
  if (event.exitCode === 0) return {tone: 'ok', text: `${label} finished${tail}`};
  return {tone: 'fail', text: `${label} failed · exit ${event.exitCode}${tail}`};
}

interface Shown {
  tone: ActivityTone;
  text: string;
  since: number;
  until: number;
  finished: number;
  failed: number;
  /** A toast that carries an attention state replaces a plain one and is never merged into a count. */
  attention: boolean;
}

export class BackgroundActivity {
  private readonly log: ActivityEntry[] = [];
  private readonly seen: string[] = [];
  private shown: Shown | undefined;
  private states = new Map<'approval' | 'paused' | 'input', string>();
  private unreadCount = 0;
  private nextId = 1;

  constructor(private readonly now: () => number = Date.now) {}

  /** Record an event once; a repeated key is ignored. Returns whether it was new. */
  push(event: ActivityEvent): boolean {
    const at = this.now();
    if (event.kind === 'cleared') {
      this.states.delete(event.state);
      return false;
    }
    if (this.seen.includes(event.key)) return false;
    this.seen.push(event.key);
    if (this.seen.length > SEEN_LIMIT) this.seen.shift();
    if (event.kind === 'attention') {
      const text = event.state === 'approval' ? 'Queue waiting for approval'
        : event.state === 'paused' ? 'Queue paused'
          : `${event.program ? safeCommandLabel(event.program) : 'A command'} ${event.confirmed === false ? 'may be' : 'is'} waiting for input`;
      const changed = this.states.get(event.state) !== text;
      this.states.set(event.state, text);
      if (changed) this.record('attention', text, at, true);
      return changed;
    }
    if (event.kind === 'queue-finished') {
      const noun = `${event.count} command${event.count === 1 ? '' : 's'}`;
      // The chain's own summary replaces the per-command toast it covers instead of being added to its count.
      this.record(event.failed ? 'fail' : 'ok', event.failed ? `Queue finished · ${event.failed} of ${noun} failed` : `Queue finished · ${noun}`, at, true,
        {finished: event.count, failed: event.failed});
      return true;
    }
    const {tone, text} = commandActivityText(event);
    this.record(tone, text, at, false, {finished: 1, failed: tone === 'fail' ? 1 : 0});
    return true;
  }

  private record(tone: ActivityTone, text: string, at: number, attention: boolean, count = {finished: 0, failed: 0}): void {
    this.log.push({id: this.nextId++, at, tone, text});
    if (this.log.length > HISTORY_LIMIT) this.log.shift();
    this.unreadCount = Math.min(UNREAD_LIMIT, this.unreadCount + 1);
    const current = this.shown && this.shown.until > at ? this.shown : undefined;
    if (!current || attention) {
      this.shown = {tone, text, since: at, until: at + TOAST_MS, finished: count.finished, failed: count.failed, attention};
      return;
    }
    // An attention toast yields only to a failure; a quiet success waits in the history (the attention state stays in the strip).
    if (current.attention) {
      if (tone === 'fail') this.shown = {tone, text, since: at, until: at + TOAST_MS, finished: count.finished, failed: count.failed, attention: false};
      return;
    }
    // A burst: one toast with counts instead of a stack. A failure keeps the failure tone; the rows stay in the history.
    const finished = current.finished + count.finished, failed = current.failed + count.failed;
    const commands = `${finished} commands finished`;
    this.shown = {
      tone: failed ? 'fail' : current.tone === 'info' && tone === 'info' ? 'info' : 'ok',
      text: failed ? `${commands} · ${failed} failed` : commands,
      since: current.since, until: Math.min(current.since + TOAST_MAX_MS, Math.max(current.until, at + TOAST_MS - 600)),
      finished, failed, attention: false,
    };
  }

  /** What to show at `at`. Pure with respect to time: an expired toast is simply absent. */
  view(at = this.now(), motion = true): ActivityView {
    const view: ActivityView = {unread: this.unreadCount};
    const shown = this.shown;
    if (shown && at < shown.until) {
      const age = at - shown.since, left = shown.until - at;
      const phase = !motion ? 'steady' : age < TOAST_IN_MS ? 'in' : left < TOAST_OUT_MS ? 'out' : 'steady';
      const progress = phase === 'in' ? age / TOAST_IN_MS : phase === 'out' ? 1 - left / TOAST_OUT_MS : 0;
      view.toast = {tone: shown.tone, text: shown.text, phase, progress: Math.min(1, Math.max(0, progress))};
    } else if (shown) this.shown = undefined;
    // Input outranks an approval, which outranks a pause: the one that most needs the person.
    for (const state of ['input', 'approval', 'paused'] as const) {
      const text = this.states.get(state);
      if (text) { view.attention = {state, tone: 'attention', text}; break; }
    }
    return view;
  }

  /** The next instant the view changes by itself (a phase boundary or expiry), for one scheduled repaint. */
  nextChange(at = this.now(), motion = true): number | undefined {
    const shown = this.shown;
    if (!shown || at >= shown.until) return undefined;
    const bounds = motion ? [shown.since + TOAST_IN_MS, shown.until - TOAST_OUT_MS, shown.until] : [shown.until];
    return bounds.find(bound => bound > at);
  }

  history(): readonly ActivityEntry[] { return this.log; }
  get unread(): number { return this.unreadCount; }
  markRead(): void { this.unreadCount = 0; }
  hasAttention(state?: 'approval' | 'paused' | 'input'): boolean { return state ? this.states.has(state) : this.states.size > 0; }
}
