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
  /** For a finished command: what the activity list needs to show it as settled work. */
  command?: {label: string; ok: boolean; interrupted: boolean; exitCode: number; elapsedMs: number};
}

/** The persistent banner: the latest news that matters, until something more important or newer replaces it. */
export interface ActivityToast {
  tone: ActivityTone;
  text: string;
  /** "Command completed" */
  title: string;
  /** "npm run build · 42.0s · exit 0" */
  detail: string;
  /** in: arriving (180 ms); steady afterwards. Always `steady` when motion is reduced. */
  phase: 'in' | 'steady';
  /** 0..1 through the current phase. */
  progress: number;
}

export interface ActivityView {
  toast?: ActivityToast;
  /** A persistent state that needs the person, until it clears. */
  attention?: {state: 'approval' | 'paused' | 'input'; tone: 'attention'; text: string};
  unread: number;
}

export const TOAST_IN_MS = 180;
/** Completions this close together are one banner with counts; a later one replaces it. */
export const COALESCE_MS = 3600;
/** A finished command stays in the activity list this long. */
export const SETTLED_MS = 60_000;
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

function commandBanner(event: Extract<ActivityEvent, {kind: 'command'}>): {title: string; detail: string} {
  const label = safeCommandLabel(event.command);
  const duration = Number.isFinite(event.elapsedMs) ? formatDuration(Math.max(0, event.elapsedMs)) : undefined;
  const parts = [label, ...(duration ? [duration] : []), ...(event.interrupted ? [] : [`exit ${event.exitCode}`])];
  return {title: event.interrupted ? 'Command interrupted' : event.exitCode === 0 ? 'Command completed' : 'Command failed', detail: parts.join(' · ')};
}

interface Shown {
  tone: ActivityTone;
  text: string;
  title: string;
  detail: string;
  since: number;
  finished: number;
  failed: number;
  /** An attention banner (a question, an approval) is replaced only by a failure or when its state clears. */
  attention: boolean;
  /** The person has looked at the log: a failure may now give way to newer news. */
  acknowledged: boolean;
}

type Mode = 'merge' | 'replace' | 'attention';

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
      // A state that clears must be able to come back with the same key (a pause and resume of the same head).
      for (let index = this.seen.length - 1; index >= 0; index -= 1) if (this.seen[index]!.startsWith(`${event.state}:`)) this.seen.splice(index, 1);
      // Its banner has nothing left to say.
      if (this.shown?.attention) this.shown = undefined;
      return false;
    }
    if (this.seen.includes(event.key)) return false;
    this.seen.push(event.key);
    if (this.seen.length > SEEN_LIMIT) this.seen.shift();
    if (event.kind === 'attention') {
      const program = event.program ? safeCommandLabel(event.program) : 'A command';
      const [title, detail] = event.state === 'approval' ? ['Queue waiting', 'approval needed']
        : event.state === 'paused' ? ['Queue paused', 'review it with /queue']
          : ['Input needed', `${program} ${event.confirmed === false ? 'may be' : 'is'} waiting`];
      const text = event.state === 'approval' ? 'Queue waiting for approval'
        : event.state === 'paused' ? 'Queue paused'
          : `${program} ${event.confirmed === false ? 'may be' : 'is'} waiting for input`;
      const changed = this.states.get(event.state) !== text;
      this.states.set(event.state, text);
      if (changed) this.record('attention', text, title, detail, at, 'attention');
      return changed;
    }
    if (event.kind === 'queue-finished') {
      const noun = `${event.count} command${event.count === 1 ? '' : 's'}`;
      const detail = event.failed ? `${event.failed} of ${noun} failed` : noun;
      // The chain's own summary replaces the per-command banner it covers instead of being added to its count.
      this.record(event.failed ? 'fail' : 'ok', `Queue finished · ${detail}`, 'Queue finished', detail, at, 'replace', {finished: event.count, failed: event.failed});
      return true;
    }
    const {tone, text} = commandActivityText(event);
    const banner = commandBanner(event);
    this.record(tone, text, banner.title, banner.detail, at, 'merge', {finished: 1, failed: tone === 'fail' ? 1 : 0},
      {label: safeCommandLabel(event.command), ok: tone === 'ok', interrupted: event.interrupted, exitCode: event.exitCode, elapsedMs: event.elapsedMs});
    return true;
  }

  private record(tone: ActivityTone, text: string, title: string, detail: string, at: number, mode: Mode, count = {finished: 0, failed: 0}, command?: ActivityEntry['command']): void {
    this.log.push({id: this.nextId++, at, tone, text, ...(command ? {command} : {})});
    if (this.log.length > HISTORY_LIMIT) this.log.shift();
    this.unreadCount = Math.min(UNREAD_LIMIT, this.unreadCount + 1);
    const make = (attention: boolean): Shown => ({tone, text, title, detail, since: at, finished: count.finished, failed: count.failed, attention, acknowledged: false});
    const current = this.shown;
    if (!current || mode === 'attention') { this.shown = make(mode === 'attention'); return; }
    // An attention banner yields only to a failure; a quiet success waits in the log (the state itself stays in the list).
    if (current.attention) { if (tone === 'fail') this.shown = make(false); return; }
    const recent = at - current.since <= COALESCE_MS;
    if (mode === 'replace' || !recent) {
      // A failure stays on screen over ordinary successes until the person has looked at the log or a newer failure arrives.
      if (current.tone === 'fail' && !current.acknowledged && tone !== 'fail' && mode !== 'replace') return;
      this.shown = make(false);
      return;
    }
    // A burst: one banner with counts instead of a stack. A failure keeps the failure tone; the rows stay in the log.
    const finished = current.finished + count.finished, failed = current.failed + count.failed;
    const commands = `${finished} commands finished`;
    this.shown = {
      ...current, finished, failed,
      tone: failed ? 'fail' : current.tone === 'info' && tone === 'info' ? 'info' : 'ok',
      text: failed ? `${commands} · ${failed} failed` : commands,
      title: failed ? 'Commands finished' : 'Commands completed',
      detail: failed ? `${finished} finished · ${failed} failed` : `${finished} commands`,
    };
  }

  /** What to show at `at`. The banner has no expiry: it stays until replaced. */
  view(at = this.now(), motion = true): ActivityView {
    const view: ActivityView = {unread: this.unreadCount};
    const shown = this.shown;
    if (shown) {
      const age = at - shown.since;
      const phase = motion && age < TOAST_IN_MS ? 'in' : 'steady';
      view.toast = {tone: shown.tone, text: shown.text, title: shown.title, detail: shown.detail, phase, progress: phase === 'in' ? Math.min(1, Math.max(0, age / TOAST_IN_MS)) : 0};
    }
    // Input outranks an approval, which outranks a pause: the one that most needs the person.
    for (const state of ['input', 'approval', 'paused'] as const) {
      const text = this.states.get(state);
      if (text) { view.attention = {state, tone: 'attention', text}; break; }
    }
    return view;
  }

  /** The only moment the view changes by itself: the end of the slide-in. Nothing else ever needs a timer. */
  nextChange(at = this.now(), motion = true): number | undefined {
    const shown = this.shown;
    if (!shown || !motion) return undefined;
    const end = shown.since + TOAST_IN_MS;
    return end > at ? end : undefined;
  }

  /** Commands that finished recently, newest first (the activity list shows them as settled work). */
  settled(at = this.now(), limit = 4): ActivityEntry[] {
    const rows: ActivityEntry[] = [];
    for (let index = this.log.length - 1; index >= 0 && rows.length < limit; index -= 1) {
      const entry = this.log[index]!;
      if (entry.command && at - entry.at <= SETTLED_MS) rows.push(entry);
    }
    return rows;
  }

  history(): readonly ActivityEntry[] { return this.log; }
  get unread(): number { return this.unreadCount; }
  markRead(): void { this.unreadCount = 0; if (this.shown) this.shown.acknowledged = true; }
  hasAttention(state?: 'approval' | 'paused' | 'input'): boolean { return state ? this.states.has(state) : this.states.size > 0; }
}
