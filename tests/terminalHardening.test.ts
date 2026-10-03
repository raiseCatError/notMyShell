import test from 'node:test';
import assert from 'node:assert/strict';
import {AlternateScreenTracker} from '../src/session/TerminalModes.js';
import {probeHost} from '../src/host/probe.js';
import {BASELINE_CAPABILITIES} from '../src/host/capabilities.js';

const push = (flags: string) => `\u001b[>${flags}u`;
const pop = '\u001b[<u';

test('keyboard stack changes preserve wire order and counted pops on reattach', () => {
  const tracker = new AlternateScreenTracker();
  tracker.observeModes(push('1') + push('3') + pop);
  assert.equal(tracker.restoreSequence(), push('1'));
  tracker.observeModes(pop + push('5') + push('7'));
  assert.equal(tracker.restoreSequence(), push('5') + push('7'));
  tracker.observeModes('\u001b[<2u');
  assert.equal(tracker.restoreSequence(), '');
  tracker.observeModes(push(''));
  assert.equal(tracker.restoreSequence(), push('0'), 'omitted push flags default to zero');
});

test('complete mode chunks are never replayed and partial modes cannot cross command reset', () => {
  const tracker = new AlternateScreenTracker();
  tracker.observeModes(push('1'));
  tracker.observeModes('ordinary output');
  assert.equal(tracker.restoreSequence(), push('1'));
  tracker.observeModes('\u001b[?200');
  tracker.reset();
  tracker.observeModes('4h');
  assert.equal(tracker.interactive, false);
  assert.equal(tracker.restoreSequence(), '');
  tracker.observeModes('\u001b[>');
  tracker.observeModes('3u');
  assert.equal(tracker.restoreSequence(), push('3'));
});

test('main and alternate keyboard stacks are independent and memory is bounded', () => {
  const tracker = new AlternateScreenTracker();
  tracker.observeModes(push('1') + '\u001b[?1049h' + push('3'));
  assert.equal(tracker.restoreSequence(), push('3'));
  tracker.observeModes('\u001b[?1049l');
  assert.equal(tracker.restoreSequence(), push('1'));
  for (let i = 0; i < 100; i++) tracker.observeModes(push('7'));
  assert.equal(tracker.restoreSequence(), push('7').repeat(32));
  tracker.observeModes('\u001b[<999u');
  assert.equal(tracker.restoreSequence(), '');
  tracker.observeModes(push('9'.repeat(10000)));
  assert.equal(tracker.restoreSequence(), '', 'oversized flag strings are never retained');
});

test('synchronous buffered probe input still removes its listener and skips late query writes', async () => {
  let removals = 0;
  let writes = 0;
  const input = 'x'.repeat(65536);
  const result = await probeHost(BASELINE_CAPABILITIES, {
    listen: receive => { receive(input); return () => { removals++; }; },
    write: () => { writes++; },
  });
  assert.equal(result.input, input);
  assert.equal(removals, 1);
  assert.equal(writes, 0);
});
