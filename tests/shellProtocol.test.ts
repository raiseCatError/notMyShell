import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_MARKER_PAYLOAD, ShellProtocolDecoder} from '../src/shell/ShellProtocol.js';

test('extracts split shell markers without leaking them into output', () => {
  const decoder = new ShellProtocolDecoder('token');
  assert.deepEqual(decoder.push('hello\u001B]777;nmsh;tok'), [{kind: 'data', data: 'hello'}]);
  assert.deepEqual(decoder.push('en;65;/tmp/project\u0007'), [
    {kind: 'marker', marker: {exitCode: 65, cwd: '/tmp/project'}},
  ]);
});

test('an unterminated or oversized marker keeps memory bounded, and output after it still flows', () => {
  const PREFIX = '\u001B]777;nmsh;token;';
  const bound = PREFIX.length + MAX_MARKER_PAYLOAD;
  const decode = (chunks: string[]) => {
    const decoder = new ShellProtocolDecoder('token');
    const events = chunks.flatMap(chunk => {
      const result = decoder.push(chunk);
      assert.ok(decoder.retainedLength <= bound, `retained ${decoder.retainedLength}`);
      return result;
    });
    return {decoder, events};
  };
  const body = 'x'.repeat(64 * 1024);
  // Unterminated: 4 MiB in 64 KiB reads stays at the bound.
  const {decoder} = decode([`a${PREFIX}0;`, ...Array.from({length: 64}, () => body)]);
  assert.ok(decoder.retainedLength <= bound);
  // An oversized prompt marker is dropped; data after its BEL flows again, split or not.
  for (const split of [false, true]) {
    const tail = `${'y'.repeat(MAX_MARKER_PAYLOAD + 10)}\u0007after`;
    const chunks = split ? [`${PREFIX}0;/`, tail.slice(0, MAX_MARKER_PAYLOAD), tail.slice(MAX_MARKER_PAYLOAD)] : [`${PREFIX}0;/${tail}`];
    const {events} = decode(chunks);
    assert.deepEqual(events.filter(event => event.kind !== 'data'), [], `no prompt marker from a truncated cwd (split ${split})`);
    assert.equal(events.filter(event => event.kind === 'data').map(event => (event as {data: string}).data).join(''), 'after');
  }
  // An oversized command line still reports the command start, truncated to the bound.
  const long = 'z'.repeat(MAX_MARKER_PAYLOAD + 100);
  const {events} = decode([`${PREFIX}exec2;1;`, long.slice(0, 500_000), long.slice(500_000), '\u0007next']);
  const exec = events.find(event => event.kind === 'exec') as {command: string; historyAllowed: number};
  assert.equal(exec.command.length, MAX_MARKER_PAYLOAD - 8);
  assert.equal(exec.historyAllowed, 1);
  assert.deepEqual(events.at(-1), {kind: 'data', data: 'next'});
  // Ordinary markers at the bound are unchanged.
  const cwd = `/${'d'.repeat(MAX_MARKER_PAYLOAD - 3)}`;
  assert.deepEqual(decode([`${PREFIX}0;${cwd}\u0007`]).events, [{kind: 'marker', marker: {exitCode: 0, cwd}}]);
});
