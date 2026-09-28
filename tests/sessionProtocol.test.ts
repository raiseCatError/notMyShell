import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PROTOCOL_VERSION, FrameDecoder, decodeMessage, encodeMessage, type ProtocolMessage} from '../src/session/SessionProtocol.js';

const samples: ProtocolMessage[] = [
  {type: 'hello', version: PROTOCOL_VERSION, client: 'nmsh'},
  {type: 'create', cwd: '/tmp/x y', env: {A: '1', 'WEIRD KEY': 'v\n\u0000'}, columns: 80, rows: 24},
  {type: 'attach', sessionId: 's1'},
  {type: 'detach', sessionId: 's1'},
  {type: 'input', data: 'ls\r\u0003\u001a\u0004'},
  {type: 'resize', columns: 120, rows: 40},
  {type: 'terminate'},
  {type: 'welcome', version: PROTOCOL_VERSION, service: 'nmshd'},
  {type: 'error', code: 'version', message: 'nope'},
  {type: 'created', sessionId: 's1', pid: 42},
  {type: 'attached', sessionId: 's1'},
  {type: 'detached', sessionId: 's1'},
  {type: 'output', data: '\u001b[?1049h\u001b[31mred\u001b[0m\r\n\u0007\u001b]777;x\u0007😀'},
  {type: 'prompt', exitCode: 130, cwd: '/tmp'},
  {type: 'exit', exitCode: 0},
  {type: 'exit', exitCode: 1, signal: 9},
];

test('protocol version is explicit on every frame', () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(JSON.parse(encodeMessage({type: 'terminate'})).v, PROTOCOL_VERSION);
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
    '{"v":2,"type":"input","data":"x"}', '{"v":1,"type":"bogus"}', '{"v":1,"type":"__proto__"}',
    '{"v":1,"type":"input","data":5}', '{"v":1,"type":"resize","columns":1.5,"rows":2}',
    '{"v":1,"type":"create","cwd":"/","env":{"A":1},"columns":1,"rows":1}']) {
    assert.equal(decodeMessage(frame).ok, false, frame);
  }
  const decoded = decodeMessage('{"v":1,"type":"input","data":"x","extra":{"__proto__":{"polluted":1}}}');
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
