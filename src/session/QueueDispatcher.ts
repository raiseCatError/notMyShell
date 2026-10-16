import {ExecutionTimeline, systemQueueClock, type QueueClock, type QueueFailurePolicy} from './ExecutionTimeline.js';
import {shellSubmission} from '../shell/submission.js';
import {EventEmitter} from 'node:events';
import type {ShellId} from '../shell/adapters/ShellAdapter.js';
import {CommandQueue, type QueueEntry, type QueueOp, type QueueState} from './CommandQueue.js';

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

  private readonly timeline: ExecutionTimeline;
  private failurePolicy: QueueFailurePolicy = 'pause';
  private foreground?: {text: string; at: number; mono: number; eligible: boolean};

  constructor(shell: QueueShell, queue = new CommandQueue(), private readonly clock: QueueClock = systemQueueClock) {
    super();
    this.shell = shell;
    this.timeline = new ExecutionTimeline(clock);
    this.queue = queue;
    this.queue.on('change', () => { if (!this.taking) this.emit('state', this.state, {}); });
  }

  get state(): QueueState { const timeline = this.timeline.state; return {...this.queue.state, ...(this.sent ? {dispatching: {...this.sent}} : {}), revision: this.queue.currentRevision, ...(timeline ? {timeline} : {})}; }

  /** A change requested by the person; the queue may run at once if the shell is idle. */
  request(change: QueueOp): void {
    if (change.op === 'failure-policy') { this.failurePolicy = change.policy; return; }
    const before = this.queue.size;
    this.taking = true;
    let refused: string | undefined;
    try { refused = this.queue.apply(change); } finally { this.taking = false; }
    if (refused) { this.emit('state', this.state, {refused}); return; }
    if (change.op === 'add') {
      const opening = !this.timeline.active;
      this.timeline.open(this.failurePolicy);
      if (opening && this.foreground?.eligible && !this.queue.state.paused) this.timeline.begin(this.foreground.text, this.foreground.at, this.foreground.mono);
    }
    if (change.op === 'clear') this.timeline.skip(before, 'cleared');
    else if (change.op === 'remove') this.timeline.skip(before - this.queue.size, this.queue.size ? undefined : 'cleared');
    this.settleTimeline();
    this.emit('state', this.state, {});
    this.dispatch();
  }

  /** Claim a manual submission synchronously, before an asynchronous shell exec marker can arrive. */
  onSubmission(): void {
    this.atPrompt = false;
    this.queue.invalidateReviews();
  }

  /** A review belongs to one controller attachment, even if no queue entry changed. */
  onOwnershipChanged(): void { this.queue.invalidateReviews(); }

  /** The shell started a command; returns the queued entry it is, when it is the one just submitted. */
  onExec(command: string, at = this.clock.now()): QueueEntry | undefined {
    this.atPrompt = false;
    this.ran = true;
    this.lastCommand = command;
    const entry = this.sent;
    this.sent = undefined;
    this.foreground = {text: command, at, mono: this.clock.monotonic(), eligible: !this.queue.state.paused};
    if (entry) this.timeline.begin(entry.text, at, this.foreground.mono, entry.id);
    this.queue.invalidateReviews();
    return entry;
  }

  onInterrupt(): void {
    if (!this.atPrompt) this.interrupted = true;
  }

  onPrompt(exitCode: number, at = this.clock.now(), waits?: {inputWaitMs?: number}): void {
    if (this.sent && !this.ran) this.timeline.unobserved();
    const belongs = this.timeline.running;
    if (this.ran && belongs) this.timeline.complete(exitCode, this.interrupted || exitCode === 130, at, waits?.inputWaitMs);
    this.foreground = undefined;
    // A submission that started no command (a comment, an empty block) is not owed to the next command.
    this.sent = undefined;
    const finished = this.ran;
    this.ran = false;
    this.atPrompt = true;
    if (finished && belongs && this.queue.size && !this.queue.state.paused) {
      if (this.interrupted || exitCode === 130) this.queue.hold({reason: 'interrupted', at, command: this.lastCommand});
      // An entry that is to run regardless of the result before it is not held back by a plain failure.
      else if (exitCode !== 0 && this.queue.next?.condition !== 'always' && this.timeline.policy !== 'continue') this.queue.hold({reason: 'failed', at, command: this.lastCommand, exitCode});
    }
    this.interrupted = false;
    this.settleTimeline();
    this.emit('state', this.state, {});
    this.dispatch();
  }

  /** The session now runs a different shell: nothing queued for the old one runs until the person resumes. */
  onShellSwitched(shell: QueueShell): void {
    this.shell = shell;
    this.atPrompt = false;
    this.ran = false;
    this.sent = undefined;
    this.foreground = undefined;
    this.queue.hold({reason: 'shell-switched', at: this.clock.now()});
  }

  /** The shell ended: what is left is reported and never runs. */
  onShellExit(): void {
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
    this.timeline.settle();
    this.emit('state', this.state, {dropped});
  }

  private settleTimeline(): void {
    if (!this.queue.size && !this.sent && !this.timeline.running) this.timeline.settle();
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
