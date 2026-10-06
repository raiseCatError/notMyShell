import {cpus, freemem, totalmem, uptime} from 'node:os';
import {readFileSync} from 'node:fs';
import {linuxBattery, parseMeminfo, parsePmset, parseVmStat, type SystemStats} from './systemStats.js';
import type {StatusStripSettings} from '../prompt/configuration.js';
import {runExternal, resolveCommand} from '../providers/providers.js';
import {presentationNow} from '../presentation/environment.js';
import {semanticIcon, type SemanticIconId} from '../prompt/glyphChoices.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth} from '../util/text.js';

export {linuxBattery, parseMeminfo, parsePmset, parseVmStat, type SystemStats};

/**
 * The optional NMSh-owned status strip: one compact right-aligned row of
 * local facts. It is presentation only (never in the transcript, /copy or
 * the session journal), hidden during passthrough and on narrow terminals,
 * and refreshed on a modest timer only while enabled. Nothing is networked.
 */

export interface StatsSource {
  sample(): Promise<SystemStats>;
}

type CpuTimes = {idle: number; total: number};

function cpuTimes(): CpuTimes {
  let idle = 0, total = 0;
  for (const cpu of cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return {idle, total};
}

/**
 * Local OS sources only. Subprocesses (`pmset`, `vm_stat` on macOS) run from
 * the strip's own refresh timer with a short timeout, never on render or
 * keystrokes; battery is sampled less often because it changes slowly.
 */
export class LocalStats implements StatsSource {
  private previous?: CpuTimes;
  private lastBattery = 0;
  private battery?: SystemStats['battery'];
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async sample(): Promise<SystemStats> {
    const now = cpuTimes();
    const previous = this.previous;
    this.previous = now;
    const cpu = previous && now.total > previous.total
      ? Math.max(0, Math.min(100, 100 * (1 - (now.idle - previous.idle) / (now.total - previous.total)))) : undefined;
    const total = totalmem();
    let memory: SystemStats['memory'] = {used: total - freemem(), total};
    if (this.platform === 'darwin') {
      const vmStat = resolveCommand('vm_stat', '/usr/bin');
      const result = vmStat ? await runExternal(vmStat, [], {timeoutMs: 1000, maxBytes: 16 * 1024}) : undefined;
      memory = (result?.ok ? parseVmStat(result.stdout, total) : undefined) ?? memory;
    } else if (this.platform === 'linux') {
      try { memory = parseMeminfo(readFileSync('/proc/meminfo', 'utf8')) ?? memory; } catch { /* Keep os counters. */ }
    }
    if (Date.now() - this.lastBattery > 60_000) {
      this.lastBattery = Date.now();
      if (this.platform === 'darwin') {
        const pmset = resolveCommand('pmset', '/usr/bin');
        const result = pmset ? await runExternal(pmset, ['-g', 'batt'], {timeoutMs: 1000, maxBytes: 8 * 1024}) : undefined;
        this.battery = result?.ok ? parsePmset(result.stdout) : undefined;
      } else if (this.platform === 'linux') this.battery = linuxBattery();
      else this.battery = undefined;
    }
    return {cpu, memory, uptimeSeconds: uptime(), ...(this.battery ? {battery: this.battery} : {})};
  }
}

export const STRIP_REFRESH_MS = 5000;
/** Below this width the strip yields its row to the transcript. */
export const STRIP_MIN_COLUMNS = 30;

function gigabytes(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

interface StripItem {icon: SemanticIconId; text: string; priority: number}

/** The strip's items in display order; text always carries the meaning, icons are optional. */
export function stripItems(settings: StatusStripSettings, stats: SystemStats, now: Date = presentationNow()): StripItem[] {
  const items: StripItem[] = [];
  if (settings.uptime && stats.uptimeSeconds !== undefined) items.push({icon: 'uptime', text: `up ${formatUptime(stats.uptimeSeconds)}`, priority: 4});
  if (settings.cpu && stats.cpu !== undefined) items.push({icon: 'cpu', text: `CPU ${Math.round(stats.cpu)}%`, priority: 3});
  if (settings.ram && stats.memory) {
    const percent = `${Math.round(100 * stats.memory.used / stats.memory.total)}%`;
    const absolute = `${gigabytes(stats.memory.used)}/${gigabytes(stats.memory.total)} GB`;
    items.push({icon: 'memory', priority: 2,
      text: `RAM ${settings.ramDisplay === 'percent' ? percent : settings.ramDisplay === 'absolute' ? absolute : `${percent} · ${absolute}`}`});
  }
  // No battery hardware means no battery item, never a fake one.
  if (settings.battery && stats.battery) {
    items.push({icon: stats.battery.charging ? 'batteryCharging' : 'battery', text: `${stats.battery.percent}%`, priority: 1});
  }
  if (settings.clock) items.push({icon: 'clock', text: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, priority: 0});
  return items;
}

/** Keep Awake in the strip: present whenever it is active and the strip is on; its forms from widest to narrowest. */
export interface StripAwake {full: string; short: string; glyph: string}

/**
 * The right-aligned strip row, or '' when nothing fits. Lower-priority items
 * (uptime, CPU, RAM) drop first so the clock survives on narrow terminals.
 * An active Keep Awake ranks above all of them: it narrows (Awake · Display,
 * Awake, its glyph) before anything else would have to drop it.
 */
export function renderStatusStrip(settings: StatusStripSettings, stats: SystemStats, columns: number, now?: Date, awake?: StripAwake): string {
  if (!settings.enabled || columns < STRIP_MIN_COLUMNS) return '';
  let items = stripItems(settings, stats, now);
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001B[0m';
  const forms = awake ? [...new Set([awake.full, awake.short, awake.glyph])] : [];
  let form = 0;
  const awakeText = () => forms[form];
  const plain = (list: StripItem[]) => [...list.map(item => { const icon = semanticIcon(item.icon); return icon ? `${icon} ${item.text}` : item.text; }), ...(awakeText() ? [awakeText()!] : [])].join(' · ');
  while (displayWidth(plain(items)) > columns - 2) {
    // Decorative items drop first, lowest priority first; Keep Awake only narrows, then goes last of all.
    if (items.length) { const drop = items.reduce((worst, item) => item.priority > worst.priority ? item : worst); items = items.filter(item => item !== drop); }
    else if (form < forms.length) form += 1;
    else break;
  }
  if (!items.length && !awakeText()) return '';
  const body = [...items.map(item => {
    const icon = semanticIcon(item.icon);
    return `${icon ? `${subtle}${icon} ` : ''}${secondary}${item.text}`;
  }), ...(awakeText() ? [`${accent}${awakeText()}`] : [])].join(`${subtle} · `);
  const width = displayWidth(plain(items));
  return `${' '.repeat(Math.max(0, columns - width - 1))}${body}${reset}`;
}

/** Whether the strip owns a row at this size. */
export function stripVisible(settings: StatusStripSettings, columns: number, rows: number): boolean {
  return settings.enabled && columns >= STRIP_MIN_COLUMNS && rows >= 8;
}
