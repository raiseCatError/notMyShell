import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {once} from 'node:events';
import {SessionService} from '../src/session/SessionService.js';
import {SocketSessionClient} from '../src/session/SocketSessionClient.js';
import {SessionService as LegacyService} from './fixtures/legacyV2/SessionService.js';
import {SocketSessionClient as LegacyClient} from './fixtures/legacyV2/SocketSessionClient.js';
import {LiveSandbox, until} from './helpers/liveFrontend.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

const signal = () => AbortSignal.timeout(15000);
const options = (sandbox: LiveSandbox, service: {socketPath: string}) => ({
  socketPath: service.socketPath, cwd: sandbox.home, columns: 80, rows: 24,
  env: Object.fromEntries(Object.entries(sandbox.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
});

test('new frontend refuses real legacy v2 service before attach/create; blocked session remains untouched', async () => {
  const sandbox = new LiveSandbox();
  const service = new LegacyService({runtimeDir: sandbox.runtime, startupIdleMs: 60000});
  const answered = join(sandbox.home, 'answered');
  writeFileSync(join(sandbox.home, '.zshrc'), `touch '${join(sandbox.home, "blocked")}'; read -k1 "?LEGACY-BLOCKED> "\nprint "$REPLY" > '${answered}'\n`);
  await service.start();
  try {
    const old = await LegacyClient.connect(options(sandbox, service));
    let output = '';
    old.on('data', data => { output += data; });
    old.start();
    await until(() => existsSync(join(sandbox.home, 'blocked')), 15000, 'old service reaches hidden startup read');
    const id = old.sessionId;
    old.detach();
    await until(() => service.registry[0]?.state === 'detached', 15000, 'legacy detached');
    for (const attach of [id, undefined]) {
      await assert.rejects(SocketSessionClient.connect({...options(sandbox, service), attach}),
        (error: {code?: string}) => error.code === 'startup-safety');
    }
    assert.equal(service.registry.length, 1, 'no extra shell created');
    assert.equal(service.registry[0]!.state, 'detached', 'refusal never takes ownership');
    assert.equal(existsSync(answered), false, 'new frontend sent no startup input');
    // Prove the frozen legacy service really forwards input to the startup read.
    const legacy = await LegacyClient.connect({...options(sandbox, service), attach: id});
    legacy.start();
    legacy.write('y');
    await until(() => existsSync(answered), 15000, 'legacy input answers hidden read');
    legacy.kill();
  } finally { await service.close(); await sandbox.dispose(); }
});

test('legacy frontend with new service cannot answer hidden startup read and queued input executes after readiness', async () => {
  const sandbox = new LiveSandbox();
  const service = new SessionService({runtimeDir: sandbox.runtime, startupIdleMs: 60000});
  const gate = join(sandbox.home, 'gate');
  writeFileSync(join(sandbox.home, '.zshrc'), `print -n 'NEW-BLOCKED> '; while [ ! -f '${gate}' ]; do sleep 0.05; done\n`);
  await service.start();
  try {
    const old = await LegacyClient.connect(options(sandbox, service));
    let executions = 0, output = '';
    old.on('exec', () => executions++);
    old.on('data', data => { output += data; });
    old.start();
    old.submit('echo LEGACY-$((1+1))');
    old.detach();
    await until(() => service.registry[0]?.state === 'detached', 15000, 'queued legacy command detached');
    const resumed = await LegacyClient.connect({...options(sandbox, service), attach: old.sessionId});
    resumed.on('exec', () => executions++);
    resumed.on('data', data => { output += data; });
    resumed.start();
    assert.equal(executions, 0);
    writeFileSync(gate, '');
    await until(() => output.includes('LEGACY-2'), 15000, 'legacy queued command runs');
    assert.equal(executions, 1);
    resumed.kill();
  } finally { await service.close(); await sandbox.dispose(); }
});

test('new service explicitly rejects overflow, retains accepted writes and eventually runs them in order', async () => {
  const sandbox = new LiveSandbox();
  const service = new SessionService({runtimeDir: sandbox.runtime, startupIdleMs: 60000});
  const gate = join(sandbox.home, 'gate');
  writeFileSync(join(sandbox.home, '.zshrc'), `while [ ! -f '${gate}' ]; do sleep 0.05; done\n`);
  await service.start();
  try {
    const client = await SocketSessionClient.connect(options(sandbox, service));
    let output = '';
    const execs: string[] = [], rejected: string[] = [];
    client.on('data', data => { output += data; });
    client.on('exec', command => execs.push(command));
    client.on('inputRejected', data => rejected.push(data));
    client.start();
    const oversized = 'x'.repeat(65537);
    client.write(oversized);
    client.write('echo ACCEPTED-$((1+1))\r');
    const cumulative = 'x'.repeat(65530);
    client.write(cumulative);
    client.write('echo SECOND-$((2+2))\r');
    await until(() => rejected.length === 2, 15000, 'oversized and cumulative overflow responses');
    assert.deepEqual(rejected, [oversized, cumulative]);
    assert.deepEqual(execs, []);
    writeFileSync(gate, '');
    await until(() => output.includes('ACCEPTED-2'), 15000, 'accepted command executes');
    assert.ok(execs.some(command => command.includes('ACCEPTED-')));
    await until(() => output.includes('SECOND-4'), 15000, 'second accepted write executes');
    assert.deepEqual(execs, ['echo ACCEPTED-$((1+1))', 'echo SECOND-$((2+2))']);
    const prompt = once(client, 'prompt', {signal: signal()});
    client.submit('echo AFTER-READY');
    await prompt;
    await until(() => output.includes('AFTER-READY'), 15000, 'post-ready submission works');
    client.kill();
  } finally { await service.close(); await sandbox.dispose(); }
});

test('socket-delayed submission rejection preserves newly typed text and retains rejected command in history', async () => {
  const sandbox = new LiveSandbox();
  const service = new SessionService({runtimeDir: sandbox.runtime, startupIdleMs: 60000});
  writeFileSync(join(sandbox.home, '.zshrc'), 'read -k1 "?Blocked> "\n');
  await service.start();
  let app: TerminalApp | undefined;
  try {
    const client = await SocketSessionClient.connect(options(sandbox, service));
    app = new TerminalApp({client, mode: 'service', sessionId: client.sessionId});
    Object.defineProperty(app, 'render', {value: () => {}});
    const command = 'echo ' + 'x'.repeat(65536);
    app['editor'].insert(command);
    await app['submit']();
    assert.ok(app['running']?.awaitingExec, 'submission awaits service response');
    app['editor'].insert('new text');
    await until(() => app!['running'] === undefined, 15000, 'rejection recovered frontend');
    assert.equal(app['editor'].text, 'new text', 'new composition survives delayed response');
    assert.equal(app['output'].recent(1)?.command, command, 'rejected command remains available in history');
  } finally {
    app?.['stop'](0); app?.['session'].kill();
    await service.close(); await sandbox.dispose();
  }
});
