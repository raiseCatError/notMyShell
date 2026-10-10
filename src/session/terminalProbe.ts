import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readdir, readFile, readlink} from 'node:fs/promises';
import {arch as hostArch} from 'node:os';

/**
 * Read-only facts about a session's terminal and its foreground process group, gathered from the operating system
 * while a command runs and its output has gone quiet. Nothing here writes to the terminal, signals a process or
 * reads input: `stty -a` on the terminal device only reports its line settings, `ps` lists processes, and Linux's
 * /proc reports what a process is blocked in. Every fact is optional; what the platform cannot tell stays unknown.
 */
export interface TerminalModes {
  /** ICANON: the kernel collects a line until Enter. Off means the program reads keys as they come. */
  canonical: boolean;
  /** ECHO: typed characters are shown. Off while a program reads a password or a single key. */
  echo: boolean;
  /** ISIG: Ctrl+C and Ctrl+Z become signals. Off in full raw mode (terminal proxies, editors). */
  signals: boolean;
}

export interface ForegroundProcess {
  pid: number;
  /** ps state letters; R is running on a CPU. */
  state: string;
  /** Cumulative CPU time in milliseconds, when the platform reports it. */
  cpuMs?: number;
  command: string;
}

export interface TerminalSample {
  modes?: TerminalModes;
  foreground: ForegroundProcess[];
  /**
   * The kernel's report (Linux): true when a foreground process is blocked in read() on this terminal; false when
   * every foreground thread is blocked in something else (sleeping, waiting on a socket or a child); undefined
   * when the platform cannot tell or a thread is waiting in poll/select, whose descriptors are not visible.
   */
  readingTerminal?: boolean;
}

export interface ProbeTarget {
  /** The terminal device, e.g. /dev/ttys015 or /dev/pts/3. */
  tty: string;
}

export type TerminalProbe = (target: ProbeTarget) => Promise<TerminalSample | undefined>;

const TIMEOUT_MS = 1500;

function run(file: string, args: string[]): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile(file, args, {timeout: TIMEOUT_MS, maxBuffer: 256 * 1024, encoding: 'utf8', env: {LC_ALL: 'C', PATH: '/usr/bin:/bin'}},
      (error, stdout) => resolve(error ? undefined : stdout));
  });
}

/** Line settings from `stty -a` (BSD and GNU layouts): flags are whole words, `-flag` when off. */
export function parseStty(text: string): TerminalModes | undefined {
  const words = new Set(text.split(/[\s;]+/u));
  const flag = (name: string) => words.has(name) ? true : words.has(`-${name}`) ? false : undefined;
  const canonical = flag('icanon'), echo = flag('echo'), signals = flag('isig');
  if (canonical === undefined || echo === undefined) return undefined;
  return {canonical, echo, signals: signals ?? true};
}

/** CPU time as ps prints it: [[dd-]hh:]mm:ss[.cc]. */
export function parseCpuTime(text: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)(?:\.(\d+))?$/u.exec(text.trim());
  if (!match) return undefined;
  const [, days = '0', hours = '0', minutes, seconds, fraction = ''] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60_000 + Number(seconds) * 1000 + Number(`0.${fraction || '0'}`) * 1000;
}

/**
 * The foreground process group of the terminal from `ps -o pid=,pgid=,tpgid=,stat=,time=,comm= -t TTY`: the
 * processes whose group is the terminal's foreground group (pgid equals tpgid).
 */
export function parseForeground(text: string): ForegroundProcess[] {
  const rows: ForegroundProcess[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(\S+)\s+(\S+)\s+(.*)$/u.exec(line);
    if (!match || match[2] !== match[3]) continue;
    const cpuMs = parseCpuTime(match[5]!);
    rows.push({pid: Number(match[1]), state: match[4]!, ...(cpuMs === undefined ? {} : {cpuMs}), command: match[6]!.trim().split('/').pop() ?? ''});
  }
  return rows.slice(0, 64);
}

/** Syscall numbers of read(2)-family calls and of poll/select-family waits, per Linux architecture. */
const LINUX_SYSCALLS: Record<string, {read: number[]; wait: number[]}> = {
  x64: {read: [0, 17, 19, 295, 327], wait: [7, 23, 232, 270, 271, 281, 441]},
  arm64: {read: [63, 65, 67, 69, 286], wait: [22, 72, 73, 441]},
};

/**
 * One line of /proc/PID/task/TID/syscall: "NR ARG0 ... SP PC" while blocked in a call, "running" or "-1 ..."
 * otherwise. Returns what the thread waits on: a read of descriptor fd, a poll/select wait, something else, or
 * undefined while it runs.
 */
export function parseSyscall(text: string, arch = hostArch()): {kind: 'read'; fd: number} | {kind: 'wait' | 'other'} | undefined {
  const fields = text.trim().split(/\s+/u);
  const nr = Number(fields[0]);
  if (!Number.isInteger(nr) || nr < 0) return undefined;
  const table = LINUX_SYSCALLS[arch];
  if (!table) return {kind: 'other'};
  if (table.read.includes(nr)) {
    const fd = Number.parseInt(fields[1] ?? '', 16);
    return Number.isInteger(fd) ? {kind: 'read', fd} : {kind: 'other'};
  }
  return table.wait.includes(nr) ? {kind: 'wait'} : {kind: 'other'};
}

/** Linux: whether the foreground group is blocked reading this terminal, from the kernel's per-thread report. */
async function linuxReading(pids: number[], tty: string): Promise<boolean | undefined> {
  let unknown = false;
  for (const pid of pids.slice(0, 16)) {
    let threads: string[];
    try { threads = (await readdir(`/proc/${pid}/task`)).slice(0, 64); } catch { return undefined; }
    for (const tid of threads) {
      let text: string;
      // Readable for the shell's own descendants; a privileged (setuid) program refuses, which stays unknown.
      try { text = await readFile(`/proc/${pid}/task/${tid}/syscall`, 'utf8'); } catch { return undefined; }
      const call = parseSyscall(text);
      if (!call) { unknown = true; continue; }
      if (call.kind === 'wait') { unknown = true; continue; }
      if (call.kind !== 'read') continue;
      let target: string;
      try { target = await readlink(`/proc/${pid}/fd/${call.fd}`); } catch { unknown = true; continue; }
      if (target === tty || target === '/dev/tty') return true;
    }
  }
  return unknown ? undefined : false;
}

async function linuxCpu(pid: number): Promise<number | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    // Fields after the parenthesised command; utime and stime are the 12th and 13th of them, in clock ticks (100 Hz).
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return (Number(fields[11]) + Number(fields[12])) * 10;
  } catch { return undefined; }
}

const STTY = ['/bin/stty', '/usr/bin/stty'].find(existsSync);
const PS = ['/bin/ps', '/usr/bin/ps'].find(existsSync);

/** The probe for this platform, or undefined where NMSh has no read-only way to look (Windows, missing tools). */
export function systemProbe(platform: NodeJS.Platform = process.platform): TerminalProbe | undefined {
  if ((platform !== 'darwin' && platform !== 'linux') || !STTY || !PS) return undefined;
  const linux = platform === 'linux';
  return async ({tty}) => {
    const name = tty.replace(/^\/dev\//u, '');
    const [stty, ps] = await Promise.all([run(STTY, [linux ? '-F' : '-f', tty, '-a']), run(PS, ['-o', 'pid=,pgid=,tpgid=,stat=,time=,comm=', '-t', name])]);
    if (stty === undefined && ps === undefined) return undefined;
    let foreground = ps === undefined ? [] : parseForeground(ps);
    let readingTerminal: boolean | undefined;
    if (linux && foreground.length) {
      // ps prints whole seconds on Linux; the kernel's tick counts are precise enough to see a busy process.
      foreground = await Promise.all(foreground.map(async item => {
        const cpuMs = await linuxCpu(item.pid);
        return cpuMs === undefined ? item : {...item, cpuMs};
      }));
      readingTerminal = await linuxReading(foreground.map(item => item.pid), tty);
    }
    const modes = stty === undefined ? undefined : parseStty(stty);
    return {...(modes ? {modes} : {}), foreground, ...(readingTerminal === undefined ? {} : {readingTerminal})};
  };
}
