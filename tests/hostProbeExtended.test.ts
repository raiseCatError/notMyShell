import test from 'node:test';
import assert from 'node:assert/strict';
import {BASELINE_CAPABILITIES} from '../src/host/capabilities.js';
import {DISPLAY_QUERY, HOST_QUERY, TEXT_SIZING_QUERY, probeHost, resolveProbeReplies, takeLateProbeReplies} from '../src/host/probe.js';

/** Replies as a terminal would send them, in the order the queries were written. */
const cpr = (row: number, column: number) => `\u001b[${row};${column}R`;
const options = {extended: true};

test('text sizing detection follows the specification: equal positions mean unsupported', () => {
  const none = resolveProbeReplies(`${cpr(1, 1)}${cpr(1, 1)}${cpr(1, 1)}`, BASELINE_CAPABILITIES, options);
  assert.deepEqual(none.capabilities.textSizing, {width: false, scale: false});
  const both = resolveProbeReplies(`${cpr(1, 1)}${cpr(1, 3)}${cpr(1, 5)}`, BASELINE_CAPABILITIES, options);
  assert.deepEqual(both.capabilities.textSizing, {width: true, scale: true});
  const widthOnly = resolveProbeReplies(`${cpr(1, 1)}${cpr(1, 3)}${cpr(1, 4)}`, BASELINE_CAPABILITIES, options);
  assert.deepEqual(widthOnly.capabilities.textSizing, {width: true, scale: false}, 'a terminal with widths only draws the doubled space one cell wide');
  const scaleOnly = resolveProbeReplies(`${cpr(1, 1)}${cpr(1, 1)}${cpr(1, 3)}`, BASELINE_CAPABILITIES, options);
  assert.deepEqual(scaleOnly.capabilities.textSizing, {width: false, scale: true}, 'scale is detected independently from width');
  const moved = resolveProbeReplies(`${cpr(1, 1)}${cpr(2, 3)}${cpr(2, 5)}`, BASELINE_CAPABILITIES, options);
  assert.deepEqual(moved.capabilities.textSizing, {width: false, scale: false}, 'a row change is no evidence');
});

test('text sizing is left undecided without all three answers, and without the request', () => {
  assert.equal(resolveProbeReplies(`${cpr(1, 1)}${cpr(1, 3)}`, BASELINE_CAPABILITIES, options).capabilities.textSizing, undefined);
  assert.equal(resolveProbeReplies('', BASELINE_CAPABILITIES, options).capabilities.textSizing, undefined);
  const unasked = resolveProbeReplies(`${cpr(1, 1)}${cpr(1, 3)}${cpr(1, 5)}`, BASELINE_CAPABILITIES);
  assert.equal(unasked.capabilities.textSizing, undefined);
  assert.equal(unasked.input, `${cpr(1, 1)}${cpr(1, 3)}${cpr(1, 5)}`, 'when not asked, nothing is consumed');
});

test('probe replies are consumed, and a fourth cursor report or keys typed meanwhile are left for the person', () => {
  const reply = `typed${cpr(1, 1)}${cpr(1, 3)}${cpr(1, 5)}${cpr(9, 9)}\u001b[?62;4;22c\u001b[6;18;9t\u001b[4;900;1200t\u001b[?0u`;
  const result = resolveProbeReplies(reply, BASELINE_CAPABILITIES, options);
  assert.equal(result.input, `typed${cpr(9, 9)}`, 'only our own replies are removed');
  assert.equal(result.capabilities.sixel, true);
  assert.deepEqual(result.capabilities.cellPixels, {width: 9, height: 18});
  assert.deepEqual(result.capabilities.windowPixels, {width: 1200, height: 900});
  assert.equal(result.capabilities.kittyKeyboard, true);
});

test('Sixel needs the terminal to say so; sizes are bounded; a pasted lookalike is not a reply', () => {
  assert.equal(resolveProbeReplies('\u001b[?62;22c', BASELINE_CAPABILITIES, options).capabilities.sixel, undefined);
  assert.equal(resolveProbeReplies('\u001b[6;5000;5000t', BASELINE_CAPABILITIES, options).capabilities.cellPixels, undefined, 'an absurd cell size is ignored');
  assert.equal(resolveProbeReplies('\u001b[6;0;0t', BASELINE_CAPABILITIES, options).capabilities.cellPixels, undefined);
  const pasted = resolveProbeReplies(`\u001b[200~${cpr(1, 1)}${cpr(1, 3)}${cpr(1, 5)}\u001b[?62;4c\u001b[201~`, BASELINE_CAPABILITIES, options);
  assert.equal(pasted.capabilities.textSizing, undefined);
  assert.equal(pasted.capabilities.sixel, undefined);
});

test('the extended batch is written only when asked, on a scratch screen that is left again', async () => {
  const writes: string[] = [];
  const transport = {write: (data: string) => { writes.push(data); }, listen: () => () => {}};
  await probeHost(BASELINE_CAPABILITIES, transport, 1);
  assert.deepEqual(writes, [HOST_QUERY], 'unchanged unless asked');
  await probeHost(BASELINE_CAPABILITIES, transport, 1, {extended: true});
  assert.equal(writes[1], `${TEXT_SIZING_QUERY}${HOST_QUERY}${DISPLAY_QUERY}`);
  assert.ok(TEXT_SIZING_QUERY.startsWith('\u001b[?1049h') && TEXT_SIZING_QUERY.endsWith('\u001b[?1049l'), 'enters and leaves the alternate screen');
  assert.match(TEXT_SIZING_QUERY, /\u001b\]66;w=2; \u001b\\/u);
  assert.match(TEXT_SIZING_QUERY, /\u001b\]66;s=2; \u001b\\/u);
});

test('a real exchange: replies arriving through the transport resolve the capabilities', async () => {
  let receive: (data: string) => void = () => {};
  const transport = {
    write: () => { setImmediate(() => receive(`${cpr(1, 1)}${cpr(1, 3)}${cpr(1, 5)}\u001b[?2026;2$y\u001b[?64;4c\u001b[6;20;10t`)); },
    listen: (callback: (data: string) => void) => { receive = callback; return () => {}; },
  };
  const result = await probeHost(BASELINE_CAPABILITIES, transport, 40, {extended: true});
  assert.deepEqual(result.capabilities.textSizing, {width: true, scale: true});
  assert.equal(result.capabilities.sixel, true);
  assert.equal(result.capabilities.synchronizedOutput, true);
  assert.deepEqual(result.capabilities.cellPixels, {width: 10, height: 20});
  assert.equal(result.input, '');
});

test('the extended probe ends as soon as DA1, its last query, answers', async () => {
  assert.ok(DISPLAY_QUERY.endsWith('\u001b[c'), 'DA1 is the end marker');
  const started = Date.now();
  let listener: (data: string) => void = () => {};
  const transport = {
    listen: (receive: (data: string) => void) => { listener = receive; return () => {}; },
    write: () => { setImmediate(() => listener(`\u001b_Gi=31;OK\u001b\\\u001b[?1u\u001b[?2026;2$y\u001b[6;20;10t\u001b[?62;4c`)); },
  };
  const result = await probeHost({...BASELINE_CAPABILITIES}, transport, undefined, {extended: true, graphics: true});
  assert.ok(Date.now() - started < 60, 'no fixed wait once the marker arrived');
  assert.equal(result.pending, false);
  assert.equal(result.input, '');
  assert.equal(result.capabilities.graphicsProtocol, 'kitty');
});

test('replies later than the probe never become typing and still count as evidence', async () => {
  const transport = {listen: () => () => {}, write: () => {}};
  const result = await probeHost({...BASELINE_CAPABILITIES}, transport, 5, {extended: true, graphics: true});
  assert.equal(result.pending, true, 'the end marker did not arrive');
  assert.equal(result.capabilities.graphicsProtocol, 'none');
  const late = takeLateProbeReplies(`ls\u001b_Gi=31;OK\u001b\\\u001b[?62;4c`, result.capabilities);
  assert.equal(late.capabilities?.graphicsProtocol, 'kitty', 'a late OK still turns native images on');
  assert.equal(late.done, true);
  assert.doesNotMatch(late.input, /Gi=31|OK/, 'the reply is not typed');
  assert.equal(late.input, 'ls', 'keys around it are kept; DA1 is removed too');
  const error = takeLateProbeReplies(`\u001b_Gi=31;ENOTSUPPORTED:x\u001b\\`, {...BASELINE_CAPABILITIES, graphicsProtocol: 'kitty'});
  assert.equal(error.input, ''); assert.equal(error.capabilities, undefined); assert.equal(error.done, false);
});
