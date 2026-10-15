import type {OutputLine} from './output.js';
import type {StopLevel, TaskRecord, TaskState} from './supervisor.js';

/**
 * What crosses the session boundary for background tasks (#382): requests
 * from the frontend and task state and output from whatever owns the
 * session's tasks (the session service, or the in-process client). Every
 * value is validated on arrival; anything malformed is dropped, never
 * guessed at.
 */

export type TaskOp =
  /** `path` is the live shell's PATH as it reported it; the owner supplies the shell and the rest of the environment. */
  | {op: 'start'; command: string; family?: string; cwd: string; path?: string}
  | {op: 'stop'; id: string; level: StopLevel}
  | {op: 'remove'; id: string};

/** New output of one task since the last update its frontend received. */
export interface TaskUpdate {
  lines: OutputLine[];
  /** The unfinished last line as it shows now (already cleaned). */
  partial: string;
  dropped: number;
  received: number;
}

const TASK_ID = /^t\d{1,9}$/u;
const LEVELS: readonly StopLevel[] = ['interrupt', 'terminate', 'kill'];
const STATES: readonly TaskState[] = ['running', 'stopping', 'exited', 'failed', 'stopped'];
const MAX_COMMAND = 64 * 1024;
const MAX_PATH = 64 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const int = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const short = (value: unknown, limit: number) => typeof value === 'string' && value.length <= limit;

export function taskOpFrom(text: string): TaskOp | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!isRecord(value)) return undefined;
  if (value.op === 'start') {
    if (!short(value.command, MAX_COMMAND) || !(value.command as string).trim() || !short(value.cwd, 4096)) return undefined;
    if (value.family !== undefined && !short(value.family, 64)) return undefined;
    if (value.path !== undefined && !short(value.path, MAX_PATH)) return undefined;
    return {op: 'start', command: value.command as string, cwd: value.cwd as string,
      ...(value.family === undefined ? {} : {family: value.family as string}), ...(value.path === undefined ? {} : {path: value.path as string})};
  }
  if (typeof value.id !== 'string' || !TASK_ID.test(value.id)) return undefined;
  if (value.op === 'stop') return LEVELS.includes(value.level as StopLevel) ? {op: 'stop', id: value.id, level: value.level as StopLevel} : undefined;
  if (value.op === 'remove') return {op: 'remove', id: value.id};
  return undefined;
}

function recordFrom(value: unknown): TaskRecord | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !TASK_ID.test(value.id) || !short(value.command, MAX_COMMAND) || !short(value.cwd, 4096)
    || !short(value.shell, 4096) || !int(value.startedAt) || !STATES.includes(value.state as TaskState)) return undefined;
  const optionalInt = (field: string) => value[field] === undefined || Number.isSafeInteger(value[field]);
  if (!optionalInt('endedAt') || !optionalInt('exitCode') || !optionalInt('signal') || !optionalInt('stopRequestedAt')) return undefined;
  if (value.family !== undefined && !short(value.family, 64)) return undefined;
  if (value.stopRequested !== undefined && !LEVELS.includes(value.stopRequested as StopLevel)) return undefined;
  if (value.leftovers !== undefined && typeof value.leftovers !== 'boolean') return undefined;
  const record: TaskRecord = {id: value.id, command: value.command as string, cwd: value.cwd as string, shell: value.shell as string,
    startedAt: value.startedAt as number, state: value.state as TaskState};
  for (const field of ['family', 'endedAt', 'exitCode', 'signal', 'stopRequested', 'stopRequestedAt', 'leftovers'] as const) {
    if (value[field] !== undefined) (record as unknown as Record<string, unknown>)[field] = value[field];
  }
  return record;
}

/** A task list; at most 256 records (the supervisor runs at most 16 and keeps a bounded number of finished ones). */
export function tasksFrom(text: string): TaskRecord[] | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!Array.isArray(value) || value.length > 256) return undefined;
  const records = value.map(recordFrom);
  return records.every(Boolean) ? records as TaskRecord[] : undefined;
}

export function taskUpdateFrom(text: string): TaskUpdate | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!isRecord(value) || !Array.isArray(value.lines) || value.lines.length > 100_000 || !short(value.partial, 64 * 1024) || !int(value.dropped) || !int(value.received)) return undefined;
  const lines: OutputLine[] = [];
  let previous = 0;
  for (const line of value.lines) {
    if (!isRecord(line) || !int(line.seq) || (line.seq as number) <= previous || !short(line.text, 64 * 1024)) return undefined;
    previous = line.seq as number;
    lines.push({seq: line.seq as number, text: line.text as string});
  }
  return {lines, partial: value.partial as string, dropped: value.dropped as number, received: value.received as number};
}

/** The next stop request for a task, from its record alone (what the supervisor's nextEscalation answers). */
export function nextLevel(record: TaskRecord | undefined): StopLevel | undefined {
  if (!record) return undefined;
  if (!record.stopRequested) return 'interrupt';
  return LEVELS[LEVELS.indexOf(record.stopRequested) + 1];
}
