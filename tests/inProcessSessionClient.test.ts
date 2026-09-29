import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InProcessSessionClient} from '../src/session/InProcessSessionClient.js';
import type {SessionClient} from '../src/session/SessionClient.js';
import type {ShellMarker} from '../src/shell/ShellProtocol.js';
import {inForeground, uniqueSleep} from './helpers/processState.js';
import {until} from './helpers/liveFrontend.js';

class FakeShell extends EventEmitter {
  calls: unknown[][] = [];
  submit(c: string) { this.calls.push(['submit', c]); }
  write(d: string) { this.calls.push(['write', d]); }
  interrupt() { this.calls.push(['interrupt']); }
  endInput() { this.calls.push(['endInput']); }
  resize(c: number, r: number) { this.calls.push(['resize', c, r]); }
  kill() { this.calls.push(['kill']); }
}

test('InProcessSessionClient forwards operations and events', () => {
  const fake = new FakeShell();
  let seen;
  const client = new InProcessSessionClient({cwd: '/w', columns: 10, rows: 5}, options => { seen = options; return fake as never; });
  assert.deepEqual(seen, {cwd: '/w', columns: 10, rows: 5});
  const events: unknown[] = [];
  client.on('data', d => events.push(['data', d]));
  client.on('prompt', m => events.push(['prompt', m]));
  client.on('exit', e => events.push(['exit', e]));
  client.submit('ls'); client.write('\u001b[A'); client.interrupt(); client.endInput(); client.resize(99, 33); client.kill();
  assert.deepEqual(fake.calls, [['submit', 'ls'], ['write', '\u001b[A'], ['interrupt'], ['endInput'], ['resize', 99, 33], ['kill']]);
  fake.emit('data', 'out'); fake.emit('prompt', {exitCode: 2, cwd: '/x'}); fake.emit('exit', {exitCode: 0});
  assert.deepEqual(events, [['data', 'out'], ['prompt', {exitCode: 2, cwd: '/x'}], ['exit', {exitCode: 0}]]);
});

function nextPrompt(client: SessionClient): Promise<ShellMarker> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no prompt')), 15000);
    client.once('prompt', m => { clearTimeout(timer); resolve(m); });
  });
}

test('InProcessSessionClient drives a real managed zsh end to end', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-client-home-')));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  let client: InProcessSessionClient | undefined;
  try {
    let output = '';
    client = new InProcessSessionClient({cwd: home, columns: 80, rows: 24});
    client.on('data', d => { output += d; });
    assert.equal((await nextPrompt(client)).cwd, home);

    let prompt = nextPrompt(client);
    client.submit('echo hello-$((40+2))');
    assert.equal((await prompt).exitCode, 0);
    assert.match(output, /hello-42/);

    prompt = nextPrompt(client);
    client.submit('(exit 7)');
    assert.equal((await prompt).exitCode, 7);

    prompt = nextPrompt(client);
    client.submit('cd /');
    assert.equal((await prompt).cwd, '/');

    client.resize(101, 31);
    prompt = nextPrompt(client);
    client.submit('stty size');
    await prompt;
    assert.match(output, /31 101/);

    prompt = nextPrompt(client);
    const interrupted = uniqueSleep(1);
    client.submit(`sleep ${interrupted}`);
    await until(() => inForeground(interrupted), 15000, 'sleep in the foreground');
    client!.interrupt();
    assert.notEqual((await prompt).exitCode, 0);

    prompt = nextPrompt(client);
    const suspended = uniqueSleep(2);
    client.submit(`sleep ${suspended}`);
    await until(() => inForeground(suspended), 15000, 'sleep in the foreground');
    client!.write('\u001a');
    assert.ok((await prompt).exitCode > 128, "suspended by SIGTSTP");
    prompt = nextPrompt(client);
    client.submit('jobs; kill %1');
    await prompt;
    assert.match(output, /suspended|sleep 30/);

    const exited = new Promise<{exitCode: number}>(resolve => client!.once('exit', resolve));
    client.submit('exit 3');
    assert.equal((await exited).exitCode, 3);
    client = undefined;
  } finally {
    client?.kill();
    process.env.HOME = previousHome;
    rmSync(home, {recursive: true, force: true});
  }
});
