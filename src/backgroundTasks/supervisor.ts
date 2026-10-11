import {statSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {spawn as spawnPty, type IPty} from 'node-pty';
import {TaskOutput, type OutputLimits} from './output.js';

/**
 * The background task supervisor (#382). Each task is an NMSh-owned process
 * in its own pseudo-terminal: the PTY makes the child a session and
 * process-group leader, so every process the task's shell starts without
 * leaving that group (pipelines included) can be signalled together, and
 * nothing else. NMSh's interactive shell, other tasks and processes that
 * deliberately detach (an adb server started by `adb logcat`) are never
 * signalled.
 *
 * The exact command text is passed as one argument to the session's own
 * shell (`<shell> -c <command>`): never re-quoted, concatenated or parsed by
 * NMSh. It runs with the environment and directory the caller supplies (the
 * session's launch environment, the live PATH and the live working
 * directory); it does not see the live shell's aliases, functions,
 * unexported variables or options.
 *
 * States are reported only from evidence: `stopping` after a stop request,
 * `stopped` / `exited` / `failed` only once the process has exited. A task
 * whose leader exited while other processes of its group still run says so.
 */

export type TaskState = 'running' | 'stopping' | 'exited' | 'failed' | 'stopped';
export type StopLevel = 'interrupt' | 'terminate' | 'kill';

export interface TaskRecord {
  /** NMSh's id: short, unique within the supervisor, never reused. */
  id: string;
  command: string;
  /** The detector's family, when the task came from a recognized command. */
  family?: string;
  cwd: string;
  shell: string;
  startedAt: number;
  endedAt?: number;
  state: TaskState;
  exitCode?: number;
  signal?: number;
  /** The strongest stop request made so far. */
  stopRequested?: StopLevel;
  /** Processes of the task's group still running after its leader exited. */
  leftovers?: boolean;
}

export interface StartRequest {
  command: string;
  family?: string;
  cwd: string;
  /** The session's shell executable (absolute path). */
  shell: string;
  /** The environment to run with; held for the spawn only, never stored on the record. */
  env: Record<string, string>;
  columns?: number;
  rows?: number;
}

export type PtySpawner = (file: string, args: string[], options: {cwd: string; env: Record<string, string>; cols: number; rows: number; name: string}) => IPty;

export interface SupervisorOptions {
  output: OutputLimits;
  /** Concurrent running tasks allowed. */
  maxRunning?: number;
  spawn?: PtySpawner;
  now?: () => number;
  /** Called (coalesced) when a task changes state or receives output. */
  onChange?: (task: TaskRecord) => void;
}

interface LiveTask {
  record: TaskRecord;
  output: TaskOutput;
  pty?: IPty;
  /** The process group the PTY made: the leader's pid. */
  group?: number;
  pending?: ReturnType<typeof setTimeout>;
}

const SIGNALS: Record<StopLevel, NodeJS.Signals> = {interrupt: 'SIGINT', terminate: 'SIGTERM', kill: 'SIGKILL'};
const ORDER: readonly StopLevel[] = ['interrupt', 'terminate', 'kill'];

export class BackgroundTaskSupervisor {
  private readonly tasks = new Map<string, LiveTask>();
  private counter = 0;
  private readonly spawn: PtySpawner;
  private readonly now: () => number;

  constructor(private readonly options: SupervisorOptions) {
    this.spawn = options.spawn ?? ((file, args, opts) => spawnPty(file, args, opts));
    this.now = options.now ?? Date.now;
  }

  list(): TaskRecord[] { return [...this.tasks.values()].map(task => ({...task.record})); }
  get(id: string): TaskRecord | undefined { const task = this.tasks.get(id); return task ? {...task.record} : undefined; }
  output(id: string): TaskOutput | undefined { return this.tasks.get(id)?.output; }

  start(request: StartRequest): {ok: true; task: TaskRecord} | {ok: false; reason: string} {
    if (!request.command.trim() || request.command.length > 64 * 1024) return {ok: false, reason: 'the command is empty or too long'};
    if (request.command.includes('\u0000')) return {ok: false, reason: 'the command contains a NUL character'};
    if (!isAbsolute(request.shell)) return {ok: false, reason: 'the shell must be an absolute path'};
    try { if (!isAbsolute(request.cwd) || !statSync(request.cwd).isDirectory()) return {ok: false, reason: 'the working directory is not a directory'}; }
    catch { return {ok: false, reason: 'the working directory does not exist'}; }
    const running = [...this.tasks.values()].filter(task => task.record.state === 'running' || task.record.state === 'stopping').length;
    if (running >= (this.options.maxRunning ?? 16)) return {ok: false, reason: `${running} background tasks are already running`};
    const id = `t${++this.counter}`;
    const record: TaskRecord = {id, command: request.command, ...(request.family ? {family: request.family} : {}), cwd: request.cwd, shell: request.shell, startedAt: this.now(), state: 'running'};
    const task: LiveTask = {record, output: new TaskOutput(this.options.output)};
    let pty: IPty;
    try {
      // One argv element for the command: the shell parses it exactly as typed.
      pty = this.spawn(request.shell, ['-c', request.command], {cwd: request.cwd, env: request.env, cols: Math.max(20, request.columns ?? 120), rows: Math.max(5, request.rows ?? 40), name: request.env.TERM || 'xterm-256color'});
    } catch (error) {
      return {ok: false, reason: `could not start: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200)};
    }
    task.pty = pty;
    task.group = pty.pid;
    this.tasks.set(id, task);
    pty.onData(data => { task.output.append(data); this.changed(task); });
    pty.onExit(({exitCode, signal}) => this.exited(task, exitCode, signal));
    this.changed(task, true);
    return {ok: true, task: {...record}};
  }

  /**
   * Ask a running task to stop. `interrupt` is what Ctrl+C would do in a terminal (SIGINT to the task's process group,
   * not a byte written to its input, which a program in raw mode would read as data); `terminate` and `kill` are the
   * explicit escalations. The task is reported stopped only when it has exited.
   */
  stop(id: string, level: StopLevel = 'interrupt'): {ok: true} | {ok: false; reason: string} {
    const task = this.tasks.get(id);
    if (!task) return {ok: false, reason: 'no such task'};
    if (task.record.state !== 'running' && task.record.state !== 'stopping') {
      return task.record.leftovers && level === 'kill' ? this.killLeftovers(task) : {ok: false, reason: 'the task is not running'};
    }
    if (!task.group) return {ok: false, reason: 'the task has no process group'};
    try { process.kill(-task.group, SIGNALS[level]); }
    catch (error) { return {ok: false, reason: (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'the task already ended' : 'the signal could not be delivered'}; }
    const previous = task.record.stopRequested;
    task.record.stopRequested = previous && ORDER.indexOf(previous) > ORDER.indexOf(level) ? previous : level;
    task.record.state = 'stopping';
    this.changed(task, true);
    return {ok: true};
  }

  /** The next escalation for a task that has not stopped yet, if any. */
  nextEscalation(id: string): StopLevel | undefined {
    const requested = this.tasks.get(id)?.record.stopRequested;
    if (!requested) return 'interrupt';
    return ORDER[ORDER.indexOf(requested) + 1];
  }

  /** Resize a task's PTY (its programs see the new size as in a terminal). */
  resize(id: string, columns: number, rows: number): void {
    const task = this.tasks.get(id);
    if (task?.pty && (task.record.state === 'running' || task.record.state === 'stopping')) {
      try { task.pty.resize(Math.max(20, columns), Math.max(5, rows)); } catch { /* exited meanwhile */ }
    }
  }

  /** Remove a finished task from the list (its output goes with it). Running tasks are never removed; stop them first. */
  remove(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.record.state === 'running' || task.record.state === 'stopping') return false;
    clearTimeout(task.pending);
    this.tasks.delete(id);
    return true;
  }

  /** Remove the oldest finished tasks beyond `keep`. */
  prune(keep: number): number {
    const finished = [...this.tasks.values()].filter(task => task.record.endedAt !== undefined).sort((a, b) => a.record.endedAt! - b.record.endedAt!);
    let removed = 0;
    for (const task of finished.slice(0, Math.max(0, finished.length - keep))) if (this.remove(task.record.id)) removed += 1;
    return removed;
  }

  /**
   * End every task this supervisor started, for an explicit session exit: interrupt, then terminate and kill what
   * remains after the grace period. Resolves when all have exited.
   */
  async shutdown(graceMs = 2000): Promise<void> {
    const live = () => [...this.tasks.values()].filter(task => task.record.state === 'running' || task.record.state === 'stopping');
    for (const level of ORDER) {
      for (const task of live()) this.stop(task.record.id, level);
      const deadline = Date.now() + graceMs;
      while (live().length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      if (!live().length) break;
    }
    for (const task of [...this.tasks.values()].filter(item => item.record.leftovers)) this.killLeftovers(task);
  }

  private exited(task: LiveTask, exitCode: number, signal?: number): void {
    const record = task.record;
    if (signal) record.signal = signal; else record.exitCode = exitCode;
    task.pty = undefined;
    // After a stop request the task is the whole group, not just its leader: a shell that does not exec its command
    // (dash) dies of SIGINT while a program that ignores SIGINT keeps running. Until the group is gone the task is
    // still stopping, and escalation still reaches it.
    if (record.stopRequested && groupAlive(task.group)) {
      record.leftovers = true;
      this.changed(task, true);
      const poll = setInterval(() => {
        if (groupAlive(task.group)) return;
        clearInterval(poll);
        this.finish(task);
      }, 50);
      poll.unref?.();
      return;
    }
    this.finish(task);
  }

  private finish(task: LiveTask): void {
    task.output.finish();
    const record = task.record;
    record.endedAt = this.now();
    // Stopped: it ended after the person asked. Otherwise its own exit status decides.
    record.state = record.stopRequested ? 'stopped' : record.signal || record.exitCode !== 0 ? 'failed' : 'exited';
    record.leftovers = groupAlive(task.group);
    this.changed(task, true);
    // The kernel hangs up the group when its leader exits; members that obey it are gone a moment later.
    if (record.leftovers) for (const delay of [100, 1000]) {
      setTimeout(() => {
        if (!record.leftovers) return;
        record.leftovers = groupAlive(task.group);
        if (!record.leftovers) this.changed(task, true);
      }, delay).unref?.();
    }
  }

  private killLeftovers(task: LiveTask): {ok: true} | {ok: false; reason: string} {
    if (!task.group || !groupAlive(task.group)) { task.record.leftovers = false; this.changed(task, true); return {ok: false, reason: 'nothing is left running'}; }
    try { process.kill(-task.group, 'SIGKILL'); } catch { /* raced with their exit */ }
    task.record.leftovers = groupAlive(task.group);
    this.changed(task, true);
    return {ok: true};
  }

  /** Output notifications are coalesced (at most every 50 ms per task); state changes are immediate. */
  private changed(task: LiveTask, immediate = false): void {
    if (!this.options.onChange) return;
    if (immediate) { clearTimeout(task.pending); task.pending = undefined; this.options.onChange({...task.record}); return; }
    if (task.pending) return;
    task.pending = setTimeout(() => { task.pending = undefined; this.options.onChange?.({...task.record}); }, 50);
    task.pending.unref?.();
  }
}

/** Whether any process of a group still exists (signal 0 checks without signalling). */
export function groupAlive(group: number | undefined): boolean {
  if (!group || group <= 1) return false;
  try { process.kill(-group, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
