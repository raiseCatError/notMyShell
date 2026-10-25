import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {syncBuiltinESMExports} from 'node:module';
import {selectedText} from '../src/output/TranscriptSelection.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

test('a burst records every output chunk in order but paints one pending frame', context => {
  const f = executionFrameFixture();
  context.mock.timers.enable({apis: ['setTimeout']});
  try {
    f.begin('printf burst');
    let paints = 0;
    f.app['renderer'].render = () => { paints++; };
    for (let i = 0; i < 200; i++) f.app['onShellData'](`line ${i}\r\n`);
    assert.equal(paints, 0, 'output bursts should not repaint for every PTY chunk');
    assert.equal(f.app['output'].view().lines.length, 201, 'parsing stays synchronous');
    context.mock.timers.tick(16);
    assert.equal(paints, 1);
    f.complete();
    assert.equal(f.app['output'].recentShellCommands()[0]!.output, Array.from({length: 200}, (_, i) => `line ${i}`).join('\n'));
  } finally { f.dispose(); }
});

test('an immediate frame consumes pending output without a redundant later paint', context => {
  const f = executionFrameFixture();
  context.mock.timers.enable({apis: ['setTimeout']});
  try {
    let paints = 0;
    let rows: string[] = [];
    f.app['renderer'].render = frame => { paints++; rows = frame.rows; };
    f.app['onShellData']('before key\r\n');
    f.app['onInput']('x');
    assert.equal(f.app['editor'].text, 'x');
    assert.ok(paints > 0, 'typing paints immediately');
    assert.ok(rows.join('\n').includes('before key'), 'the immediate frame includes pending output');
    const afterKey = paints;
    context.mock.timers.tick(16);
    assert.equal(paints, afterKey, 'typing already presented the pending output');
  } finally { f.dispose(); }
});

test('stopping cancels output work and never paints after disposal', context => {
  const f = executionFrameFixture();
  context.mock.timers.enable({apis: ['setTimeout']});
  try {
    f.app['onShellData']('pending\r\n');
    f.app['stop'](0);
    let paints = 0;
    f.app['renderer'].render = () => { paints++; };
    context.mock.timers.tick(100);
    assert.equal(paints, 0);
    assert.equal(f.app['outputRenderTimer'], undefined);
  } finally { f.dispose(); }
});


for (const event of ['prompt', 'resize'] as const) {
  test(`pending output is consumed by an immediate ${event} frame`, context => {
    const f = executionFrameFixture();
    context.mock.timers.enable({apis: ['setTimeout']});
    try {
      f.begin('printf tail');
      let paints = 0;
      f.app['renderer'].render = () => { paints++; };
      f.app['onShellData']('tail\r\n');
      if (event === 'prompt') f.complete(); else f.app['onResize']();
      assert.ok(paints > 0);
      assert.equal(f.app['outputRenderTimer'], undefined);
      const after = paints;
      context.mock.timers.tick(16);
      assert.equal(paints, after);
    } finally { f.dispose(); }
  });
}

test('terminal queries are forwarded before the pending output paint', context => {
  const f = executionFrameFixture();
  context.mock.timers.enable({apis: ['setTimeout']});
  try {
    f.begin('printf query');
    const written: string[] = [];
    const write = context.mock.method(process.stdout, 'write', (data: string | Uint8Array) => { written.push(String(data)); return true; });
    try {
      f.app['onShellData']('pending\r\n');
      f.app['onShellData']('\u001b[?2026$p');
      assert.ok(written.join('').includes('\u001b[?2026$p'), 'query reaches the host synchronously');
      assert.notEqual(f.app['outputRenderTimer'], undefined);
    } finally { write.mock.restore(); }
  } finally { f.dispose(); }
});

test('a pending paint cannot replace a parser-triggered fullscreen handoff', context => {
  const f = executionFrameFixture();
  context.mock.timers.enable({apis: ['setTimeout']});
  try {
    f.begin('unknown-interactive-tool');
    let paints = 0;
    f.app['renderer'].render = () => { paints++; };
    const written: string[] = [];
    const write = context.mock.method(process.stdout, 'write', (data: string | Uint8Array) => { written.push(String(data)); return true; });
    try {
      f.app['onShellData']('pending\r\n');
      f.app['onShellData']('\u001b[?1049hFULLSCREEN');
      assert.equal(f.app['passthrough'], true);
      assert.ok(written.join('').includes('\u001b[?1049hFULLSCREEN'), 'raw handoff bytes are forwarded immediately');
      context.mock.timers.tick(16);
      assert.equal(paints, 0);
    } finally { write.mock.restore(); }
  } finally { f.dispose(); }
});


for (const kind of ['mouseClick', 'mouseMove'] as const) {
  test(`pending FOLLOW output keeps ${kind} on the row actually painted`, context => {
    const f = executionFrameFixture(50, 14);
    context.mock.timers.enable({apis: ['setTimeout']});
    try {
      f.begin('printf rows', Array.from({length: 30}, (_, i) => `row ${i}\r\n`).join(''));
      const painted = f.capture();
      const start = f.app['historyViewport'].start;
      const before = f.app['output'].wrapped(50);
      const local = 2;
      const expected = before[start + local]!.lineIndex;
      f.app['onShellData']('new row\r\n');
      f.app['handleKey']({kind, x: 5, y: painted.plan.transcript.top + local + 1});
      assert.equal(f.app['hoveredLineIndex'], expected, 'pending rows must not shift the pointer target');
      if (kind === 'mouseClick') assert.equal(f.app['selection']?.anchor, start + local);
    } finally { f.dispose(); }
  });
}


test('drag mapping and wrapped Unicode fragments stay on the displayed source while output is pending', context => {
  const f = executionFrameFixture(50, 14);
  context.mock.timers.enable({apis: ['setTimeout']});
  try {
    f.begin('printf wide', '界e\u0301 '.repeat(500));
    const painted = f.capture();
    const start = f.app['historyViewport'].start;
    const local = 2;
    const y = painted.plan.transcript.top + local + 1;
    f.app['onShellData']('界e\u0301 '.repeat(100));
    f.app['handleKey']({kind: 'mouseClick', x: 5, y});
    assert.equal(f.app['selection']?.anchor, start + local, 'the wrap fragment, not just its line ID, is stable');
    const nextFrame = f.app['presentationFrame']!;
    f.app['onShellData']('tail\r\nmore\r\n');
    const redrawnStart = f.app['historyViewport'].start;
    assert.equal(f.app['outputRenderTimer'], undefined, 'an active drag keeps output paints synchronous');
    assert.equal(f.app['transcriptRowAt'](nextFrame.plan.transcript.top + 4), redrawnStart + 3, 'release uses the displayed mapping');
    f.app['handleKey']({kind: 'mouseDrag', x: 5, y: nextFrame.plan.transcript.top + 4});
    assert.equal(f.app['selection']?.head, redrawnStart + 3);
    assert.ok(f.app['presentationFrame']!.transcript.rows.length <= nextFrame.plan.transcript.height, 'only viewport rows are retained');
  } finally { f.dispose(); }
});

test('a clear invalidates pending displayed IDs instead of acting on their replacements', context => {
  const f = executionFrameFixture(50, 14);
  context.mock.timers.enable({apis: ['setTimeout']});
  try {
    f.begin('printf rows', Array.from({length: 30}, (_, i) => `old ${i}\r\n`).join(''));
    const painted = f.capture();
    f.app['onShellData']('\u001b[2Jreplacement\r\n');
    f.app['handleKey']({kind: 'mouseClick', x: 5, y: painted.plan.transcript.top + 1});
    assert.equal(f.app['selection'], undefined);
    assert.equal(f.app['hoveredLineIndex'], undefined);
  } finally { f.dispose(); }
});


test('a live redraw during a drag is painted before release can copy its replacement', async context => {
  const f = executionFrameFixture(50, 14);
  context.mock.timers.enable({apis: ['setTimeout']});
  let copied = '';
  const child = Object.assign(new EventEmitter(), {stdin: new PassThrough(), kill: () => true});
  child.stdin.on('data', data => { copied += String(data); });
  child.stdin.on('finish', () => child.emit('exit', 0));
  const spawn = context.mock.method(childProcess, 'spawn', () => child);
  syncBuiltinESMExports();
  try {
    f.begin('printf progress', 'first\r\nsecond\r\n');
    const painted = f.capture();
    const wrapped = f.app['output'].wrapped(50);
    const start = f.app['historyViewport'].start;
    const first = wrapped.findIndex(row => row.plain === 'first');
    const second = wrapped.findIndex(row => row.plain === 'second');
    const y = (index: number) => painted.plan.transcript.top + index - start + 1;
    let drawn = '';
    f.app['renderer'].render = frame => { drawn = stripAnsi(frame.rows.join('\n')); };
    f.app['handleKey']({kind: 'mouseClick', x: 5, y: y(first)});
    f.app['handleKey']({kind: 'mouseDrag', x: 5, y: y(second)});
    assert.equal(f.app['selection']?.dragging, true);
    f.app['onShellData']('\u001b[2A\rreplacement\r\nsecond\r\n');
    assert.ok(drawn.includes('replacement'), 'selection output must be painted synchronously');
    assert.equal(f.app['outputRenderTimer'], undefined);
    const expected = selectedText(f.app['output'].wrapped(50), f.app['selection']!);
    f.app['handleKey']({kind: 'mouseRelease', x: 5, y: y(second)});
    await new Promise(resolve => setImmediate(resolve));
    if (spawn.mock.callCount()) assert.equal(copied, expected, 'the fake clipboard receives the already-painted selection');
    assert.equal(f.app['selection']?.dragging, false);
  } finally {
    spawn.mock.restore(); syncBuiltinESMExports(); f.dispose();
  }
});


test('clearing a finished selection does not repaint underneath a pending click', context => {
  const f = executionFrameFixture(50, 14);
  context.mock.timers.enable({apis: ['setTimeout']});
  try {
    f.begin('printf rows', Array.from({length: 30}, (_, i) => `row ${i}\r\n`).join(''));
    const painted = f.capture();
    const start = f.app['historyViewport'].start;
    const expected = f.app['output'].wrapped(50)[start + 2]!.lineIndex;
    f.app['selection'] = {anchor: start, head: start + 1, dragging: false, moved: true};
    f.app['onShellData']('new row\r\n');
    f.app['handleKey']({kind: 'mouseClick', x: 5, y: painted.plan.transcript.top + 3});
    assert.equal(f.app['hoveredLineIndex'], expected);
    assert.equal(f.app['selection']?.anchor, start + 2);
  } finally { f.dispose(); }
});
