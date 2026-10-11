import type {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateText} from '../util/text.js';
import {commandLine, elapsed, fitHints, removalBlocked, stateWords, stopChoice, taskLabel, taskText} from './bar.js';
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
  /** The selected row of the Preferences tab. */
  selected = 0;
  /**
   * The selected task, by id: the order changes while the manager is open (a task finishes and moves down, a new one
   * starts at the top), and a row index would then make `x` or Delete act on a task the person never chose.
   */
  selectedTaskId?: string;
  private taskIndex = 0;
  /** First task row shown when the list is taller than the room it has. */
  private listTop = 0;

  /** Running tasks first, then finished ones, newest first. */
  static order(tasks: readonly TaskRecord[]): TaskRecord[] {
    return [...tasks].sort((a, b) => Number(live(b)) - Number(live(a)) || (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  }

  /** The selected task's position in `ordered`: the same task while it exists, else the one now in its place. */
  private resolve(ordered: readonly TaskRecord[]): number {
    let index = ordered.findIndex(task => task.id === this.selectedTaskId);
    if (index === -1) index = Math.max(0, Math.min(this.taskIndex, ordered.length - 1));
    this.selectedTaskId = ordered[index]?.id;
    this.taskIndex = index;
    return index;
  }

  handleKey(key: Key, tasks: readonly TaskRecord[], preferences: BackgroundPreferences, next: (taskId: string) => StopLevel | undefined, now = Date.now()): ManagerOutcome {
    if (key.kind === 'escape') return {kind: 'close'};
    if (key.kind === 'complete' || key.kind === 'focusPrevious') { this.tab = this.tab === 'tasks' ? 'preferences' : 'tasks'; this.selected = 0; return {kind: 'none'}; }
    if (this.tab === 'tasks') {
      const ordered = BackgroundManager.order(tasks);
      const index = this.resolve(ordered);
      const task = ordered[index];
      if (key.kind === 'up' || key.kind === 'down') {
        const target = ordered[Math.max(0, Math.min(ordered.length - 1, index + (key.kind === 'up' ? -1 : 1)))];
        if (target) { this.selectedTaskId = target.id; this.taskIndex = ordered.indexOf(target); }
        return {kind: 'none'};
      }
      if (key.kind === 'enter') return task ? {kind: 'view', taskId: task.id} : {kind: 'none'};
      if (key.kind === 'delete' || key.kind === 'backspace') {
        if (!task) return {kind: 'none'};
        const blocked = removalBlocked(task);
        return blocked ? {kind: 'none', message: blocked} : {kind: 'remove', taskId: task.id};
      }
      if (key.kind === 'text' && key.value === 'x' && task) {
        const choice = stopChoice(task, next, now);
        return 'level' in choice ? {kind: 'stop', taskId: task.id, level: choice.level} : {kind: 'none', message: choice.message};
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
    const footer = this.tab === 'tasks' ? ['↑↓ select', 'Enter output', 'x stop', 'Del remove', 'c clear finished', 'Tab preferences', 'Esc close']
      : ['↑↓ select', '←→ change', 'Del forget a command', 'Tab tasks', 'Esc close'];
    if (this.tab === 'tasks') {
      const ordered = BackgroundManager.order(tasks);
      if (!ordered.length) lines.push(paint(fit('  No background tasks. Run one with /background run <command>, or choose b when NMSh suggests it.'), UI_COLORS.subtle));
      const selectedIndex = this.resolve(ordered);
      const task = ordered[selectedIndex];
      const details: string[] = [];
      if (task) {
        const output = outputs(task.id);
        const command = commandLine(task);
        details.push('', paint('Details', UI_COLORS.primary, true));
        details.push(fit(`  Command  ${command.text}${command.more ? ` (+${command.more} more line${command.more === 1 ? '' : 's'})` : ''}`));
        details.push(fit(`  In       ${taskText(task.cwd)}`), fit(`  Started  ${new Date(task.startedAt).toLocaleTimeString('en-GB')}`));
        if (task.endedAt !== undefined) details.push(fit(`  Ended    ${new Date(task.endedAt).toLocaleTimeString('en-GB')} · ${task.signal ? `signal ${task.signal}` : `exit ${task.exitCode}`}`));
        if (task.leftovers) details.push(paint(fit('  Left     processes of this task still run; x kills them'), UI_COLORS.failure));
        if (output) details.push(fit(`  Output   ${output.lines().length} lines kept${output.dropped ? `, ${output.dropped} dropped by the retention limit` : ''}`));
        details.push(paint(fit("  Runs in its own terminal, without this shell's aliases, functions or unexported variables."), UI_COLORS.subtle));
      }
      // The list keeps at least three rows (or all tasks, when fewer) and gives the rest to the details; a longer
      // list scrolls with the selection and says how many rows it does not show.
      const room = Math.max(1, options.rows - 2);
      const listRows = Math.max(Math.min(ordered.length, 3), room - details.length);
      const windowed = ordered.length > listRows;
      const visible = windowed ? Math.max(1, listRows - 1) : ordered.length;
      if (selectedIndex < this.listTop) this.listTop = selectedIndex;
      if (selectedIndex >= this.listTop + visible) this.listTop = selectedIndex - visible + 1;
      this.listTop = Math.max(0, Math.min(this.listTop, ordered.length - visible));
      ordered.slice(this.listTop, this.listTop + visible).forEach(item => {
        const chosen = item.id === task?.id;
        const text = `${chosen ? pointer : ' '} ${item.id.padEnd(4)} ${taskLabel(item)}  ${elapsed((item.endedAt ?? options.now) - item.startedAt)}  ${stateWords(item)}`;
        lines.push(paint(fit(text), item.state === 'failed' ? UI_COLORS.failure : chosen ? UI_COLORS.accent : UI_COLORS.secondary, chosen));
      });
      if (windowed) {
        const above = this.listTop, below = ordered.length - this.listTop - visible;
        lines.push(paint(fit(`  ${[above ? `${above} above` : '', below ? `${below} below` : ''].filter(Boolean).join(' · ')}`), UI_COLORS.subtle));
      }
      lines.push(...details);
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
    if (options.rows >= 1) body.push(paint(fitHints(footer, width), UI_COLORS.subtle));
    return body.slice(0, Math.max(0, options.rows));
  }
}
