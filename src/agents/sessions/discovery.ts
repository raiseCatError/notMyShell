import {execFile} from 'node:child_process';
import {readlinkSync} from 'node:fs';
import {harnessForExecutable} from '../harnesses.js';

/**
 * System-wide discovery of known agent processes from process metadata only:
 * pid, parent, terminal, elapsed time and executable name. Command-line
 * arguments are never read (they can hold prompts or secrets). A process is an
 * agent only when its executable name is in the harness registry.
 */

export interface ProcessRow {pid: number; ppid: number; tty?: string; elapsedMs: number; name: string}
export interface DiscoveredAgent {pid: number; harness: string; tty?: string; startedAt: number; cwd?: string}

/** `[[dd-]hh:]mm:ss` → milliseconds. */
export function parseElapsed(value: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/u.exec(value.trim());
  if (!match) return undefined;
  const [, days, hours, minutes, seconds] = match;
  return (((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000;
}

/** Rows of `ps -A -o pid=,ppid=,tty=,etime=,comm=` (comm is the executable, never its arguments). */
export function parsePs(output: string, limit = 20_000): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split('\n').slice(0, limit)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const elapsedMs = parseElapsed(match[4]!);
    if (elapsedMs === undefined) continue;
    const command = match[5]!;
    const name = command.slice(command.lastIndexOf('/') + 1).replace(/^-/u, '');
    rows.push({pid: Number(match[1]), ppid: Number(match[2]), ...(match[3] !== '?' && match[3] !== '??' ? {tty: match[3]} : {}), elapsedMs, name});
  }
  return rows;
}

/**
 * Known agents among process rows. A harness that spawns helpers with the
 * same name counts once (the top-most matching ancestor); `exclude` drops
 * processes NMSh already manages so one agent never appears twice.
 */
export function findAgents(rows: readonly ProcessRow[], now: number, exclude: ReadonlySet<number> = new Set(), cwdOf?: (pid: number) => string | undefined): DiscoveredAgent[] {
  const byPid = new Map(rows.map(row => [row.pid, row]));
  const agents: DiscoveredAgent[] = [];
  for (const row of rows) {
    const harness = harnessForExecutable(row.name);
    if (!harness || exclude.has(row.pid)) continue;
    // Skip when an ancestor is already an agent (same harness helper) or is managed by NMSh.
    let parent = byPid.get(row.ppid);
    let nested = false;
    for (let depth = 0; parent && depth < 32; depth += 1) {
      if (exclude.has(parent.pid) || harnessForExecutable(parent.name)) { nested = true; break; }
      parent = byPid.get(parent.ppid);
    }
    if (nested) continue;
    const cwd = cwdOf?.(row.pid);
    agents.push({pid: row.pid, harness: harness.id, ...(row.tty ? {tty: row.tty} : {}), startedAt: now - row.elapsedMs, ...(cwd ? {cwd} : {})});
  }
  return agents;
}

/** Linux exposes a process's cwd as a symlink we may read; elsewhere it stays unknown rather than being guessed. */
export function procCwd(pid: number): string | undefined {
  if (process.platform !== 'linux') return undefined;
  try { return readlinkSync(`/proc/${pid}/cwd`); } catch { return undefined; }
}

/** One bounded, asynchronous scan (never on the input path). */
export function scanAgents(exclude: ReadonlySet<number> = new Set(), now = Date.now()): Promise<DiscoveredAgent[]> {
  return new Promise(resolve => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,tty=,etime=,comm='], {timeout: 3000, maxBuffer: 4 * 1024 * 1024}, (error, stdout) => {
      resolve(error ? [] : findAgents(parsePs(stdout), now, exclude, procCwd));
    });
  });
}
