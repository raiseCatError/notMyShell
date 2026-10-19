import {ExecutionTimeline, systemQueueClock, type QueueClock, type QueueFailurePolicy, type QueueTimeline} from './ExecutionTimeline.js';
import {SUMMARY_LIMIT, buildQueueSummary, recognizedExecutables, reviewedTextSafe, type QueueSummary} from './QueueSummary.js';
import {shellSubmission} from '../shell/submission.js';
import {ignorePatternFromEnv, isPrivateCommand} from '../suggestions/types.js';
import {EventEmitter} from 'node:events';
import type {ShellId} from '../shell/adapters/ShellAdapter.js';
import {CommandQueue, type QueueEntry, type QueueOp, type QueueState} from './CommandQueue.js';

/** At most this many held lines from one command's unread typing; the rest is dropped, never run. */
export const UNREAD_LINE_LIMIT = 10;

/**
 * Lines from typing a command never read (#426), as the person would have seen them on a terminal's line: Backspace,
 * Ctrl+U and Ctrl+W applied, terminal sequences (arrow keys, a terminal's replies) and other control bytes dropped.
 * A trailing line without Enter is a line too. Empty lines hold nothing.
 */
export function unreadLines(text: string): string[] {
  const lines: string[] = [];
  let line = '';
  const flush = () => { if (line.trim()) lines.push(line); line = ''; };
  const chars = Array.from(text.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[PX^_][^\u001b]*(?:\u001b\\)?|O.|.)?/gu, ''));
  for (const char of chars) {
    if (char === '\r' || char === '\n') flush();
    else if (char === '\u007f' || char === '\b') line = Array.from(line).slice(0, -1).join('');
    else if (char === '\u0015') line = '';
    else if (char === '\u0017') line = line.replace(/\S+\s*$/u, '');
    else if (char === '\t' || !/[\u0000-\u001f\u007f-\u009f]/u.test(char)) line += char;
  }
  flush();
  return lines.slice(0, UNREAD_LINE_LIMIT);
}

/** What the dispatcher needs from a shell session (ShellSession implements it). */
export interface QueueShell {
  submit(command: string): void;
  readonly isReady: boolean;
  readonly adapter: {readonly id: ShellId};
}

export interface QueueEvent {
  /** The entry just submitted to the shell (it has left the queue). */
  dispatched?: QueueEntry;
  /** Why the last requested change was refused. */
  refused?: string;
  /** Entries that will never run because the shell ended. */
  dropped?: readonly QueueEntry[];
}

/**
 * Runs a session's queue in its own shell, one entry at a time, only on the shell's own evidence:
 * - an entry is submitted only while the shell is at its prompt (after its prompt marker, before the next exec);
 * - the entry leaves the queue in the same step (`CommandQueue.take`), so it can never be submitted twice;
 * - after a command that failed (non-zero status) or was interrupted, the queue pauses with that reason instead of
 *   running what was prepared to follow it; the person resumes or clears it. Only an entry the person marked
 *   `always` goes on after a plain failure (never after an interrupt), and one marked `approve` waits for approval;
 * - a shell switch pauses it (entries were written for the previous shell), and a shell exit drops what is left,
 *   reporting it, never replaying it elsewhere.
 * No timers: silence is never taken as completion.
 */
export class QueueDispatcher extends EventEmitter<{state: [QueueState, QueueEvent]}> {
  readonly queue: CommandQueue;
  private shell: QueueShell;
  /** Between a prompt marker and the next exec, with nothing submitted yet. */
  private atPrompt = false;
  /** A command started (exec) since the last prompt. */
  private ran = false;
  private lastCommand = '';
  /** Ctrl+C was sent while this command ran. */
  private interrupted = false;
  /** Set while taking an entry, so the change is announced once, together with what was dispatched. */
  private taking = false;
  /** The entry submitted at the last prompt, until the shell reports the command it started. */
  private sent?: QueueEntry;
  /** A manual submission can precede its exec marker; only a newly joined chain may adopt that predecessor. */
  private manualStarting = false;
  private startingChain?: number;

  private readonly timeline: ExecutionTimeline;
  private failurePolicy: QueueFailurePolicy = 'pause';
  private foreground?: {text: string; at: number; mono: number; eligible: boolean; summaryEligible: boolean};
  /** Automatic saving for chains that settle while on; off by default. */
  private autoSummaries = false;
  private summaries: QueueSummary[] = [];
  private detailChain?: number;

  constructor(shell: QueueShell, queue = new CommandQueue(), private readonly clock: QueueClock = systemQueueClock) {
    super();
    this.shell = shell;
    this.timeline = new ExecutionTimeline(clock);
    this.queue = queue;
    this.queue.on('change', () => { if (!this.taking) this.emit('state', this.state, {}); });
  }

  get state(): QueueState {
    const timeline = this.timeline.state;
    const history = this.timeline.history;
    const detail = this.detailChain === undefined ? undefined : this.timeline.record(this.detailChain);
    return {...this.queue.state, ...(this.sent ? {dispatching: {...this.sent}} : {}), revision: this.queue.currentRevision,
      ...(timeline ? {timeline} : {}), ...(history.length ? {history} : {}), ...(detail ? {historyDetail: detail} : {}),
      ...(this.summaries.length ? {summaries: this.summaries.map(summary => structuredClone(summary))} : {})};
  }

  /** A change requested by the person; the queue may run at once if the shell is idle. */
  request(change: QueueOp): void {
    if (change.op === 'failure-policy') { this.failurePolicy = change.policy; return; }
    if (change.op === 'history-detail' || change.op === 'save-summary' || change.op === 'summaries-auto') { this.summaryRequest(change); return; }
    const before = this.queue.size;
    this.taking = true;
    let refused: string | undefined;
    try { refused = this.queue.apply(change); } finally { this.taking = false; }
    if (refused) { this.emit('state', this.state, {refused}); return; }
    if (change.op === 'add') {
      const opening = !this.timeline.active;
      this.timeline.open(this.failurePolicy);
      if (opening && this.manualStarting && !this.queue.state.paused) this.startingChain = this.timeline.state?.id;
      if (opening && this.foreground?.eligible && !this.queue.state.paused) this.timeline.begin(this.foreground.text, this.foreground.at, this.foreground.mono, undefined, this.foreground.summaryEligible);
    }
    if (change.op === 'clear') this.timeline.skip(before, 'cleared');
    else if (change.op === 'remove') this.timeline.skip(before - this.queue.size, this.queue.size ? undefined : 'cleared');
    this.settleTimeline();
    this.emit('state', this.state, {});
    this.dispatch();
  }

  /** Claim a manual submission synchronously, before an asynchronous shell exec marker can arrive. */
  onSubmission(): void {
    if (this.atPrompt && !this.ran && !this.sent) this.manualStarting = true;
    this.atPrompt = false;
    this.queue.invalidateReviews();
  }

  /** A review belongs to one controller attachment, even if no queue entry changed. */
  onOwnershipChanged(): void { this.queue.invalidateReviews(); }

  /** The shell started a command; returns the queued entry it is, when it is the one just submitted. */
  onExec(command: string, at = this.clock.now(), historyAllowed?: number): QueueEntry | undefined {
    this.atPrompt = false;
    this.ran = true;
    this.lastCommand = command;
    const entry = this.sent;
    this.sent = undefined;
    const summaryEligible = historyAllowed === 1 && !isPrivateCommand(entry?.text ?? command, ignorePatternFromEnv());
    this.foreground = {text: command, at, mono: this.clock.monotonic(), eligible: !this.queue.state.paused, summaryEligible};
    if (entry) this.timeline.begin(entry.text, at, this.foreground.mono, entry.id, summaryEligible);
    else if (this.manualStarting && this.startingChain !== undefined && this.startingChain === this.timeline.state?.id) this.timeline.begin(command, at, this.foreground.mono, undefined, summaryEligible);
    this.manualStarting = false; this.startingChain = undefined;
    this.queue.invalidateReviews();
    return entry;
  }

  onInterrupt(): void {
    if (!this.atPrompt) this.interrupted = true;
  }

  onPrompt(exitCode: number, at = this.clock.now(), waits?: {inputWaitMs?: number}): void {
    if (!this.ran && (this.sent || (this.manualStarting && this.startingChain !== undefined && this.startingChain === this.timeline.state?.id))) this.timeline.unobserved();
    this.manualStarting = false; this.startingChain = undefined;
    const belongs = this.timeline.running;
    if (this.ran && belongs) this.timeline.complete(exitCode, this.interrupted || exitCode === 130, at, waits?.inputWaitMs);
    this.foreground = undefined;
    // A submission that started no command (a comment, an empty block) is not owed to the next command.
    this.sent = undefined;
    const finished = this.ran;
    this.ran = false;
    this.atPrompt = true;
    if (finished && this.queue.size && !this.queue.state.paused) {
      if (this.interrupted || exitCode === 130) this.queue.hold({reason: 'interrupted', at, command: this.lastCommand});
      // An entry that is to run regardless of the result before it is not held back by a plain failure.
      else if (belongs && exitCode !== 0 && this.queue.next?.condition !== 'always' && this.timeline.policy !== 'continue') this.queue.hold({reason: 'failed', at, command: this.lastCommand, exitCode});
    }
    this.interrupted = false;
    this.settleTimeline();
    this.emit('state', this.state, {});
    this.dispatch();
  }

  /**
   * Typing the command `program` never read, which the shell took out of its terminal when the command finished
   * (#426): each line is held for the person's approval, never run by itself. Returns how many lines are held.
   */
  holdUnread(text: string, program: string): number {
    let held = 0;
    for (const line of unreadLines(text)) {
      this.request({op: 'add', text: line, typedWhile: program.slice(0, 64) || 'the command'});
      held += 1;
    }
    return held;
  }

  /** The session now runs a different shell: nothing queued for the old one runs until the person resumes. */
  onShellSwitched(shell: QueueShell): void {
    this.shell = shell;
    this.atPrompt = false;
    this.ran = false;
    this.sent = undefined;
    this.foreground = undefined;
    this.manualStarting = false; this.startingChain = undefined;
    this.queue.hold({reason: 'shell-switched', at: this.clock.now()});
  }

  /** The shell ended: what is left is reported and never runs. */
  onShellExit(): void {
    this.manualStarting = false; this.startingChain = undefined;
    this.atPrompt = false;
    this.taking = true;
    let dropped: QueueEntry[];
    try { dropped = this.queue.drain(); } finally { this.taking = false; }
    if (this.sent) this.timeline.unobserved();
    this.sent = undefined;
    this.foreground = undefined;
    this.ran = false;
    this.interrupted = false;
    this.timeline.skip(dropped.length, 'shell-ended');
    if (this.timeline.running) this.timeline.abort(this.clock.now());
    if (this.timeline.settle()) this.autoSaveSettled();
    this.emit('state', this.state, {dropped});
  }

  private settleTimeline(): void {
    if (!this.queue.size && !this.sent && !this.timeline.running && this.timeline.settle()) this.autoSaveSettled();
  }

  /** History detail, automatic saving and saved summaries: owner facts only, never dispatch or shell state. */
  private summaryRequest(change: Extract<QueueOp, {op: 'history-detail' | 'save-summary' | 'summaries-auto'}>): void {
    if (change.expectedRevision !== undefined && change.expectedRevision !== this.queue.currentRevision) {
      this.emit('state', this.state, {refused: 'The queue changed; review it again before continuing.'});
      return;
    }
    if (change.op === 'history-detail') {
      this.detailChain = change.chainId !== undefined && this.timeline.record(change.chainId) ? change.chainId : undefined;
      this.emit('state', this.state, {});
      return;
    }
    if (change.op === 'summaries-auto') {
      this.autoSummaries = change.enabled;
      if (this.autoSummaries) this.autoSaveSettled();
      this.emit('state', this.state, {});
      return;
    }
    const saved = this.saveSummary(change.chainId, change.reviewed?.text);
    this.emit('state', this.state, saved ? {} : {refused: 'That chain has no settled result to summarize.'});
  }

  private autoSaveSettled(): void {
    if (!this.autoSummaries) return;
    const latest = this.timeline.history.at(-1);
    if (latest) this.saveSummary(latest.id);
  }

  private saveSummary(chainId: number, reviewed?: readonly (string | null)[]): boolean {
    // Exactly one artifact per chain: a repeat save (or a replay) never rewrites or duplicates it.
    if (this.summaries.some(summary => summary.chainId === chainId)) return true;
    const detail = this.timeline.record(chainId);
    const record = this.timeline.history.find(item => item.id === chainId);
    if (!detail || !record) return false;
    const texts = reviewed === undefined ? undefined : this.validReviewed(reviewed, detail);
    if (reviewed !== undefined && !texts) return false;
    this.summaries.push(buildQueueSummary(detail, {savedAt: this.clock.now(), origin: texts ? 'reviewed' : 'automatic',
      names: recognizedExecutables(this.shell.adapter.id), ...(texts ? {reviewed: texts} : {}), entriesOmitted: record.resultsOmitted}));
    if (this.summaries.length > SUMMARY_LIMIT) this.summaries.shift();
    return true;
  }

  /** Reviewed text is stored only when it matches the retained detail and the owner can verify it is clean. */
  private validReviewed(texts: readonly (string | null)[], detail: QueueTimeline): (string | null)[] | undefined {
    if (texts.length !== detail.executions.length) return undefined;
    const out: (string | null)[] = [];
    for (const text of texts) {
      if (text === null) { out.push(null); continue; }
      if (typeof text !== 'string' || !reviewedTextSafe(text)) return undefined;
      out.push(text);
    }
    return out;
  }

  private dispatch(): void {
    if (!this.atPrompt || !this.shell.isReady) return;
    this.taking = true;
    let entry: QueueEntry | undefined;
    try { entry = this.queue.take(); } finally { this.taking = false; }
    if (!entry) return;
    // Leaves the prompt now: a second dispatch cannot happen before this entry's own prompt.
    this.atPrompt = false;
    this.sent = entry;
    this.emit('state', this.state, {dispatched: entry});
    // Exactly as the composer submits it: a multi-line entry runs as one block.
    this.shell.submit(shellSubmission(entry.text, this.shell.adapter.id));
  }
}
