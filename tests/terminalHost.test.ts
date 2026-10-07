import test from 'node:test';
import assert from 'node:assert/strict';
import {BASELINE_CAPABILITIES, resolveHostCapabilities} from '../src/host/capabilities.js';
import {probeHost, resolveProbeReplies} from '../src/host/probe.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {KeyDecoder} from '../src/terminal/keys.js';

test('unknown and Terminal.app attachments use a complete keyboard-only baseline', () => {
  for (const env of [{}, {TERM_PROGRAM: 'Apple_Terminal'}, {TERM_PROGRAM: 'ghostty', STY: 'screen'}]) {
    assert.deepEqual(resolveHostCapabilities(env), BASELINE_CAPABILITIES);
    const writes: string[] = [];
    const renderer = new TerminalRenderer(data => writes.push(data), resolveHostCapabilities(env));
    renderer.enter();
    renderer.render({rows: ['plain'], cursorRow: 1, cursorColumn: 1});
    renderer.suspendForPassthrough();
    renderer.resumeAfterPassthrough();
    renderer.leave();
    // Optional protocols are never enabled. After a foreground app the renderer still releases mouse modes
    // and pops keyboard entries (idempotent resets) so a killed app cannot leave them on; see terminalModeReconciliation.test.ts.
    assert.doesNotMatch(writes.join(''), /\u001b\[(?:[<>]1?u|\?100[036]h|\?2026[hl])/u);
    assert.doesNotMatch(writes.slice(0, 2).join(''), /\u001b\[\?100[036]l/u, 'no mouse resets before any foreground app');
    assert.match(writes.join(''), /plain/u);
  }
  assert.deepEqual(new KeyDecoder().push('\n\u0017\u0012\u001bOP\u000f'),
    ['newline', 'deleteWord', 'historySearch', 'palette', 'toggleDetails'].map(kind => ({kind})));
});

test('reply evidence wins over hints and preserves text and bracketed pastes', () => {
  const pasted = '\u001b[200~\u001b[?8u\u001b[?2026;1$y\u001b[201~';
  const result = resolveProbeReplies(`early${pasted}\u001b[?0u\u001b[?2026;2$y\r`, BASELINE_CAPABILITIES);
  assert.equal(result.input, `early${pasted}\r`);
  assert.equal(result.capabilities.kittyKeyboard, true);
  assert.equal(result.capabilities.synchronizedOutput, true);
  assert.equal(resolveProbeReplies('\u001b[?2026;0$y', {...BASELINE_CAPABILITIES, synchronizedOutput: true}).capabilities.synchronizedOutput, false);
});

test('silent, split-reply and failed transports always remove their listener', async () => {
  for (const behavior of ['silent', 'split', 'failed']) {
    let receive = (_data: string) => {};
    let removed = 0;
    const before = performance.now();
    const result = await probeHost(BASELINE_CAPABILITIES, {
      listen: callback => { receive = callback; return () => { removed++; }; },
      write: () => {
        if (behavior === 'failed') throw new Error('closed output');
        if (behavior === 'split') { receive('x\u001b[?'); receive('0u\u001b[?2026;1$y'); }
      },
    }, 5);
    assert.equal(removed, 1);
    assert.ok(performance.now() - before < 500);
    assert.equal(result.input, behavior === 'split' ? 'x' : '');
    assert.equal(result.capabilities.kittyKeyboard, behavior === 'split');
  }
});

test('reattach creates independent capabilities without changing the previous host', () => {
  const previous = resolveHostCapabilities({TERM_PROGRAM: 'ghostty'});
  const next = resolveHostCapabilities({TERM_PROGRAM: 'Apple_Terminal'});
  assert.equal(previous.kittyKeyboard, true);
  assert.equal(next.kittyKeyboard, false);
  next.hyperlinks = true;
  assert.equal(BASELINE_CAPABILITIES.hyperlinks, false);
});

test('synchronized redraw closes on exceptions; suspended renderer never paints or pops twice', () => {
  const writes: string[] = [];
  let fail = false;
  const renderer = new TerminalRenderer(data => {
    writes.push(data);
    if (fail && data.includes('2026h')) throw new Error('write failed');
  }, {...BASELINE_CAPABILITIES, synchronizedOutput: true, kittyKeyboard: true});
  renderer.enter();
  fail = true;
  assert.throws(() => renderer.render({rows: ['output'], cursorRow: 1, cursorColumn: 1}));
  assert.equal(writes.at(-1), '\u001b[?2026l');
  renderer.suspendForPassthrough();
  const count = writes.length;
  renderer.render({rows: ['hidden'], cursorRow: 1, cursorColumn: 1});
  renderer.suspendForPassthrough();
  assert.equal(writes.length, count);
  renderer.leave();
  assert.equal(writes.join('').split('\u001b[<u').length - 1, 1);
});
