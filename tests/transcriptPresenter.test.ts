import test from 'node:test';
import assert from 'node:assert/strict';
import {AnsiOutputParser} from '../src/output/AnsiOutputParser.js';
import {TranscriptPresenter, type TranscriptView} from '../src/output/TranscriptPresenter.js';
import {OutputBuffer, type CompletedCommand} from '../src/output/OutputBuffer.js';
import {DEFAULT_TRANSCRIPT_APPEARANCE} from '../src/prompt/configuration.js';

/** A synthetic view built straight from records, with no OutputBuffer involved. */
function view(sourceLines: string[], completed: CompletedCommand[], commandLines: number[]): TranscriptView {
  const parser = new AnsiOutputParser();
  for (const line of sourceLines) parser.addLine(line);
  const blocks = completed.map(record => ({start: record.startId, end: record.endId ?? Number.POSITIVE_INFINITY}));
  return {
    lines: parser.allLines(),
    completed,
    visualGaps: new Set(completed.slice(1).map(record => record.startId)),
    lineTypes: new Map(commandLines.map(line => [line, 'command' as const])),
    historicalContexts: new Map(completed.map(record => [record.startId, {cwd: '/tmp/project'}])),
    ownerOf: line => blocks.find(block => line >= block.start && line < block.end)?.start,
  };
}

const record = (startId: number, outputStartId: number, endId: number, expanded = true): CompletedCommand => ({
  command: `cmd${startId}`, output: '', lifecycleText: '', exitCode: 0, startId, outputStartId, endId, expanded,
});

test('presenter rows carry block ownership from records and headers precede commands', () => {
  const lines = ['cmd0', 'a', 'b', 'cmd3', 'c'];
  const rows = new TranscriptPresenter().rows(view(lines, [record(0, 1, 3), record(3, 4, 5)], [0, 3]), 40);
  const plain = rows.map(row => row.plain);
  assert.equal(rows[0]!.isHistoricalHeader, true);
  assert.deepEqual(plain.filter((_, index) => !rows[index]!.isHistoricalHeader && rows[index]!.lineIndex !== -1), lines);
  assert.deepEqual(rows.filter(row => row.lineIndex === 4).map(row => row.blockStartId), [3]);
  assert.equal(rows.find(row => row.isHistoricalHeader && row.blockStartId === 3) !== undefined, true);
  assert.equal(rows.some(row => row.lineIndex === -1 && row.plain === ''), true, 'visual gap between blocks');
});

test('presenter folds a collapsed block into head, disclosure row and tail without dropping ownership', () => {
  const output = Array.from({length: 30}, (_, index) => `line ${index}`);
  const presented = new TranscriptPresenter().rows(view(['cmd', ...output], [record(0, 1, 31, false)], [0]), 60);
  const hint = presented.find(row => row.isFoldHint)!;
  assert.match(hint.plain, /lines hidden · Ctrl\+O  ›$/u);
  assert.equal(hint.commandIndex, 0);
  assert.equal(hint.blockStartId, 0);
  assert.ok(presented.length < 31, 'collapsed rows are hidden from presentation only');
  const expanded = new TranscriptPresenter().rows(view(['cmd', ...output], [record(0, 1, 31, true)], [0]), 60);
  assert.match(expanded.find(row => row.isFoldHint)!.plain, /30 lines shown · Ctrl\+O  ⌄$/u);
});

test('presenter output is deterministic and follows the appearance it is given', () => {
  const synthetic = view(['cmd', 'out'], [record(0, 1, 2)], [0]);
  const presenter = new TranscriptPresenter();
  assert.deepEqual(presenter.rows(synthetic, 50), presenter.rows(synthetic, 50));
  presenter.setAppearance({...DEFAULT_TRANSCRIPT_APPEARANCE, divider: false, historicalPrompt: false});
  assert.equal(presenter.rows(synthetic, 50).some(row => row.isHistoricalHeader), false);
  presenter.setAppearance({...DEFAULT_TRANSCRIPT_APPEARANCE, historicalPrompt: false});
  assert.equal(presenter.rows(synthetic, 50).find(row => row.isHistoricalHeader)!.plain, '─'.repeat(50));
});

test('presenter renders completed and live activity rows from the view', () => {
  const activity = {id: 'x', kind: 'tap-stream' as const, label: 'suite', startedAt: 0, completedAt: 1000,
    status: 'completed' as const, outputStartId: 1, outputEndId: 2, expanded: true};
  const completed = {...record(0, 1, 2), activities: [activity]};
  const rows = new TranscriptPresenter().rows(view(['cmd', 'ok 1'], [completed], [0]), 60);
  const activityRow = rows.find(row => row.activityId === 'x' && row.isFoldHint)!;
  assert.match(activityRow.plain, /✓ suite · Completed · 1\.0s ⌄$/u);
  assert.ok(rows.some(row => row.activityId === 'x' && row.plain === '    ok 1'), 'expanded activity output is indented');

  const live = view(['cmd', 'ok 1'], [], [0]);
  const running = {...activity, status: 'running' as const, completedAt: undefined};
  const liveRows = new TranscriptPresenter().rows({...live, active: {activities: [running]}}, 60);
  assert.equal(liveRows.at(-2)!.isLiveActivity, true, 'live activity follows the newest output');
});

test('decorate paints command surface, hover and focus without touching stored text', () => {
  const presenter = new TranscriptPresenter();
  const rows = presenter.rows(view(['cmd', ...Array.from({length: 12}, (_, i) => `${i}`)], [record(0, 1, 13, true)], [0]), 40);
  const commandRow = rows.find(row => row.lineIndex === 0 && !row.isHistoricalHeader)!;
  const hint = rows.find(row => row.isFoldHint)!;
  const idle = {now: 0};
  assert.match(presenter.decorate(commandRow, 'command', idle), /^\u001B\[48;2;38;38;48m/u);
  assert.equal(presenter.decorate(hint, undefined, idle), hint.ansi, 'unhovered hint is unchanged');
  assert.match(presenter.decorate(hint, undefined, {now: 0, hoveredLineIndex: hint.lineIndex}), /^\u001B\[48;2;45;45;55m/u);
  assert.match(presenter.decorate(hint, undefined, {now: 0, focusedCommandIndex: 0}), /^\u001B\[48;2;60;60;80m/u);
  assert.match(presenter.stickyHeaderSurface('cmd'), /^\u001B\[48;2;38;38;48mcmd\u001B\[K/u);
});

test('NO_COLOR reattach suppresses saved authored styles while preserving raw program styles and transcript bytes', () => {
  const buffer = new OutputBuffer();
  buffer.beginCommand('echo colored', ['\u001b[38;2;166;124;243mecho colored\u001b[0m']);
  buffer.write('\u001b[31mRAW-RED\u001b[0m\n');
  buffer.complete(0);
  buffer.addHistoryLine('\u001b[38;2;116;181;154mCompleted\u001b[0m');
  const saved = buffer.transcript();
  const restored = new OutputBuffer();
  restored.restoreTranscript(saved);
  const previous = {NO_COLOR: process.env.NO_COLOR, NMSH_COLOR: process.env.NMSH_COLOR};
  process.env.NO_COLOR = '1';
  delete process.env.NMSH_COLOR;
  try {
    const rows = restored.wrapped(12);
    const authored = rows.filter(row => row.lineIndex !== undefined && restored.lineTypes.has(row.lineIndex));
    assert.ok(authored.some(row => row.plain.includes('echo colored')));
    assert.ok(authored.some(row => row.plain.includes('Completed')));
    for (const row of authored) assert.doesNotMatch(row.ansi, /\u001b\[(?:38|48);/u);
    const raw = rows.find(row => row.plain === 'RAW-RED');
    assert.ok(raw);
    assert.match(raw.ansi, /\u001b\[31m/u, 'program SGR remains raw');
    assert.doesNotMatch(restored.presenter.stickyHeaderRow(restored.view(), 0, 40)!, /\u001b\[38;/u);
    assert.deepEqual(restored.transcript(), saved, 'presentation never rewrites stored styles');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('presentation command metadata reads scale with records and source lines', () => {
  const work = (count: number): number => {
    let reads = 0;
    const records = Array.from({length: count}, (_, index) => new Proxy(record(index * 3, index * 3 + 1, index * 3 + 3), {
      get(target, property, receiver) {
        if (property === 'startId' || property === 'outputStartId' || property === 'endId') reads++;
        return Reflect.get(target, property, receiver);
      },
    })).reverse();
    const lines = Array.from({length: count}, (_, index) => [`cmd${index}`, `out${index}`, `tail${index}`]).flat();
    const source = view(lines, records, Array.from({length: count}, (_, index) => index * 3));
    reads = 0;
    const presented = new TranscriptPresenter().rows(source, 80);
    assert.equal(presented.filter(row => row.lineIndex !== undefined && row.lineIndex >= 0 && !row.isHistoricalHeader).length, lines.length);
    return reads;
  };
  const short = work(50);
  const long = work(100);
  assert.ok(long <= short * 3, `Doubling history increased command metadata reads from ${short} to ${long}`);
});

test('command index metadata keeps first matching array priority, including out-of-order records', () => {
  const lines = ['cmd0', 'one', 'tail', 'cmd3', 'two', 'end'];
  for (const records of [[record(3, 4, 6), record(0, 1, 3)], [record(0, 1, 3), record(3, 4, 6)]]) {
    const rows = new TranscriptPresenter().rows(view(lines, records, [0, 3]), 80);
    for (const row of rows) if (row.lineIndex !== undefined && row.lineIndex >= 0 && !row.isHistoricalHeader) {
      assert.equal(row.commandIndex, records.findIndex(command => command.startId <= row.lineIndex!));
    }
  }
});

test('a later presentation rebuilds command indexes after new records and clear', () => {
  const buffer = new OutputBuffer();
  buffer.beginCommand('first', ['first']); buffer.write('one\n'); buffer.complete(0, {holdOpen: true});
  assert.equal(buffer.wrapped(80).find(row => row.plain === 'first')?.commandIndex, 0);
  buffer.beginCommand('second', ['second']); buffer.write('two\n'); buffer.complete(0, {holdOpen: true});
  assert.equal(buffer.wrapped(80).find(row => row.plain === 'first')?.commandIndex, 1);
  buffer.clearPresentation();
  buffer.beginCommand('new', ['new']); buffer.write('three\n'); buffer.complete(0, {holdOpen: true});
  assert.equal(buffer.wrapped(80).find(row => row.plain === 'new')?.commandIndex, 0);
  assert.equal(buffer.wrapped(80).some(row => row.plain === 'first'), false);
});

test('duplicate output and disclosure anchors retain first-record priority', () => {
  const lines = ['cmd', ...Array.from({length: 30}, (_, index) => `line ${index}`)];
  const rows = new TranscriptPresenter().rows(view(lines, [record(0, 1, 31, false), record(0, 1, 31, true)], [0]), 60);
  assert.equal(rows.find(row => row.isFoldHint)?.commandIndex, 0);
  assert.ok(rows.length < lines.length, 'the first duplicate record remains folded');
  const activity = {id: 'first', kind: 'tap-stream' as const, label: 'child', startedAt: 0, completedAt: 1000,
    status: 'completed' as const, outputStartId: 1, outputEndId: 1, expanded: true};
  const parents = [{...record(0, 1, 2), activities: [activity]}, {...record(0, 1, 2), activities: [{...activity, id: 'second'}]}];
  const disclosed = new TranscriptPresenter().rows(view(['cmd', 'out', 'Completed'], parents, [0]), 60);
  assert.equal(disclosed.find(row => row.lineIndex === 2)?.commandIndex, 0);
});

test('command priority advances over source rows hidden by a folded range', () => {
  const lines = ['cmd', ...Array.from({length: 11}, (_, index) => `line ${index}`)];
  const records = [record(3, 4, 8), record(0, 1, 10, false)];
  const rows = new TranscriptPresenter().rows(view(lines, records, [0, 3]), 80);
  assert.equal(rows.find(row => row.lineIndex === 10)?.commandIndex, 0);
});

test('authored color policy is sampled once per frame and changes apply on the next frame', () => {
  const parser = new AnsiOutputParser();
  for (let index = 0; index < 100; index++) parser.addLine(`\x1b[31mnotice ${index}\x1b[0m`);
  parser.addLine('\x1b[32mraw program output\x1b[0m');
  const source: TranscriptView = {lines: parser.allLines(), completed: [], visualGaps: new Set(),
    lineTypes: new Map(Array.from({length: 100}, (_, index) => [index, 'metadata' as const])), historicalContexts: new Map(), ownerOf: () => undefined};
  const originalEnv = process.env;
  let reads = 0;
  let level = 'truecolor';
  const env = {...originalEnv};
  Object.defineProperty(env, 'NMSH_COLOR', {enumerable: true, configurable: true, get: () => { reads++; return level; }});
  process.env = env;
  try {
    const presenter = new TranscriptPresenter();
    const colored = presenter.rows(source, 80);
    const colorReads = reads;
    level = 'none'; reads = 0;
    const plain = presenter.rows(source, 80);
    assert.match(colored[0]!.ansi, /\x1b\[31m/u);
    assert.doesNotMatch(plain[0]!.ansi, /\x1b\[31m/u);
    assert.match(plain.at(-1)!.ansi, /\x1b\[32m/u, 'raw PTY color remains raw');
    assert.deepEqual(plain.map(row => row.plain), colored.map(row => row.plain));
    assert.equal(colorReads, 1, 'one authored policy read for the colored frame');
    assert.equal(reads, 1, 'one fresh policy read for the next frame');
    reads = 0;
    const raw = presenter.rows({...source, lineTypes: new Map()}, 80);
    assert.match(raw[0]!.ansi, /\x1b\[31m/u);
    assert.equal(reads, 0, 'raw-only output needs no authored-color policy');
  } finally { process.env = originalEnv; }
});
