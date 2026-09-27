import test from 'node:test';
import assert from 'node:assert/strict';
import {cursorScreenRow, planScreen, regionAt, regionOf, terminalRowFromScreen, type ScreenPlan, type ScreenPlanInput} from '../src/app/screenPlan.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {stripAnsi} from '../src/util/text.js';

const base: ScreenPlanInput = {rows: 24, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: true,
  contextPlacement: 'header', hasVisibleContext: true, composerLayout: 'twoLine'};
const kinds = (plan: ScreenPlan) => plan.regions.map(region => region.kind);
const sgr = (button: number, x: number, y: number) => `\u001B[<${button};${x};${y}M`;

test('Dock Top plans the composer first, menus on its edge, then a chronological transcript', () => {
  const bottom = planScreen({...base, suggestions: 3, running: true});
  const top = planScreen({...base, suggestions: 3, running: true, composerPosition: 'top'});
  assert.equal(bottom.composerPosition, 'bottom');
  assert.deepEqual(kinds(top), ['prompt', 'input', 'separator', 'suggestions', 'transcript', 'activity']);
  assert.equal(top.ptyRows, bottom.ptyRows, 'the shell gets the same rows in both positions');
  assert.equal(cursorScreenRow(top, 0), 1, 'cursor lives in the top input region');
  for (const plan of [bottom, top]) {
    const total = plan.regions.reduce((sum, region) => sum + region.height, 0);
    assert.ok(total <= plan.rows);
    plan.regions.forEach((region, index) => index > 0 && assert.equal(region.top, plan.regions[index - 1]!.top + plan.regions[index - 1]!.height));
  }
});

test('Dock Top keeps jump and activity right after the newest output, and PTY rows at full capacity', () => {
  const short = planScreen({...base, running: true, detached: true, composerPosition: 'top', transcriptRows: 3});
  const transcript = short.transcript;
  assert.equal(transcript.height, 3, 'transcript is only as tall as its rows');
  assert.equal(regionOf(short, 'jump')?.top, transcript.top + 3);
  assert.equal(regionOf(short, 'activity')?.top, transcript.top + 4);
  const full = planScreen({...base, running: true, detached: true, composerPosition: 'top', transcriptRows: 500});
  assert.equal(short.ptyRows, full.ptyRows, 'PTY rows do not change as output grows');
  assert.equal(full.transcript.height, full.ptyRows);
});

test('Dock Top panels open on the composer edge; narrow row counts never overflow', () => {
  const panel = planScreen({...base, panelRows: 8, composerPosition: 'top'});
  assert.deepEqual(kinds(panel), ['panel', 'transcript']);
  assert.equal(regionAt(panel, 0)?.region.kind, 'panel');
  for (let rows = 1; rows <= 12; rows += 1) {
    const plan = planScreen({...base, rows, inputRows: 3, suggestions: 4, running: true, composerPosition: 'top', transcriptRows: 2});
    assert.ok(plan.regions.reduce((sum, region) => sum + region.height, 0) <= rows, `rows ${rows}`);
    assert.ok(cursorScreenRow(plan, 0) < rows);
  }
});

test('composer position persists as bottom (default) or top and is editable in /settings', () => {
  assert.equal(normalizePromptConfiguration({}).composerPosition, 'bottom');
  assert.equal(normalizePromptConfiguration({composerPosition: 'top'}).composerPosition, 'top');
  assert.equal(normalizePromptConfiguration({composerPosition: 'left'}).composerPosition, 'bottom');
  const row = SETTINGS_ROWS.find(candidate => candidate.id === 'composerPosition')!;
  assert.ok(row.control === 'enum');
  assert.deepEqual(row.options, ['Bottom', 'Top']);
});

test('Dock Top render, cursor, mouse hover/click and PTY rows all follow the plan', () => {
  const app = new TerminalApp();
  try {
    app['promptConfiguration'].composerPosition = 'top';
    app['output'].beginCommand('seq', ['❯ seq']);
    app['output'].write(Array.from({length: 40}, (_, index) => `line-${index}\n`).join(''));
    app['output'].complete(0);
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 20})});
    Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
    const frames: Array<{rows: string[]; cursorRow: number}> = [];
    const sizes: number[] = [];
    app['renderer'].render = ((frame: {rows: string[]; cursorRow: number}) => { frames.push(frame); }) as never;
    app['session'].resize = ((_columns: number, rows: number) => { sizes.push(rows); }) as never;
    app['render']();
    const plan: ScreenPlan = app['planFrame'](80, 20);
    const frame = frames.at(-1)!;
    const input = regionOf(plan, 'input')!;
    assert.ok(input.top < plan.transcript.top, 'composer above transcript');
    assert.equal(frame.cursorRow, terminalRowFromScreen(input.top));
    assert.equal(sizes.at(-1), plan.ptyRows);
    const wrapped = app['output'].wrapped(80);
    const lastRow = plan.transcript.top + plan.transcript.height - 1;
    assert.equal(stripAnsi(frame.rows[lastRow]!), wrapped.at(-1)!.plain, 'newest output at the transcript bottom');
    const viewStart = app['historyViewport'].resolve(wrapped.length, plan.transcript.height);
    const hintIndex = wrapped.findIndex((row, index) => index >= viewStart && row.isFoldHint);
    assert.ok(hintIndex >= viewStart && hintIndex < viewStart + plan.transcript.height, 'fold hint visible');
    const hintScreenRow = plan.transcript.top + hintIndex - viewStart;
    app['onInput'](sgr(35, 2, terminalRowFromScreen(hintScreenRow)));
    assert.equal(app['hoveredLineIndex'], wrapped[hintIndex]!.lineIndex, 'hover maps through the top-docked plan');
    const expanded = app['output'].recent(1)!.expanded;
    app['onInput'](sgr(0, 2, terminalRowFromScreen(hintScreenRow)));
    assert.notEqual(app['output'].recent(1)!.expanded, expanded, 'click toggles the fold under Dock Top');
    app['onInput'](sgr(35, 2, terminalRowFromScreen(input.top)));
    assert.equal(app['hoveredLineIndex'], undefined, 'composer rows are never transcript');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
