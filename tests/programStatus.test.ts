import test from 'node:test';
import assert from 'node:assert/strict';
import {HostProgramStatus, osc7501, programStatusSupported} from '../src/host/programStatus.js';
import {semanticSupport} from '../src/host/semanticMarks.js';
import {detectTerminalHost} from '../src/host/terminalHost.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * OSC 7501 program status: an optional projection for hosts that document it (Rex). It reports only what NMSh has
 * evidence for, always in NMSh's own record (`id=nmsh`), only on change, and never carries a command line or typing.
 */

const decode = (sequence: string) => {
  const match = /^\u001B\]7501;(.*)\u001B\\$/u.exec(sequence);
  assert.ok(match, `a well-formed report: ${JSON.stringify(sequence)}`);
  return Object.fromEntries(match[1]!.split(':').map(pair => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)] as [string, string]));
};

test('support: Rex only, never inside tmux or screen; NMSH_PROGRAM_STATUS overrides', () => {
  assert.equal(programStatusSupported({TERM_PROGRAM: 'rex', TERM: 'xterm-256color'}), true);
  assert.equal(programStatusSupported({TERM_PROGRAM: 'rex', TMUX: '/tmp/tmux,1,0'}), false);
  assert.equal(programStatusSupported({TERM_PROGRAM: 'rex', STY: '1.pts'}), false);
  assert.equal(programStatusSupported({TERM_PROGRAM: 'ghostty'}), false);
  assert.equal(programStatusSupported({}), false);
  assert.equal(programStatusSupported({TERM_PROGRAM: 'ghostty', NMSH_PROGRAM_STATUS: '1'}), true);
  assert.equal(programStatusSupported({TERM_PROGRAM: 'rex', NMSH_PROGRAM_STATUS: '0'}), false);
});

test('Rex gets OSC 133 and OSC 7 and is named; nothing else about other hosts changes', () => {
  assert.deepEqual(semanticSupport({TERM_PROGRAM: 'rex', TERM: 'xterm-256color'}), {marks: true, cwd: true});
  assert.deepEqual(semanticSupport({TERM_PROGRAM: 'rex', NMSH_SEMANTIC: '0'}), {marks: false, cwd: false});
  assert.deepEqual(semanticSupport({TERM_PROGRAM: 'SomethingElse'}), {marks: false, cwd: false});
  const host = detectTerminalHost({TERM_PROGRAM: 'rex', TERM: 'xterm-256color'}, 'darwin');
  assert.equal(host.name, 'Rex');
  assert.equal(host.newWindow, undefined, 'NMSh opens no Rex blocks or windows');
});

test('reports follow the protocol: own record, required state, base64 text without control characters, within limits', () => {
  assert.deepEqual(decode(osc7501({state: 'working'})), {state: 'working', id: 'nmsh', app: 'nmsh', title: Buffer.from('NMSh').toString('base64')});
  const blocked = decode(osc7501({state: 'blocked', kind: 'auth', message: 'A program is waiting\nfor hidden input'}));
  assert.equal(blocked.kind, 'auth');
  assert.equal(Buffer.from(blocked.msg!, 'base64').toString('utf8'), 'A program is waiting for hidden input');
  assert.deepEqual(decode(osc7501(undefined)), {state: 'clear', id: 'nmsh'}, 'clearing removes only NMSh\'s record, never the root or every record');
  for (const sequence of [osc7501({state: 'error', message: 'x'.repeat(100)}), osc7501({state: 'working'})]) {
    assert.ok(sequence.length < 4096);
    for (const [name, value] of Object.entries(decode(sequence))) {
      assert.match(name, /^[a-z]+$/u);
      assert.match(value, /^[A-Za-z0-9_.,+/=-]*$/u);
    }
  }
});

test('written only on change, only while NMSh owns the screen (except a command start), cleared once at the end', () => {
  const written: string[] = [];
  let owned = true;
  const status = new HostProgramStatus(true, data => { written.push(data); }, () => owned);
  status.set(undefined);
  assert.deepEqual(written, [], 'an idle NMSh writes nothing at all');
  status.set({state: 'working'});
  status.set({state: 'working'});
  assert.equal(written.length, 1);
  owned = false;
  status.set({state: 'blocked', kind: 'question', message: 'm'});
  assert.equal(written.length, 1, 'held while a program owns the screen');
  status.set({state: 'working'}, true);
  assert.equal(written.length, 1, 'unchanged');
  owned = true;
  status.forget();
  status.set({state: 'working'});
  assert.equal(written.length, 2, 'a new prompt zone may have dropped it: resent');
  status.end();
  status.end();
  assert.equal(decode(written.at(-1)!).state, 'clear');
  assert.equal(written.length, 3, 'cleared once');
  const off: string[] = [];
  const unsupported = new HostProgramStatus(false, data => { off.push(data); }, () => true);
  unsupported.set({state: 'working'}); unsupported.end();
  assert.deepEqual(off, [], 'an unsupported host gets nothing');
});

test('TerminalApp: each state comes from NMSh evidence; the command line and typing never reach the host', async () => {
  const frame = executionFrameFixture(100, 30);
  const written: string[] = [];
  Object.defineProperty(frame.app, 'hostProgramStatus', {value: new HostProgramStatus(true, (data: string) => { written.push(data); }, () => true)});
  const states = () => written.map(decode).map(fields => fields.kind ? `${fields.state}:${fields.kind}` : fields.state);
  try {
    frame.capture();
    assert.deepEqual(states(), [], 'idle at the prompt: nothing');
    frame.begin('curl -u user:hunter2 https://example.test');
    frame.capture();
    frame.session.emit('inputState', {request: {since: Date.now(), confidence: 'likely', mode: 'hidden'}, timing: {waitedMs: 0, waits: 0}});
    frame.capture();
    assert.deepEqual(states(), ['working'], 'a likely request is no evidence');
    frame.session.emit('inputState', {request: {since: Date.now(), confidence: 'confirmed', mode: 'hidden'}, timing: {waitedMs: 0, waits: 0}});
    frame.capture();
    frame.session.emit('inputState', {timing: {waitedMs: 0, waits: 0}});
    frame.capture();
    frame.complete(0);
    frame.capture();
    assert.deepEqual(states(), ['working', 'blocked:auth', 'working', 'clear']);
    frame.session.emit('queueState', {entries: [{id: 1, text: 'echo held', addedAt: 1, condition: 'approve', typedWhile: 'sleep'}]}, {});
    frame.capture();
    frame.session.emit('queueState', {entries: [{id: 2, text: 'make', addedAt: 2}], paused: {reason: 'failed', at: 3, command: 'false', exitCode: 1}}, {});
    frame.capture();
    frame.session.emit('queueState', {entries: [{id: 2, text: 'make', addedAt: 2}], paused: {reason: 'user', at: 4}}, {});
    frame.capture();
    assert.deepEqual(states().slice(4), ['blocked:permission', 'error', 'clear'], 'a pause the person asked for is no error');
    const text = written.map(sequence => Object.values(decode(sequence)).map(value => {
      try { return Buffer.from(value, 'base64').toString('utf8'); } catch { return ''; }
    }).join(' ')).join('\n');
    for (const secret of ['hunter2', 'curl', 'echo held', 'make']) assert.equal(text.includes(secret), false, `${secret} never reaches the host`);
    frame.session.emit('queueState', {entries: [{id: 3, text: 'echo held', addedAt: 5, condition: 'approve', typedWhile: 'sleep'}]}, {});
    frame.capture();
    frame.app['stop'](0);
    assert.deepEqual(states().slice(7), ['blocked:permission', 'clear'], 'NMSh stopping removes its record');
  } finally { frame.dispose(); }
});
