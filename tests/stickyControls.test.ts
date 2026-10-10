import test from 'node:test';
import assert from 'node:assert/strict';
import {OutputBuffer, type CompletedCommand} from '../src/output/OutputBuffer.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';

/**
 * Sticky block controls: while a completed block's header is scrolled away, its Copy and Actions ride on the sticky
 * header row (NMSh's own viewport rendering; native scrollback is out of reach and never claimed). Ownership is the
 * block's startId from the row model, never screen coordinates.
 */
const sgr = (button: number, x: number, y: number) => `\u001B[<${button};${x};${y}M`;

function run(output: OutputBuffer, command: string, lines: number): number {
  const startId = output.beginCommand(command, [`❯ ${command}`]);
  output.write(Array.from({length: lines}, (_, index) => `${command}-out-${index}\n`).join(''));
  output.complete(0);
  output.setCompletionLifecycle('✔ Completed · 1 ms · 10:00');
  return startId;
}

function app(columns = 80, rows = 20, folding: 'never' | 'smart' = 'never') {
  const instance = new TerminalApp();
  const output = instance['output'] as OutputBuffer;
  // Expanded blocks, so the viewport can scroll through their output (a folded block is covered separately).
  output.setOutputFolding(folding);
  const ids = {alpha: run(output, 'alpha', 3), bravo: run(output, 'bravo', 40), charlie: run(output, 'charlie', 40)};
  instance['output'].presenter.setLayout('normal');
  instance['promptConfiguration'].composerPosition = 'bottom';
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns, rows})});
  const frames: string[][] = [];
  instance['renderer'].render = ((frame: {rows: string[]}) => { frames.push(frame.rows); }) as never;
  const copies: Array<{records: CompletedCommand[]; includeStatus: boolean}> = [];
  // The clipboard boundary: what would be written, and success, without touching the person's clipboard.
  Object.defineProperty(instance, 'copyRecords', {value: async (records: CompletedCommand[], includeStatus: boolean) => { copies.push({records, includeStatus}); return true; }});
  const frame = () => { instance['render'](); return frames.at(-1)!.map(stripAnsi); };
  /** Put the row whose text is `plain` at the top of the transcript viewport. */
  const scrollTo = (plain: string) => {
    const wrapped = output.wrapped(columns);
    const index = wrapped.findIndex(row => row.plain === plain);
    const viewport = instance['historyViewport'];
    const height = instance['planFrame'](columns, rows).viewportRows;
    viewport.scrollLines(wrapped.length, height, index - viewport.resolve(wrapped.length, height));
  };
  const done = () => { instance['stop'](0); instance['session'].kill(); };
  return {instance, output, ids, frame, scrollTo, copies, done};
}

const controlsIn = (rows: string[]) => rows.filter(row => /\[Actions\]/u.test(row));

test('sticky row carries Copy and Actions for the block in view, and they follow the block you scroll into', () => {
  const {frame, scrollTo, done} = app();
  try {
    scrollTo('bravo-out-10');
    let rows = frame();
    assert.match(rows[0]!, /^❯ bravo.*\[Copy\] \[Actions\]$/u);
    assert.equal(controlsIn(rows).length, 1, 'one set of controls on screen');
    scrollTo('charlie-out-5');
    rows = frame();
    assert.match(rows[0]!, /^❯ charlie.*\[Copy\] \[Actions\]$/u, 'now the next block');
    // The real header in view: no sticky row and no sticky controls (hover/focus keep their own affordance).
    scrollTo('❯ charlie');
    rows = frame();
    assert.equal(controlsIn(rows).length, 0);
    assert.match(rows[0]!, /^❯ charlie\s*$/u);
  } finally { done(); }
});

test('sticky Copy copies that block\'s full stored output; the label confirms in place without moving Actions', async () => {
  const {instance, frame, scrollTo, copies, ids, done} = app();
  try {
    scrollTo('bravo-out-30');
    const before = frame()[0]!;
    const copyColumn = before.indexOf('[Copy]') + 1;
    const actionsColumn = before.indexOf('[Actions]') + 1;
    instance['onInput'](sgr(0, copyColumn + 2, 1));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(copies.length, 1);
    assert.equal(copies[0]!.records[0]!.startId, ids.bravo);
    assert.equal(copies[0]!.records[0]!.output.split('\n').length, 40, 'every line, not the visible part');
    assert.equal(copies[0]!.includeStatus, false, 'the setting decides');
    const after = frame()[0]!;
    assert.match(after, /\[✓ Copied\] \[Actions\]$/u);
    assert.equal(after.indexOf('[Actions]') + 1, actionsColumn, 'Actions did not move');
    assert.equal(displayWidth(after), displayWidth(before));
    // The confirmation belongs to bravo only.
    scrollTo('charlie-out-5');
    assert.match(frame()[0]!, /\[Copy\] \[Actions\]$/u);
  } finally { done(); }
});

test('sticky Actions opens that block\'s palette; elsewhere on the row a click still jumps to its header', () => {
  const {instance, frame, scrollTo, ids, done} = app();
  try {
    scrollTo('bravo-out-10');
    const row = frame()[0]!;
    instance['onInput'](sgr(0, row.indexOf('[Actions]') + 3, 1));
    const palette = instance['paletteState'] as {items: Array<{id: string}>} | undefined;
    assert.ok(palette);
    assert.ok(palette.items.every(item => item.id.startsWith(`block:${ids.bravo}:`)), 'actions for bravo');
    instance['paletteState'] = undefined;
    instance['onInput'](sgr(0, 3, 1));
    const wrapped = instance['output'].wrapped(80);
    assert.equal(wrapped[instance['historyViewport'].start]!.lineIndex, ids.bravo, 'jumped to the real header');
  } finally { done(); }
});

test('narrow widths keep Actions, then nothing, and never cover the header\'s start', () => {
  for (const [columns, expected] of [[60, /\[Copy\] \[Actions\]$/u], [30, /❯ bravo.*\[Actions\]$/u], [24, /^❯ bravo/u]] as const) {
    const {frame, scrollTo, done} = app(columns, 20);
    try {
      scrollTo('bravo-out-10');
      const row = frame()[0]!;
      assert.match(row, expected, `${columns} columns`);
      assert.ok(displayWidth(row) <= columns);
      if (columns === 24) assert.doesNotMatch(row, /\[Actions\]|\[Copy\]/u);
      assert.match(row, /^❯ bravo/u, 'the command stays readable');
    } finally { done(); }
  }
});

test('no sticky controls while a command runs, behind a panel, or in passthrough', () => {
  const {instance, frame, scrollTo, done} = app();
  try {
    scrollTo('bravo-out-10');
    assert.equal(controlsIn(frame()).length, 1);
    instance['running'] = {command: 'sleep 9', startedAt: Date.now(), interrupted: false, cleared: false, startId: 9999, cwd: '/'};
    assert.equal(controlsIn(frame()).length, 0, 'block actions wait for the prompt, as they always have');
    instance['running'] = undefined;
    instance['copyPicker'] = {records: [], query: '', searching: false, cursor: 0, chosen: new Set(), includeStatus: false, preview: true};
    assert.equal(instance['stickyHeader'](instance['output'].wrapped(80), instance['historyViewport'].start), undefined, 'a panel suppresses sticky');
    instance['copyPicker'] = undefined;
  } finally { done(); }
});

test('a folded block: the sticky Copy still copies every stored line, not the folded view', async () => {
  const {instance, output, ids, copies, done} = app(80, 20, 'smart');
  try {
    // Folded: the whole block fits; open the palette on it and copy from there, the same path the sticky Copy uses.
    assert.ok(output.wrapped(80).length < 60, 'folded');
    await instance['copyBlock'](ids.charlie);
    assert.equal(copies[0]!.records[0]!.output.split('\n').length, 40);
  } finally { done(); }
});
