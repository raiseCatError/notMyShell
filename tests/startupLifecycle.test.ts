import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {SessionClient, SessionClientEvents} from '../src/session/SessionClient.js';

class ControlledSession extends EventEmitter<SessionClientEvents> implements SessionClient {
  submitted: string[] = [];
  start() {} submit(command: string) { this.submitted.push(command); }
  write() {} interrupt() {} endInput() {} resize() {} kill() {} detach() {} ack() {}
}

test('initial bootstrap prompt never completes an early submitted command; its own exec/prompt does', async () => {
  const client = new ControlledSession();
  const app = new TerminalApp({client, mode: 'in-process'});
  app['render'] = () => {};
  try {
    app['editor'].insert('print READY'); await app['submit']();
    client.emit('prompt', {exitCode: 0, cwd: process.cwd()}, {});
    assert.equal(app['running']?.command, 'print READY');
    assert.equal(app['output'].transcript().records.length, 0);
    client.emit('exec', 'print READY', {historyAllowed: 1});
    client.emit('data', 'READY\r\n', {});
    client.emit('prompt', {exitCode: 0, cwd: process.cwd()}, {});
    const records = app['output'].transcript().records;
    assert.equal(records.length, 1);
    assert.equal(records[0]!.command, 'print READY');
    assert.match(records[0]!.output, /READY/);
  } finally { app['stop'](0); client.kill(); }
});

test('a real first exec and syntax failure after bootstrap still complete normally', async () => {
  const client = new ControlledSession();
  const app = new TerminalApp({client, mode: 'in-process'});
  app['render'] = () => {};
  try {
    client.emit('exec', 'print attached', {historyAllowed: 1});
    client.emit('prompt', {exitCode: 0, cwd: process.cwd()}, {});
    assert.equal(app['output'].transcript().records.length, 1);
    app['editor'].insert(')'); await app['submit']();
    client.emit('prompt', {exitCode: 1, cwd: process.cwd()}, {});
    assert.equal(app['output'].transcript().records[0]!.exitCode, 1);
    assert.equal(app['running'], undefined);
  } finally { app['stop'](0); client.kill(); }
});

test('live fixture run waits for the command journal instead of matching echoed input', async () => {
  const sandbox = new LiveSandbox();
  const gate = join(sandbox.home, 'gate');
  let running: Promise<void> | undefined;
  try {
    const frontend = sandbox.launch(); await frontend.waitFor(/❯/);
    let settled = false;
    running = frontend.run(`while [[ ! -f '${gate}' ]]; do sleep .05; done; print JOURNAL-READY`, /JOURNAL-READY/);
    void running.then(() => { settled = true; });
    await until(async () => (await sandbox.sessions()).some(session => session.running?.includes('JOURNAL-READY')), 15000, 'gated command');
    assert.equal(settled, false, 'the submitted command contains the expected text but has not finished');
    writeFileSync(gate, ''); await running;
  } finally { writeFileSync(gate, ''); await running?.catch(() => {}); await sandbox.dispose(); }
});
