import {spawnSync} from 'node:child_process';
import {readFileSync, readlinkSync} from 'node:fs';
import type {SessionInfo} from '../../src/session/SessionProtocol.js';
import type {Frontend, LiveSandbox} from './liveFrontend.js';

// Failure-only, read-only observations. No terminal input, resize, signals,
// environment or command contents; every subprocess has a fixed bound.
function probe(command: string, args: string[], deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return {status: null, signal: null, error: 'diagnostic budget exhausted', output: '', stderr: ''};
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: Math.min(1000, remaining), maxBuffer: 16 * 1024});
  return {status: result.status, signal: result.signal, error: result.error?.message,
    output: result.stdout?.trim().slice(0, 2048), stderr: result.stderr?.trim().slice(0, 512)};
}

type TerminalObservation = {unavailable: string; ttyProbe?: ReturnType<typeof probe>} | {tty: string; size: ReturnType<typeof probe>};

function terminalSize(pid: number, deadline: number): TerminalObservation {
  if (!Number.isSafeInteger(pid) || pid <= 1) return {unavailable: 'invalid owned PID'};
  if (process.platform === 'linux') {
    const fd = `/proc/${pid}/fd/0`;
    try {
      const tty = readlinkSync(fd);
      if (!/^\/dev\/pts\/\d+$/.test(tty)) return {unavailable: 'stdin is not a PTY slave'};
      return {tty, size: probe('stty', ['-F', fd, 'size'], deadline)};
    } catch (error) { return {unavailable: String(error)}; }
  }
  if (process.platform === 'darwin') {
    const ttyProbe = probe('ps', ['-p', String(pid), '-o', 'tty='], deadline);
    const tty = ttyProbe.output;
    if (ttyProbe.status !== 0 || !tty || !/^ttys\d+$/.test(tty)) return {unavailable: 'no validated PTY slave', ttyProbe};
    return {tty, size: probe('stty', ['-f', `/dev/${tty}`, 'size'], deadline)};
  }
  return {unavailable: `unsupported platform ${process.platform}`};
}

function children(pid: number, deadline: number) {
  const result = probe('pgrep', ['-P', String(pid)], deadline);
  const pids = result.status === 0 ? (result.output ?? '').split('\n').map(Number)
    .filter(value => Number.isSafeInteger(value) && value > 1).slice(0, 8) : [];
  return {parent: pid, pids, probe: result};
}

function processState(pid: number, deadline: number) {
  const state = probe('ps', ['-p', String(pid), '-o', 'pid=,ppid=,pgid=,state=,comm='], deadline);
  if (process.platform !== 'linux') return {pid, state};
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8').split('\n')
      .filter(line => /^(State|Pid|PPid|NSpgid|NSsid|SigPnd|ShdPnd|SigBlk|SigIgn|SigCgt):/.test(line));
    const wchan = readFileSync(`/proc/${pid}/wchan`, 'utf8').trim().slice(0, 128);
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return {pid, state, status, wchan, ttyNumber: fields[4], foregroundGroup: fields[5]};
  } catch (error) { return {pid, state, unavailable: String(error)}; }
}

type FullscreenObservation = {unavailable: string} | {
  session: Pick<SessionInfo, 'id' | 'pid' | 'state' | 'fullscreen' | 'lastExit'> & {runningPresent: boolean};
  backend: TerminalObservation;
  frontend: TerminalObservation;
  children: ReturnType<typeof children>[];
  processes: ReturnType<typeof processState>[];
};

export async function fullscreenFailure(sandbox: LiveSandbox, id: string, backendPid: number, frontend: Frontend): Promise<FullscreenObservation> {
  const deadline = Date.now() + 5000;
  try {
    const session = (await sandbox.sessions()).find(value => value.id === id);
    if (!session || session.pid !== backendPid || !Number.isSafeInteger(backendPid) || backendPid <= 1) {
      return {unavailable: 'live session does not match the owned backend'};
    }
    const backend = terminalSize(backendPid, deadline);
    const outer = terminalSize(frontend.pty.pid, deadline);
    const direct = children(backendPid, deadline);
    const descendants = direct.pids.map(pid => children(pid, deadline));
    return {session: {id: session.id, pid: session.pid, state: session.state, fullscreen: session.fullscreen,
      runningPresent: session.running !== undefined, lastExit: session.lastExit},
    backend, frontend: outer,
    children: [direct, ...descendants],
    processes: [...new Set([backendPid, ...direct.pids, ...descendants.flatMap(value => value.pids)])].slice(0, 12).map(pid => processState(pid, deadline))};
  } catch (error) { return {unavailable: String(error)}; }
}
