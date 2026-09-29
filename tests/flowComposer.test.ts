import test from 'node:test';
import assert from 'node:assert/strict';
import {cursorScreenRow, planScreen, regionAt, regionOf, terminalRowFromScreen, type ScreenPlan, type ScreenPlanInput} from '../src/app/screenPlan.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {stripAnsi} from '../src/util/text.js';

const base: ScreenPlanInput = {rows: 24, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: true,
  contextPlacement: 'header', hasVisibleContext: true, composerLayout: 'twoLine', composerPosition: 'flow'};
const kinds = (plan: ScreenPlan) => plan.regions.map(region => region.kind);
const contiguous = (plan: ScreenPlan) => {
  assert.ok(plan.regions.reduce((sum, region) => sum + region.height, 0) <= plan.rows);
  plan.regions.forEach((region, index) => index > 0 && assert.equal(region.top, plan.regions[index - 1]!.top + plan.regions[index - 1]!.height));
};

test('Flow places the composer right after the newest output and follows its growth', () => {
  const bottom = planScreen({...base, composerPosition: 'bottom'});
  const short = planScreen({...base, transcriptRows: 3});
  // The existing breathing-space row separates output from the composer, as in Bottom.
  assert.deepEqual(kinds(short), ['transcript', 'gap', 'prompt', 'input', 'separator']);
  assert.equal(short.transcript.height, 3);
  assert.equal(regionOf(short, 'prompt')!.top, 4, 'prompt directly after the output and its gap');
  assert.equal(cursorScreenRow(short, 0), regionOf(short, 'input')!.top);
  const longer = planScreen({...base, transcriptRows: 10});
  assert.equal(regionOf(longer, 'input')!.top, regionOf(short, 'input')!.top + 7, 'the composer moves down with output');
  const full = planScreen({...base, transcriptRows: 500});
  assert.equal(regionOf(full, 'input')!.top, regionOf(bottom, 'input')!.top, 'a full screen lands where Bottom docks');
  for (const plan of [short, longer, full]) {
    assert.equal(plan.ptyRows, bottom.ptyRows, 'the shell always gets the full capacity; output growth never resizes it');
    contiguous(plan);
  }
  const empty = planScreen({...base, hasOutput: false, transcriptRows: 0});
  assert.equal(regionOf(empty, 'prompt')!.top, 0, 'a fresh session starts at the top like a terminal');
});

test('Flow menus open below the input; activity sits between output and composer', () => {
  const plan = planScreen({...base, suggestions: 3, running: true, transcriptRows: 4});
  // While running, the activity row brings its own spacer instead of the gap.
  assert.deepEqual(kinds(plan), ['transcript', 'activity', 'prompt', 'input', 'separator', 'suggestions']);
  assert.equal(regionOf(plan, 'activity')!.top, 4);
  const full = planScreen({...base, suggestions: 3, running: true, transcriptRows: 500});
  assert.deepEqual(kinds(full), ['transcript', 'activity', 'prompt', 'input', 'separator', 'suggestions']);
  assert.equal(full.regions.at(-1)!.top + full.regions.at(-1)!.height, full.rows, 'still fits when the screen is full');
});

test('Flow scrolled back: the composer scrolls with the document and PTY and viewport rows stay fixed', () => {
  const following = planScreen({...base, running: true, suggestions: 2, transcriptRows: 500});
  const followInput = regionOf(following, 'input')!;
  // Three rows back: everything below the transcript moves down three rows, clipped at the edge.
  const nudged = planScreen({...base, running: true, suggestions: 2, detached: true, transcriptRows: 500,
    viewStart: 500 - following.viewportRows - 3});
  assert.equal(nudged.transcript.height, following.transcript.height + 3);
  assert.equal(regionOf(nudged, 'activity')!.top, regionOf(following, 'activity')!.top + 3);
  assert.equal(nudged.ptyRows, following.ptyRows, 'scrolling back never resizes the shell');
  assert.equal(nudged.viewportRows, following.viewportRows, 'the viewport keeps the following capacity, so it never snaps back');
  contiguous(nudged);
  // A page back: the composer is entirely below the view.
  const paged = planScreen({...base, running: true, suggestions: 2, detached: true, transcriptRows: 500, viewStart: 100});
  assert.deepEqual(kinds(paged), ['transcript']);
  assert.equal(paged.transcript.height, paged.rows);
  assert.equal(paged.inputHeight, 0);
  assert.equal(regionOf(paged, 'input'), undefined);
  assert.ok(followInput.top > 0);
});

test('Flow panels pin to the bottom edge; narrow terminals and long input never overflow', () => {
  const panel = planScreen({...base, panelRows: 8, transcriptRows: 3});
  assert.deepEqual(kinds(panel), ['transcript', 'panel']);
  assert.equal(panel.composerPosition, 'flow');
  assert.equal(regionAt(panel, 23)?.region.kind, 'panel');
  for (let rows = 1; rows <= 14; rows += 1) {
    for (const transcriptRows of [0, 2, 400]) {
      for (const [detached, viewStart] of [[false, 0], [true, 0], [true, 395], [true, 399]] as const) {
        const plan = planScreen({...base, rows, inputRows: 12, suggestions: 4, running: true, detached, transcriptRows, viewStart});
        contiguous(plan);
        assert.ok(cursorScreenRow(plan, 0) < rows, `rows ${rows}`);
      }
    }
  }
});

test('composer position accepts Flow', () => {
  assert.equal(normalizePromptConfiguration({composerPosition: 'flow'}).composerPosition, 'flow');
  assert.equal(normalizePromptConfiguration({composerPosition: 'Flow!'}).composerPosition, 'bottom');
});

function flowApp(columns = 80, rows = 20) {
  const app = new TerminalApp();
  app['promptConfiguration'].composerPosition = 'flow';
  // Long test output must stay scrollable rather than fold into a summary.
  app['output'].setOutputFolding('never');
  Object.defineProperty(app, 'dimensions', {value: () => ({columns, rows})});
  Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
  const frames: Array<{rows: string[]; cursorRow: number; cursorVisible: boolean}> = [];
  const sizes: number[] = [];
  app['renderer'].render = ((frame: {rows: string[]; cursorRow: number; cursorVisible: boolean}) => { frames.push(frame); }) as never;
  app['session'].resize = ((_columns: number, ptyRows: number) => { sizes.push(ptyRows); }) as never;
  app['session'].write = (() => {}) as never;
  return {app, frames, sizes};
}

const output = (app: TerminalApp, lines: number) => {
  app['output'].beginCommand('seq', ['❯ seq']);
  app['output'].write(Array.from({length: lines}, (_, index) => `line-${index}\n`).join(''));
  app['output'].complete(0);
};
const wheelUp = '\u001B[<64;2;2M';

test('Flow render: the input row follows the newest output and the PTY size stays fixed', () => {
  const {app, frames, sizes} = flowApp();
  try {
    output(app, 2);
    app['render']();
    const shortPlan: ScreenPlan = app['planFrame'](80, 20);
    const shortInput = regionOf(shortPlan, 'input')!;
    assert.ok(shortInput.top < 12, 'short output: composer near the top');
    assert.equal(frames.at(-1)!.cursorRow, terminalRowFromScreen(shortInput.top));
    assert.equal(stripAnsi(frames.at(-1)!.rows[shortPlan.transcript.top + shortPlan.transcript.height - 1]!),
      app['output'].wrapped(80).at(-1)!.plain, 'newest output directly above the composer');
    output(app, 60);
    app['render']();
    const fullPlan: ScreenPlan = app['planFrame'](80, 20);
    assert.ok(regionOf(fullPlan, 'input')!.top > shortInput.top, 'composer followed the output down');
    assert.equal(new Set(sizes).size, 1, 'PTY rows never changed as output grew');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('Flow: scrolling moves the composer with the document; wheel alone keeps the view; typing returns to it', () => {
  const {app, frames} = flowApp();
  try {
    output(app, 80);
    app['render']();
    const followInput = regionOf(app['planFrame'](80, 20), 'input')!;
    app['onInput'](wheelUp);
    app['render']();
    assert.equal(app['historyViewport'].detached, true, 'a small scroll back stays detached');
    const nudged = regionOf(app['planFrame'](80, 20), 'input');
    assert.ok(!nudged || nudged.top === followInput.top + 3, 'the composer moved down with the document');
    app['onInput']('\u001B[5~'); // Page Up
    app['render']();
    assert.equal(regionOf(app['planFrame'](80, 20), 'input'), undefined, 'a page back: composer below the view');
    assert.equal(frames.at(-1)!.cursorVisible, false, 'no input row on screen');
    app['onInput'](wheelUp);
    app['onInput']('\u001B[<35;2;5M'); // mouse move
    assert.equal(app['historyViewport'].detached, true, 'scroll and mouse navigation alone stay detached');
    app['onInput']('e');
    assert.equal(app['historyViewport'].detached, false, 'typing returns to the newest output');
    assert.equal(app['editor'].text, 'e', 'the key is still typed');
    app['render']();
    assert.equal(frames.at(-1)!.cursorVisible, true);
    assert.equal(regionOf(app['planFrame'](80, 20), 'input')!.top, followInput.top);
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('Bottom and Top keep their existing behavior: typing does not change the scrolled view', () => {
  for (const position of ['bottom', 'top'] as const) {
    const {app} = flowApp();
    try {
      app['promptConfiguration'].composerPosition = position;
      output(app, 80);
      app['render']();
      app['onInput'](wheelUp);
      app['onInput']('e');
      assert.equal(app['historyViewport'].detached, true, position);
    } finally {
      app['stop'](0);
      app['session'].kill();
    }
  }
});

test('Flow + Chat: the live composer renders normally while history renders right-aligned', () => {
  const {app, frames} = flowApp();
  try {
    app['promptConfiguration'].transcriptPresentation = 'chat';
    app['output'].presenter.setLayout('chat');
    output(app, 2);
    app['onInput']('echo hi');
    app['render']();
    const plan: ScreenPlan = app['planFrame'](80, 20);
    const inputRow = stripAnsi(frames.at(-1)!.rows[regionOf(plan, 'input')!.top]!);
    assert.match(inputRow, /^\S*\s?echo hi/, 'composer input stays left-aligned');
    const historyRow = frames.at(-1)!.rows.slice(plan.transcript.top, plan.transcript.top + plan.transcript.height)
      .map(row => stripAnsi(row)).find(row => row.includes('seq'));
    assert.ok(historyRow && /^\s{10,}/u.test(historyRow), 'historical command right-aligned in Chat');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('Flow end to end: fullscreen apps stay raw, and returning restores the document and composer', async () => {
  const {LiveSandbox, until} = await import('./helpers/liveFrontend.js');
  const sandbox = new LiveSandbox({composerPosition: 'flow'});
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    await app.run('echo FLOW-BEFORE', /FLOW-BEFORE/);
    let mark = app.mark;
    app.pty.write(`printf '\\e[?1049hFULL-SCREEN'; read -k1 _; printf '\\e[?1049l'\r`);
    await app.waitFor(/FULL-SCREEN/, mark);
    mark = app.mark;
    app.pty.write('q');
    // The app leaves the alternate screen itself; then NMSh repaints its composer.
    await until(() => app.output.indexOf('\u001b[?1049l', mark) !== -1, 15000, 'fullscreen exit');
    await app.waitFor(/❯/, app.output.indexOf('\u001b[?1049l', mark));
    await app.run('echo FLOW-AFTER', /FLOW-AFTER/);
    assert.match(app.output.slice(mark).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, ''), /FLOW-BEFORE/, 'the document was repainted');
  } finally {
    await sandbox.dispose();
  }
});
