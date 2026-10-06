import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Parsers for local OS statistics, shared by the Status Strip and the Context
 * Engine's system capabilities. Pure functions plus one bounded sysfs read;
 * no UI, configuration or process imports, so any layer may depend on them.
 */

export interface SystemStats {
  /** CPU use 0..100 since the previous sample; undefined until two samples exist. */
  cpu?: number;
  memory?: {used: number; total: number};
  /** Undefined when the machine has no battery (desktops never show one). */
  battery?: {percent: number; charging: boolean};
  uptimeSeconds?: number;
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
export function linuxBattery(): SystemStats['battery'] {
  try {
    const root = '/sys/class/power_supply';
    const battery = readdirSync(root).find(name => /^BAT/u.test(name));
    if (!battery) return undefined;
    const percent = Number(readFileSync(join(root, battery, 'capacity'), 'utf8').trim());
    const status = readFileSync(join(root, battery, 'status'), 'utf8').trim().toLowerCase();
    return Number.isFinite(percent) ? {percent: Math.min(100, percent), charging: status === 'charging' || status === 'full'} : undefined;
  } catch { return undefined; }
}
