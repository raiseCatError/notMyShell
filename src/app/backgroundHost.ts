import {renderTaskBar, TaskBarController} from '../backgroundTasks/bar.js';
import {classifyCommand, isClassified} from '../backgroundTasks/detector.js';
import {BackgroundManager} from '../backgroundTasks/manager.js';
import {TaskOutput} from '../backgroundTasks/output.js';
import {decide, loadPreferences, savePreferences, type BackgroundPreferences, type Decision} from '../backgroundTasks/preferences.js';
import {nextLevel, type TaskUpdate} from '../backgroundTasks/protocol.js';
import {renderSuggestion, type Suggestion} from '../backgroundTasks/suggestion.js';
import type {StopLevel, TaskRecord} from '../backgroundTasks/supervisor.js';
import {taskLabel, stateWords} from '../backgroundTasks/bar.js';
import {TaskOutputView} from '../backgroundTasks/view.js';

/**
 * The frontend's view of this session's background tasks (#382): the list
 * the task owner reported, a mirror of each task's output, the task bar,
 * the /background manager and output view, and a pending suggestion. It
 * performs no I/O beyond the preferences file and never runs anything: task
 * requests go through the session boundary, and every foreground path stays
 * as it was.
 */

const LIVE = new Set(['running', 'stopping']);

export type BackgroundPanel = {kind: 'manager'; manager: BackgroundManager} | {kind: 'view'; taskId: string; view: TaskOutputView};

export class BackgroundHost {
  preferences: BackgroundPreferences;
  records: TaskRecord[] = [];
  private readonly outputs = new Map<string, TaskOutput>();
  readonly bar: TaskBarController;
  panel?: BackgroundPanel;
  /** A recognized command the person submitted, waiting for b / Enter / a / n / Esc. */
  suggestion?: Suggestion;
  /** A one-line note on the bar (a refusal, why x did nothing). */
  message?: string;
  private states = new Map<string, string>();

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.preferences = loadPreferences(env);
    this.bar = new TaskBarController(this.preferences.bar === 'expanded');
  }

  /** The owner's list. Returns the tasks that finished since the last list (for the end notice). */
  onTasks(records: readonly TaskRecord[]): TaskRecord[] {
    const ended: TaskRecord[] = [];
    for (const record of records) {
      const before = this.states.get(record.id);
      if (before && LIVE.has(before) && !LIVE.has(record.state)) ended.push(record);
      this.states.set(record.id, record.state);
    }
    const ids = new Set(records.map(record => record.id));
    for (const id of [...this.outputs.keys()]) if (!ids.has(id)) { this.outputs.delete(id); this.states.delete(id); }
    this.records = [...records];
    this.bar.sync(this.records);
    if (this.panel?.kind === 'view' && !ids.has(this.panel.taskId)) this.panel = undefined;
    return ended;
  }

  onOutput(id: string, update: TaskUpdate): void { this.output(id).receive(update); }

  output(id: string): TaskOutput {
    let output = this.outputs.get(id);
    if (!output) {
      output = new TaskOutput({lines: this.preferences.retention.lines, bytes: this.preferences.retention.bytes});
      this.outputs.set(id, output);
    }
    return output;
  }

  record(id: string): TaskRecord | undefined { return this.records.find(record => record.id === id); }
  readonly next = (id: string): StopLevel | undefined => nextLevel(this.record(id));

  /** What submitting this command does: foreground (unchanged), a suggestion, or the background for an Always family. */
  decide(command: string): Decision {
    const result = classifyCommand(command);
    return decide(isClassified(result) ? result : undefined, this.preferences);
  }

  setPreferences(preferences: BackgroundPreferences, env: NodeJS.ProcessEnv = process.env): void {
    this.preferences = preferences;
    this.bar.expanded = preferences.bar === 'expanded';
    savePreferences(preferences, env);
  }

  /** Rows above the composer: the suggestion (while one waits), then the task bar. Empty with no tasks and no suggestion. */
  rows(width: number, style: {now: number; color: boolean; safe: boolean}): string[] {
    const rows: string[] = [];
    if (this.suggestion) rows.push(...renderSuggestion(this.suggestion, {width, color: style.color, safe: style.safe}));
    if (this.records.length) rows.push(...renderTaskBar(this.bar, this.records, {width, ...style, next: this.next, upArrow: this.preferences.upArrow}));
    if (this.message && this.records.length) rows.push(this.message.slice(0, Math.max(1, width)));
    return rows;
  }

  /** The manager or a task's output, as panel rows. */
  panelRows(width: number, rows: number, style: {now: number; color: boolean; safe: boolean}): string[] {
    const panel = this.panel;
    if (!panel) return [];
    if (panel.kind === 'manager') return panel.manager.render(this.records, id => this.outputs.get(id), this.preferences, {width, rows, ...style});
    const task = this.record(panel.taskId);
    return task ? panel.view.render(task, this.output(task.id), {width, height: rows, ...style}) : [];
  }

  /** One line for the transcript when a task starts or ends: NMSh's words, never the task's output. */
  static startLine(task: TaskRecord): string { return `Background ${task.id} started: ${taskLabel(task)} · /background ${task.id} shows its output`; }
  static endLine(task: TaskRecord): string { return `Background ${task.id} · ${taskLabel(task)} · ${stateWords(task)}`; }
}
