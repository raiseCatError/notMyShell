import type {Command} from './run.js';

/** macOS: one bounded `ps` for every process's parent, controlling tty and executable. */
export const psCommand = (): Command => ({file: '/bin/ps', args: ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'tty=', '-o', 'comm='], timeoutMs: 3000});

export interface ProcessRow {pid: number; ppid: number; tty: string; command: string}

export function processTable(stdout: string): Map<number, ProcessRow> {
  const rows = new Map<number, ProcessRow>();
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*?)\s*$/u.exec(line);
    if (match) rows.set(Number(match[1]), {pid: Number(match[1]), ppid: Number(match[2]), tty: match[3]!, command: match[4]!});
  }
  return rows;
}

/** `ttys004` → `/dev/ttys004`; no controlling terminal (`??`, `-`) → undefined. */
export function ttyDevice(tty: string | undefined): string | undefined {
  if (!tty || !/^tty[\w.]+$|^pts\/\d+$/u.test(tty)) return undefined;
  return `/dev/${tty}`;
}

/** Parents, nearest first, from a process table (bounded; a cycle or pid 1 ends the walk). */
export function ancestorsFrom(table: ReadonlyMap<number, ProcessRow>, pid: number): number[] {
  const out: number[] = [];
  let current = table.get(pid)?.ppid;
  while (current !== undefined && current > 1 && out.length < 64 && !out.includes(current)) {
    out.push(current);
    current = table.get(current)?.ppid;
  }
  return out;
}
