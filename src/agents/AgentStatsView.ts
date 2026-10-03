import {formatDuration} from '../status/commandTiming.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {truncateAnsi} from '../util/text.js';
import {agentDescriptor, KNOWN_AGENTS, type AgentId} from './agents.js';
import {dayKey, type AgentActivityData, type LoadState} from './AgentActivityStore.js';

const RESET = '\u001b[0m';
/** Density glyphs carry the level without color (NO_COLOR, monochrome hosts). */
const LEVEL_GLYPHS = ['·', '░', '▒', '▓', '█'] as const;
const DAY_MS = 86_400_000;

function hex(color: string): RgbColor {
  return {red: Number.parseInt(color.slice(1, 3), 16), green: Number.parseInt(color.slice(3, 5), 16), blue: Number.parseInt(color.slice(5, 7), 16)};
}

function mix(a: RgbColor, b: RgbColor, t: number): RgbColor {
  return {red: Math.round(a.red + (b.red - a.red) * t), green: Math.round(a.green + (b.green - a.green) * t), blue: Math.round(a.blue + (b.blue - a.blue) * t)};
}

/** Escape for an agent's accent; empty under NO_COLOR (foreground follows the color level). */
export function agentColor(color: string): string {
  return foreground(hex(color));
}

/** Combined per-day milliseconds across agents (or one agent). */
export function dailyTotals(data: AgentActivityData, agent?: AgentId): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [id, entry] of Object.entries(data.agents)) {
    if (agent && id !== agent) continue;
    for (const [day, ms] of Object.entries(entry?.days ?? {})) totals.set(day, (totals.get(day) ?? 0) + ms);
  }
  return totals;
}

/** Quantize a day's duration into 0..4 against the busiest day shown. Deterministic. */
export function heatLevel(ms: number, max: number): number {
  if (ms <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(4, Math.ceil((ms / max) * 4)));
}

/**
 * A contribution-style grid: one column per week (oldest left), one row per
 * weekday (Mon..Sun), ending at `now`'s week. Pure; no dependency.
 */
export function renderHeatmap(days: ReadonlyMap<string, number>, now: number, weeks: number, accent: RgbColor): string[] {
  const today = new Date(now);
  const weekday = (today.getDay() + 6) % 7; // Monday = 0
  const lastMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekday).getTime();
  const firstMonday = lastMonday - (weeks - 1) * 7 * DAY_MS;
  const cells: number[][] = Array.from({length: 7}, () => []);
  let max = 0;
  for (const ms of days.values()) max = Math.max(max, ms);
  const base = UI_COLORS.subtle;
  const labels = ['Mon', '   ', 'Wed', '   ', 'Fri', '   ', 'Sun'];
  for (let week = 0; week < weeks; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      // Calendar arithmetic through Date keeps DST transitions on the right day.
      const start = new Date(firstMonday);
      const at = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + day).getTime();
      cells[day]!.push(at > now ? -1 : heatLevel(days.get(dayKey(at)) ?? 0, max));
    }
  }
  return cells.map((row, day) => `${labels[day]} ${row.map(level => {
    if (level < 0) return ' ';
    const color = level === 0 ? base : mix(base, accent, 0.25 + level * 0.1875);
    return `${foreground(color)}${LEVEL_GLYPHS[level]}${RESET}`;
  }).join('')}`);
}

export interface AgentStatsOptions {
  now: number;
  columns: number;
  enabled: boolean;
  loadState: LoadState;
}

/** The /agents view: per-agent totals, recent runs and a heatmap. Facts only. */
export function renderAgentStats(data: AgentActivityData, options: AgentStatsOptions): string[] {
  const {now, columns} = options;
  const accent = foreground(UI_COLORS.accent);
  const dim = foreground(UI_COLORS.secondary);
  const rows: string[] = [`${accent}Agent activity${RESET}${dim} · local only · nothing leaves this machine${RESET}`];
  if (!options.enabled) rows.push(`${dim}Recording is Off. Turn it on with /agents on; existing data is kept until /agents reset.${RESET}`);
  if (options.loadState === 'newer-version') rows.push(`${dim}The activity file was written by a newer NMSh; it is shown empty and left unchanged.${RESET}`);
  if (options.loadState === 'recovered-corrupt') rows.push(`${dim}The previous activity file was unreadable; it was kept beside the new one with a .corrupt suffix.${RESET}`);
  rows.push('');
  const safe = getCurrentGlyphMode() === 'safe';
  const known = KNOWN_AGENTS.filter(agent => (data.agents[agent.id]?.runs ?? 0) > 0);
  if (known.length === 0) rows.push(`${dim}No agent runs recorded yet. Claude Code and Codex CLI runs are counted when they finish.${RESET}`);
  for (const agent of known) {
    const totals = data.agents[agent.id]!;
    const days = Object.keys(totals.days).length;
    const color = foreground(hex(agent.color));
    rows.push(`${color}${safe ? agent.safeGlyph : agent.glyph}${RESET} ${agent.name.padEnd(12)} ${formatDuration(totals.durationMs).padStart(10)}  `
      + `${dim}${totals.runs} run${totals.runs === 1 ? '' : 's'} · ${days} day${days === 1 ? '' : 's'} used${RESET}`);
  }
  if (known.length > 0) {
    rows.push('');
    const weeks = Math.max(4, Math.min(52, columns - 6));
    rows.push(`${dim}Last ${weeks} weeks${RESET}`);
    rows.push(...renderHeatmap(dailyTotals(data), now, weeks, UI_COLORS.accent));
    rows.push(`${dim}less ${LEVEL_GLYPHS.join('')} more${RESET}`);
    rows.push('');
    rows.push(`${dim}Recent${RESET}`);
    for (const run of data.recent.slice(0, 5)) {
      const agent = agentDescriptor(run.agent);
      const status = run.exitCode === undefined ? 'interrupted' : run.exitCode === 0 ? 'finished' : `exit ${run.exitCode}`;
      rows.push(`  ${new Date(run.startedAt).toLocaleString()}  ${agent.short.padEnd(7)} ${formatDuration(run.durationMs).padStart(9)}  ${dim}${status}${RESET}`);
    }
  }
  rows.push('');
  rows.push(`${dim}/agents on · /agents off · /agents reset (deletes all agent activity data)${RESET}`);
  return rows.map(row => truncateAnsi(row, columns));
}

/** Completion wording for a finished agent run, in the activity line's vocabulary. */
export function agentCompletionText(agent: AgentId, elapsedMs: number, exitCode: number, interrupted: boolean): string {
  const name = agentDescriptor(agent).short;
  if (interrupted) return `Stopped ${name} after ${formatDuration(elapsedMs)}`;
  if (exitCode !== 0) return `${name} exited ${exitCode} after ${formatDuration(elapsedMs)}`;
  return `Worked with ${name} for ${formatDuration(elapsedMs)}`;
}
