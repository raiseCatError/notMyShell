import {cpus, freemem, totalmem, uptime} from 'node:os';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {StatusStripSettings} from '../prompt/configuration.js';
import {runExternal, resolveCommand} from '../providers/providers.js';
import {presentationNow} from '../presentation/environment.js';
import {semanticIcon, type SemanticIconId} from '../prompt/glyphChoices.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth} from '../util/text.js';

/**
 * The optional NMSh-owned status strip: one compact right-aligned row of
 * local facts. It is presentation only (never in the transcript, /copy or
 * the session journal), hidden during passthrough and on narrow terminals,
 * and refreshed on a modest timer only while enabled. Nothing is networked.
 */

export interface SystemStats {
  /** CPU use 0..100 since the previous sample; undefined until two samples exist. */
  cpu?: number;
  memory?: {used: number; total: number};
  /** Undefined when the machine has no battery (desktops never show one). */
  battery?: {percent: number; charging: boolean};
  uptimeSeconds?: number;
}

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

/** `pmset -g batt`: a percentage only when an internal battery is listed. */
export function parsePmset(output: string): SystemStats['battery'] {
  const line = output.split('\n').find(item => /InternalBattery/u.test(item));
  const match = line && /(\d{1,3})%;\s*([a-zA-Z ]+);/u.exec(line);
  if (!match) return undefined;
  const state = match[2]!.trim().toLowerCase();
  return {percent: Math.min(100, Number(match[1])), charging: state === 'charging' || state === 'charged' || state === 'finishing charge'};
}

/** `vm_stat`: used = active + wired + compressed pages, close to Activity Monitor's Memory Used. */
export function parseVmStat(output: string, total: number): SystemStats['memory'] {
  const page = Number(/page size of (\d+) bytes/u.exec(output)?.[1] ?? 0);
  const pages = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`, 'u').exec(output)?.[1] ?? NaN);
  const used = (pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) * page;
  return page > 0 && Number.isFinite(used) && used > 0 ? {used: Math.min(used, total), total} : undefined;
}

/** `/proc/meminfo`: used = total - MemAvailable. */
export function parseMeminfo(text: string): SystemStats['memory'] {
  const field = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, 'mu').exec(text)?.[1] ?? NaN) * 1024;
  const total = field('MemTotal');
  const available = field('MemAvailable');
  return Number.isFinite(total) && Number.isFinite(available) && total > 0 ? {used: total - available, total} : undefined;
}

/** Linux `/sys/class/power_supply/BAT*`. */
function linuxBattery(): SystemStats['battery'] {
  try {
    const root = '/sys/class/power_supply';
    const battery = readdirSync(root).find(name => /^BAT/u.test(name));
    if (!battery) return undefined;
    const percent = Number(readFileSync(join(root, battery, 'capacity'), 'utf8').trim());
    const status = readFileSync(join(root, battery, 'status'), 'utf8').trim().toLowerCase();
    return Number.isFinite(percent) ? {percent: Math.min(100, percent), charging: status === 'charging' || status === 'full'} : undefined;
  } catch { return undefined; }
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

/**
 * The right-aligned strip row, or '' when nothing fits. Lower-priority items
 * (uptime, CPU, RAM) drop first so the clock survives on narrow terminals.
 */
export function renderStatusStrip(settings: StatusStripSettings, stats: SystemStats, columns: number, now?: Date): string {
  if (!settings.enabled || columns < STRIP_MIN_COLUMNS) return '';
  let items = stripItems(settings, stats, now);
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const reset = '\u001B[0m';
  const plain = (list: StripItem[]) => list.map(item => { const icon = semanticIcon(item.icon); return icon ? `${icon} ${item.text}` : item.text; }).join(' · ');
  while (items.length && displayWidth(plain(items)) > columns - 2) {
    const drop = items.reduce((worst, item) => item.priority > worst.priority ? item : worst);
    items = items.filter(item => item !== drop);
  }
  if (!items.length) return '';
  const body = items.map(item => {
    const icon = semanticIcon(item.icon);
    return `${icon ? `${subtle}${icon} ` : ''}${secondary}${item.text}`;
  }).join(`${subtle} · `);
  const width = displayWidth(plain(items));
  return `${' '.repeat(Math.max(0, columns - width - 1))}${body}${reset}`;
}

/** Whether the strip owns a row at this size. */
export function stripVisible(settings: StatusStripSettings, columns: number, rows: number): boolean {
  return settings.enabled && columns >= STRIP_MIN_COLUMNS && rows >= 8;
}
