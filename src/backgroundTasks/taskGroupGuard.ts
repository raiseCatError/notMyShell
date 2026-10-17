import {spawn, spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, renameSync, rmSync} from 'node:fs';
import {constants} from 'node:os';

// Runs as the PTY session/group leader. Its own group (0) is the only signalling target.
const [directory, shell, command, owner, environmentKey] = process.argv.slice(2) as [string, string, string, string, string];
const levels = ['interrupt', 'terminate', 'kill'];
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGKILL'];
const group = spawnSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], {encoding: 'utf8', timeout: 1000});
// forkpty must have established OUR group. A failed probe never falls back to signalling another group.
if (group.status !== 0 || Number(group.stdout.trim()) !== process.pid) process.exit(1);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => {});
let applied = -1;
let ended = false;
const requested = () => {
  try { return levels.indexOf(readFileSync(`${directory}/signal`, 'utf8')); } catch { return -1; }
};
const parent = Number(owner);
if (process.ppid !== parent) { rmSync(directory, {recursive: true, force: true}); process.kill(0, 'SIGKILL'); }
const first = requested();
if (first >= 0) process.exit(128 + constants.signals[signals[first]!]!);
const restored = JSON.parse(process.env[environmentKey] ?? '{}') as Record<string, string | null>;
delete process.env[environmentKey];
const env = {...process.env};
for (const [key, value] of Object.entries(restored)) { if (value === null) delete env[key]; else env[key] = value; }
const child = spawn(shell, ['-c', command], {stdio: 'inherit', env});
const saveExit = (exitCode: number, signal?: number) => {
  if (ended) return;
  ended = true;
  writeFileSync(`${directory}/exit-next`, JSON.stringify({exitCode, ...(signal ? {signal} : {})}), {mode: 0o600});
  renameSync(`${directory}/exit-next`, `${directory}/exit`);
  // Preserve the terminal hangup that the original command leader's exit caused; the guard alone ignores it.
  process.kill(0, 'SIGHUP');
};
child.on('error', () => saveExit(127));
child.on('exit', (code, signal) => saveExit(code ?? 0, signal ? constants.signals[signal] : undefined));
let lastProbe = -Infinity;
const poll = setInterval(() => {
  // An orphaned guard owns its group, never the former parent's possibly recycled PID.
  if (process.ppid !== parent) { rmSync(directory, {recursive: true, force: true}); process.kill(0, 'SIGKILL'); }
  const next = requested();
  if (next > applied) { applied = next; process.kill(0, signals[next]!); }
  if (!ended || performance.now() - lastProbe < 250) return;
  lastProbe = performance.now();
  const result = spawnSync('/bin/ps', ['-eo', 'pid=,ppid=,pgid=,stat='], {encoding: 'utf8', timeout: 1000, maxBuffer: 4 * 1024 * 1024});
  if (result.error || result.status !== 0) return; // Unknown membership retains the guard; never guess empty.
  const members = result.stdout.trim().split('\n').some(line => {
    const [pid, ppid, pgid, state] = line.trim().split(/\s+/u);
    return Number(pgid) === process.pid && Number(pid) !== process.pid && Number(ppid) !== process.pid && !state?.startsWith('Z');
  });
  if (!members) { clearInterval(poll); process.exit(0); }
}, 25);
