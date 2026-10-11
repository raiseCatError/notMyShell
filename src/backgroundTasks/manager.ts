import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateText} from '../util/text.js';
import {commandLine, elapsed, stateWords, taskLabel, taskText} from './bar.js';
import type {TaskOutput} from './output.js';
import {rememberFamily, type BackgroundPreferences} from './preferences.js';
import type {StopLevel, TaskRecord} from './supervisor.js';

/**
 * `/background` (`/bg`, #382): the full manager. Tasks tab: every task of the
 * session, running first, with details on the selected one; Enter opens its
 * live output, `x` stops (again: the next escalation), Delete removes a
 * finished task, `c` clears all finished ones. Preferences tab: suggestions,
 * task bar, Up arrow, notifications, retention and the per-family decisions.
 * Changes are returned as new preferences for the caller to save; the
 * manager performs no I/O.
 */

export type ManagerOutcome =
  | {kind: 'none'; message?: string}
  | {kind: 'close'}
  | {kind: 'view'; taskId: string}
  | {kind: 'stop'; taskId: string; level: StopLevel}
  | {kind: 'remove'; taskId: string}
  | {kind: 'clear'}
  | {kind: 'preferences'; value: BackgroundPreferences};

interface Setting {
  label: string;
  value: (p: BackgroundPreferences) => string;
  change: (p: BackgroundPreferences, direction: number) => BackgroundPreferences;
}

const cycle = <T>(values: readonly T[], current: T, direction: number): T => {
  const index = values.indexOf(current);
  return values[((index === -1 ? 0 : index) + direction + values.length) % values.length]!;
};

const SETTINGS: readonly Setting[] = [
  {label: 'Suggestions', value: p => (p.suggestions === 'ask' ? 'ask for recognized commands' : 'off'), change: (p, d) => ({...p, suggestions: cycle(['ask', 'off'] as const, p.suggestions, d)})},
  {label: 'Task bar', value: p => p.bar, change: (p, d) => ({...p, bar: cycle(['collapsed', 'expanded'] as const, p.bar, d)})},
  {label: 'Up enters the bar', value: p => (p.upArrow === 'idle' ? 'from an idle composer' : 'off (Shift+Up still does)'), change: (p, d) => ({...p, upArrow: cycle(['idle', 'off'] as const, p.upArrow, d)})},
  {label: 'Notify when a task ends', value: p => ({never: 'never', failure: 'when it fails', always: 'always'})[p.notify], change: (p, d) => ({...p, notify: cycle(['never', 'failure', 'always'] as const, p.notify, d)})},
  {label: 'Output kept per task', value: p => `${p.retention.lines.toLocaleString('en-US')} lines`, change: (p, d) => ({...p, retention: {...p.retention, lines: cycle([1000, 5000, 20_000, 100_000], p.retention.lines, d)}})},
  {label: 'Finished tasks kept', value: p => String(p.retention.finishedKept), change: (p, d) => ({...p, retention: {...p.retention, finishedKept: cycle([5, 20, 50], p.retention.finishedKept, d)}})},
];

const live = (task: TaskRecord) => task.state === 'running' || task.state === 'stopping';

export class BackgroundManager {
  tab: 'tasks' | 'preferences' = 'tasks';
  selected = 0;

  /** Running tasks first, then finished ones, newest first. */
  static order(tasks: readonly TaskRecord[]): TaskRecord[] {
    return [...tasks].sort((a, b) => Number(live(b)) - Number(live(a)) || (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  }

  handleKey(key: Key, tasks: readonly TaskRecord[], preferences: BackgroundPreferences, next: (taskId: string) => StopLevel | undefined): ManagerOutcome {
    if (key.kind === 'escape') return {kind: 'close'};
    if (key.kind === 'complete' || key.kind === 'focusPrevious') { this.tab = this.tab === 'tasks' ? 'preferences' : 'tasks'; this.selected = 0; return {kind: 'none'}; }
    if (this.tab === 'tasks') {
      const ordered = BackgroundManager.order(tasks);
      this.selected = Math.max(0, Math.min(this.selected, ordered.length - 1));
      const task = ordered[this.selected];
      if (key.kind === 'up' || key.kind === 'down') { this.selected = Math.max(0, Math.min(ordered.length - 1, this.selected + (key.kind === 'up' ? -1 : 1))); return {kind: 'none'}; }
      if (key.kind === 'enter') return task ? {kind: 'view', taskId: task.id} : {kind: 'none'};
      if (key.kind === 'delete' || key.kind === 'backspace') {
        if (!task) return {kind: 'none'};
        return live(task) ? {kind: 'none', message: 'stop it first; a running task is never removed'} : {kind: 'remove', taskId: task.id};
      }
      if (key.kind === 'text' && key.value === 'x' && task) {
        if (!live(task)) return {kind: 'none', message: 'this task has already ended'};
        const level = next(task.id);
        return level ? {kind: 'stop', taskId: task.id, level} : {kind: 'none', message: 'already killed; waiting for the process to exit'};
      }
      if (key.kind === 'text' && key.value === 'c') return ordered.some(item => !live(item)) ? {kind: 'clear'} : {kind: 'none', message: 'no finished tasks'};
      return {kind: 'none'};
    }
    const families = Object.keys(preferences.families).sort();
    const count = SETTINGS.length + families.length;
    if (key.kind === 'up' || key.kind === 'down') { this.selected = Math.max(0, Math.min(count - 1, this.selected + (key.kind === 'up' ? -1 : 1))); return {kind: 'none'}; }
    if (key.kind === 'left' || key.kind === 'right' || key.kind === 'enter') {
      const setting = SETTINGS[this.selected];
      if (setting) return {kind: 'preferences', value: setting.change(preferences, key.kind === 'left' ? -1 : 1)};
      const family = families[this.selected - SETTINGS.length];
      if (!family) return {kind: 'none'};
      return {kind: 'preferences', value: rememberFamily(preferences, family, preferences.families[family] === 'always' ? 'never' : 'always')};
    }
    if (key.kind === 'delete' || key.kind === 'backspace') {
      const family = families[this.selected - SETTINGS.length];
      if (!family) return {kind: 'none'};
      this.selected = Math.max(0, this.selected - 1);
      return {kind: 'preferences', value: rememberFamily(preferences, family, undefined)};
    }
    return {kind: 'none'};
  }

  /** Exactly `rows` lines of at most `width` cells; the last row lists the keys that work in this tab. */
  render(tasks: readonly TaskRecord[], outputs: (id: string) => TaskOutput | undefined, preferences: BackgroundPreferences,
    options: {width: number; rows: number; now: number; color: boolean; safe: boolean}): string[] {
    const width = Math.max(1, options.width);
    const reset = options.color ? '\u001b[0m' : '';
    const paint = (text: string, color: {red: number; green: number; blue: number}, bold = false) => options.color ? `${bold ? '\u001b[1m' : ''}${foreground(color)}${text}${reset}` : text;
    const fit = (text: string) => truncateText(text, width);
    const pointer = options.safe ? '>' : '›';
    const tabs = `${this.tab === 'tasks' ? '[Tasks]' : ' Tasks '}  ${this.tab === 'preferences' ? '[Preferences]' : ' Preferences '}`;
    const lines = [paint(fit(`Background tasks  ${tabs}`), UI_COLORS.primary, true)];
    const footer = this.tab === 'tasks' ? '↑↓ select · Enter output · x stop · Del remove · c clear finished · Tab preferences · Esc close'
      : '↑↓ select · ←→ change · Del forget a command · Tab tasks · Esc close';
    if (this.tab === 'tasks') {
      const ordered = BackgroundManager.order(tasks);
      if (!ordered.length) lines.push(paint(fit('  No background tasks. Run one with /background run <command>, or choose b when NMSh suggests it.'), UI_COLORS.subtle));
      ordered.forEach((task, index) => {
        const chosen = index === this.selected;
        const text = `${chosen ? pointer : ' '} ${task.id.padEnd(4)} ${taskLabel(task)}  ${elapsed((task.endedAt ?? options.now) - task.startedAt)}  ${stateWords(task)}`;
        lines.push(paint(fit(text), task.state === 'failed' ? UI_COLORS.failure : chosen ? UI_COLORS.accent : UI_COLORS.secondary, chosen));
      });
      const task = ordered[Math.min(this.selected, ordered.length - 1)];
      if (task) {
        const output = outputs(task.id);
        const command = commandLine(task);
        lines.push('', paint('Details', UI_COLORS.primary, true));
        lines.push(fit(`  Command  ${command.text}${command.more ? ` (+${command.more} more line${command.more === 1 ? '' : 's'})` : ''}`));
        lines.push(fit(`  In       ${taskText(task.cwd)}`), fit(`  Started  ${new Date(task.startedAt).toLocaleTimeString('en-GB')}`));
        if (task.endedAt !== undefined) lines.push(fit(`  Ended    ${new Date(task.endedAt).toLocaleTimeString('en-GB')} · ${task.signal ? `signal ${task.signal}` : `exit ${task.exitCode}`}`));
        if (output) lines.push(fit(`  Output   ${output.lines().length} lines kept${output.dropped ? `, ${output.dropped} dropped by the retention limit` : ''}`));
        lines.push(paint(fit("  Runs in its own terminal, without this shell's aliases, functions or unexported variables."), UI_COLORS.subtle));
      }
    } else {
      SETTINGS.forEach((setting, index) => {
        const chosen = index === this.selected;
        lines.push(paint(fit(`${chosen ? pointer : ' '} ${setting.label.padEnd(26)} ${setting.value(preferences)}`), chosen ? UI_COLORS.accent : UI_COLORS.secondary, chosen));
      });
      lines.push('', paint('Remembered commands', UI_COLORS.primary, true));
      const families = Object.keys(preferences.families).sort();
      if (!families.length) lines.push(paint(fit('  None yet: choose a or n when NMSh suggests a command.'), UI_COLORS.subtle));
      families.forEach((family, index) => {
        const chosen = SETTINGS.length + index === this.selected;
        const word = preferences.families[family] === 'always' ? 'always in the background' : 'never ask';
        lines.push(paint(fit(`${chosen ? pointer : ' '} ${taskText(family, 64).padEnd(26)} ${word}`), chosen ? UI_COLORS.accent : UI_COLORS.secondary, chosen));
      });
    }
    const body = lines.slice(0, Math.max(0, options.rows - 1));
    while (body.length < options.rows - 1) body.push('');
    if (options.rows >= 1) body.push(paint(fit(footer), UI_COLORS.subtle));
    return body.slice(0, Math.max(0, options.rows));
  }
}
