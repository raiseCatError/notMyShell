import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {HistoryViewport, stickyHeaderFor} from '../src/output/viewport.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';

const sgr = (button: number, x: number, y: number) => `\u001B[<${button};${x};${y}M`;

function run(output: OutputBuffer, command: string, lines: number, complete = true): number {
  const startId = output.beginCommand(command, [`❯ ${command}`]);
  output.write(Array.from({length: lines}, (_, index) => `${command}-out-${index}\n`).join(''));
  if (complete) output.complete(0);
  return startId;
}

function threeBlocks(): {output: OutputBuffer; ids: number[]} {
  const output = new OutputBuffer();
  const ids = [run(output, 'alpha', 5), run(output, 'bravo', 5), run(output, 'charlie', 5)];
  return {output, ids};
}

const indexOf = (output: OutputBuffer, plain: string, width = 80) => output.wrapped(width).findIndex(row => row.plain === plain);

test('rows carry their owning block startId; gaps and welcome rows do not', () => {
  const {output, ids} = threeBlocks();
  const rows = output.wrapped(80);
  assert.equal(rows[indexOf(output, '❯ alpha')]!.blockStartId, ids[0]);
  assert.equal(rows[indexOf(output, 'bravo-out-3')]!.blockStartId, ids[1]);
  assert.equal(rows[indexOf(output, 'charlie-out-0')]!.blockStartId, ids[2]);
  assert.ok(rows.filter(row => row.lineIndex === -1).every(row => row.blockStartId === undefined));
});

test('no sticky while the real command row is the top row or visible', () => {
  const {output} = threeBlocks();
  const rows = output.wrapped(80);
  assert.equal(stickyHeaderFor(rows, indexOf(output, '❯ alpha')), undefined);
  assert.equal(stickyHeaderFor(rows, 0), undefined);
});

test('sticky appears once the header scrolls above, and the next block pushes it off (3+ blocks, both directions)', () => {
  const {output, ids} = threeBlocks();
  const rows = output.wrapped(80);
  const owners = rows.map((_, start) => stickyHeaderFor(rows, start)?.startId);
  assert.equal(owners[indexOf(output, 'alpha-out-2')], ids[0]);
  assert.equal(owners[indexOf(output, '❯ bravo')], undefined, 'real B header at top: no duplicate');
  assert.equal(owners[indexOf(output, 'bravo-out-0')], ids[1], 'B replaced A');
  assert.equal(owners[indexOf(output, 'charlie-out-4')], ids[2], 'C replaced B');
  // Scrolling upward walks the same pure mapping back: C → B → A.
  assert.equal(owners[indexOf(output, 'bravo-out-4')], ids[1]);
  assert.equal(owners[indexOf(output, 'alpha-out-0')], ids[0]);
  assert.equal(stickyHeaderFor(rows, indexOf(output, 'bravo-out-0'))!.targetIndex, indexOf(output, '❯ bravo'));
});

test('ownership is structural, not textual', () => {
  const output = new OutputBuffer();
  const first = run(output, 'echo x', 0);
  output.write('');
  const second = output.beginCommand('echo x', ['❯ echo x']);
  output.write('❯ echo x\nmore\n');
  const rows = output.wrapped(80);
  const fake = rows.findIndex((row, index) => row.plain === '❯ echo x' && row.lineIndex !== second && index > 0 && row.lineIndex !== first);
  assert.equal(rows[fake]!.blockStartId, second);
  assert.equal(stickyHeaderFor(rows, fake)!.startId, second, 'output text resembling a command does not become a header');
});

test('one-row sticky: start preserved, ANSI-safe ellipsis for long or continued commands', () => {
  const output = new OutputBuffer();
  const long = 'npm run build && npm test && npm run typecheck && npm run lint';
  const startId = run(output, long, 3);
  const row = output.stickyHeaderRow(startId, 30)!;
  assert.equal(stripAnsi(row), `${`❯ ${long}`.slice(0, 29)}…`);
  assert.ok(!row.includes('\n'));
  assert.equal(displayWidth(row), 30);
  assert.ok(row.endsWith('\u001B[0m'), 'ends with a reset');

  const multi = output.beginCommand('for x in 1 2', ['❯ for x in 1 2', '  do echo $x; done']);
  output.write('1\n');
  output.complete(0);
  assert.equal(stripAnsi(output.stickyHeaderRow(multi, 80)!), '❯ for x in 1 2…');
  assert.equal(stripAnsi(output.stickyHeaderRow(startId, 200)!), `❯ ${long}`);
});

test('an empty-output block is not treated as a continued command row', () => {
  const output = new OutputBuffer();
  const empty = run(output, 'true', 0);
  run(output, 'next', 1);
  assert.equal(stripAnsi(output.stickyHeaderRow(empty, 80)!), '❯ true');
});

test('resize recomputes ownership from logical identity', () => {
  const output = new OutputBuffer();
  const startId = run(output, 'wide', 0, false);
  output.write(`${'x'.repeat(60)}\n`.repeat(4));
  output.complete(0);
  for (const width of [80, 20]) {
    const rows = output.wrapped(width);
    const top = rows.findIndex(row => row.lineIndex === startId + 2);
    assert.equal(stickyHeaderFor(rows, top)!.startId, startId, `width ${width}`);
    assert.equal(rows[stickyHeaderFor(rows, top)!.targetIndex]!.lineIndex, startId);
  }
});

test('/clear leaves no owner; /resume restores structural ownership', () => {
  const {output, ids} = threeBlocks();
  const saved = output.transcript();
  output.clearPresentation();
  assert.ok(output.wrapped(80).every(row => row.blockStartId === undefined));
  assert.equal(output.stickyHeaderRow(ids[1]!, 80), undefined);

  const restored = new OutputBuffer();
  restored.restoreTranscript(saved);
  const rows = restored.wrapped(80);
  assert.equal(stickyHeaderFor(rows, indexOf(restored, 'bravo-out-2'))!.startId, ids[1]);
});

test('sticky is never stored: transcript, journal payload, and copy stay unchanged', () => {
  const {output, ids} = threeBlocks();
  const before = JSON.stringify(output.transcript());
  output.wrapped(80);
  output.stickyHeaderRow(ids[0]!, 80);
  const after = output.transcript();
  assert.equal(JSON.stringify(after), before);
  assert.ok(!JSON.stringify(after).includes('blockStartId'));
  assert.equal(serializeCopyPayload(output.recent(1)!), 'charlie-out-0\ncharlie-out-1\ncharlie-out-2\ncharlie-out-3\ncharlie-out-4');
});

test('follow mode keeps a running command pinned; Jump to bottom is unaffected', () => {
  const output = new OutputBuffer();
  const startId = run(output, 'tail -f log', 40, false);
  const viewport = new HistoryViewport();
  const rows = output.wrapped(80);
  const start = viewport.resolve(rows.length, 10);
  assert.equal(viewport.mode, 'follow');
  assert.equal(stickyHeaderFor(rows, start)!.startId, startId);
  viewport.scrollLines(rows.length, 10, -5);
  assert.equal(viewport.mode, 'detached');
  assert.equal(stickyHeaderFor(rows, viewport.resolve(rows.length, 10))!.startId, startId);
  viewport.latest();
  assert.equal(viewport.resolve(rows.length, 10), rows.length - 10);
});

function appWithBlocks(): TerminalApp {
  const app = new TerminalApp();
  const output = app['output'] as OutputBuffer;
  run(output, 'alpha', 3);
  run(output, 'bravo', 40, false);
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 20})});
  return app;
}

test('plain click jumps to the real header; Shift+click does not', () => {
  const app = appWithBlocks();
  try {
    Object.defineProperty(app, 'render', {value: () => {}});
    const output = app['output'] as OutputBuffer;
    const rows = output.wrapped(80);
    app['onInput']('\u001B[5~');
    const viewport = app['historyViewport'] as HistoryViewport;
    const before = viewport.start;
    const sticky = app['stickyHeader'](rows, before);
    assert.ok(sticky, 'sticky visible after scrolling into bravo/alpha output');

    app['onInput'](sgr(4, 3, 1));
    assert.equal(viewport.start, before, 'shift+click is native selection');

    app['onInput'](sgr(0, 3, 1));
    assert.equal(viewport.start, sticky.targetIndex);
    assert.equal(rows[viewport.start]!.lineIndex, sticky.startId, 'real header is now the top row');
    assert.equal(app['stickyHeader'](rows, viewport.start), undefined, 'sticky disappears after the jump');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('panels and passthrough suppress sticky; closing restores it', () => {
  const app = appWithBlocks();
  try {
    const output = app['output'] as OutputBuffer;
    const rows = output.wrapped(80);
    const top = rows.findIndex(row => row.plain === 'bravo-out-10');
    assert.ok(app['stickyHeader'](rows, top));
    app['resumeBrowser'] = {} as never;
    assert.equal(app['stickyHeader'](rows, top), undefined, 'panel wins');
    app['resumeBrowser'] = undefined;
    assert.ok(app['stickyHeader'](rows, top), 'restored on close');
    app['passthrough'] = true;
    assert.equal(app['stickyHeader'](rows, top), undefined);
    app['passthrough'] = false;
    app['externalPassthrough'] = true;
    assert.equal(app['stickyHeader'](rows, top), undefined);
    app['externalPassthrough'] = false;
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('rendered frame shows one sticky row over the top without duplicating the header', () => {
  const app = appWithBlocks();
  try {
    const frames: string[][] = [];
    app['renderer'].render = ((frame: {rows: string[]}) => { frames.push(frame.rows); }) as never;
    app['onInput']('\u001B[5~');
    app['render']();
    const rows = frames.at(-1)!.map(stripAnsi);
    assert.match(rows[0]!, /^❯ bravo/u);
    assert.equal(rows.filter(row => row.startsWith(rows[0]!.trimEnd())).length, 1, 'no duplicate command row');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
