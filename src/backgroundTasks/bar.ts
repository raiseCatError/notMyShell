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
 * - In the bar: ↑↓ select, Enter view output, `x` stop (again, after a
 *   moment: the next escalation, named on screen; on a finished task whose
 *   processes still run: kill them), Delete remove a finished task, Space
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

/**
 * How long a stronger signal waits after the previous stop request. Without it a double press, or a held key's
 * repeat, went from SIGINT to SIGKILL in a fraction of a second, before the program could clean up.
 */
export const ESCALATION_PAUSE_MS = 1500;

/** What `x` does for a task now: a stop level to request, or why nothing is sent. The bar and the manager share it. */
export function stopChoice(task: TaskRecord, next: (taskId: string) => StopLevel | undefined, now: number): {level: StopLevel} | {message: string} {
  if (!LIVE.has(task.state)) {
    // A finished task whose group still runs: the only stop left is the explicit kill of what remains.
    if (task.leftovers) return task.stopRequested === 'kill' ? {message: 'already killed; waiting for its processes to exit'} : {level: 'kill'};
    return {message: 'this task has already ended; Delete removes it from the list'};
  }
  const level = next(task.id);
  if (!level) return {message: 'already killed; waiting for the process to exit'};
  if (level !== 'interrupt' && task.stopRequestedAt !== undefined && now - task.stopRequestedAt < ESCALATION_PAUSE_MS) {
    return {message: `stop requested; give it a moment, then x sends ${LEVEL_WORDS[level]}`};
  }
  return {level};
}

/** Why a task cannot be removed now, or undefined when it can. */
export function removalBlocked(task: TaskRecord): string | undefined {
  if (LIVE.has(task.state)) return 'stop it first (x); a running task is never removed';
  if (task.leftovers) return 'its processes still run; x kills them, then Delete removes it';
  return undefined;
}

/** The key hint `x` has for a task now, or '' when it does nothing. */
function stopHint(task: TaskRecord, next: ((taskId: string) => StopLevel | undefined) | undefined, now: number): string {
  if (!next) return LIVE.has(task.state) ? 'x stop' : '';
  const choice = stopChoice(task, next, now);
  if (!('level' in choice)) return '';
  if (!LIVE.has(task.state)) return 'x kill what is left';
  return choice.level === 'interrupt' ? 'x stop' : `x ${LEVEL_WORDS[choice.level]}`;
}

/**
 * Key hints joined with ` · `, fitted to a width by dropping hints before the last one (the way back), so a narrow
 * terminal keeps the first actions and Esc rather than cutting through the middle of a word.
 */
export function fitHints(hints: readonly string[], width: number): string {
  const kept = hints.filter(Boolean);
  while (kept.length > 1 && displayWidth(kept.join(' · ')) > width) kept.splice(kept.length - 2, 1);
  return truncateText(kept.join(' · '), Math.max(1, width));
}

export class TaskBarController {
  selectedId?: string;
  focused = false;
  expanded: boolean;
  /** Where the selection was, so removing a task selects its neighbour rather than jumping to the first. */
  private index = 0;

  constructor(expanded = false) { this.expanded = expanded; }

  /** Keep the selection on an existing task (by id); when it is gone, on the task now in its place. */
  sync(tasks: readonly TaskRecord[]): void {
    let index = tasks.findIndex(task => task.id === this.selectedId);
    if (index === -1) { index = Math.min(this.index, tasks.length - 1); this.selectedId = tasks[index]?.id; }
    this.index = Math.max(0, index);
    if (!tasks.length) this.focused = false;
  }

  /** A key while the bar has focus. `next` is the escalation the supervisor would apply for the selected task. */
  handleKey(key: Key, tasks: readonly TaskRecord[], next: (taskId: string) => StopLevel | undefined, now = Date.now()): BarAction {
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
      case 'delete': case 'backspace': {
        if (!selected) return {kind: 'none'};
        const blocked = removalBlocked(selected);
        return blocked ? {kind: 'none', message: blocked} : {kind: 'remove', taskId: selected.id};
      }
      case 'text': {
        if (key.value === 'x' && selected) {
          const choice = stopChoice(selected, next, now);
          return 'level' in choice ? {kind: 'stop', taskId: selected.id, level: choice.level} : {kind: 'none', message: choice.message};
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

/** The state in one word or two, for rows too narrow for `stateWords` (the mark still tells the states apart). */
function shortState(task: TaskRecord): string {
  if (task.state === 'stopping' || task.state === 'failed') return task.state;
  return task.leftovers ? `${task.state}, left` : task.state;
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
  /** The Up preference, so the hint names the key that actually enters the bar. */
  upArrow?: 'idle' | 'off';
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
  const keysFor = (task: TaskRecord) => [
    'Enter view', stopHint(task, options.next, options.now), removalBlocked(task) ? '' : 'Del remove', 'Esc back',
  ].filter(Boolean);
  const rowText = (task: TaskRecord, focused: boolean, suffix = '') => {
    const lead = `${focused ? (options.safe ? '>' : '›') : ' '}${m[task.state]} `;
    const time = elapsed((task.endedAt ?? options.now) - task.startedAt);
    const label = taskLabel(task);
    // Which task this is matters more than its timer: narrow rows drop the time, then the long state words, before
    // the label goes below a dozen cells.
    const keep = Math.min(displayWidth(label), 12);
    const tails = [`  ${time}  ${stateWords(task)}${suffix}`, `  ${stateWords(task)}${suffix}`, `  ${shortState(task)}${suffix}`, `  ${shortState(task)}`];
    const tail = tails.find(candidate => width - displayWidth(lead) - displayWidth(candidate) >= keep) ?? tails.at(-1)!;
    const room = Math.max(1, width - displayWidth(lead) - displayWidth(tail));
    return truncateText(`${lead}${truncateText(label, Math.max(1, Math.min(room, 32)))}${tail}`, width);
  };
  const row = (task: TaskRecord, focused: boolean) => paint(rowText(task, focused), tone(task.state), focused);
  if (!controller.expanded) {
    if (controller.focused) {
      const position = tasks.length > 1 ? `  ${tasks.indexOf(selected) + 1}/${tasks.length}` : '';
      const base = rowText(selected, true, position);
      const room = width - displayWidth(base) - 2;
      // Keys only when at least the way back fits beside the task; otherwise the task row alone.
      const keys = room >= displayWidth('Esc back') ? `  ${fitHints(keysFor(selected), room)}` : '';
      return [paint(`${base}${keys}`, tone(selected.state), true)];
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
  const up = options.safe ? '^' : '↑';
  const enter = options.upArrow === 'off' ? `Shift+${up}` : up;
  const title = 'Background tasks  ';
  const header = !controller.focused ? `${title}${enter} or /background`
    : width - displayWidth(title) >= displayWidth('Esc back') ? `${title}${fitHints(keysFor(selected), width - displayWidth(title))}` : title.trim();
  const lines = [paint(truncateText(header, width), UI_COLORS.subtle)];
  for (const task of tasks.slice(start, start + visible)) lines.push(row(task, controller.focused && task.id === selected.id));
  if (tasks.length > visible) lines.push(paint(truncateText(`  +${tasks.length - visible} more · /background lists all`, width), UI_COLORS.subtle));
  return lines;
}
