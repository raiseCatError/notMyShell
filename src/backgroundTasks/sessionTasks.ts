import {DEFAULT_PREFERENCES} from './preferences.js';
import type {TaskOp, TaskUpdate} from './protocol.js';
import {BackgroundTaskSupervisor, type PtySpawner, type TaskRecord} from './supervisor.js';

/**
 * One session's background tasks (#382), owned beside its shell by whatever
 * owns the session: the session service, or the in-process client when the
 * window runs its shell itself. Tasks belong to the session, not to a window:
 * a detached frontend leaves them running, a reattached one receives the list
 * and each task's recent output, and nothing is ever started again. Ending the
 * session ends its tasks.
 */

export interface TaskListener {
  tasks(records: TaskRecord[]): void;
  output(id: string, update: TaskUpdate): void;
}

/** One update never carries more than this much text; older lines beyond it count as not received. */
export const MAX_UPDATE_BYTES = 1024 * 1024;

export interface SessionTasksOptions {
  /** The session shell's absolute path, now. */
  shell: () => string | undefined;
  /** The session's launch environment (held in memory only; never on a record). */
  env: () => Record<string, string>;
  spawn?: PtySpawner;
  finishedKept?: number;
  now?: () => number;
}

export class SessionTasks {
  private readonly supervisor: BackgroundTaskSupervisor;
  private listener?: TaskListener;
  /** The last line seq the current listener has, per task. */
  private readonly sent = new Map<string, number>();
  private ended = false;

  constructor(private readonly options: SessionTasksOptions) {
    const retention = DEFAULT_PREFERENCES().retention;
    this.supervisor = new BackgroundTaskSupervisor({output: {lines: retention.lines, bytes: retention.bytes},
      ...(options.spawn ? {spawn: options.spawn} : {}), ...(options.now ? {now: options.now} : {}), onChange: record => this.changed(record)});
  }

  list(): TaskRecord[] { return this.supervisor.list(); }

  /** A frontend attached: it gets the whole list and each task's recent output, then changes as they happen. */
  attach(listener: TaskListener): void {
    this.listener = listener;
    this.sent.clear();
    const records = this.supervisor.list();
    listener.tasks(records);
    for (const record of records) this.publish(record.id);
  }

  detach(listener?: TaskListener): void {
    if (!listener || this.listener === listener) this.listener = undefined;
  }

  /** A request from the frontend. Returns why it was refused, or undefined when it was done. */
  request(op: TaskOp): string | undefined {
    if (this.ended) return 'the session has ended';
    if (op.op === 'start') {
      const shell = this.options.shell();
      if (!shell) return 'the session shell is not available';
      const result = this.supervisor.start({command: op.command, cwd: op.cwd, shell, ...(op.family ? {family: op.family} : {}),
        env: {...this.options.env(), ...(op.path ? {PATH: op.path} : {})}});
      return result.ok ? undefined : result.reason;
    }
    if (op.op === 'stop') { const result = this.supervisor.stop(op.id, op.level); return result.ok ? undefined : result.reason; }
    if (!this.supervisor.remove(op.id)) return 'a running task, or one whose processes still run, is never removed';
    this.sent.delete(op.id);
    this.listener?.tasks(this.supervisor.list());
    return undefined;
  }

  /** The session ends: interrupt, terminate, then kill what remains. */
  async shutdown(): Promise<void> {
    this.ended = true;
    await this.supervisor.shutdown();
    this.listener = undefined;
  }

  private changed(record: TaskRecord): void {
    // Finished tasks beyond the kept number are removed oldest first; a task whose processes still run is never removed.
    if (record.state !== 'running' && record.state !== 'stopping') this.supervisor.prune(this.options.finishedKept ?? DEFAULT_PREFERENCES().retention.finishedKept);
    if (!this.listener) return;
    this.listener.tasks(this.supervisor.list());
    this.publish(record.id);
  }

  private publish(id: string): void {
    const output = this.supervisor.output(id);
    if (!output || !this.listener) return;
    const after = this.sent.get(id) ?? 0;
    const fresh = output.since(after);
    // Newest first until the budget is used: a reattach after a long burst shows the latest lines.
    const lines = [];
    let bytes = 0;
    for (let index = fresh.length - 1; index >= 0; index--) {
      const line = fresh[index]!;
      bytes += Buffer.byteLength(line.text) + 16;
      if (bytes > MAX_UPDATE_BYTES) break;
      lines.unshift(line);
    }
    this.sent.set(id, output.lastSeq);
    this.listener.output(id, {lines, partial: output.partial(), dropped: output.dropped, received: output.received});
  }
}
