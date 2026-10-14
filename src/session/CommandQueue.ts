import {EventEmitter} from 'node:events';

/**
 * Commands prepared while another runs, owned by one session and run by its own shell, one at a time.
 *
 * The queue is data, never a shell construct: no `;`, `&&` or background jobs. Its owner (the session service, or
 * the in-process client) is the only place entries are taken for running (see QueueDispatcher), so an entry runs at
 * most once, and only in the shell of the session that owns it.
 */
export interface QueueEntry {
  /** Unique within the session, never reused. */
  id: number;
  /** Exactly what is submitted to the shell, multi-line included. */
  text: string;
  addedAt: number;
}

/** Why the queue does not run its next entry by itself. */
export type QueuePause =
  | {reason: 'user'; at: number}
  | {reason: 'failed'; at: number; command: string; exitCode: number}
  | {reason: 'interrupted'; at: number; command: string}
  | {reason: 'shell-switched'; at: number}
  | {reason: 'restored'; at: number};

export interface QueueState {
  entries: readonly QueueEntry[];
  paused?: QueuePause;
  /** An entry being edited holds the queue at that point until the edit is saved or cancelled. */
  editing?: number;
}

export type QueueOp =
  | {op: 'add'; text: string}
  | {op: 'edit'; id: number; text: string}
  | {op: 'edit-begin'; id: number}
  | {op: 'edit-cancel'; id: number}
  | {op: 'remove'; id: number}
  | {op: 'move'; id: number; to: number}
  | {op: 'clear'}
  | {op: 'pause'}
  | {op: 'resume'};

/** Bounds: a queue is for prepared commands, not bulk data. */
export const QUEUE_LIMIT = 100;
export const ENTRY_LIMIT = 64 * 1024;
/** All queued text together: keeps every queue snapshot well inside one protocol frame. */
export const QUEUE_BYTES_LIMIT = 1024 * 1024;

export class CommandQueue extends EventEmitter<{change: [QueueState]}> {
  private entries: QueueEntry[] = [];
  private nextId = 1;
  private pause?: QueuePause;
  private editing?: number;

  constructor(private readonly now: () => number = Date.now) { super(); }

  get state(): QueueState {
    return {entries: this.entries.map(entry => ({...entry})), ...(this.pause ? {paused: {...this.pause}} : {}),
      ...(this.editing === undefined ? {} : {editing: this.editing})};
  }

  get size(): number { return this.entries.length; }

  /** Applies an operation; returns why it was refused, if it was. */
  apply(change: QueueOp): string | undefined {
    switch (change.op) {
      case 'add': {
        if (!change.text.trim()) return 'Nothing to queue.';
        if (change.text.length > ENTRY_LIMIT) return 'That command is too long to queue.';
        if (this.entries.length >= QUEUE_LIMIT) return `The queue holds at most ${QUEUE_LIMIT} commands.`;
        if (this.bytes() + Buffer.byteLength(change.text) > QUEUE_BYTES_LIMIT) return 'The queue is full; run or remove some commands first.';
        this.entries.push({id: this.nextId++, text: change.text, addedAt: this.now()});
        break;
      }
      case 'edit': {
        const entry = this.entries.find(item => item.id === change.id);
        if (!entry) return 'That command already ran or was removed.';
        if (!change.text.trim()) return 'A queued command cannot be empty; remove it instead.';
        if (change.text.length > ENTRY_LIMIT) return 'That command is too long to queue.';
        if (this.bytes() - Buffer.byteLength(entry.text) + Buffer.byteLength(change.text) > QUEUE_BYTES_LIMIT) return 'The queue is full; run or remove some commands first.';
        entry.text = change.text;
        if (this.editing === change.id) this.editing = undefined;
        break;
      }
      case 'edit-begin': {
        if (!this.entries.some(item => item.id === change.id)) return 'That command already ran or was removed.';
        this.editing = change.id;
        break;
      }
      case 'edit-cancel': {
        if (this.editing !== change.id) return undefined;
        this.editing = undefined;
        break;
      }
      case 'remove': {
        const index = this.entries.findIndex(item => item.id === change.id);
        if (index === -1) return 'That command already ran or was removed.';
        this.entries.splice(index, 1);
        if (this.editing === change.id) this.editing = undefined;
        break;
      }
      case 'move': {
        const index = this.entries.findIndex(item => item.id === change.id);
        if (index === -1) return 'That command already ran or was removed.';
        const to = Math.max(0, Math.min(this.entries.length - 1, change.to));
        const [entry] = this.entries.splice(index, 1);
        this.entries.splice(to, 0, entry!);
        break;
      }
      case 'clear':
        this.entries = [];
        this.editing = undefined;
        this.pause = undefined;
        break;
      case 'pause':
        this.pause = {reason: 'user', at: this.now()};
        break;
      case 'resume':
        this.pause = undefined;
        break;
    }
    this.changed();
    return undefined;
  }

  /** Stops automatic running; entries stay. */
  hold(pause: QueuePause): void {
    if (!this.entries.length) return;
    this.pause = pause;
    this.changed();
  }

  /**
   * The next entry, removed from the queue, when it may run now: not paused and not held by an edit. Taking is the
   * only way an entry leaves for the shell, so it can never run twice.
   */
  take(): QueueEntry | undefined {
    if (this.pause || !this.entries.length) return undefined;
    if (this.editing === this.entries[0]!.id) return undefined;
    const entry = this.entries.shift()!;
    this.changed();
    return entry;
  }

  /** Everything still queued, removed (the shell ended or the session went away). */
  drain(): QueueEntry[] {
    const entries = this.entries;
    this.entries = [];
    this.editing = undefined;
    this.pause = undefined;
    if (entries.length) this.changed();
    return entries;
  }

  private bytes(): number {
    return this.entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.text), 0);
  }

  private changed(): void {
    this.emit('change', this.state);
  }
}
