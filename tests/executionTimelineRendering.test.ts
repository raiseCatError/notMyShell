import * as queueRendering from '../src/status/executionTimeline.js';
import {AnsiOutputParser} from '../src/output/AnsiOutputParser.js';
import {applyUiTheme, uiColorsFor} from '../src/appearance/uiTheme.js';
import {currentForeground} from '../src/presentation/cellOverlay.js';
import {UI_COLORS} from '../src/ui/palette.js';
import {contrastRatio, relativeLuminance} from '../src/chroma/color.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {QueueDispatcher} from '../src/session/QueueDispatcher.js';
import {queueActivitySummary} from '../src/status/executionTimeline.js';
import {queueBlock} from '../src/status/queueStatus.js';
import {queuePanelKey, renderQueuePanel} from '../src/queue/QueuePanel.js';
import {planScreen, regionOf, withQueueRows} from '../src/app/screenPlan.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {QueueState} from '../src/session/CommandQueue.js';
import type {QueueTimeline} from '../src/session/ExecutionTimeline.js';

const timeline: QueueTimeline = {id: 1, createdAt: 1000, startedAt: 1000, observedAt: 3000, elapsedMs: 2000, failurePolicy: 'pause', status: 'active',
  counts: {succeeded: 1, failed: 0, interrupted: 0, skipped: 0, unobserved: 0}, executions: [
    {id: 1, text: 'build', source: 'manual', startedAt: 1000, endedAt: 2000, durationMs: 1000, status: 'succeeded', exitCode: 0},
    {id: 2, text: 'test', source: 'queue', entryId: 1, startedAt: 2000, status: 'running'}]};
const state: QueueState = {timeline, revision: 3, entries: [1,2,3].map(id => ({id, text: 'echo next' + id, addedAt: 1000}))};
const plain = (state_: QueueState, width = 80, height = 7) => queueBlock(state_, width, height, {now: 3000, animate: false})!.map(stripAnsi).join('\n');

test('production timeline is chronological with one running glyph and a next-only navigation marker', () => {
  const text = plain(state);
  assert.doesNotMatch(text, /[╭├╰│]/u);
  assert.match(text, /Queue · 5 commands/u);
  assert.ok(text.indexOf('build') < text.indexOf('test'));
  assert.ok(text.indexOf('test') < text.indexOf('echo next1'));
  assert.match(text, /build.*1.0s/u);
  assert.match(text, /test.*Running/u);
  assert.match(text, /› echo next1.*Next/u);
  assert.match(text, /echo next2.*Queued/u);
  assert.match(text, /\+1 more/u);
  assert.doesNotMatch(text, /› test/u);
});

test('production pause/failure/interrupt states retain factual cause, code and bounded dimensions', () => {
  const failed = structuredClone(state);
  failed.paused = {reason: 'failed', at: 3000, command: 'test', exitCode: 17};
  failed.timeline!.executions[1] = {...failed.timeline!.executions[1]!, status: 'failed', endedAt: 3000, durationMs: 1000, exitCode: 17};
  for (const width of [16, 24, 32, 80]) for (const height of [2,3,5,7]) {
    const rows = queueBlock(failed, width, height, {now: 3000, animate: false})!;
    assert.ok(rows.length <= height);
    for (const row of rows) assert.ok(displayWidth(stripAnsi(row)) <= width);
    if (width >= 32 && height >= 3) assert.match(rows.map(stripAnsi).join('\n'), /exit 17/u);
  }
  assert.match(plain({...state, paused: {reason: 'user', at: 3000}}), /Paused manually/u);
  assert.match(plain({...state, paused: {reason: 'interrupted', at: 3000, command: 'test'}}), /interrupted/iu);
});

test('cleared chain is never labelled successfully completed and completed results stay visible with no pending entries', () => {
  const finished = structuredClone(state);
  finished.entries = []; finished.timeline!.status = 'cleared'; finished.timeline!.endedAt = 3000;
  finished.timeline!.executions.pop(); finished.timeline!.counts.skipped = 3;
  assert.match(plain(finished), /cleared/iu);
  assert.doesNotMatch(plain(finished), /Completed/u);
  finished.timeline!.status = 'finished';
  assert.match(plain(finished), /finished/iu);
  assert.match(plain(finished), /build/u);
});

test('timeline uses safe neutralized text and NO_COLOR without connector nesting', () => {
  const saved = {NO_COLOR: process.env.NO_COLOR, NMSH_ICONS: process.env.NMSH_ICONS};
  process.env.NO_COLOR = '1'; process.env.NMSH_ICONS = 'safe';
  try {
    const hostile = structuredClone(state);
    hostile.timeline!.executions[0]!.text = 'echo \u001b]52;c;abc\u0007';
    const rows = queueBlock(hostile, 80, 7, {now: 3000, animate: false})!;
    assert.doesNotMatch(rows.join(''), /\u001b\[(?:38|48);/u);
    assert.doesNotMatch(stripAnsi(rows.join('')), /[\u0000-\u001f\u007f-\u009f]/u);
    assert.match(rows.map(stripAnsi).join('\n'), /> echo next1/u);
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('shared geometry places the new timeline before activity without changing PTY size', () => {
  for (const composerPosition of ['bottom','top','flow'] as const) for (const rows of [12,18,30]) {
    const base = planScreen({rows, inputRows: 1, suggestions: 0, running: true, detached: false, hasOutput: true,
      contextPlacement: 'header', hasVisibleContext: true, composerLayout: 'twoLine', composerPosition, transcriptRows: 400});
    const next = withQueueRows(base, 5, true);
    assert.equal(next.ptyRows, base.ptyRows);
    const queue = regionOf(next, 'queue'), activity = regionOf(next, 'activity');
    if (queue && activity) assert.equal(queue.top + queue.height, activity.top);
    const regions = [...next.regions].sort((a,b) => a.top-b.top);
    regions.forEach((region,index) => { if (index) assert.ok(region.top >= regions[index-1]!.top + regions[index-1]!.height); });
  }
});

test('queue manager requires a second key for resume and clear, with the reviewed revision', () => {
  const paused = {...state, paused: {reason: 'user' as const, at: 1}};
  const panel = {selected: 0};
  assert.equal(queuePanelKey(panel, {kind: 'text', value: 'p'}, paused, true, true), undefined);
  assert.deepEqual(queuePanelKey(panel, {kind: 'enter'}, paused, true, true), {kind: 'change', change: {op: 'resume', expectedRevision: 3}});
  assert.equal(queuePanelKey(panel, {kind: 'text', value: 'c'}, paused, true, true), undefined);
  assert.deepEqual(queuePanelKey(panel, {kind: 'enter'}, paused, true, true), {kind: 'change', change: {op: 'clear', expectedRevision: 3}});
  queuePanelKey(panel, {kind: 'text', value: 'c'}, paused, true, true);
  assert.equal(queuePanelKey(panel, {kind: 'enter'}, {...paused, revision: 4}, true, true), undefined, 'changed state invalidates the review');
});

test('approval review presents the exact multiline command, with explicit omitted-line disclosure', () => {
  const asking = structuredClone(state);
  asking.entries = [{id: 3, text: 'echo one\necho two\necho three', addedAt: 1, condition: 'approve'}];
  const full = queueBlock(asking, 80, 7, {review: 'approve'})!.map(stripAnsi).join('\n');
  assert.match(full, /echo one\necho two\necho three/u);
  assert.match(full, /Enter.*approves/u);
  const compact = queueBlock(asking, 32, 3, {review: 'approve'})!.map(stripAnsi).join('\n');
  assert.match(compact, /more|e shows all/u);
});

test('starting submission remains visible without a running animation or duration', () => {
  const starting = structuredClone(state);
  starting.timeline!.executions = [];
  starting.timeline!.counts.succeeded = 0;
  starting.dispatching = {id: 9, text: 'submitted', addedAt: 1};
  const text = plain(starting);
  assert.match(text, /submitted.*Starting/u);
  assert.doesNotMatch(text, /submitted.*Running/u);
});


test('aggregate display uses only monotonic observation deltas, never epoch arithmetic', () => {
  const d = new QueueDispatcher({isReady: true, adapter: {id: 'zsh'}, submit() {}}, undefined, {now: () => 1000, monotonic: () => 100});
  d.onExec('build'); d.request({op: 'add', text: 'test'});
  const snapshot = d.state;
  assert.match(queueActivitySummary(snapshot), /<1 ms elapsed/u);
  const clockJump = {...snapshot, timeline: {...snapshot.timeline!, observedAt: snapshot.timeline!.observedAt + 3600000}};
  assert.equal(queueActivitySummary(clockJump, 250), queueActivitySummary(snapshot, 250));
});


test('narrow paused reasons preserve failure codes and interruption before long command text', () => {
  const command = 'some-very-long-command-with-many-arguments';
  const paused = {...state, paused: {reason: 'failed' as const, at: 3000, command, exitCode: 17}};
  assert.match(plain(paused, 24, 3), /exit 17/u);
  assert.match(plain({...paused, paused: {reason: 'interrupted', at: 3000, command}}, 24, 3), /Interrupted/u);
});

test('queue manager exposes captured failure policy without reinterpreting staged work', () => {
  const panel = renderQueuePanel({selected: 0}, {...state, timeline: {...timeline, failurePolicy: 'continue'}}, undefined, 100, 30, true).join('\n');
  assert.match(stripAnsi(panel), /continue after nonzero exit/u);
  assert.match(stripAnsi(panel), /Ctrl\+C always pauses/u);
});


test('paused first pending entry retains a muted next marker and an explicit Paused state', () => {
  const text = plain({...state, paused: {reason: 'user', at: 3000}}, 32, 7);
  assert.match(text, /› echo next1 +Paused/u);
  assert.doesNotMatch(text, /› test/u, 'running uses the activity glyph');
});

test('semantic row tints are restrained, readable and reset before subsequent terminal content', () => {
  const failed = structuredClone(state);
  failed.timeline!.executions[1] = {...failed.timeline!.executions[1]!, status: 'failed', endedAt: 3000, durationMs: 1000, exitCode: 17};
  const states = [state, failed, {...failed, paused: {reason: 'user' as const, at: 3000}}];
  const backgrounds = new Set<string>();
  const rgb = (style: string, layer: number) => {
    const match = [...style.matchAll(new RegExp(`\\u001b\\[${layer};2;(\\d+);(\\d+);(\\d+)m`, 'gu'))].at(-1);
    return match ? {red: Number(match[1]), green: Number(match[2]), blue: Number(match[3])} : undefined;
  };
  for (const snapshot of states) {
    for (const row of queueBlock(snapshot, 80, 7, {animate: false})!) {
      if (!/build|exit 17.*1.0s|echo next1.*(?:Next|Paused)/u.test(stripAnsi(row))) continue;
      const parser = new AnsiOutputParser(); parser.write(row + '\nUNSTYLED');
      const cells = parser.allLines()[0]!.filter(cell => cell && cell.text.trim());
      assert.ok(cells.some(cell => rgb(cell!.style, 48)), `missing semantic background: ${stripAnsi(row)}`);
      for (const cell of cells) {
        const bg = rgb(cell!.style, 48), fg = rgb(cell!.style, 38);
        assert.ok(bg && fg, 'every tinted text cell has a complete readable style');
        assert.ok(contrastRatio(fg!, bg!) >= 4.5, 'text contrast on tint');
        assert.ok(relativeLuminance(bg!) < relativeLuminance(UI_COLORS.selection), 'quieter than full focus band');
        backgrounds.add(JSON.stringify(bg));
      }
      assert.ok(parser.allLines()[1]!.every(cell => !cell || !rgb(cell.style, 48)), 'background never leaks into later output');
      assert.ok(displayWidth(row) <= 80);
    }
  }
  assert.ok(backgrounds.size >= 4, 'success, failure, pause and next remain distinct');
});

test('narrow aggregate summaries keep complete priority facts instead of clipped phrases', () => {
  const failed = structuredClone(state);
  failed.paused = {reason: 'failed', command: 'test', at: 3000, exitCode: 17};
  const interrupted = structuredClone(state);
  interrupted.paused = {reason: 'interrupted', command: 'test', at: 3000};
  interrupted.timeline!.executions[1] = {...interrupted.timeline!.executions[1]!, status: 'interrupted', exitCode: 130};
  const finished = structuredClone(state); finished.entries = []; finished.timeline!.status = 'finished'; finished.timeline!.executions.pop();
  const cases: Array<[QueueState, RegExp[]]> = [
    [state, [/Running/u, /2.0s/u, /3 pending/u]],
    [{...state, paused: {reason: 'user', at: 3000}}, [/Paused/u, /2.0s wall/u, /3 pending/u]],
    [failed, [/Paused/u, /exit 17/u, /2.0s/u]],
    [interrupted, [/Interrupted/u, /exit 130/u, /2.0s/u]],
    [finished, [/Finished/u, /2.0s/u, /1 succeeded/u]],
  ];
  for (const [snapshot, facts] of cases) {
    const summary = queueActivitySummary(snapshot, 0, 32);
    assert.ok(displayWidth(summary) <= 32, summary);
    assert.doesNotMatch(summary, /…|\(incl|wa$/u);
    for (const fact of facts) assert.match(summary, fact);
  }
});


test('aggregate parts preserve semantic colors and never celebrate failed or discarded chains', () => {
  const failed = structuredClone(state); failed.timeline!.status = 'finished'; failed.timeline!.counts.failed = 1;
  const rendered = queueRendering.renderQueueActivitySummary(failed, 0, 100);
  const parser = new AnsiOutputParser(); parser.write(rendered);
  const cells = parser.allLines()[0]!.filter(Boolean);
  assert.ok(cells.some(cell => cell!.style.includes(`38;2;${UI_COLORS.failure.red};${UI_COLORS.failure.green};${UI_COLORS.failure.blue}`)));
  const text = stripAnsi(rendered);
  assert.match(text, /1 failed/u);
  assert.ok(displayWidth(text) <= 100);
  const narrow = queueRendering.renderQueueActivitySummary({...state, paused: {reason: 'failed', command: 'test', exitCode: 17, at: 3000}}, 0, 32);
  assert.match(stripAnsi(narrow), /exit 17/u);
  assert.doesNotMatch(stripAnsi(narrow), /…/u);
});


test('semantic surfaces follow custom dark/light text roles with readable contrast', () => {
  const saved = structuredClone(UI_COLORS);
  try {
    const backgrounds: string[] = [];
    for (const theme of [
      {accent: '#dd88bb', separator: '#557799', success: '#448844', failure: '#bb4455', warning: '#bb8800', primary: '#f7eeee', secondary: '#ddd0dd', subtle: '#887788', selection: '#53435a'},
      {accent: '#883366', separator: '#557799', success: '#227744', failure: '#992233', warning: '#996600', primary: '#222222', secondary: '#444444', subtle: '#666666', selection: '#e0ddee'},
    ]) {
      applyUiTheme(uiColorsFor(theme));
      const rows = queueBlock(state, 80, 7, {animate: false})!;
      const row = rows.find(row => stripAnsi(row).includes('build'))!;
      backgrounds.push(row);
      const parser = new AnsiOutputParser(); parser.write(row);
      for (const cell of parser.allLines()[0] ?? []) if (cell?.text.trim()) {
        const fill = [...cell.style.matchAll(/\u001b\[48;2;(\d+);(\d+);(\d+)m/gu)].at(-1)!;
        const background = {red: +fill[1]!, green: +fill[2]!, blue: +fill[3]!};
        assert.ok(contrastRatio(currentForeground(cell.style)!, background) >= 4.5);
      }
    }
    assert.notEqual(backgrounds[0], backgrounds[1], 'surfaces are theme derived');
  } finally { applyUiTheme(saved); }
});
