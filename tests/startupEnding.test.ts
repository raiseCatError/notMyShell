import test from 'node:test';
import assert from 'node:assert/strict';
import {CellGrid} from '../src/idle/CellGrid.js';
import {pureMix} from '../src/idle/auroraMoods.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {ENDING_MS, endingDuration, paintStartupEnding, WELCOME_STEP_MS, type StartupEnding} from '../src/setup/startup/ending.js';
import {FIRST_RUN_HEADLINE_LINE, renderFirstRunWelcome} from '../src/output/FirstRunWelcome.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/** The ending: setup folds away into the real transcript and composer. Presentation only; the real frame is never cleared. */
function withColor<T>(run: () => T): T {
  const saved = {color: process.env.NMSH_COLOR, none: process.env.NO_COLOR};
  process.env.NMSH_COLOR = 'truecolor'; delete process.env.NO_COLOR;
  try { return run(); } finally {
    if (saved.color === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = saved.color;
    if (saved.none !== undefined) process.env.NO_COLOR = saved.none;
  }
}

const COLUMNS = 60, ROWS = 30, SKY = 12;
const real = Array.from({length: ROWS}, (_, i) => i < 27 ? `transcript ${i}` : i === 27 ? 'PROMPT ROW' : i === 28 ? 'INPUT ROW' : 'SEPARATOR ROW');
const plan = {regions: [{kind: 'transcript' as const, top: 0, height: 27}, {kind: 'prompt' as const, top: 27, height: 1}, {kind: 'input' as const, top: 28, height: 1}, {kind: 'separator' as const, top: 29, height: 1}]};
const ending = (over: Partial<StartupEnding> = {}): StartupEnding => ({start: 10_000, skyHeight: SKY, columns: COLUMNS, rows: ROWS,
  sky: {started: 0, mood: 'aurora', previousMood: 'aurora', changedAt: Number.NEGATIVE_INFINITY, from: pureMix('aurora'), timeAt: 0, activeAt: 9_000},
  backdrop: 'aurora', config: structuredClone(DEFAULT_PROMPT_CONFIGURATION),
  ground: Array.from({length: ROWS - SKY}, (_, i) => i === 0 ? '' : `ground ${i}`), composerFrom: 3, welcome: false, welcomeLines: 0, ...over});
const skyRows = (rows: readonly string[]) => { let count = 0; while (count < rows.length && /\u001b\[48;2;/u.test(rows[count]!) && !rows[count]!.includes('▔')) count++; return count; };
const composerOffset = (rows: readonly string[]) => {
  const index = rows.findIndex(row => stripAnsi(row) === 'PROMPT ROW');
  return index < 0 ? Number.POSITIVE_INFINITY : index - 27;
};

test('frames at 0, 120, 300, 520, 700 and 880 ms: the ground recedes, the sky folds into a rule that fades, the composer rises', () => withColor(() => {
  const sky = new CellGrid();
  const frames = [0, 120, 300, 520, 700, 880].map(t => ({t, ...paintStartupEnding(real, plan, COLUMNS, 10_000 + t, ending(), sky)}));
  const at = (t: number) => frames.find(frame => frame.t === t)!;
  // The ground: faint over the real frame at first, then gone.
  assert.ok(at(0).rows.some(row => stripAnsi(row) === 'ground 3' && row.includes('\u001b[2m')), 'the ground is drawn faint');
  assert.ok(at(120).rows.some(row => stripAnsi(row) === 'ground 3'));
  for (const t of [300, 520, 700, 880]) assert.ok(!at(t).rows.some(row => stripAnsi(row).startsWith('ground')), `${t}: the ground is gone`);
  assert.equal(stripAnsi(at(0).rows[28]!), 'ground 16', 'it recedes everywhere, the composer\'s landing place included');
  // The sky: folds upward on the real engine, its height never grows; then one rule; then nothing.
  const heights = frames.map(frame => skyRows(frame.rows));
  assert.equal(heights[0], SKY);
  for (let i = 1; i < heights.length; i++) assert.ok(heights[i]! <= heights[i - 1]!, `sky height ${heights}`);
  assert.ok(heights[1]! < SKY && heights[2]! < heights[1]!, 'it folds');
  assert.equal(heights[3], 0);
  // The rule sits behind the real frame: it fills row 0 only after the row's own text, never over or between it.
  const behind = `transcript 0 ${'▔'.repeat(COLUMNS - 13)}`;
  assert.equal(stripAnsi(at(520).rows[0]!), behind, 'one luminous rule at the top, behind the real row');
  assert.equal(stripAnsi(at(700).rows[0]!), behind, 'the rule is still fading');
  const open = paintStartupEnding(['', ...real.slice(1)], plan, COLUMNS, 10_000 + 600, ending(), sky);
  assert.equal(stripAnsi(open.rows[0]!), '▔'.repeat(COLUMNS), 'over a blank row it spans the width');
  assert.notEqual(at(700).rows[0], at(520).rows[0], 'it fades');
  assert.equal(at(880).rows[0], real[0], 'then nothing: the real frame shows');
  // The horizon rides the folding sky's bottom edge.
  assert.equal(stripAnsi(at(120).rows[heights[1]!]!), '▔'.repeat(COLUMNS));
  // The composer rises from below the bottom edge into its own place, the caret hidden until it lands.
  const offsets = frames.map(frame => composerOffset(frame.rows));
  assert.equal(offsets[0], Number.POSITIVE_INFINITY, 'it starts below the bottom edge');
  for (let i = 1; i < offsets.length; i++) assert.ok(offsets[i]! <= offsets[i - 1]!, `offsets ${offsets}`);
  assert.equal(offsets.at(-1), 0);
  assert.deepEqual(frames.map(frame => frame.caretVisible), [false, false, false, false, false, true]);
  assert.deepEqual(frames.map(frame => frame.done), [false, false, false, false, false, true]);
  assert.deepEqual(at(880).rows, real, 'the last frame is exactly the real frame');
  assert.equal(ENDING_MS, 880);
}));

test('Vespyr rides the folding horizon up and out of view instead of vanishing', () => withColor(() => {
  const sky = new CellGrid();
  const with0 = paintStartupEnding(real, plan, COLUMNS, 10_000, ending({catX: 4}), sky).rows.slice(0, SKY);
  const without0 = paintStartupEnding(real, plan, COLUMNS, 10_000, ending(), sky).rows.slice(0, SKY);
  assert.notDeepEqual(with0, without0, 'the cat stands on the horizon as the fold begins');
  assert.deepEqual(with0.slice(0, SKY - 4), without0.slice(0, SKY - 4), 'on the horizon, not above it');
  const mid = (catX?: number) => paintStartupEnding(real, plan, COLUMNS, 10_000 + 200, ending(catX === undefined ? {} : {catX}), sky).rows;
  assert.notDeepEqual(mid(4), mid(), 'still riding it mid-fold, clipped by the top edge');
  const gone = (catX?: number) => paintStartupEnding(real, plan, COLUMNS, 10_000 + 600, ending(catX === undefined ? {} : {catX}), sky).rows;
  assert.deepEqual(gone(4), gone(), 'gone once the sky is');
}));

test('the composer rise is short at the bottom and long in Flow; rows it leaves are blank, never stale', () => withColor(() => {
  const flowPlan = {regions: [{kind: 'transcript' as const, top: 0, height: 4}, {kind: 'prompt' as const, top: 4, height: 1}, {kind: 'input' as const, top: 5, height: 1}]};
  const flowReal = Array.from({length: ROWS}, (_, i) => i < 4 ? `transcript ${i}` : i === 4 ? 'PROMPT ROW' : i === 5 ? 'INPUT ROW' : '');
  const frame = paintStartupEnding(flowReal, flowPlan, COLUMNS, 10_000 + 500, ending({composerFrom: ROWS - 4, skyHeight: 0, ground: []}), new CellGrid());
  const index = frame.rows.findIndex(row => stripAnsi(row) === 'PROMPT ROW');
  assert.ok(index > 6, 'mid-rise, well below its own place');
  assert.equal(frame.rows[4], '', 'the place it will land is blank until then');
  assert.equal(frame.rows[5], '');
}));

test('the ending lasts 880 ms, longer while a first-run welcome is still arriving', () => withColor(() => {
  assert.equal(endingDuration(ending({welcome: false})), ENDING_MS);
  assert.ok(endingDuration(ending({welcome: true, welcomeLines: 12})) > ENDING_MS, 'the welcome keeps arriving after the composer lands');
}));

test('the first-run welcome: the luminous rule, the headline, the lead, the four ways in and the aurora\'s new home', () => withColor(() => {
  const rows = renderFirstRunWelcome(80);
  const text = rows.map(row => row.plain).join('\n');
  assert.match(text, /You're all set\. Welcome to notMyShell!/u);
  // The lead wraps to a reading measure, as in the reference.
  assert.match(text.replace(/\s+/gu, ' '), /We're so glad you're here\. Your shell is still yours; NMSh just makes it a nicer place to live\./u);
  for (const tip of ['/guide', '/btw', 'F1', '/startup', '/setup']) assert.ok(text.includes(tip), tip);
  assert.match(text, /The aurora lives on in \/screensaver\./u);
  assert.ok(rows.some(row => /[▁_]{20,}/u.test(row.plain)), 'the horizon, kept as a short luminous rule');
  assert.ok(rows.every(row => row.plain.length <= 80));
  for (const row of renderFirstRunWelcome(24)) assert.ok(stripAnsi(row.ansi).length <= 24);
  // Lines arrive one at a time: a wrapped paragraph is one line, a spacer arrives with the line after it,
  // and everything after Vespyr's block (line 0) lands in under 600 ms.
  const lines = rows.map(row => row.firstRunLine);
  assert.ok(lines.every(line => typeof line === 'number' && line >= 1), `numbered ${lines}`);
  for (let i = 1; i < lines.length; i++) assert.ok(lines[i]! >= lines[i - 1]!, `in order ${lines}`);
  const lead = rows.filter(row => /glad|nicer place/u.test(row.plain));
  assert.equal(lead.length, 2, 'the lead wraps at 80 columns');
  assert.equal(lead[0]!.firstRunLine, lead[1]!.firstRunLine, 'and arrives as one line');
  assert.equal(rows.find(row => row.plain.includes('You\'re all set'))!.firstRunLine, FIRST_RUN_HEADLINE_LINE);
  assert.equal(rows[0]!.plain, '', 'a spacer first');
  assert.equal(rows[0]!.firstRunLine, rows[1]!.firstRunLine, 'arriving with the rule');
  assert.ok(WELCOME_STEP_MS * Math.max(...lines.map(Number)) < 600, 'the whole welcome arrives in under 600 ms');
  assert.equal(renderFirstRunWelcome(24).length > rows.length, true, 'narrow widths wrap rather than cut');
  assert.ok(renderFirstRunWelcome(24).every(row => typeof row.firstRunLine === 'number'), 'and keep their numbering');
}));

const startQuick = (f: ReturnType<typeof executionFrameFixture>, firstRun: boolean) => {
  if (firstRun) {
    Object.assign(f.app['promptConfiguration'], {onboardingComplete: false, introSeen: false, toolsSetupComplete: false});
    f.app['startOnboarding']();
  } else f.app['startSetup']('quick');
  assert.ok(f.app['setupState']?.quick);
  f.capture();
};
const transcriptText = (f: ReturnType<typeof executionFrameFixture>) => f.app['output'].wrapped(100).map((row: {plain: string}) => row.plain).join('\n');

test('Apply on a genuine first run with Recommended: the welcome, once, in the real transcript; the ending runs and lands', () => {
  const f = executionFrameFixture(100, 32, 'rich');
  try {
    startQuick(f, true);
    f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
    assert.equal(f.app['setupState'], undefined, 'the selector closed');
    assert.equal(f.app['promptConfiguration'].onboardingComplete, true, 'applied before the ending');
    assert.ok(f.app['startupEnding'], 'the ending runs');
    assert.ok(f.app['output'].transcript().firstRun, 'the first-run welcome is stored with the transcript');
    assert.ok(f.app['output'].view().welcome, 'with Vespyr\'s welcome block');
    const frame = f.capture().frame;
    assert.equal(frame.cursorVisible, false, 'the caret waits for the composer');
    assert.doesNotMatch(transcriptText(f), /is ready ·/u, 'no receipt on the first run with Recommended');
    assert.equal(f.app['toolsPanel'], undefined, 'the tools review waits for the ending');
    for (let t = 0; t < 4000 && f.app['startupEnding']; t += 40) f.paint(40);
    assert.equal(f.app['startupEnding'], undefined, 'the ending finished');
    assert.equal(f.app['startupEndingClock'], undefined, 'and its clock with it');
    // Then the review chose Review and install recommended tools: the shared panel, filtered, nothing installed.
    const tools = f.app['toolsPanel'];
    assert.ok(tools, 'the tools panel opens after the ending');
    assert.equal(tools.tier, 'recommended');
    assert.ok(tools.preselect || tools.selection, 'missing recommended tools are ticked once verified');
    assert.equal(tools.confirm, undefined, 'nothing installs without its confirmation');
    f.app['handleKey']({kind: 'escape'});
    assert.equal(f.app['toolsPanel'], undefined, 'Esc declines; onboarding is complete anyway');
    assert.equal(f.app['promptConfiguration'].onboardingComplete, true);
    const final = f.capture().frame;
    assert.equal(final.cursorVisible, true);
    assert.match(final.rows.map(stripAnsi).join('\n'), /You're all set\. Welcome to notMyShell!/u);
    // Reopening and applying Recommended again never replays the welcome: a receipt only.
    f.app['startSetup']('quick'); f.capture();
    f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
    f.app['finishStartupEnding']();
    assert.equal(transcriptText(f).match(/You're all set/gu)?.length, 1, 'one welcome only');
    assert.match(transcriptText(f), /✓ NMSh Recommended is ready · \/startup changes it anytime/u);
  } finally { f.dispose(); }
});

test('Minimal and Keep Existing: the first run is welcomed once like Recommended; later applies add one receipt line', async () => {
  for (const [choice, receipt] of [['2', /✓ Minimal Terminal is ready · Two-line · \/startup changes it anytime/u], ['4', /✓ Keeping your setup · zsh · (?:nothing changed · )?\/startup changes it anytime/u]] as const) {
    const f = executionFrameFixture(100, 32, 'rich');
    try {
      startQuick(f, true);
      await new Promise(resolve => setImmediate(resolve));
      f.app['handleKey']({kind: 'text', value: choice}); f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
      assert.equal(f.app['setupState'], undefined, `choice ${choice} applied`);
      f.app['finishStartupEnding']();
      let text = transcriptText(f);
      assert.match(text, /You're all set\. Welcome to notMyShell!/u, `choice ${choice}: welcomed`);
      for (const tip of ['/guide', '/btw', 'F1', '/startup', '/setup']) assert.ok(text.includes(tip), `${choice}: ${tip}`);
      assert.ok(f.app['output'].view().welcome, `choice ${choice}: with Vespyr's block, whatever the welcome preference`);
      assert.doesNotMatch(text, /✓/u, 'no receipt on the first run');
      assert.doesNotMatch(text, /❯ \/(?:setup|startup)/u, 'no command echo');
      if (choice === '2') assert.equal(f.app['promptConfiguration'].welcome, 'none', 'Minimal keeps no welcome on later launches');
      // Reopening /startup and applying again: one receipt line, never a second welcome.
      f.app['startSetup']('quick'); f.capture();
      await new Promise(resolve => setImmediate(resolve));
      f.app['handleKey']({kind: 'text', value: choice}); f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
      f.app['finishStartupEnding']();
      text = transcriptText(f);
      assert.match(text, receipt);
      assert.equal(text.match(/✓/gu)?.length, 1, 'one receipt line');
      assert.equal(text.match(/You're all set/gu)?.length, 1, 'one welcome only');
    } finally { f.dispose(); }
  }
});

test('a key at 300 ms finishes the ending and types into the composer exactly once; a resize finishes it too', () => {
  const f = executionFrameFixture(100, 32, 'rich');
  try {
    startQuick(f, false);
    f.app['handleKey']({kind: 'text', value: '2'}); f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
    assert.ok(f.app['startupEnding']);
    f.paint(300);
    f.app['handleKey']({kind: 'text', value: 'x'});
    assert.equal(f.app['startupEnding'], undefined, 'the key finished the ending');
    assert.equal(f.app['editor'].text, 'x', 'and reached the composer once');
    assert.equal(f.app['startupEndingClock'], undefined);
    assert.equal(f.capture().frame.cursorVisible, true);
    // Minimal turned effects off: reopening the selector now runs without motion, so Apply has no ending.
    f.app['startSetup']('quick'); f.capture();
    f.app['handleKey']({kind: 'text', value: '1'}); f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
    assert.equal(f.app['startupEnding'], undefined, 'the selector ran without motion, so it simply closes');
  } finally { f.dispose(); }
  const g = executionFrameFixture(100, 32, 'rich');
  try {
    startQuick(g, false);
    g.app['handleKey']({kind: 'enter'}); g.app['handleKey']({kind: 'enter'});
    assert.ok(g.app['startupEnding']);
    g.paint(120);
    g.app['onResize']();
    assert.equal(g.app['startupEnding'], undefined, 'a resize finishes it');
    assert.equal(g.app['startupEndingClock'], undefined);
  } finally { g.dispose(); }
});

test('Reduced Motion and Effects Off: Apply shows the final state at once, with no clock', () => {
  for (const mode of ['reduced', 'effects-off'] as const) {
    const f = executionFrameFixture(100, 32, mode);
    try {
      startQuick(f, false);
      f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
      assert.equal(f.app['startupEnding'], undefined, mode);
      assert.equal(f.app['startupEndingClock'], undefined);
      assert.ok(f.app['toolsPanel'], 'with no ending, the chosen tools review opens at once');
      f.app['handleKey']({kind: 'escape'});
      assert.equal(f.capture().frame.cursorVisible, true);
    } finally { f.dispose(); }
  }
});

test('Leave on a first run applies nothing and says so quietly; the welcome is not shown', () => {
  const f = executionFrameFixture(100, 32, 'rich');
  try {
    startQuick(f, true);
    const before = structuredClone(f.app['promptConfiguration']);
    f.app['handleKey']({kind: 'escape'}); f.app['handleKey']({kind: 'right'}); f.app['handleKey']({kind: 'enter'});
    assert.equal(f.app['setupState'], undefined);
    assert.equal(f.app['startupEnding'], undefined, 'nothing to land: no ending');
    assert.equal(f.app['promptConfiguration'].onboardingComplete, before.onboardingComplete);
    assert.match(transcriptText(f), /Setup closed\. Nothing was applied · \/startup reopens it/u);
    assert.equal(f.app['output'].transcript().firstRun, undefined);
  } finally { f.dispose(); }
});

test('the first-run welcome survives the transcript round trip and is never added twice', () => {
  const f = executionFrameFixture(100, 32, 'reduced');
  try {
    startQuick(f, true);
    f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
    const saved = f.app['output'].transcript();
    assert.deepEqual(saved.firstRun, {version: 1});
    f.app['output'].restoreTranscript(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(f.app['output'].transcript().firstRun, {version: 1});
    assert.match(transcriptText(f), /You're all set/u);
    f.app['output'].restoreTranscript({...saved, firstRun: {version: 99}} as never);
    assert.equal(f.app['output'].transcript().firstRun, undefined, 'an unknown version is refused, not guessed');
    void parseSlashCommand; void normalizePromptConfiguration;
  } finally { f.dispose(); }
});
