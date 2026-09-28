import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PROTOCOL_VERSION, FrameDecoder, decodeMessage, encodeMessage, type ProtocolMessage} from '../src/session/SessionProtocol.js';

const samples: ProtocolMessage[] = [
  {type: 'hello', version: PROTOCOL_VERSION, client: 'nmsh'},
  {type: 'create', cwd: '/tmp/x y', env: {A: '1', 'WEIRD KEY': 'v\n\u0000'}, columns: 80, rows: 24},
  {type: 'attach', sessionId: 's1', columns: 90, rows: 30},
  {type: 'detach'},
  {type: 'list'},
  {type: 'input', data: 'ls\r\u0003\u001a\u0004'},
  {type: 'resize', columns: 120, rows: 40},
  {type: 'terminate'},
  {type: 'welcome', version: PROTOCOL_VERSION, service: 'nmshd'},
  {type: 'error', code: 'version', message: 'nope'},
  {type: 'created', sessionId: 's1', pid: 42},
  {type: 'attached', sessionId: 's1', pid: 42, cwd: '/tmp', fullscreen: 0},
  {type: 'attached', sessionId: 's1', pid: 42, cwd: '/tmp', fullscreen: 1, running: 'vim x', runningSince: 1700000000000},
  {type: 'detached', sessionId: 's1'},
  {type: 'sessions', sessions: []},
  {type: 'sessions', sessions: [{id: 's1', pid: 42, state: 'detached', cwd: '/w', createdAt: 1, running: 'sleep 9', runningSince: 2},
    {id: 's2', pid: 43, state: 'attached', cwd: '/', createdAt: 3}]},
  {type: 'output', data: '\u001b[?1049h\u001b[31mred\u001b[0m\r\n\u0007\u001b]777;x\u0007😀'},
  {type: 'prompt', exitCode: 130, cwd: '/tmp'},
  {type: 'exit', exitCode: 0},
  {type: 'exit', exitCode: 1, signal: 9},
];

test('protocol version is explicit on every frame', () => {
  assert.equal(PROTOCOL_VERSION, 2);
  assert.equal(JSON.parse(encodeMessage({type: 'terminate'})).v, PROTOCOL_VERSION);
});

test('v1 frames are refused: a v1 service ends shells on disconnect, so it must never serve a v2 frontend', () => {
  assert.equal(decodeMessage('{"v":1,"type":"hello","version":1,"client":"nmsh"}').ok, false);
});

test('every message round-trips unchanged, including control and escape bytes', () => {
  for (const message of samples) {
    const frame = encodeMessage(message);
    assert.equal(frame.indexOf('\n'), frame.length - 1, 'only the terminator is a raw newline');
    assert.deepEqual(decodeMessage(frame.slice(0, -1)), {ok: true, message});
  }
});

test('malformed and incompatible frames are rejected without partial state', () => {
  for (const frame of ['', '{', 'null', '[]', '"x"', '{"type":"input","data":"x"}',
    '{"v":3,"type":"input","data":"x"}', '{"v":2,"type":"bogus"}', '{"v":2,"type":"__proto__"}',
    '{"v":2,"type":"input","data":5}', '{"v":2,"type":"resize","columns":1.5,"rows":2}',
    '{"v":2,"type":"create","cwd":"/","env":{"A":1},"columns":1,"rows":1}',
    '{"v":2,"type":"attach","sessionId":"s"}',
    '{"v":2,"type":"sessions","sessions":{}}',
    '{"v":2,"type":"sessions","sessions":[{"id":"s","pid":1,"state":"zombie","cwd":"/","createdAt":1}]}',
    '{"v":2,"type":"sessions","sessions":[{"id":"s","pid":"1","state":"attached","cwd":"/","createdAt":1}]}']) {
    assert.equal(decodeMessage(frame).ok, false, frame);
  }
  const listed = decodeMessage('{"v":2,"type":"sessions","sessions":[{"id":"s","pid":1,"state":"detached","cwd":"/","createdAt":1,"env":{"SECRET":"x"}}]}');
  assert.deepEqual(listed, {ok: true, message: {type: 'sessions', sessions: [{id: 's', pid: 1, state: 'detached', cwd: '/', createdAt: 1}]}});
  const decoded = decodeMessage('{"v":2,"type":"input","data":"x","extra":{"__proto__":{"polluted":1}}}');
  assert.deepEqual(decoded, {ok: true, message: {type: 'input', data: 'x'}});
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('frame decoder handles fragments, batched frames, and contains malformed ones', () => {
  const stream = samples.map(encodeMessage).join('') + 'garbage\n' + encodeMessage({type: 'terminate'});
  const decoder = new FrameDecoder();
  const results = [];
  for (let i = 0; i < stream.length; i += 7) results.push(...decoder.push(stream.slice(i, i + 7)));
  assert.equal(results.length, samples.length + 2);
  assert.deepEqual(results.slice(0, samples.length).map(r => r.ok && r.message), samples);
  assert.equal(results[samples.length]!.ok, false);
  assert.deepEqual(results.at(-1), {ok: true, message: {type: 'terminate'}});
  assert.equal(new FrameDecoder().push(stream).length, samples.length + 2);
});

test('TerminalApp talks to the shell only through SessionClient', async () => {
  const source = await readFile(new URL('../src/app/TerminalApp.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /ShellSession|node-pty/);
  assert.match(source, /private readonly session: SessionClient;/);
});
