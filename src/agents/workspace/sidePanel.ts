import type {AgentSession} from '../sessions/model.js';
import {contextMeter, effortStatus, formatTokens, modelName, currentModel, type AgentTelemetry} from '../telemetry.js';
import {displayText} from '../transcript/projection.js';
import {displayWidth, padCells, stripAnsi, truncateAnsi, truncateText} from '../../util/text.js';
import {getCurrentGlyphMode} from '../../ui/glyphs.js';
import {foreground, UI_COLORS} from '../../ui/palette.js';
import {colorLevel} from '../../presentation/capabilities.js';

/**
 * The agent view's right panel: what the target is doing to its context and the project, from telemetry only (never
 * disk or the provider on the render path). Sections appear only when they have facts: context pressure with its
 * source and age, model and effort, the plan, files read and edited, running subagents and tasks, compactions, and a
 * rate limit only once it is close. Meaning never depends on color; every mark has words or an ASCII form.
 */

const RESET = '\u001b[0m';
/** Columns at which the panel shows by default; narrower terminals keep the conversation full width. */
export const SIDE_PANEL_MIN_COLUMNS = 120;

export function sidePanelWidth(columns: number): number {
  return Math.max(30, Math.min(46, Math.floor(columns * 0.3)));
}

/** Whether the panel is shown: the person's explicit choice, else on at wide terminals. */
export function sidePanelShown(choice: boolean | undefined, columns: number): boolean {
  return columns >= 72 && (choice ?? columns >= SIDE_PANEL_MIN_COLUMNS);
}

const safe = () => getCurrentGlyphMode() === 'safe';
const paint = (color: Parameters<typeof foreground>[0]) => colorLevel() === 'none' ? '' : foreground(color);

function age(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

/** A filled bar in cells; Safe glyphs draw it with # and -. */
function bar(percent: number, cells: number): string {
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)));
  const [on, off] = safe() ? ['#', '-'] : ['█', '░'];
  return on.repeat(filled) + off.repeat(cells - filled);
}

function relative(path: string, cwd: string | undefined): string {
  const clean = displayText(path);
  if (cwd && clean.startsWith(`${cwd}/`)) return clean.slice(cwd.length + 1);
  return clean.replace(/^\/(?:Users|home)\/[^/]+/u, '~');
}

export function renderSidePanel(session: AgentSession, width: number, height: number, now: number, settingsEffort?: string): string[] {
  const telemetry = session.telemetry;
  const primary = paint(UI_COLORS.primary), secondary = paint(UI_COLORS.secondary), subtle = paint(UI_COLORS.subtle), accent = paint(UI_COLORS.accent), failure = paint(UI_COLORS.failure);
  const out: string[] = [];
  const line = (text: string, style = secondary) => out.push(`${style}${truncateText(text, width)}${RESET}`);
  const title = (text: string) => { if (out.length) out.push(''); out.push(`${accent}${truncateText(text, width)}${RESET}`); };
  if (!telemetry) { line('Nothing reported yet.', subtle); return fit(out, width, height); }

  context(telemetry, width, now, title, line, {primary, secondary, subtle, failure});
  const running = currentModel(telemetry, session.model);
  if (running) {
    title('Model');
    line(`${modelName(running.value, telemetry)}${running.source === 'requested' ? ' (requested)' : ''}`, primary);
    // Compact provenance words: the panel is narrow, and the picker and header carry the full sentence.
    const effort = effortStatus(telemetry, settingsEffort);
    const words: Record<string, string> = {acknowledged: `Effort ${effort.value} · acknowledged`, launch: `Effort ${effort.value} · launch flag`, settings: `Effort ${effort.value} · settings`,
      default: 'Effort: model default', unavailable: 'No effort levels'};
    if (words[effort.state]) line(words[effort.state]!, subtle);
    const mode = telemetry.requested.permissionMode?.value ?? telemetry.runtime?.permissionMode;
    if (mode) line(`Permissions ${mode}${telemetry.requested.permissionMode ? ' (requested)' : ''}`, subtle);
  }

  const todos = telemetry.todos?.value ?? [];
  if (todos.length) {
    const done = todos.filter(item => item.status === 'completed').length;
    title(`Plan ${done}/${todos.length}`);
    for (const item of todos.slice(0, 8)) {
      const mark = item.status === 'completed' ? (safe() ? '[x]' : '✓') : item.status === 'in_progress' ? (safe() ? '[>]' : '▸') : (safe() ? '[ ]' : '·');
      line(`${mark} ${displayText(item.status === 'in_progress' && item.activeForm ? item.activeForm : item.content)}`, item.status === 'in_progress' ? primary : item.status === 'completed' ? subtle : secondary);
    }
    if (todos.length > 8) line(`+${todos.length - 8} more`, subtle);
  }

  const tasks = [...telemetry.tasks.values()].filter(task => task.status === 'running' || now - task.updated < 30_000).reverse();
  if (tasks.length) {
    title(`Subagents and tasks`);
    for (const task of tasks.slice(0, 6)) {
      const who = displayText(task.subagent ?? task.type ?? 'task');
      const state = task.status === 'running' ? `${Math.max(0, Math.round((now - task.started) / 1000))}s` : displayText(task.status);
      line(`${who} · ${displayText(task.description)}`, task.status === 'running' ? primary : subtle);
      line(`  ${state}${task.tokens ? ` · ${formatTokens(task.tokens)} tok` : ''}${task.lastTool ? ` · ${displayText(task.lastTool)}` : ''}`, task.status === 'failed' ? failure : subtle);
    }
  }

  const files = [...telemetry.files.values()].reverse();
  if (files.length) {
    const edited = files.filter(file => file.edits || file.writes);
    title(`Files ${edited.length ? `${edited.length} changed · ` : ''}${files.length} touched`);
    for (const file of files.slice(0, 10)) {
      const change = file.edits || file.writes ? `+${file.added} -${file.removed}` : 'read';
      const name = relative(file.path, session.cwd);
      const room = Math.max(4, width - displayWidth(change) - 1);
      out.push(`${file.edits || file.writes ? primary : secondary}${padCells(truncateStart(name, room), room, 0)}${RESET} ${file.edits || file.writes ? secondary : subtle}${change}${RESET}`);
    }
    if (files.length > 10) line(`+${files.length - 10} more`, subtle);
  }

  if (telemetry.compactions.length) {
    const last = telemetry.compactions.at(-1)!;
    title(`Compacted ${telemetry.compactions.length}×`.replace('×', safe() ? 'x' : '×'));
    line(`${last.trigger} · ${formatTokens(last.preTokens)}${last.postTokens ? ` → ${formatTokens(last.postTokens)}` : ''} · ${age(last.at, now)}`.replace('→', safe() ? '->' : '→'), subtle);
  }

  const limits = Object.entries(telemetry.rateLimits).filter(([, limit]) => limit.value.status !== 'allowed' || (limit.value.utilization ?? 0) >= 0.7);
  if (limits.length) {
    title('Usage limits');
    for (const [type, limit] of limits) {
      const words = type.replace('_', ' ').replace('five hour', '5-hour').replace('seven day', '7-day');
      const use = limit.value.utilization !== undefined ? ` ${Math.round(limit.value.utilization * 100)}%` : '';
      const reset = limit.value.resetsAt ? ` · resets ${new Date(limit.value.resetsAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}` : '';
      line(`${words}${use}${reset}${limit.value.from ? ` · via ${displayText(limit.value.from)}` : ''}`, limit.value.status === 'rejected' ? failure : secondary);
    }
  }

  const usage = telemetry.usage;
  if (usage) {
    title('Session');
    line(`${usage.turns} turn${usage.turns === 1 ? '' : 's'}${usage.costUsd !== undefined ? ` · ~$${usage.costUsd.toFixed(2)} estimated` : ''}`, subtle);
  }
  return fit(out, width, height);
}

function context(telemetry: AgentTelemetry, width: number, now: number, title: (text: string) => void, line: (text: string, style?: string) => void,
  c: {primary: string; secondary: string; subtle: string; failure: string}): void {
  const meter = contextMeter(telemetry);
  title('Context');
  if (!meter) { line('Not reported yet', c.subtle); line('/context asks Claude', c.subtle); return; }
  const percent = Math.round(meter.percent);
  const label = `${percent}%`;
  const cells = Math.max(4, Math.min(20, width - displayWidth(label) - 1));
  line(`${bar(meter.percent, cells)} ${label}`, percent >= 85 ? c.failure : c.primary);
  line(`${formatTokens(meter.used)} of ${formatTokens(meter.max)}`, c.secondary);
  const snapshot = meter.source === 'provider' ? telemetry.context?.value : undefined;
  if (snapshot?.autoCompact && snapshot.autoCompactThreshold) {
    const headroom = Math.max(0, snapshot.autoCompactThreshold - snapshot.totalTokens);
    line(`${formatTokens(headroom)} before auto-compact`, c.secondary);
  }
  line(meter.source === 'provider' ? `Claude's count · ${age(meter.at, now)}` : `estimate from the last turn · ${age(meter.at, now)}`, c.subtle);
  if (snapshot) {
    const used = snapshot.categories.filter(category => category.kind === 'used' && category.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, 6);
    for (const category of used) {
      const value = formatTokens(category.tokens);
      const room = Math.max(4, width - displayWidth(value) - 1);
      line(`${padCells(truncateText(displayText(category.name), room), room, 0)} ${value}`, c.subtle);
    }
  }
}

function truncateStart(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  const ellipsis = safe() ? '...' : '…';
  let tail = '';
  for (const ch of [...text].reverse()) { if (displayWidth(ch + tail) + displayWidth(ellipsis) > width) break; tail = ch + tail; }
  return ellipsis + tail;
}

function fit(lines: string[], width: number, height: number): string[] {
  const rows = lines.slice(0, Math.max(0, height));
  while (rows.length < height) rows.push('');
  return rows.map(row => displayWidth(stripAnsi(row)) > width ? truncateAnsi(row, width) : row);
}
