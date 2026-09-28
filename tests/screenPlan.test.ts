import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateScreenLayout} from '../src/app/layout.js';
import {
  cursorScreenRow,
  planScreen,
  regionAt,
  regionOf,
  screenRowFromTerminal,
  terminalRowFromScreen,
  type ScreenPlan,
  type ScreenPlanInput,
} from '../src/app/screenPlan.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {HistoryViewport} from '../src/output/viewport.js';
import {stripAnsi} from '../src/util/text.js';
import type {ComposerLayout, ContextPlacement} from '../src/prompt/configuration.js';

const sgr = (button: number, x: number, y: number) => `\u001B[<${button};${x};${y}M`;

function* inputs(): Generator<ScreenPlanInput> {
  const placements: ContextPlacement[] = ['header', 'composer'];
  const composers: ComposerLayout[] = ['twoLine', 'oneLine'];
  for (const rows of [1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 24, 40]) {
    for (const inputRows of [1, 2, 5, 9, 30]) {
      for (const suggestions of [0, 1, 4, 20]) {
        for (const panelRows of [undefined, 0, 6, 60]) {
          for (const contextPlacement of placements) {
            for (const composerLayout of composers) {
              for (const flags of [0, 1, 2, 3, 4, 5, 6, 7, 15]) {
                yield {
                  rows,
                  inputRows,
                  suggestions,
                  panelRows,
                  contextPlacement,
                  composerLayout,
                  running: Boolean(flags & 1),
                  detached: Boolean(flags & 2),
                  hasOutput: Boolean(flags & 4),
                  hasVisibleContext: !(flags & 8),
                };
              }
            }
          }
        }
      }
    }
  }
}

/** v0.4 PTY rows, transcribed from the pre-plan render(): layout outputHeight, or rows minus panel rows. */
function legacyPtyRows(input: ScreenPlanInput): number {
  if (input.panelRows !== undefined) return Math.max(0, input.rows - input.panelRows);
  return legacyLayout(input).outputHeight;
}

function legacyLayout(input: ScreenPlanInput) {
  return calculateScreenLayout(input.rows, input.inputRows, input.suggestions, input.running, input.detached,
    input.hasOutput, input.contextPlacement, input.hasVisibleContext, input.composerLayout);
}

test('screen plan invariants hold across a deterministic geometry matrix', () => {
  let checked = 0;
  for (const input of inputs()) {
    const plan = planScreen(input);
    const label = JSON.stringify(input);
    let cursor = 0;
    for (const region of plan.regions) {
      assert.ok(region.height > 0, `listed regions are non-empty: ${label}`);
      assert.equal(region.top, cursor, `regions are contiguous and never overlap: ${label}`);
      cursor += region.height;
    }
    assert.equal(cursor, plan.rows, `regions account for every screen row: ${label}`);
    assert.ok(plan.transcript.height >= 0 && plan.transcript.top >= 0, label);
    assert.equal(plan.transcript.top, 0, `Dock Bottom transcript starts at the top: ${label}`);
    assert.equal(plan.ptyRows, legacyPtyRows(input), `PTY rows match v0.4: ${label}`);
    assert.equal(plan.panelActive, input.panelRows !== undefined, label);
    if (plan.panelActive) {
      assert.equal(plan.inputHeight, 0);
      assert.equal(plan.regions.some(region => region.kind === 'input' || region.kind === 'suggestions'), false, label);
    } else {
      const input_ = regionOf(plan, 'input');
      assert.ok(input_, `input region always exists without a panel: ${label}`);
      assert.equal(input_.height, plan.inputHeight);
      for (let caret = 0; caret < plan.inputHeight; caret += 1) {
        const row = cursorScreenRow(plan, caret);
        assert.equal(regionAt(plan, row)?.region.kind, 'input', `cursor resolves inside the input region: ${label}`);
      }
    }
    for (let row = 0; row < plan.rows; row += 1) {
      const hit = regionAt(plan, row);
      assert.ok(hit, `every row resolves to a region: ${label}`);
      assert.ok(hit.localRow >= 0 && hit.localRow < hit.region.height);
    }
    assert.equal(regionAt(plan, -1), undefined);
    assert.equal(regionAt(plan, plan.rows), undefined);
    checked += 1;
  }
  assert.ok(checked > 10_000);
});

test('plan regions reproduce every v0.4 layout flag and the v0.4 cursor row', () => {
  for (const input of inputs()) {
    if (input.panelRows !== undefined) continue;
    const plan = planScreen(input);
    const layout = legacyLayout(input);
    const height = (kind: Parameters<typeof regionOf>[1]) => regionOf(plan, kind)?.height ?? 0;
    assert.equal(plan.transcript.height, layout.outputHeight);
    assert.equal(height('gap'), Number(layout.showGap));
    assert.equal(height('jump'), Number(layout.showJump));
    assert.equal(height('suggestions'), layout.suggestionCount);
    assert.equal(height('activity'), layout.showLiveActivity ? 2 : 0);
    assert.equal(height('composerBorder'), Number(layout.showComposerTopBorder));
    assert.equal(height('prompt'), Number(layout.showPrompt));
    assert.equal(height('separator'), Number(layout.showSeparator));
    for (let caret = 0; caret < layout.inputHeight; caret += 1) {
      const legacyCursor = Math.min(input.rows, layout.outputHeight + Number(layout.showGap) + Number(layout.showJump)
        + layout.suggestionCount + (layout.showLiveActivity ? 2 : 0) + Number(layout.showComposerTopBorder)
        + Number(layout.showPrompt) + caret + 1);
      assert.equal(terminalRowFromScreen(cursorScreenRow(plan, caret)), legacyCursor, JSON.stringify(input));
    }
  }
});

test('PTY rows keep concrete v0.4 Dock Bottom values', () => {
  const base: ScreenPlanInput = {rows: 24, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: true,
    contextPlacement: 'header', hasVisibleContext: true, composerLayout: 'twoLine'};
  assert.equal(planScreen(base).ptyRows, 20, 'prompt + input + separator + gap');
  assert.equal(planScreen({...base, running: true}).ptyRows, 19, 'activity replaces the gap');
  assert.equal(planScreen({...base, suggestions: 3}).ptyRows, 17);
  assert.equal(planScreen({...base, composerLayout: 'oneLine'}).ptyRows, 20, 'border replaces the prompt row');
  assert.equal(planScreen({...base, contextPlacement: 'composer'}).ptyRows, 19, 'composer placement adds a border');
  assert.equal(planScreen({...base, inputRows: 3}).ptyRows, 18);
  assert.equal(planScreen({...base, panelRows: 10}).ptyRows, 14, 'panel takeover');
  assert.equal(planScreen({...base, panelRows: 99}).ptyRows, 0);
});

test('panel takeover pins the panel to the bottom and toggles geometry consistently', () => {
  const base: ScreenPlanInput = {rows: 20, inputRows: 2, suggestions: 4, running: false, detached: true, hasOutput: true,
    contextPlacement: 'header', hasVisibleContext: true, composerLayout: 'twoLine'};
  const open = planScreen({...base, panelRows: 6});
  assert.deepEqual(open.regions, [{kind: 'transcript', top: 0, height: 14}, {kind: 'panel', top: 14, height: 6}]);
  assert.equal(cursorScreenRow(open, 3), 14, 'hidden cursor parks at the panel');
  const closed = planScreen(base);
  assert.deepEqual(closed, planScreen({...base, panelRows: undefined}), 'closing restores the composer plan');
  assert.ok(regionOf(closed, 'input'));
});

test('terminal and screen row conversions are inverse', () => {
  for (let row = 0; row < 50; row += 1) assert.equal(screenRowFromTerminal(terminalRowFromScreen(row)), row);
  assert.equal(screenRowFromTerminal(1), 0, 'terminal row 1 is screen row 0');
});

function appWithOutput(rows = 20): TerminalApp {
  const app = new TerminalApp();
  app['output'].beginCommand('seq', ['❯ seq']);
  app['output'].write(Array.from({length: 60}, (_, index) => `line-${index}\n`).join(''));
  app['output'].complete(0);
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows})});
  Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
  return app;
}

function dispose(app: TerminalApp): void {
  app['stop'](0);
  app['session'].kill();
}

const shellSuggestions = Array.from({length: 5}, (_, index) => ({name: `s${index}`, insertion: `s${index}`, description: 'x'}));

test('render paints each region where the plan says, with the cursor in the input region', () => {
  const app = appWithOutput();
  try {
    app['shellSuggestions'] = shellSuggestions;
    const frames: Array<{rows: string[]; cursorRow: number}> = [];
    app['renderer'].render = ((frame: {rows: string[]; cursorRow: number}) => { frames.push(frame); }) as never;
    app['render']();
    const frame = frames.at(-1)!;
    const plan: ScreenPlan = app['planFrame'](80, 20);
    assert.equal(frame.rows.length, plan.rows);
    const wrapped = app['output'].wrapped(80);
    const last = plan.transcript.top + plan.transcript.height - 1;
    assert.equal(stripAnsi(frame.rows[last]!), wrapped.at(-1)!.plain, 'transcript ends at its region bottom');
    const suggestions = regionOf(plan, 'suggestions')!;
    assert.equal(suggestions.height, 5);
    assert.match(stripAnsi(frame.rows[suggestions.top]!), /^› s0/u);
    const input = regionOf(plan, 'input')!;
    assert.equal(frame.cursorRow, terminalRowFromScreen(input.top));
  } finally {
    dispose(app);
  }
});

test('mouse hit-testing uses the rendered plan: slash suggestions are never transcript rows', () => {
  const app = appWithOutput();
  try {
    Object.defineProperty(app, 'render', {value: () => {}});
    app['editor'].insert('/');
    const plan: ScreenPlan = app['planFrame'](80, 20);
    const suggestions = regionOf(plan, 'suggestions');
    assert.ok(suggestions, 'slash suggestions are visible');
    app['onInput'](sgr(35, 2, terminalRowFromScreen(suggestions.top)));
    assert.equal(app['hoveredLineIndex'], undefined, 'hovering a suggestion row does not hover transcript');
    const wrapped = app['output'].wrapped(80);
    const lastRow = plan.transcript.height - 1;
    app['onInput'](sgr(35, 2, terminalRowFromScreen(plan.transcript.top + lastRow)));
    const viewStart = app['historyViewport'].resolve(wrapped.length, plan.transcript.height);
    assert.equal(app['hoveredLineIndex'], wrapped[viewStart + lastRow]!.lineIndex, 'last transcript row hovers');
    app['onInput'](sgr(36, 2, 2));
    assert.equal(app['hoveredLineIndex'], wrapped[viewStart + lastRow]!.lineIndex, 'shift+motion stays native');
  } finally {
    dispose(app);
  }
});

test('mouse hit-testing respects panel takeover geometry', () => {
  const app = appWithOutput();
  try {
    Object.defineProperty(app, 'render', {value: () => {}});
    app['appearanceState'] = {} as never;
    Object.defineProperty(app, 'settingsPanelRows', {value: () => Array.from({length: 6}, () => 'panel')});
    const plan: ScreenPlan = app['planFrame'](80, 20);
    assert.equal(plan.transcript.height, 14);
    const wrapped = app['output'].wrapped(80);
    const viewStart = app['historyViewport'].resolve(wrapped.length, 14);
    app['onInput'](sgr(35, 2, 14));
    assert.equal(app['hoveredLineIndex'], wrapped[viewStart + 13]!.lineIndex, 'row just above the panel is transcript');
    app['onInput'](sgr(35, 2, 15));
    assert.equal(app['hoveredLineIndex'], undefined, 'panel rows are not transcript');
  } finally {
    dispose(app);
  }
});

test('scroll paging uses the rendered transcript height including shell suggestions', () => {
  const app = appWithOutput();
  try {
    Object.defineProperty(app, 'render', {value: () => {}});
    app['shellSuggestions'] = shellSuggestions;
    const height = (app['planFrame'](80, 20) as ScreenPlan).transcript.height;
    const total = app['output'].wrapped(80).length;
    const expected = new HistoryViewport();
    expected.resolve(total, height);
    expected.page(total, height, -1);
    app['onInput']('\u001B[5~');
    assert.equal(app['historyViewport'].start, expected.start);
  } finally {
    dispose(app);
  }
});

test('PTY resizes to plan rows on panel open/close and full screen in passthrough', () => {
  const app = appWithOutput();
  try {
    const sizes: number[] = [];
    app['session'].resize = ((_columns: number, rows: number) => { sizes.push(rows); }) as never;
    app['renderer'].render = (() => {}) as never;
    app['render']();
    const closed = sizes.at(-1)!;
    assert.equal(closed, 16, 'v0.4: 20 rows minus gap, prompt, input, separator');
    app['appearanceState'] = {} as never;
    Object.defineProperty(app, 'settingsPanelRows', {value: () => Array.from({length: 6}, () => 'panel'), configurable: true});
    app['render']();
    assert.equal(sizes.at(-1), 14);
    app['appearanceState'] = undefined;
    app['render']();
    assert.equal(sizes.at(-1), closed);
    app['passthrough'] = true;
    app['onResize']();
    assert.equal(sizes.at(-1), 20, 'passthrough keeps the full terminal');
    app['passthrough'] = false;
    app['render']();
    assert.equal(sizes.at(-1), closed, 'returning rebuilds the Bottom plan');
  } finally {
    dispose(app);
  }
});
