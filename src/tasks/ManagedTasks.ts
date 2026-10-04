import {spawn, type ChildProcess} from 'node:child_process';

/**
 * Long-lived tasks Ask starts for the person (dev servers, watchers) run here,
 * beside the shell rather than in it, so the shell stays usable. Each task is
 * one child process NMSh spawned itself, in its own process group (detached
 * from the host terminal, so it never touches the controlling TTY), with
 * bounded output. NMSh only ever stops tasks it owns, and stops all of them
 * when it exits. URLs are taken from the task's own output, never assumed.
 */

export type TaskStatus = 'starting' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopping';

export interface ManagedTask {
  id: string;
  label: string;
  argv: string[];
  cwd: string;
  startedAt: number;
  status: TaskStatus;
  endedAt?: number;
  exitCode?: number | null;
  /** Bounded output lines (ANSI stripped), oldest dropped first. */
  output: string[];
  /** URLs the task printed (local first), in order of appearance. */
  urls: string[];
  pid?: number;
  /** Always true: tasks here were started by NMSh; nothing else is ever listed or stopped. */
  ownedByNMSh: true;
}

const MAX_LINES = 2000;
const MAX_TASKS = 8;
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/gu;
/** http(s) URLs a server prints ("Local: http://localhost:5173/"). */
const URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[\w.-]+)(?::\d{2,5})?(?:\/[^\s'"<>)\]]*)?/gu;

export function extractUrls(line: string): string[] {
  return [...line.replace(ANSI, '').matchAll(URL)].map(match => match[0].replace(/[.,;:]+$/u, '').replace(/\/$/u, '').replace('://0.0.0.0', '://localhost'));
}

let counter = 0;

export class ManagedTasks {
  readonly tasks: ManagedTask[] = [];
  private readonly children = new Map<string, ChildProcess>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly spawnTask: typeof spawn = spawn, private readonly now: () => number = Date.now) {}

  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of this.listeners) listener(); }

  get(id: string): ManagedTask | undefined { return this.tasks.find(task => task.id === id); }
  live(): ManagedTask[] { return this.tasks.filter(task => task.status === 'starting' || task.status === 'running' || task.status === 'waiting' || task.status === 'stopping'); }

  start(label: string, argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): ManagedTask | {error: string} {
    if (!argv.length) return {error: 'Nothing to run.'};
    if (this.live().length >= MAX_TASKS) return {error: `NMSh already runs ${MAX_TASKS} background tasks; stop one first.`};
    // Finished tasks are kept briefly for "show its output"; the oldest finished ones go first.
    while (this.tasks.length >= MAX_TASKS * 2) { const index = this.tasks.findIndex(task => !this.children.has(task.id)); if (index < 0) break; this.tasks.splice(index, 1); }
    counter += 1;
    const task: ManagedTask = {id: `task-${counter}`, label, argv: [...argv], cwd, startedAt: this.now(), status: 'starting', output: [], urls: [], ownedByNMSh: true};
    let child: ChildProcess;
    try {
      child = this.spawnTask(argv[0]!, argv.slice(1), {cwd, env: {...env, FORCE_COLOR: '0'}, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    } catch (error) { return {error: error instanceof Error ? error.message : String(error)}; }
    task.pid = child.pid;
    this.children.set(task.id, child);
    this.tasks.push(task);
    let partial = '';
    const take = (chunk: Buffer | string) => {
      const text = partial + chunk.toString();
      const lines = text.split(/\r?\n|\r/u);
      partial = lines.pop() ?? '';
      if (partial.length > 4096) { lines.push(partial); partial = ''; }
      for (const raw of lines) this.line(task, raw);
      if (task.status === 'starting') task.status = 'running';
      this.emit();
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.on('spawn', () => { if (task.status === 'starting') { task.status = 'running'; this.emit(); } });
    child.on('error', error => { this.line(task, `NMSh: ${error.message}`); this.finish(task, -1); });
    child.on('exit', code => { if (partial) this.line(task, partial); partial = ''; this.finish(task, code); });
    this.emit();
    return task;
  }

  private line(task: ManagedTask, raw: string): void {
    const line = raw.replace(ANSI, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, '');
    task.output.push(line);
    if (task.output.length > MAX_LINES) task.output.splice(0, task.output.length - MAX_LINES);
    for (const url of extractUrls(line)) if (!task.urls.includes(url) && task.urls.length < 8) task.urls.push(url);
  }

  private finish(task: ManagedTask, code: number | null): void {
    if (!this.children.has(task.id)) return;
    this.children.delete(task.id);
    task.exitCode = code;
    task.endedAt = this.now();
    // A task the person stopped ended as asked; otherwise its exit status decides.
    task.status = task.status === 'stopping' || code === 0 ? 'completed' : 'failed';
    this.emit();
  }

  /** Stop one task NMSh owns: the whole process group (npm and the server it started), TERM then KILL. */
  stop(id: string): boolean {
    const task = this.get(id);
    const child = this.children.get(id);
    if (!task || !child || task.status === 'stopping') return false;
    task.status = 'stopping';
    this.emit();
    const signal = (name: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, name); } catch { try { child.kill(name); } catch { /* already gone */ } } };
    signal('SIGTERM');
    setTimeout(() => { if (this.children.has(id)) signal('SIGKILL'); }, 5000).unref();
    return true;
  }

  /** Stop every owned task (NMSh is exiting). */
  dispose(): void {
    for (const id of [...this.children.keys()]) this.stop(id);
    this.listeners.clear();
  }
}
