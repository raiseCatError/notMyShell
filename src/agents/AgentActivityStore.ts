import {mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {KNOWN_AGENTS, type AgentId} from './agents.js';

/**
 * Optional, local-only usage facts about known agent CLIs run inside NMSh.
 *
 * Stored per agent: total duration, run count, per-day duration and a short
 * list of recent runs (start time, duration, exit code). Never stored: the
 * command line, arguments, cwd, prompts, responses, output or environment.
 * Nothing here is sent anywhere.
 */

export const AGENT_ACTIVITY_SCHEMA = 1;
/** Days of per-day history kept per agent (a little over a year for the heatmap). */
export const MAX_DAYS = 400;
export const MAX_RECENT = 50;

export interface AgentRun {
  agent: AgentId;
  startedAt: number;
  durationMs: number;
  /** Absent when the run was interrupted or its status is unknown. */
  exitCode?: number;
}

export interface AgentTotals {
  durationMs: number;
  runs: number;
  /** Local calendar day (YYYY-MM-DD) → milliseconds worked that day. */
  days: Record<string, number>;
  lastUsedAt?: number;
}

export interface AgentActivityData {
  version: typeof AGENT_ACTIVITY_SCHEMA;
  agents: Partial<Record<AgentId, AgentTotals>>;
  recent: AgentRun[];
  /** Dedupe keys of recently recorded runs, so a replayed completion is never counted twice. */
  seen: string[];
}

export type LoadState = 'ok' | 'absent' | 'recovered-corrupt' | 'newer-version';

export function emptyActivity(): AgentActivityData {
  return {version: AGENT_ACTIVITY_SCHEMA, agents: {}, recent: [], seen: []};
}

export function agentActivityPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(nmshConfigDirectory(env), 'agent-activity.json');
}

/** Local calendar day for a timestamp. */
export function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const AGENT_IDS = new Set<string>(KNOWN_AGENTS.map(agent => agent.id));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function normalizeTotals(value: unknown): AgentTotals | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const days: Record<string, number> = {};
  if (record.days && typeof record.days === 'object') {
    for (const [day, ms] of Object.entries(record.days as Record<string, unknown>)) if (/^\d{4}-\d{2}-\d{2}$/u.test(day) && finite(ms)) days[day] = ms;
  }
  return {durationMs: finite(record.durationMs) ? record.durationMs : 0, runs: finite(record.runs) ? Math.floor(record.runs) : 0, days: pruneDays(days),
    ...(finite(record.lastUsedAt) ? {lastUsedAt: record.lastUsedAt} : {})};
}

function pruneDays(days: Record<string, number>): Record<string, number> {
  const keys = Object.keys(days).sort();
  if (keys.length <= MAX_DAYS) return days;
  return Object.fromEntries(keys.slice(-MAX_DAYS).map(key => [key, days[key]!]));
}

/**
 * Normalize a stored file into the current schema. Invalid fields are dropped
 * individually; a file from a newer NMSh is reported, never rewritten. A later
 * schema adds its upgrade step here, keyed on `version`.
 */
export function migrateActivity(value: unknown): AgentActivityData | 'newer' | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== 'number') return undefined;
  if (record.version > AGENT_ACTIVITY_SCHEMA) return 'newer';
  const agents: AgentActivityData['agents'] = {};
  if (record.agents && typeof record.agents === 'object') {
    for (const [id, raw] of Object.entries(record.agents as Record<string, unknown>)) {
      if (!AGENT_IDS.has(id)) continue;
      const totals = normalizeTotals(raw);
      if (totals) agents[id as AgentId] = totals;
    }
  }
  const recent = Array.isArray(record.recent) ? record.recent.filter((run): run is AgentRun => !!run && typeof run === 'object'
    && AGENT_IDS.has((run as AgentRun).agent) && finite((run as AgentRun).startedAt) && finite((run as AgentRun).durationMs))
    .map(run => ({agent: run.agent, startedAt: run.startedAt, durationMs: run.durationMs,
      ...(Number.isSafeInteger(run.exitCode) ? {exitCode: run.exitCode} : {})})).slice(0, MAX_RECENT) : [];
  const seen = Array.isArray(record.seen) ? record.seen.filter((key): key is string => typeof key === 'string' && key.length <= 200).slice(-MAX_RECENT * 2) : [];
  return {version: AGENT_ACTIVITY_SCHEMA, agents, recent, seen};
}

/** Pure: add one finished run. Returns false when the dedupe key was already recorded. */
export function addRun(data: AgentActivityData, run: AgentRun, key: string): boolean {
  if (data.seen.includes(key)) return false;
  const totals = data.agents[run.agent] ?? {durationMs: 0, runs: 0, days: {}};
  totals.durationMs += run.durationMs;
  totals.runs += 1;
  totals.lastUsedAt = Math.max(totals.lastUsedAt ?? 0, run.startedAt + run.durationMs);
  // A run spanning midnight is credited to the day it started; good enough for a heatmap.
  const day = dayKey(run.startedAt);
  totals.days[day] = (totals.days[day] ?? 0) + run.durationMs;
  totals.days = pruneDays(totals.days);
  data.agents[run.agent] = totals;
  data.recent = [run, ...data.recent].slice(0, MAX_RECENT);
  data.seen = [...data.seen, key].slice(-MAX_RECENT * 2);
  return true;
}

export class AgentActivityStore {
  state: LoadState = 'absent';

  constructor(readonly path = agentActivityPath()) {}

  load(): AgentActivityData {
    let text: string;
    try { text = readFileSync(this.path, 'utf8'); } catch { this.state = 'absent'; return emptyActivity(); }
    let migrated: ReturnType<typeof migrateActivity>;
    try { migrated = migrateActivity(JSON.parse(text)); } catch { migrated = undefined; }
    if (migrated === 'newer') { this.state = 'newer-version'; return emptyActivity(); }
    if (!migrated) {
      // Keep the unreadable file for inspection instead of silently discarding it.
      try { renameSync(this.path, `${this.path}.corrupt-${Date.now()}`); } catch { /* best effort */ }
      this.state = 'recovered-corrupt';
      return emptyActivity();
    }
    this.state = 'ok';
    return migrated;
  }

  /** Record one run; a newer-schema file written by a later NMSh is never overwritten. */
  record(run: AgentRun, key: string): boolean {
    const data = this.load();
    if (this.state === 'newer-version') return false;
    if (!addRun(data, run, key)) return false;
    this.save(data);
    return true;
  }

  save(data: AgentActivityData): void {
    mkdirSync(dirname(this.path), {recursive: true, mode: 0o700});
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(data)}\n`, {encoding: 'utf8', mode: 0o600});
    renameSync(temporary, this.path);
  }

  /** Delete every stored agent-activity fact. */
  reset(): void {
    rmSync(this.path, {force: true});
    this.state = 'absent';
  }
}
