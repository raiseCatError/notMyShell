import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, truncateText} from '../util/text.js';
import {stripTerminalControls} from '../util/terminalControls.js';
import type {StopLevel, TaskRecord, TaskState} from './supervisor.js';

/**
 * The background task bar (#382): frontend chrome directly above the
 * composer. Empty, it takes no rows. Collapsed (the default), it is one
 * summary row; expanded, one row per task up to a bound, with an overflow
 * row. It never covers the composer or the transcript: the frontend gives it
 * rows the way it gives notices rows (ScreenPlan `withNoticeRows`).
 *
 * Keyboard (decided against the existing composer behavior):
 * - Up from an idle composer (empty draft, not browsing history, no
 *   foreground command running or waiting for input) enters the bar, the
 *   same spatial rule the agent shelf uses. Otherwise Up keeps its editor and
 *   history meaning. A preference turns this off.
 * - Shift+Up from an empty composer always enters it (with an empty draft
 *   it has nothing to select), and `/background` works when keys are taken
 *   by the terminal.
 * - In the bar: ↑↓ select, Enter view output, `x` stop (again: the next
 *   escalation, named on screen), Delete remove a finished task, Space
 *   expand/collapse, Esc back. Any other typing returns to the composer and
 *   is not lost.
 */

export type BarAction =
  | {kind: 'enter'}
  | {kind: 'leave'; forward?: Key}
  | {kind: 'select'; delta: number}
  | {kind: 'view'; taskId: string}
  | {kind: 'stop'; taskId: string; level: StopLevel}
  | {kind: 'remove'; taskId: string}
  | {kind: 'toggle'}
  | {kind: 'none'; message?: string};

export interface ComposerState {
  /** No draft text and no selection. */
  empty: boolean;
  /** Up/Down are moving through shell history right now. */
  browsingHistory: boolean;
  /** A foreground command runs (it may be waiting for input): it owns the keys. */
  foregroundBusy: boolean;
  /** Another owner (passthrough, approval, search, a panel, the agent message box) has the keyboard. */
  otherOwner: boolean;
}

/** Whether a key in the composer enters the bar. Never while anything else owns input; never with a draft. */
export function entersBar(key: Key, composer: ComposerState, tasks: number, upArrow: 'idle' | 'off'): boolean {
  if (!tasks || composer.foregroundBusy || composer.otherOwner || !composer.empty) return false;
  if (key.kind === 'selectUp') return true;
  return key.kind === 'up' && upArrow === 'idle' && !composer.browsingHistory;
}

const LIVE: ReadonlySet<TaskState> = new Set(['running', 'stopping']);
const LEVEL_WORDS: Record<StopLevel, string> = {interrupt: 'interrupt', terminate: 'terminate (SIGTERM)', kill: 'kill (SIGKILL)'};

export class TaskBarController {
  selectedId?: string;
  focused = false;
  expanded: boolean;

  constructor(expanded = false) { this.expanded = expanded; }

  /** Keep the selection on an existing task (by id), else the first. */
  sync(tasks: readonly TaskRecord[]): void {
    if (!tasks.some(task => task.id === this.selectedId)) this.selectedId = tasks[0]?.id;
    if (!tasks.length) this.focused = false;
  }

  /** A key while the bar has focus. `next` is the escalation the supervisor would apply for the selected task. */
  handleKey(key: Key, tasks: readonly TaskRecord[], next: (taskId: string) => StopLevel | undefined): BarAction {
    this.sync(tasks);
    const index = tasks.findIndex(task => task.id === this.selectedId);
    const selected = tasks[index];
    switch (key.kind) {
      case 'escape': this.focused = false; return {kind: 'leave'};
      case 'up': case 'down': {
        const target = Math.max(0, Math.min(tasks.length - 1, index + (key.kind === 'up' ? -1 : 1)));
        // Down past the last task goes back to the composer, which sits right below the bar.
        if (key.kind === 'down' && index === tasks.length - 1) { this.focused = false; return {kind: 'leave'}; }
        this.selectedId = tasks[target]?.id;
        return {kind: 'select', delta: key.kind === 'up' ? -1 : 1};
      }
      case 'enter': return selected ? {kind: 'view', taskId: selected.id} : {kind: 'none'};
      case 'delete': case 'backspace':
        if (!selected) return {kind: 'none'};
        return LIVE.has(selected.state) ? {kind: 'none', message: 'stop it first (x); a running task is never removed'} : {kind: 'remove', taskId: selected.id};
      case 'text': {
        if (key.value === 'x' && selected) {
          if (!LIVE.has(selected.state)) return {kind: 'none', message: 'this task has already ended; Delete removes it from the list'};
          const level = next(selected.id);
          return level ? {kind: 'stop', taskId: selected.id, level} : {kind: 'none', message: 'already killed; waiting for the process to exit'};
        }
        if (key.value === ' ') { this.expanded = !this.expanded; return {kind: 'toggle'}; }
        this.focused = false;
        return {kind: 'leave', forward: key};
      }
      case 'paste': this.focused = false; return {kind: 'leave', forward: key};
      default: return {kind: 'none'};
    }
  }

  /** The rows this bar needs now; the frontend reserves exactly these. */
  rows(tasks: readonly TaskRecord[], maxRows = 4): number {
    if (!tasks.length) return 0;
    if (!this.expanded) return 1;
    const layout = expandedLayout(tasks.length, maxRows);
    return 1 + layout.visible + Number(layout.overflow);
  }
}

/** Expanded: a header, as many task rows as fit, and an overflow row when some do not; never more than `maxRows`. */
function expandedLayout(count: number, maxRows: number): {visible: number; overflow: boolean} {
  const budget = Math.max(2, maxRows) - 1;
  return count <= budget ? {visible: count, overflow: false} : {visible: Math.max(1, budget - 1), overflow: true};
}

export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** The words a person reads for a task state, from evidence only. */
export function stateWords(task: TaskRecord): string {
  switch (task.state) {
    case 'running': return 'running';
    case 'stopping': return task.stopRequested === 'interrupt' ? 'stopping' : task.stopRequested === 'terminate' ? 'stopping (SIGTERM sent)' : 'stopping (SIGKILL sent)';
    case 'stopped': return task.leftovers ? 'stopped, processes left' : 'stopped';
    case 'exited': return task.leftovers ? 'exited, processes left' : 'exited';
    case 'failed': return task.signal ? `failed (signal ${task.signal})` : `failed (exit ${task.exitCode ?? '?'})`;
  }
}

const marks = (safe: boolean): Record<TaskState, string> => safe
  ? {running: '*', stopping: '~', exited: '+', failed: 'x', stopped: '-'}
  : {running: '●', stopping: '◐', exited: '✓', failed: '✗', stopped: '■'};

/**
 * Task text as NMSh may draw it. Commands, families and directory names are not NMSh's words: a pasted command or a
 * directory name can carry escape sequences, so whole sequences, controls and bidi overrides are removed before any
 * of it reaches the screen or a copy.
 */
export function taskText(value: string, maxLength = 512): string {
  return stripTerminalControls(value.replace(/\t/gu, ' '), maxLength).trim();
}

/** The first line of a task's command, displayable, and how many lines follow it. */
export function commandLine(task: TaskRecord): {text: string; more: number} {
  const lines = task.command.split('\n');
  return {text: taskText(lines[0]!), more: lines.length - 1};
}

/** A short label: the family when known (`adb logcat`), else the command's first line. */
export function taskLabel(task: TaskRecord): string {
  return taskText(task.family ?? commandLine(task).text, 160) || task.id;
}

export interface BarRenderOptions {
  width: number;
  now: number;
  safe: boolean;
  color: boolean;
  /** The next escalation per task, so the focused row can name what `x` does. */
  next?: (taskId: string) => StopLevel | undefined;
  maxRows?: number;
}

/**
 * Exactly `controller.rows(tasks)` lines, each at most `width` cells. State has a mark and a word, never color alone;
 * the focused selection is marked with `›`/`>`, and the keys shown are the ones that work for it.
 */
export function renderTaskBar(controller: TaskBarController, tasks: readonly TaskRecord[], options: BarRenderOptions): string[] {
  controller.sync(tasks);
  if (!tasks.length) return [];
  const width = Math.max(1, options.width);
  const m = marks(options.safe);
  const reset = options.color ? '\u001b[0m' : '';
  const tone = (state: TaskState) => state === 'failed' ? UI_COLORS.failure : state === 'running' ? UI_COLORS.accent : state === 'stopping' ? UI_COLORS.secondary : UI_COLORS.subtle;
  const paint = (text: string, color: {red: number; green: number; blue: number}, bold = false) => options.color ? `${bold ? '\u001b[1m' : ''}${foreground(color)}${text}${reset}` : text;
  const selected = tasks.find(task => task.id === controller.selectedId) ?? tasks[0]!;
  const keysFor = (task: TaskRecord) => {
    const level = LIVE.has(task.state) ? options.next?.(task.id) : undefined;
    const stop = !LIVE.has(task.state) ? 'Del remove' : level === 'interrupt' ? 'x stop' : level ? `x ${LEVEL_WORDS[level]}` : '';
    return ['Enter view', stop, 'Esc back'].filter(Boolean).join(' · ');
  };
  const rowText = (task: TaskRecord, focused: boolean, suffix = '') => {
    const lead = `${focused ? (options.safe ? '>' : '›') : ' '}${m[task.state]} `;
    const time = elapsed((task.endedAt ?? options.now) - task.startedAt);
    const tail = `  ${time}  ${stateWords(task)}${suffix}`;
    const room = Math.max(1, width - displayWidth(lead) - displayWidth(tail));
    return truncateText(`${lead}${truncateText(taskLabel(task), Math.max(1, Math.min(room, 32)))}${tail}`, width);
  };
  const row = (task: TaskRecord, focused: boolean) => paint(rowText(task, focused), tone(task.state), focused);
  if (!controller.expanded) {
    if (controller.focused) {
      const position = tasks.length > 1 ? `  ${tasks.indexOf(selected) + 1}/${tasks.length}` : '';
      const base = rowText(selected, true, position);
      const keys = `  ${keysFor(selected)}`;
      return [paint(displayWidth(base) + displayWidth(keys) <= width ? `${base}${keys}` : base, tone(selected.state), true)];
    }
    const order: TaskState[] = ['running', 'stopping', 'failed', 'stopped', 'exited'];
    const counts = order.map(state => [state, tasks.filter(task => task.state === state).length] as const).filter(([, count]) => count);
    const running = tasks.filter(task => LIVE.has(task.state)).length;
    const summary = `${running ? m.running : m.exited} ${tasks.length} background task${tasks.length === 1 ? '' : 's'} · ${counts.map(([state, count]) => `${count} ${state}`).join(' · ')}`;
    return [paint(truncateText(summary, width), running ? UI_COLORS.secondary : UI_COLORS.subtle)];
  }
  const {visible} = expandedLayout(tasks.length, options.maxRows ?? 4);
  const index = Math.max(0, tasks.indexOf(selected));
  const start = Math.max(0, Math.min(index - visible + 1, tasks.length - visible));
  const lines = [paint(truncateText(controller.focused ? `Background tasks  ${keysFor(selected)}` : `Background tasks  ${options.safe ? '^' : '↑'} or /background`, width), UI_COLORS.subtle)];
  for (const task of tasks.slice(start, start + visible)) lines.push(row(task, controller.focused && task.id === selected.id));
  if (tasks.length > visible) lines.push(paint(truncateText(`  +${tasks.length - visible} more · /background lists all`, width), UI_COLORS.subtle));
  return lines;
}
