import {spawn, type ChildProcess} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {classifyCommand, splitCommands, type PasteKind} from '../input/pasteGuard.js';
import {stripTerminalControls} from '../util/terminalControls.js';

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
export const MAX_INTERVAL_MS = 3_600_000;
export const MAX_ACTIVE_WATCHES = 8;
const MAX_COMMAND = 4096;
const MAX_OUTPUT = 200_000;
const STOP_GRACE_MS = 1500;

export function watchSafety(command: string): WatchSafety {
  if (!command.trim() || command.length > MAX_COMMAND || /[\u0000-\u001f\u007f]/u.test(command)) {
    return {kind: 'refused', reason: 'A tracked command must be nonempty, single-line and at most 4096 characters.'};
  }
  // A harmless-looking first word is not evidence that embedded shell execution is safe.
  // Fail closed rather than scheduling substitutions, backticks or process substitutions.
  if (/\$\(|`|[<>]\(/u.test(command)) {
    return {kind: 'refused', reason: 'Shell and process substitutions cannot be tracked repeatedly.'};
  }
  const outsideQuotes = command.replace(/"(?:\\.|[^"\\])*"|'[^']*'/gu, '""');
  // Detached shell jobs would outlive the observed sample and multiply on every
  // tick; heredocs also need a different stdin/input-ownership contract.
  if (/(?:^|[^&])&(?!&)|<</u.test(outsideQuotes)) {
    return {kind: 'refused', reason: 'Background operators and heredocs cannot be tracked safely.'};
  }
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
    // Allow only Docker's explicit read-only disk report. Other Docker verbs (including
    // 'system prune') still require confirmation, or are refused by the classifier.
    const dockerDiskReport = /^docker\s+system\s+df(?:\s+(?:-v|--verbose))?\s*$/u.test(part.text);
    if ((kinds.includes('unknown') || kinds.includes('project') || kinds.includes('text')) && !dockerDiskReport && !TEST_RUNNERS.test(part.text) && !/^git\s+(?:status|log|diff|branch|remote|show)\b/u.test(part.text)) unknown = true;
  }
  return unknown ? {kind: 'confirm', reason: 'NMSh can\'t tell whether this command changes anything; it will run every interval.', network, remote} : {kind: 'allowed', network, remote};
}

/** Parse a finite interval strictly. Invalid cadence never falls through as shell text. */
export function parseWatch(text: string): {command: string; intervalMs?: number; error?: string} {
  const input = text.trim();
  const marker = /^(?:--every|-n|every)(?:\s+|$)/u;
  if (!marker.test(input)) return {command: input.replace(/^--(?:\s+|$)/u, '').trim()};
  const every = /^(?:--every|-n|every)\s+(\d+(?:\.\d+)?)\s*(ms|seconds?|secs?|s|minutes?|mins?|m)?(?:\s+|$)/u.exec(input);
  if (!every) return {command: '', error: 'Invalid interval. Use /track --every 5s -- <command>.'};
  const value = Number(every[1]);
  const unit = every[2] ?? 's';
  const multiplier = unit === 'ms' ? 1 : /^(?:m|min|minute)/u.test(unit) ? 60_000 : 1000;
  const intervalMs = value * multiplier;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > MAX_INTERVAL_MS) {
    return {command: '', error: 'Interval must be positive and at most 60 minutes.'};
  }
  const command = input.slice(every[0].length).replace(/^--(?:\s+|$)/u, '').trim();
  if (!command) return {command: '', error: 'Provide a finite command after the interval.'};
  return {command, intervalMs};
}

export interface WatchRun {output: string; exitCode: number | null; at: number; durationMs: number; truncated?: boolean; timedOut?: boolean; error?: string; signal?: string | null}

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
  private readonly killTimers = new Map<string, NodeJS.Timeout>();
  private readonly listeners = new Set<(watch: WatchTask, transition?: 'pass' | 'fail') => void>();

  /**
   * `env` may be a function, read at every sample: the window passes its launch environment with the live shell's
   * PATH, so a tracked command finds what the shell finds (never its aliases, functions or unexported variables).
   */
  constructor(private readonly shell: string = '/bin/sh', private readonly now: () => number = Date.now, private readonly env: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv) = process.env) {}

  /** Whether a sample of this watch is running now. */
  sampling(id: string): boolean { return this.children.has(id); }

  onChange(listener: (watch: WatchTask, transition?: 'pass' | 'fail') => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(watch: WatchTask, transition?: 'pass' | 'fail'): void { for (const listener of this.listeners) listener(watch, transition); }

  get(id: string): WatchTask | undefined { return this.watches.find(watch => watch.id === id); }
  active(): WatchTask[] { return this.watches.filter(watch => watch.status !== 'stopped'); }

  /** Start watching a command already judged allowed (or confirmed). The first run starts at once. */
  start(command: string, cwd: string, intervalMs: number | undefined, safety: Exclude<WatchSafety, {kind: 'refused'}>): WatchTask {
    if (this.active().length >= MAX_ACTIVE_WATCHES) throw new Error(`At most ${MAX_ACTIVE_WATCHES} active trackers can run.`);
    // Stopped rows do not appear in the manager; do not retain unlimited stale records.
    if (this.watches.length >= 128) {
      for (let index = 0; index < this.watches.length && this.watches.length > 64;) {
        if (this.watches[index]?.status === 'stopped') this.watches.splice(index, 1);
        else index += 1;
      }
    }
    if (intervalMs !== undefined && (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > MAX_INTERVAL_MS)) {
      throw new Error('Invalid tracking interval.');
    }
    counter += 1;
    const minimum = safety.remote ? MIN_REMOTE_MS : MIN_LOCAL_MS;
    const watch: WatchTask = {id: `watch-${counter}`, command, cwd, intervalMs: Math.max(minimum, intervalMs ?? DEFAULT_INTERVAL_MS), startedAt: this.now(), runs: 0,
      status: 'running', changes: [], network: safety.network};
    this.watches.push(watch);
    this.runNow(watch.id);
    return watch;
  }

  /** Run once now (skipped while a run is still in flight: runs never overlap). */
  runNow(id: string): boolean {
    const watch = this.get(id);
    if (!watch || watch.status === 'stopped' || this.children.has(id)) return false;
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    const started = this.now();
    let output = '';
    let receivedBytes = 0;
    let truncated = false;
    let timedOut = false;
    let spawnError: string | undefined;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let child: ChildProcess;
    try {
      const env = typeof this.env === 'function' ? this.env() : this.env;
      child = spawn(this.shell, ['-c', watch.command], {cwd: watch.cwd, env: {...env, NO_COLOR: '1', FORCE_COLOR: '0'}, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    } catch (error) {
      this.record(watch, {output: stripTerminalControls(String(error), MAX_OUTPUT), exitCode: -1, at: started, durationMs: 0, error: 'spawn failed'});
      return true;
    }
    this.children.set(id, child);
    const take = (decoder: StringDecoder, chunk: Buffer) => {
      const kept = Math.min(chunk.length, Math.max(0, MAX_OUTPUT - receivedBytes));
      if (kept) { receivedBytes += kept; output += decoder.write(chunk.subarray(0, kept)); }
      if (kept < chunk.length) truncated = true;
    };
    child.stdout?.on('data', (chunk: Buffer) => take(stdoutDecoder, chunk));
    child.stderr?.on('data', (chunk: Buffer) => take(stderrDecoder, chunk));
    // Timeout is not a successful completion, even when the shell exits on a signal.
    const limit = setTimeout(() => {
      timedOut = true;
      this.signalGroup(child, 'SIGKILL');
      // A detached descendant may retain pipe FDs after the tracked shell dies.
      // Stop consuming it; the sample must not wait on an unrelated pipe holder.
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, Math.min(60_000, watch.intervalMs * 3));
    limit.unref();
    child.on('error', error => { spawnError = String(error); });
    // Only 'close' guarantees the captured stdio has finished, unlike 'exit'.
    child.on('close', (code, signal) => {
      clearTimeout(limit);
      const killTimer = this.killTimers.get(id);
      if (killTimer) clearTimeout(killTimer);
      this.killTimers.delete(id);
      if (this.children.get(id) !== child) return;
      this.children.delete(id);
      output += stdoutDecoder.end() + stderrDecoder.end();
      const sanitized = output.split('\n').map(line => stripTerminalControls(line, MAX_OUTPUT)).join('\n');
      this.record(watch, {output: sanitized, exitCode: code ?? -1, at: started, durationMs: this.now() - started,
        ...(truncated ? {truncated} : {}), ...(timedOut ? {timedOut} : {}),
        ...(spawnError ? {error: stripTerminalControls(spawnError, 300)} : {}),
        ...(signal ? {signal} : {})});
    });
    return true;
  }

  private signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch { try { child.kill(signal); } catch { /* already exited */ } }
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

  /** Stop scheduling, signal the owned process group, and bound graceful termination. */
  stop(id: string): boolean {
    const watch = this.get(id);
    if (!watch || watch.status === 'stopped') return false;
    watch.status = 'stopped';
    this.schedule(watch);
    const child = this.children.get(id);
    if (child) {
      this.signalGroup(child, 'SIGTERM');
      const pending = this.killTimers.get(id);
      if (pending) clearTimeout(pending);
      const killTimer = setTimeout(() => {
        this.killTimers.delete(id);
        if (this.children.get(id) === child) {
          this.signalGroup(child, 'SIGKILL');
          child.stdout?.destroy();
          child.stderr?.destroy();
        }
      }, STOP_GRACE_MS);
      killTimer.unref();
      this.killTimers.set(id, killTimer);
    }
    this.emit(watch);
    return true;
  }

  get scheduled(): number { return this.timers.size + this.children.size; }

  dispose(): void {
    for (const watch of this.active()) this.stop(watch.id);
    this.listeners.clear();
  }
}
