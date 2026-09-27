import test from 'node:test';
import assert from 'node:assert/strict';
import {AnsiOutputParser} from '../src/output/AnsiOutputParser.js';
import {TranscriptPresenter, type TranscriptView} from '../src/output/TranscriptPresenter.js';
import type {CompletedCommand} from '../src/output/OutputBuffer.js';
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
