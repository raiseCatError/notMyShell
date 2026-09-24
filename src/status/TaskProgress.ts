import {spawn, type ChildProcessByStdio} from 'node:child_process';
import type {Readable} from 'node:stream';
import {formatDuration} from './commandTiming.js';
import {shimmerText} from './shimmer.js';
import {GLYPHS, getCurrentGlyphMode} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';

export type TaskStatus = 'running' | 'succeeded' | 'failed';
export interface TaskSnapshot {
  label: string;
  resultLabel?: string;
  status: TaskStatus;
  startedAt: number;
  endedAt?: number;
  completed?: number;
  total?: number;
  details: string;
  error?: string;
}

const MAX_DETAILS = 16 * 1024;
const RESET = '\u001B[0m';

/** A factual, bounded UI state and child-process runner for NMSh-owned tasks. */
export class TaskProgress {
  readonly state: TaskSnapshot;
  private timer?: NodeJS.Timeout;
  private timeout?: NodeJS.Timeout;
  private child?: ChildProcessByStdio<null, Readable, Readable>;
  private settled = false;

  constructor(label: string, private readonly onChange: () => void, now = Date.now(), resultLabel?: string) {
    this.state = {label, ...(resultLabel ? {resultLabel} : {}), status: 'running', startedAt: now, details: ''};
  }

  /** Call only with an actual measured total. Package-manager installs use indeterminate mode. */
  setProgress(completed: number, total: number): void {
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(completed)) return;
    this.state.total = total;
    this.state.completed = Math.max(0, Math.min(total, completed));
    this.onChange();
  }

  appendDetails(text: string): void {
    this.state.details = (this.state.details + text).slice(-MAX_DETAILS);
  }

  markFailure(error: string): void {
    this.state.status = 'failed';
    this.state.error = error;
    this.state.endedAt ??= Date.now();
    this.appendDetails(`\n${error}\n`);
    this.onChange();
  }

  async run(command: string, args: string[], timeoutMs = 10 * 60_000): Promise<TaskSnapshot> {
    if (this.child || this.settled) throw new Error('Task already started');
    return new Promise(resolve => {
      const finish = (error?: string) => {
        if (this.settled) return;
        this.settled = true;
        this.state.status = error ? 'failed' : 'succeeded';
        this.state.error = error;
        this.state.endedAt = Date.now();
        if (this.timer) clearInterval(this.timer);
        if (this.timeout) clearTimeout(this.timeout);
        this.timer = undefined;
        this.timeout = undefined;
        this.child?.stdout.removeAllListeners('data');
        this.child?.stderr.removeAllListeners('data');
        this.child = undefined;
        this.onChange();
        resolve(this.state);
      };
      try {
        const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe'], env: process.env});
        this.child = child;
        child.stdout.on('data', (chunk: Buffer) => this.appendDetails(chunk.toString('utf8')));
        child.stderr.on('data', (chunk: Buffer) => this.appendDetails(chunk.toString('utf8')));
        child.once('error', error => finish(error.message));
        child.once('exit', (code, signal) => finish(code === 0 ? undefined : `Exit ${code ?? signal ?? 'unknown'}`));
        this.timer = setInterval(this.onChange, 100);
        this.timeout = setTimeout(() => {
          this.appendDetails('\nTimed out.\n');
          child.kill('SIGTERM');
          finish('Timed out');
        }, timeoutMs);
        this.onChange();
      } catch (error) {
        finish(error instanceof Error ? error.message : String(error));
      }
    });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.timeout) clearTimeout(this.timeout);
    this.timer = undefined;
    this.timeout = undefined;
    this.child?.kill('SIGTERM');
  }
}

export function taskElapsed(state: TaskSnapshot, now = Date.now()): string {
  return formatDuration(Math.max(0, (state.endedAt ?? now) - state.startedAt));
}

export function taskProgressBar(state: TaskSnapshot, now = Date.now(), width = 24): string {
  const safe = getCurrentGlyphMode() === 'safe';
  const track = safe ? '-' : '─';
  const fill = safe ? '=' : '━';
  const head = safe ? '>' : '╺';
  if (state.total && state.completed !== undefined) {
    const count = Math.round(width * state.completed / state.total);
    return fill.repeat(count) + track.repeat(Math.max(0, width - count));
  }
  const position = Math.floor((now - state.startedAt) / 100) % width;
  return track.repeat(position) + head + track.repeat(width - position - 1);
}

export function renderTaskProgress(state: TaskSnapshot, now = Date.now()): string[] {
  const duration = taskElapsed(state, now);
  if (state.status === 'running') {
    return [`${shimmerText(`${getCurrentGlyphMode() === 'safe' ? '*' : '◈'} ${state.label}…`, now - state.startedAt, true)}${RESET}  ${duration}`,
      `${foreground(UI_COLORS.secondary)}  ${taskProgressBar(state, now)}${RESET}`];
  }
  const success = state.status === 'succeeded';
  const icon = success ? GLYPHS.success : GLYPHS.failure;
  const color = foreground(success ? UI_COLORS.success : UI_COLORS.failure);
  const finished = state.resultLabel
    ? `${state.resultLabel} ${success ? 'installed' : 'installation failed'}`
    : `${state.label} ${success ? 'completed' : 'failed'}`;
  return [`${color}${icon} ${finished} · ${duration}${RESET}`,
    ...(success ? [] : [`${foreground(UI_COLORS.secondary)}  Enter for details${RESET}`])];
}
