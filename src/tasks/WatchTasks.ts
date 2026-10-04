import {spawn, type ChildProcess} from 'node:child_process';
import {classifyCommand, splitCommands, type PasteKind} from '../input/pasteGuard.js';

/**
 * /watch: NMSh runs a command again and again on its own schedule (never a
 * `while true` loop in the person's shell), keeps the current and previous
 * results (bounded), and shows what changed in one live block instead of
 * piling copies of the output into the transcript. Commands are classified
 * before they are watched: read-only, status and test commands are fine;
 * anything that installs, modifies, destroys, escalates or pipes downloaded
 * code is refused; unknown commands need an explicit confirmation; network
 * targets get a longer minimum interval. Watches live with this NMSh window:
 * they stop (with their processes) when it exits.
 */
export type WatchSafety = {kind: 'allowed'; network: boolean; remote: boolean} | {kind: 'confirm'; reason: string; network: boolean; remote: boolean} | {kind: 'refused'; reason: string};

const TEST_RUNNERS = /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|tests|check|lint|typecheck)(?::\S+)?|npx\s+(?:jest|vitest|mocha|tsc)\b|node\s+--test|pytest|python3?\s+-m\s+(?:pytest|unittest)|cargo\s+(?:test|check|clippy)|go\s+(?:test|vet)|make\s+(?:test|check|lint)|deno\s+test|bundle\s+exec\s+rspec|rspec|jest|vitest|tsc(?:\s+--noEmit)?)\b/u;
const REFUSED: ReadonlySet<PasteKind> = new Set(['install', 'modifies', 'destructive', 'privilege', 'pipeline', 'navigation']);
export const DEFAULT_INTERVAL_MS = 5000;
export const MIN_LOCAL_MS = 2000;
export const MIN_REMOTE_MS = 15000;
const MAX_OUTPUT = 200_000;

export function watchSafety(command: string): WatchSafety {
  const parts = splitCommands(command);
  if (!parts.length) return {kind: 'refused', reason: 'There is no command to watch.'};
  let unknown = false;
  let network = false;
  let remote = false;
  for (const part of parts) {
    const kinds = classifyCommand(part.text, part.pipedFrom);
    const bad = kinds.find(kind => REFUSED.has(kind));
    if (bad) return {kind: 'refused', reason: `/watch won't repeatedly run a command that ${bad === 'navigation' ? 'changes directory' : bad === 'install' ? 'installs packages' : bad === 'privilege' ? 'runs as root' : bad === 'pipeline' ? 'runs downloaded code' : bad === 'destructive' ? 'deletes or destroys things' : 'modifies files'} (${part.text}).`};
    if (kinds.includes('network')) {
      network = true;
      const target = /https?:\/\/([^/:\s]+)/u.exec(part.text)?.[1] ?? /\s([\w.-]+\.[a-z]{2,})(?:\s|$)/iu.exec(part.text)?.[1];
      if (target && !/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/u.test(target)) remote = true;
    }
    if (kinds.includes('command') && !TEST_RUNNERS.test(part.text) && !/^git\s+(?:status|log|diff|branch|remote|show)\b/u.test(part.text)) unknown = true;
  }
  return unknown ? {kind: 'confirm', reason: 'NMSh can\'t tell whether this command changes anything; it will run every interval.', network, remote} : {kind: 'allowed', network, remote};
}

/** "--every 5s", "every 10 seconds", "-n 2" → milliseconds (clamped to the minimum for the command). */
export function parseWatch(text: string): {command: string; intervalMs?: number} {
  const every = /^(?:--every|-n|every)\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|minutes?|ms)?\s+/u.exec(text.trim());
  if (!every) return {command: text.trim()};
  const value = Number(every[1]);
  const unit = every[2] ?? 's';
  const intervalMs = unit === 'ms' ? value : /^m/u.test(unit) && unit !== 'ms' ? value * 60_000 : value * 1000;
  return {command: text.trim().slice(every[0].length).trim(), intervalMs};
}

export interface WatchRun {output: string; exitCode: number | null; at: number; durationMs: number}

export interface WatchTask {
  id: string;
  command: string;
  cwd: string;
  intervalMs: number;
  startedAt: number;
  runs: number;
  status: 'running' | 'paused' | 'stopped';
  current?: WatchRun;
  previous?: WatchRun;
  /** What changed between the last two runs (semantic when an adapter recognizes the output). */
  changes: string[];
  /** One-line summary of the current result ("238 pass · 1 fail"). */
  summary?: string;
  previousSummary?: string;
  network: boolean;
}

/** Semantic summaries: TAP/node --test counts, Jest totals, git status entries; undefined for generic output. */
export function summarize(command: string, output: string, exitCode: number | null): string | undefined {
  const pass = /^# pass (\d+)/mu.exec(output)?.[1];
  const fail = /^# fail (\d+)/mu.exec(output)?.[1];
  if (pass !== undefined || fail !== undefined) return `${pass ?? 0} pass · ${fail ?? 0} fail`;
  const jest = /Tests:\s+(?:(\d+) failed, )?(\d+) passed/u.exec(output);
  if (jest) return `${jest[2]} pass · ${jest[1] ?? 0} fail`;
  if (/^\s*git\s+status\b/u.test(command)) {
    const entries = output.split('\n').filter(line => /^\s*(?:modified|new file|deleted|renamed):|^\t\S/u.test(line) || /^[ MADRCU?!]{2} /u.test(line)).length;
    return /nothing to commit/u.test(output) ? 'clean' : `${entries} change${entries === 1 ? '' : 's'}`;
  }
  return exitCode === 0 ? undefined : `exit ${exitCode}`;
}

/** What changed: failing test names in/out, git entries in/out, else a line diff count with a sample. */
export function diffRuns(previous: string, current: string): string[] {
  const failing = (text: string) => new Set(text.split('\n').filter(line => /^\s*not ok \d+ - /u.test(line)).map(line => line.replace(/^\s*not ok \d+ - /u, '').trim()));
  const before = failing(previous);
  const after = failing(current);
  if (before.size || after.size) {
    return [...[...before].filter(name => !after.has(name)).map(name => `✓ ${name} now passes`), ...[...after].filter(name => !before.has(name)).map(name => `✗ ${name} now fails`),
      ...[...after].filter(name => before.has(name)).slice(0, 3).map(name => `✗ ${name} still fails`)].slice(0, 8);
  }
  const lines = (text: string) => text.split('\n').map(line => line.trimEnd()).filter(Boolean);
  const a = new Set(lines(previous));
  const b = new Set(lines(current));
  const added = [...b].filter(line => !a.has(line));
  const removed = [...a].filter(line => !b.has(line));
  if (!added.length && !removed.length) return [];
  return [`${added.length} line${added.length === 1 ? '' : 's'} added · ${removed.length} removed`, ...added.slice(0, 3).map(line => `+ ${line.slice(0, 100)}`), ...removed.slice(0, 2).map(line => `- ${line.slice(0, 100)}`)];
}

let counter = 0;

export class WatchTasks {
  readonly watches: WatchTask[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly children = new Map<string, ChildProcess>();
  private readonly listeners = new Set<(watch: WatchTask, transition?: 'pass' | 'fail') => void>();

  constructor(private readonly shell: string = '/bin/sh', private readonly now: () => number = Date.now, private readonly env: NodeJS.ProcessEnv = process.env) {}

  onChange(listener: (watch: WatchTask, transition?: 'pass' | 'fail') => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(watch: WatchTask, transition?: 'pass' | 'fail'): void { for (const listener of this.listeners) listener(watch, transition); }

  get(id: string): WatchTask | undefined { return this.watches.find(watch => watch.id === id); }
  active(): WatchTask[] { return this.watches.filter(watch => watch.status !== 'stopped'); }

  /** Start watching a command already judged allowed (or confirmed). The first run starts at once. */
  start(command: string, cwd: string, intervalMs: number | undefined, safety: Exclude<WatchSafety, {kind: 'refused'}>): WatchTask {
    counter += 1;
    const minimum = safety.remote ? MIN_REMOTE_MS : MIN_LOCAL_MS;
    const watch: WatchTask = {id: `watch-${counter}`, command, cwd, intervalMs: Math.max(minimum, intervalMs ?? DEFAULT_INTERVAL_MS), startedAt: this.now(), runs: 0,
      status: 'running', changes: [], network: safety.network};
    this.watches.push(watch);
    this.runNow(watch.id);
    return watch;
  }

  /** Run once now (skipped while a run is still in flight: runs never overlap). */
  runNow(id: string): void {
    const watch = this.get(id);
    if (!watch || watch.status === 'stopped' || this.children.has(id)) return;
    const started = this.now();
    let output = '';
    let child: ChildProcess;
    try {
      child = spawn(this.shell, ['-c', watch.command], {cwd: watch.cwd, env: {...this.env, NO_COLOR: '1', FORCE_COLOR: '0'}, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    } catch (error) { this.record(watch, {output: String(error), exitCode: -1, at: started, durationMs: 0}); return; }
    this.children.set(id, child);
    const take = (chunk: Buffer) => { if (output.length < MAX_OUTPUT) output += chunk.toString().slice(0, MAX_OUTPUT - output.length); };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    // A run never outlives a few intervals (bounded at a minute).
    const limit = setTimeout(() => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, Math.min(60_000, watch.intervalMs * 3));
    limit.unref();
    const done = (code: number | null) => {
      clearTimeout(limit);
      if (this.children.get(id) !== child) return;
      this.children.delete(id);
      this.record(watch, {output: output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, ''), exitCode: code, at: started, durationMs: this.now() - started});
    };
    child.on('error', () => done(-1));
    child.on('exit', code => done(code));
  }

  private record(watch: WatchTask, run: WatchRun): void {
    if (watch.status === 'stopped') return;
    const wasPassing = watch.current ? watch.current.exitCode === 0 : undefined;
    watch.previous = watch.current;
    watch.current = run;
    watch.runs += 1;
    watch.previousSummary = watch.summary;
    const summary = summarize(watch.command, run.output, run.exitCode);
    if (summary) watch.summary = summary; else delete watch.summary;
    watch.changes = watch.previous ? diffRuns(watch.previous.output, run.output) : [];
    const transition = wasPassing === undefined ? undefined : wasPassing && run.exitCode !== 0 ? 'fail' : !wasPassing && run.exitCode === 0 ? 'pass' : undefined;
    this.schedule(watch);
    this.emit(watch, transition);
  }

  private schedule(watch: WatchTask): void {
    const existing = this.timers.get(watch.id);
    if (existing) clearTimeout(existing);
    this.timers.delete(watch.id);
    if (watch.status !== 'running') return;
    const timer = setTimeout(() => { this.timers.delete(watch.id); this.runNow(watch.id); }, watch.intervalMs);
    timer.unref();
    this.timers.set(watch.id, timer);
  }

  pause(id: string): boolean {
    const watch = this.get(id);
    if (!watch || watch.status !== 'running') return false;
    watch.status = 'paused';
    this.schedule(watch);
    this.emit(watch);
    return true;
  }

  resume(id: string): boolean {
    const watch = this.get(id);
    if (!watch || watch.status !== 'paused') return false;
    watch.status = 'running';
    this.runNow(id);
    this.emit(watch);
    return true;
  }

  /** Stop: no more runs, the in-flight run's process group is ended, nothing is left behind. */
  stop(id: string): boolean {
    const watch = this.get(id);
    if (!watch || watch.status === 'stopped') return false;
    watch.status = 'stopped';
    this.schedule(watch);
    const child = this.children.get(id);
    this.children.delete(id);
    if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } } }
    this.emit(watch);
    return true;
  }

  get scheduled(): number { return this.timers.size + this.children.size; }

  dispose(): void {
    for (const watch of this.active()) this.stop(watch.id);
    this.listeners.clear();
  }
}
