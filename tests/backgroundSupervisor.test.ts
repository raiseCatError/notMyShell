import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BackgroundTaskSupervisor, groupAlive, type TaskRecord} from '../src/backgroundTasks/supervisor.js';

const STREAM = join(import.meta.dirname, 'fixtures', 'background', 'stream.mjs');
const BURST = join(import.meta.dirname, 'fixtures', 'background', 'burst.mjs');
const SLEEPER = join(import.meta.dirname, 'fixtures', 'background', 'sleeper.mjs');
const SHELL = '/bin/sh';
const node = (script: string, ...args: string[]) => [process.execPath, script, ...args].map(part => `'${part}'`).join(' ');
const env = (): Record<string, string> => ({PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/', TERM: 'xterm-256color'});
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/**
 * The sleeper in the background, then `leader` once the sleeper ignores the hangup (it creates a file), waiting at most
 * about ten seconds. Without the wait, a slow Node start let the leader's exit hang the member up first, and the task
 * rightly reported no leftovers.
 */
const afterSleeperReady = (cwd: string, ms: string, leader: string) => {
  const ready = join(cwd, 'sleeper-ready');
  return `${node(SLEEPER, ms, ready)} & i=0; while [ ! -e '${ready}' ] && [ $i -lt 1000 ]; do sleep 0.01; i=$((i+1)); done; ${leader}`;
};

async function waitFor(check: () => boolean, what: string, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function withSupervisor(run: (supervisor: BackgroundTaskSupervisor, cwd: string, changes: TaskRecord[]) => Promise<void>, limits = {lines: 2000, bytes: 1024 * 1024}) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'nmsh-bg-')));
  const changes: TaskRecord[] = [];
  const supervisor = new BackgroundTaskSupervisor({output: limits, onChange: task => changes.push(task)});
  try { await run(supervisor, cwd, changes); }
  finally { await supervisor.shutdown(500); await rm(cwd, {recursive: true, force: true}); }
}

const text = (supervisor: BackgroundTaskSupervisor, id: string) => supervisor.output(id)!.lines().map(line => line.text).join('\n');

test('a logcat-like stream: output arrives live; stop is SIGINT to its own group and is reported only after exit', async () => {
  await withSupervisor(async (supervisor, cwd) => {
    const started = supervisor.start({command: node(STREAM), family: 'adb logcat', cwd, shell: SHELL, env: env()});
    assert.ok(started.ok);
    const id = started.task.id;
    await waitFor(() => supervisor.output(id)!.lines().length >= 5, 'streamed lines');
    assert.match(text(supervisor, id), /I\/ActivityManager\(\s*\d+\): line 1/u);
    assert.deepEqual(supervisor.stop(id), {ok: true});
    assert.equal(typeof supervisor.get(id)!.stopRequestedAt, 'number', 'the request time paces escalation in views');
    assert.equal(supervisor.get(id)!.state === 'stopping' || supervisor.get(id)!.state === 'stopped', true, 'never "stopped" before the exit is observed');
    await waitFor(() => supervisor.get(id)!.state === 'stopped', 'stopped');
    const task = supervisor.get(id)!;
    // The leader is the program itself when the shell execs it (bash, zsh) and the shell when it does not (dash).
    assert.ok(task.exitCode === 130 || task.signal === 2, JSON.stringify(task));
    assert.equal(task.stopRequested, 'interrupt');
    assert.match(text(supervisor, id), /interrupted \(SIGINT\)/u, 'the program saw SIGINT, as with Ctrl+C');
    assert.equal(task.leftovers, false);
    assert.deepEqual(supervisor.stop(id), {ok: false, reason: 'the task is not running'});
  });
});

test('a task that ignores SIGINT stays "stopping"; escalation is explicit, one level at a time', async () => {
  await withSupervisor(async (supervisor, cwd) => {
    const {task} = supervisor.start({command: node(STREAM, '--ignore-int'), cwd, shell: SHELL, env: env()}) as {ok: true; task: TaskRecord};
    await waitFor(() => supervisor.output(task.id)!.lines().length >= 2, 'output');
    supervisor.stop(task.id);
    await waitFor(() => /ignoring SIGINT/u.test(text(supervisor, task.id)), 'the program refusing');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(supervisor.get(task.id)!.state, 'stopping', 'still running: not reported as stopped');
    assert.equal(supervisor.nextEscalation(task.id), 'terminate');
    supervisor.stop(task.id, 'terminate');
    await waitFor(() => supervisor.get(task.id)!.state === 'stopped', 'stopped after SIGTERM');
    assert.equal(supervisor.get(task.id)!.stopRequested, 'terminate');
    // It also survives the hangup: where /bin/sh does not exec the program (dash), SIGTERM ends the shell, the kernel
    // hangs up the terminal (SIGHUP, then EIO on writes), and a program that died of that would be stopped by it rather
    // than by SIGKILL. That stop is real and reported as such; this test is about the explicit escalation.
    const stubborn = supervisor.start({command: node(STREAM, '--ignore-int', '--ignore-term', '--ignore-hup'), cwd, shell: SHELL, env: env()}) as {ok: true; task: TaskRecord};
    await waitFor(() => supervisor.output(stubborn.task.id)!.lines().length >= 1, 'output');
    supervisor.stop(stubborn.task.id); supervisor.stop(stubborn.task.id, 'terminate');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(supervisor.get(stubborn.task.id)!.state, 'stopping', JSON.stringify({task: supervisor.get(stubborn.task.id), output: text(supervisor, stubborn.task.id).split('\n').slice(-4)}));
    assert.equal(supervisor.nextEscalation(stubborn.task.id), 'kill');
    supervisor.stop(stubborn.task.id, 'kill');
    await waitFor(() => supervisor.get(stubborn.task.id)!.state === 'stopped', 'killed');
    assert.equal(supervisor.get(stubborn.task.id)!.stopRequested, 'kill');
    assert.equal(supervisor.get(stubborn.task.id)!.leftovers, false, 'the whole group is gone');
    assert.equal(supervisor.nextEscalation(stubborn.task.id), undefined, 'nothing beyond kill');
  });
});

test('a pipeline stops as a whole; a detached helper it started (like the adb server) and other tasks are untouched', async () => {
  await withSupervisor(async (supervisor, cwd) => {
    const pidfile = join(cwd, 'daemon.pid');
    const piped = supervisor.start({command: `${node(STREAM, `--daemon=${pidfile}`)} | cat`, cwd, shell: SHELL, env: env()}) as {ok: true; task: TaskRecord};
    const other = supervisor.start({command: node(STREAM), cwd, shell: SHELL, env: env()}) as {ok: true; task: TaskRecord};
    await waitFor(() => supervisor.output(piped.task.id)!.lines().length >= 3 && supervisor.output(other.task.id)!.lines().length >= 3, 'both streaming');
    const daemon = Number(await readFile(pidfile, 'utf8'));
    try {
      supervisor.stop(piped.task.id);
      await waitFor(() => ['stopped', 'exited', 'failed'].includes(supervisor.get(piped.task.id)!.state), 'pipeline ended');
      await waitFor(() => supervisor.get(piped.task.id)!.leftovers === false, 'no leftovers in the group', 3000);
      assert.equal(alive(daemon), true, 'a process that left the group (setsid) is not NMSh\'s to stop');
      assert.equal(supervisor.get(other.task.id)!.state, 'running', 'stopping one task leaves the others running');
      const before = supervisor.output(other.task.id)!.lastSeq;
      await waitFor(() => supervisor.output(other.task.id)!.lastSeq > before + 3, 'the other task still streams');
    } finally { try { process.kill(daemon, 'SIGKILL'); } catch { /* gone */ } }
  });
});

test('a task that leaves nothing behind is never reported as having processes left, even for a moment; it is removable once exited', async () => {
  await withSupervisor(async (supervisor, cwd, changes) => {
    for (let run = 0; run < 5; run += 1) {
      const {task} = supervisor.start({command: `printf 'done ${run}\\n'`, cwd, shell: SHELL, env: env()}) as {ok: true; task: TaskRecord};
      await waitFor(() => supervisor.get(task.id)!.state === 'exited', 'exited');
      assert.deepEqual(changes.filter(change => change.id === task.id && change.leftovers).map(change => change.state), [],
        'the guard still being alive is not a process left behind');
      assert.equal(supervisor.remove(task.id), true, 'exited with nothing left: removable at once');
    }
  });
});

test('processes left in the group after the leader exits are reported, and killed only on request', async () => {
  await withSupervisor(async (supervisor, cwd) => {
    const {task} = supervisor.start({command: afterSleeperReady(cwd, '60000', 'sleep 1; exit 0'), cwd, shell: SHELL, env: env()}) as {ok: true; task: TaskRecord};
    await waitFor(() => supervisor.get(task.id)!.state !== 'running', 'leader exited');
    await new Promise(resolve => setTimeout(resolve, 300));
    const record = supervisor.get(task.id)!;
    assert.equal(record.state, 'exited');
    assert.equal(record.leftovers, true, 'a member that ignored the hangup is still running, and the task says so');
    assert.deepEqual(supervisor.stop(task.id), {ok: false, reason: 'the task is not running'}, 'a plain stop does not reach leftovers');
    assert.deepEqual(supervisor.stop(task.id, 'kill'), {ok: true});
    await waitFor(() => supervisor.get(task.id)!.leftovers === false, 'leftovers gone');
  });
});

test('a leftover group that ends later is noticed and forgotten: no stale "processes left", no kill aimed at a reused group id', async () => {
  await withSupervisor(async (supervisor, cwd) => {
    // The member outlives the leader by more than a second, past any one-off check after the exit.
    const {task} = supervisor.start({command: afterSleeperReady(cwd, '1600', 'sleep 0.2; exit 0'), cwd, shell: SHELL, env: env()}) as {ok: true; task: TaskRecord};
    await waitFor(() => supervisor.get(task.id)!.state === 'exited', 'leader exited');
    await waitFor(() => supervisor.get(task.id)!.leftovers === true, 'leftovers reported');
    assert.equal(supervisor.remove(task.id), false, 'a task whose processes still run is not removed: nothing could stop them afterwards');
    await waitFor(() => supervisor.get(task.id)!.leftovers === false, 'the late exit noticed', 5000);
    assert.deepEqual(supervisor.stop(task.id, 'kill'), {ok: false, reason: 'the task is not running'}, 'nothing is signalled once the group is gone');
    assert.equal(supervisor.remove(task.id), true);
  });
});

test('short commands: exit status decides exited/failed; the exact command text reaches the shell unchanged', async () => {
  await withSupervisor(async (supervisor, cwd) => {
    const quoting = supervisor.start({command: `printf '%s|\\n' "a  b" 'c$HOME' "d\\"e" && pwd`, cwd, shell: SHELL, env: env()}) as {ok: true; task: TaskRecord};
    const failing = supervisor.start({command: 'echo going; exit 3', cwd, shell: SHELL, env: env()}) as {ok: true; task: TaskRecord};
    await waitFor(() => supervisor.get(quoting.task.id)!.state === 'exited' && supervisor.get(failing.task.id)!.state === 'failed', 'both ended');
    assert.deepEqual(supervisor.output(quoting.task.id)!.lines().map(line => line.text), ['a  b|', 'c$HOME|', 'd"e|', cwd]);
    assert.equal(supervisor.get(failing.task.id)!.exitCode, 3);
    assert.equal(supervisor.get(quoting.task.id)!.endedAt! >= supervisor.get(quoting.task.id)!.startedAt, true);
  });
});

test('environment is used for the spawn and never kept on the task record', async () => {
  await withSupervisor(async (supervisor, cwd, changes) => {
    const {task} = supervisor.start({command: 'echo "$NMSH_TEST_TOKEN"', cwd, shell: SHELL, env: {...env(), NMSH_TEST_TOKEN: 'secret-value-123'}}) as {ok: true; task: TaskRecord};
    await waitFor(() => supervisor.get(task.id)!.state === 'exited', 'exit');
    assert.equal(text(supervisor, task.id), 'secret-value-123', 'the program saw its environment');
    assert.ok(!JSON.stringify([supervisor.list(), changes]).includes('secret-value-123'), 'records carry no environment');
  });
});

test('refusals: bad directory, relative shell, NUL bytes, the running-task limit', async () => {
  const supervisor = new BackgroundTaskSupervisor({output: {lines: 10, bytes: 1024}, maxRunning: 1});
  assert.deepEqual(supervisor.start({command: 'true', cwd: '/definitely/not/here', shell: SHELL, env: env()}), {ok: false, reason: 'the working directory does not exist'});
  assert.deepEqual(supervisor.start({command: 'true', cwd: '/', shell: 'sh', env: env()}), {ok: false, reason: 'the shell must be an absolute path'});
  assert.deepEqual(supervisor.start({command: 'true\u0000rm', cwd: '/', shell: SHELL, env: env()}), {ok: false, reason: 'the command contains a NUL character'});
  const first = supervisor.start({command: node(STREAM), cwd: '/', shell: SHELL, env: env()});
  assert.ok(first.ok);
  assert.deepEqual(supervisor.start({command: 'true', cwd: '/', shell: SHELL, env: env()}), {ok: false, reason: '1 background tasks are already running'});
  await supervisor.shutdown(500);
  assert.ok(supervisor.list().every(task => task.state === 'stopped'));
  assert.equal(supervisor.remove(supervisor.list()[0]!.id), true, 'a finished task can be removed');
});

test('high-volume hostile output is bounded, inert and does not stall', async () => {
  await withSupervisor(async (supervisor, cwd) => {
    const started = Date.now();
    const {task} = supervisor.start({command: node(BURST, '8'), cwd, shell: SHELL, env: env()}) as {ok: true; task: TaskRecord};
    await waitFor(() => supervisor.get(task.id)!.state === 'exited', 'burst finished', 60_000);
    const output = supervisor.output(task.id)!;
    assert.ok(output.lines().length <= 500 && output.bytes <= 64 * 1024, `bounded: ${output.lines().length} lines, ${output.bytes} bytes`);
    assert.ok(output.dropped > 1000, 'old lines were dropped, and counted');
    assert.ok(output.received > 8 * 1024 * 1024);
    for (const line of output.lines()) assert.doesNotMatch(line.text, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‮]/u);
    assert.deepEqual(output.lines().slice(-2).map(line => line.text), ['progress 100%', 'done'], 'a progress line keeps its last state');
    assert.ok(output.lines().some(line => line.text.includes('�')), 'invalid UTF-8 shows as replacement characters');
    assert.ok(Date.now() - started < 60_000);
  }, {lines: 500, bytes: 64 * 1024});
});

test('groupAlive never claims a group that is gone, and never checks group 0 or 1', () => {
  assert.equal(groupAlive(undefined), false);
  assert.equal(groupAlive(1), false);
  assert.equal(groupAlive(2 ** 22 + 12345), false);
});

test('a wrapper shell that dies of SIGINT does not end the task while its program still runs', async () => {
  // dash-style: the shell does not exec the program, so SIGINT ends the shell first; the program ignores it.
  await withSupervisor(async (supervisor, cwd) => {
    const {task} = supervisor.start({command: `${node(STREAM, '--ignore-int')}; true`, cwd, shell: SHELL, env: env()}) as {ok: true; task: TaskRecord};
    await waitFor(() => supervisor.output(task.id)!.lines().length >= 2, 'output');
    supervisor.stop(task.id);
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(supervisor.get(task.id)!.state, 'stopping', 'the program still runs, so the task is not stopped');
    assert.equal(supervisor.nextEscalation(task.id), 'terminate');
    assert.deepEqual(supervisor.stop(task.id, 'terminate'), {ok: true});
    await waitFor(() => supervisor.get(task.id)!.state === 'stopped', 'stopped once the group is gone');
    assert.equal(supervisor.get(task.id)!.leftovers, false);
  });
});


test('an immediate stop is accepted before PTY group readiness, and never signals a numeric group id', async () => {
  await withSupervisor(async (supervisor, cwd) => {
    const started = supervisor.start({command: 'sleep 30', cwd, shell: SHELL, env: env()});
    assert.ok(started.ok);
    const original = process.kill;
    const targets: number[] = [];
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal !== 0) { targets.push(pid); throw Object.assign(new Error('group not established yet'), {code: 'ESRCH'}); }
      return original(pid, signal);
    }) as typeof process.kill;
    try {
      assert.deepEqual(supervisor.stop(started.task.id), {ok: true}, 'stop intent is retained until the task can receive it');
      assert.deepEqual(targets, [], 'the supervisor never guesses or later reuses a numeric process group');
    } finally { process.kill = original; }
    await waitFor(() => supervisor.get(started.task.id)!.state === 'stopped', 'immediate stop completion');
    assert.equal(supervisor.get(started.task.id)!.leftovers, false);
  });
});


test('Node startup hooks cannot block the task guard, and the command retains its original Node environment', async () => {
  await withSupervisor(async (supervisor, cwd) => {
    // A bounded blocking import exits by itself on the broken implementation, so RED never leaks a paused debugger.
    const options = '--import=data:text/javascript,await%20new%20Promise(r=>setTimeout(r,300));process.exit(88)';
    const started = supervisor.start({command: `printf '%s\\n' "$NODE_OPTIONS"; sleep 30`, cwd, shell: SHELL, env: {...env(), NODE_OPTIONS: options}});
    assert.ok(started.ok);
    await waitFor(() => text(supervisor, started.task.id).includes(options), 'the original environment reaches the command', 2000);
    assert.deepEqual(supervisor.stop(started.task.id, 'kill'), {ok: true});
    await waitFor(() => supervisor.get(started.task.id)!.state === 'stopped', 'guard cancellation');
    const pending = supervisor.start({command: 'sleep 30', cwd, shell: SHELL, env: {...env(), NODE_OPTIONS: options}});
    assert.ok(pending.ok);
    assert.deepEqual(supervisor.stop(pending.task.id, 'kill'), {ok: true});
    await waitFor(() => supervisor.get(pending.task.id)!.state === 'stopped', 'kill before guard readiness');
  });
});
