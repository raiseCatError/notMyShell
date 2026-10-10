import {shellSubmission} from '../shell/submission.js';
import {EventEmitter} from 'node:events';
import {CommandQueue, type QueueEntry, type QueueOp, type QueueState} from './CommandQueue.js';

/** What the dispatcher needs from a shell session (ShellSession implements it). */
export interface QueueShell {
  submit(command: string): void;
  readonly isReady: boolean;
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

  constructor(shell: QueueShell, queue = new CommandQueue()) {
    super();
    this.shell = shell;
    this.queue = queue;
    this.queue.on('change', state => { if (!this.taking) this.emit('state', state, {}); });
  }

  get state(): QueueState { return this.queue.state; }

  /** A change requested by the person; the queue may run at once if the shell is idle. */
  request(change: QueueOp): void {
    const refused = this.queue.apply(change);
    if (refused) { this.emit('state', this.queue.state, {refused}); return; }
    this.dispatch();
  }

  /** The shell started a command; returns the queued entry it is, when it is the one just submitted. */
  onExec(command: string): QueueEntry | undefined {
    this.atPrompt = false;
    this.ran = true;
    this.lastCommand = command;
    const entry = this.sent;
    this.sent = undefined;
    return entry;
  }

  onInterrupt(): void {
    if (!this.atPrompt) this.interrupted = true;
  }

  onPrompt(exitCode: number): void {
    // A submission that started no command (a comment, an empty block) is not owed to the next command.
    this.sent = undefined;
    const finished = this.ran;
    this.ran = false;
    this.atPrompt = true;
    if (finished && this.queue.size) {
      const at = Date.now();
      if (this.interrupted || exitCode === 130) this.queue.hold({reason: 'interrupted', at, command: this.lastCommand});
      // An entry that is to run regardless of the result before it is not held back by a plain failure.
      else if (exitCode !== 0 && this.queue.next?.condition !== 'always') this.queue.hold({reason: 'failed', at, command: this.lastCommand, exitCode});
    }
    this.interrupted = false;
    this.dispatch();
  }

  /** The session now runs a different shell: nothing queued for the old one runs until the person resumes. */
  onShellSwitched(shell: QueueShell): void {
    this.shell = shell;
    this.atPrompt = false;
    this.ran = false;
    this.sent = undefined;
    this.queue.hold({reason: 'shell-switched', at: Date.now()});
  }

  /** The shell ended: what is left is reported and never runs. */
  onShellExit(): void {
    this.atPrompt = false;
    this.taking = true;
    let dropped: QueueEntry[];
    try { dropped = this.queue.drain(); } finally { this.taking = false; }
    if (dropped.length) this.emit('state', this.queue.state, {dropped});
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
    this.emit('state', this.queue.state, {dispatched: entry});
    // Exactly as the composer submits it: a multi-line entry runs as one block.
    this.shell.submit(shellSubmission(entry.text));
  }
}
