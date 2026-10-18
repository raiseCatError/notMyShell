import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nextLevel, taskOpFrom, taskUpdateFrom, tasksFrom, type TaskUpdate} from '../src/backgroundTasks/protocol.js';
import {TaskOutput} from '../src/backgroundTasks/output.js';
import {SessionTasks, type TaskListener} from '../src/backgroundTasks/sessionTasks.js';
import type {TaskRecord} from '../src/backgroundTasks/supervisor.js';
import {SessionService} from '../src/session/SessionService.js';
import {SocketSessionClient} from '../src/session/SocketSessionClient.js';
import {decodeMessage, encodeMessage, SERVICE_FEATURES, CLIENT_FEATURES} from '../src/session/SessionProtocol.js';
import {socketPathFor} from '../src/session/runtimeDir.js';

async function until(check: () => boolean, timeoutMs = 10000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${what} not reached`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  chmodSync(dir, 0o700);
  return dir;
}

test('task requests are validated before anything runs: ids, levels, sizes, blank commands', () => {
  assert.deepEqual(taskOpFrom(JSON.stringify({op: 'start', command: 'adb logcat', cwd: '/tmp', family: 'adb logcat', path: '/usr/bin'})),
    {op: 'start', command: 'adb logcat', cwd: '/tmp', family: 'adb logcat', path: '/usr/bin'});
  assert.deepEqual(taskOpFrom(JSON.stringify({op: 'stop', id: 't3', level: 'terminate'})), {op: 'stop', id: 't3', level: 'terminate'});
  for (const bad of [{op: 'start', command: '   ', cwd: '/'}, {op: 'stop', id: 't3', level: 'nuke'}, {op: 'remove', id: '3'}, {op: 'stop', id: '../t1', level: 'kill'},
    {op: 'start', command: 'x'.repeat(70_000), cwd: '/'}, {op: 'run', id: 't1'}, ['op']]) {
    assert.equal(taskOpFrom(JSON.stringify(bad)), undefined, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(taskOpFrom('{not json'), undefined);
  const record = {id: 't1', command: 'ping x', cwd: '/', shell: '/bin/sh', startedAt: 1, state: 'running'};
  assert.deepEqual(tasksFrom(JSON.stringify([record])), [record]);
  assert.equal(tasksFrom(JSON.stringify([{...record, state: 'zombie'}])), undefined);
  assert.equal(tasksFrom(JSON.stringify([{...record, leftovers: 'yes'}])), undefined);
  assert.equal(taskUpdateFrom(JSON.stringify({lines: [{seq: 2, text: 'b'}, {seq: 1, text: 'a'}], partial: '', dropped: 0, received: 2})), undefined, 'seq must increase');
  assert.equal(nextLevel({...record, state: 'running'} as TaskRecord), 'interrupt');
  assert.equal(nextLevel({...record, state: 'stopping', stopRequested: 'terminate'} as TaskRecord), 'kill');
  assert.equal(nextLevel({...record, state: 'stopping', stopRequested: 'kill'} as TaskRecord), undefined);
});

test('the protocol carries task messages only as negotiated features, and their frames decode', () => {
  assert.ok((SERVICE_FEATURES as readonly string[]).includes('background-tasks'));
  assert.ok((CLIENT_FEATURES as readonly string[]).includes('background-tasks'));
  for (const message of [{type: 'task', change: '{}'}, {type: 'tasks', state: '[]'}, {type: 'task-output', taskId: 't1', update: '{}'}] as const) {
    const decoded = decodeMessage(encodeMessage(message).trimEnd());
    assert.ok(decoded.ok, message.type);
  }
  assert.equal(decodeMessage(encodeMessage({type: 'task-output', taskId: 't1'} as never).trimEnd()).ok, false);
});

test('a mirrored output keeps the owner\'s line numbers, never takes a line twice, and counts what it never received', () => {
  const mirror = new TaskOutput({lines: 3, bytes: 1 << 20});
  mirror.receive({lines: [{seq: 5, text: 'five'}, {seq: 6, text: 'six\u001B]0;PWNED\u0007'}], partial: 'prog\u001B[2K', dropped: 4, received: 100});
  assert.deepEqual(mirror.lines().map(line => line.text), ['five', 'six'], 'escape sequences are removed again on arrival');
  assert.equal(mirror.partial(), 'prog');
  assert.equal(mirror.dropped, 4);
  mirror.receive({lines: [{seq: 6, text: 'six'}, {seq: 7, text: 'seven'}, {seq: 8, text: 'eight'}], partial: '', dropped: 4, received: 120});
  assert.deepEqual(mirror.lines().map(line => line.seq), [6, 7, 8], 'bounded by the same limits; seq 6 was not added twice');
  assert.equal(mirror.lastSeq, 8);
  assert.equal(mirror.dropped, 5);
});

test('session tasks: own terminals, output beside the shell, reattach replays the list and recent output, removal only when finished', async () => {
  const cwd = scratch('nt-bgs-');
  const events: {tasks: TaskRecord[][]; output: Map<string, TaskUpdate[]>} = {tasks: [], output: new Map()};
  const listener: TaskListener = {tasks: records => events.tasks.push(records), output: (id, update) => events.output.set(id, [...(events.output.get(id) ?? []), update])};
  const tasks = new SessionTasks({shell: () => '/bin/sh', env: () => ({PATH: '/usr/bin:/bin', HOME: cwd})});
  try {
    tasks.attach(listener);
    assert.deepEqual(events.tasks.at(-1), []);
    assert.equal(tasks.request({op: 'start', command: "printf 'alpha\\nbeta\\n'; echo \"$PATH\"", cwd, path: '/bin:/usr/bin'}), undefined);
    await until(() => events.tasks.at(-1)?.[0]?.state === 'exited', 10000, 'task exit');
    const text = (events.output.get('t1') ?? []).flatMap(update => update.lines.map(line => line.text));
    assert.deepEqual(text.slice(0, 3), ['alpha', 'beta', '/bin:/usr/bin'], 'the live PATH is the task\'s PATH');
    assert.equal(tasks.request({op: 'start', command: 'sleep 30', cwd}), undefined);
    await until(() => events.tasks.at(-1)?.some(task => task.id === 't2' && task.state === 'running') ?? false, 10000, 'second task');
    assert.match(tasks.request({op: 'remove', id: 't2'}) ?? '', /running task/u);
    // A new window attaches: the whole list and each task's recent output, nothing started again.
    const replay: {tasks: TaskRecord[][]; lines: string[]} = {tasks: [], lines: []};
    tasks.attach({tasks: records => replay.tasks.push(records), output: (_id, update) => replay.lines.push(...update.lines.map(line => line.text))});
    assert.deepEqual(replay.tasks[0]?.map(task => task.id), ['t1', 't2']);
    assert.ok(replay.lines.includes('alpha'));
    assert.equal(tasks.request({op: 'stop', id: 't2', level: 'interrupt'}), undefined);
    await until(() => tasks.list().find(task => task.id === 't2')?.state === 'stopped', 10000, 'stopped by SIGINT');
    assert.equal(tasks.request({op: 'remove', id: 't1'}), undefined);
    assert.deepEqual(tasks.list().map(task => task.id), ['t2']);
    assert.match(tasks.request({op: 'start', command: 'true', cwd: join(cwd, 'missing')}) ?? '', /directory/u);
  } finally { await tasks.shutdown(); rmSync(cwd, {recursive: true, force: true}); }
  assert.match(tasks.request({op: 'start', command: 'true', cwd}) ?? '', /ended/u, 'nothing starts after the session ended');
});

test('service: a frontend starts a task, its output never enters the shell stream, and a reattached window gets it back', async () => {
  const base = scratch('nt-bgsvc-');
  const runtimeDir = join(base, 'rt');
  const home = join(base, 'h');
  const service = new SessionService({runtimeDir, startupIdleMs: 60000});
  await service.start();
  const options = {socketPath: socketPathFor(runtimeDir), cwd: base, columns: 80, rows: 24, env: {...process.env, HOME: home, ZDOTDIR: home} as Record<string, string>, timeoutMs: 15000};
  let shellOutput = '';
  const lines: string[] = [];
  let records: readonly TaskRecord[] = [];
  const client = await SocketSessionClient.connect(options);
  try {
    assert.ok(client.features.has('background-tasks'));
    client.on('data', data => { shellOutput += data; });
    client.on('tasks', next => { records = next; });
    client.on('taskOutput', (_id, update) => lines.push(...update.lines.map(line => line.text)));
    const refusals: string[] = [];
    client.on('taskRefused', reason => refusals.push(reason));
    client.start();
    client.task!({op: 'start', command: 'printf "TASK-%s\\n" ONLY', cwd: base});
    await until(() => records[0]?.state === 'exited' && lines.includes('TASK-ONLY'), 15000, 'task output');
    assert.ok(!shellOutput.includes('TASK-ONLY'), 'task output never reaches the shell\'s stream');
    client.task!({op: 'stop', id: 't9', level: 'interrupt'});
    await until(() => refusals.length > 0, 5000, 'refusal');
    assert.match(refusals[0]!, /no such task/u);
    const id = client.sessionId;
    client.detach();
    const again = await SocketSessionClient.connect({...options, attach: id});
    const replayed: string[] = [];
    let replayedTasks: readonly TaskRecord[] = [];
    again.on('tasks', next => { replayedTasks = next; });
    again.on('taskOutput', (_id, update) => replayed.push(...update.lines.map(line => line.text)));
    again.start();
    await until(() => replayed.includes('TASK-ONLY'), 15000, 'replay after reattach');
    assert.deepEqual(replayedTasks.map(task => task.id), ['t1']);
    again.kill();
  } finally { await service.close(); rmSync(base, {recursive: true, force: true}); }
});
