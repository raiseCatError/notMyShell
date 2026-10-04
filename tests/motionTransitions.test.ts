import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {DEFAULT_MOTION, DEFAULT_PROMPT_CONFIGURATION, MIGRATED_MOTION, normalizeMotion, normalizePromptConfiguration, type MotionSettings} from '../src/prompt/configuration.js';
import {decayCells, diffModules, DURATIONS, morphCells, sweepCells, transitionPaint, Transitions} from '../src/motion/transitions.js';
import {overlayRow} from '../src/presentation/cellOverlay.js';
import {PREVIEW_HEIGHT, renderMotionPreview} from '../src/motion/MotionPreview.js';
import {applyUiTheme} from '../src/appearance/uiTheme.js';
import {stripAnsi} from '../src/util/text.js';

const gate = {reducedMotion: false, effectsOff: false, color: true};
const make = (motion: Partial<MotionSettings> = {}, current = gate) => new Transitions(() => ({...DEFAULT_MOTION, ...motion}), () => current);

test('motion registry: fresh installs restrained, existing configs migrate to Off', () => {
  assert.deepEqual(DEFAULT_PROMPT_CONFIGURATION.motion, DEFAULT_MOTION);
  assert.equal(DEFAULT_MOTION.commandLaunch, 'sweep');
  assert.equal(DEFAULT_MOTION.contextTransitions, 'subtle');
  assert.deepEqual(normalizeMotion(undefined), MIGRATED_MOTION, 'an older config without a motion group sees nothing new move');
  assert.deepEqual(normalizePromptConfiguration({nmsh: {}}).motion, MIGRATED_MOTION);
  assert.equal(normalizeMotion({commandLaunch: 'pulse', contextTransitions: 'bogus'}).commandLaunch, 'pulse');
});

test('transitions are finite, replace rather than queue, and stop completely', () => {
  const transitions = make();
  transitions.launch(0);
  transitions.launch(50);
  assert.equal(transitions.live(60).filter(item => item.kind === 'launch').length, 1, 'a second Enter retargets, never queues');
  assert.equal(transitions.live(50 + DURATIONS.launch).length, 0);
  assert.equal(transitions.busy, false, 'nothing live: no clock needed');
  transitions.materialize(4, 9, 'git checkout', 0);
  transitions.editorChanged('git checkout x');
  assert.equal(transitions.live(10).length, 0, 'editing drops a stale materialization');
});

test('Reduced Motion, Decorative Effects Off and NO_COLOR start nothing; Off settings start nothing', () => {
  for (const blocked of [{...gate, reducedMotion: true}, {...gate, effectsOff: true}, {...gate, color: false}]) {
    const transitions = make({}, blocked);
    transitions.launch(0); transitions.seal(1, 'failure', 0); transitions.echo('failure', 0); transitions.morph([{id: 'cwd', text: '~/x', change: 'changed'}], 0);
    assert.equal(transitions.live(1).length, 0);
  }
  const off = make({commandLaunch: 'off', completionHighlight: 'off', completionEffect: 'off', eventFeedback: 'off', contextTransitions: 'off'});
  off.launch(0); off.materialize(0, 3, 'abc', 0); off.seal(1, 'success', 0); off.echo('failure', 0); off.morph([{id: 'a', text: 'b', change: 'changed'}], 0);
  assert.equal(off.live(1).length, 0);
});

test('semantic module diff: only changed, appeared and disappeared modules', () => {
  const before = [{id: 'project', text: 'notMyShell', role: 'project'}, {id: 'cwd', text: '~/src', role: 'cwd'}, {id: 'git', text: 'main', role: 'gitBranch'}];
  assert.deepEqual(diffModules(before, before), [], 'no transition when nothing changed');
  const after = [{id: 'project', text: 'notMyShell', role: 'project'}, {id: 'cwd', text: '~/src', role: 'cwd'}, {id: 'git', text: 'feature/foo', role: 'gitBranch'},
    {id: 'git', text: '~1', role: 'gitModified'}, {id: 'node', text: '24.1', role: 'node'}];
  const changes = diffModules(before, after);
  assert.deepEqual(changes.map(change => `${change.role}:${change.change}`).sort(), ['gitBranch:changed', 'gitModified:appeared', 'node:appeared']);
  assert.deepEqual(diffModules(after, before).map(change => change.change).sort(), ['changed', 'disappeared', 'disappeared']);
});

test('paints tint foregrounds within bounds, decay to nothing and never fill a background', () => {
  const color = {red: 200, green: 100, blue: 255};
  assert.ok(sweepCells(40, 0.5, color, 0.8).size > 0);
  assert.equal(sweepCells(40, 1, color, 0.8).size, 0, 'the band leaves at the end');
  assert.equal(decayCells(0, 10, 1, color, 0.6).size, 0, 'materialization settles to plain syntax colors');
  const morph = morphCells(10, 20, 0.3, color, false, 'changed');
  assert.ok([...morph.keys()].every(column => column >= 10 && column < 20), 'within the module\'s final columns');
  assert.ok([...morph.values()].every(paint => (paint.tint || paint.dim) && !paint.glyph), 'never text');
  const all = [sweepCells(40, 0.5, color, 0.8), decayCells(0, 10, 0.2, color, 0.6, true), morph, morphCells(10, 20, 0.5, color, true, 'appeared'),
    ...[transitionPaint.launch('sweep', 40, 0.5, true), transitionPaint.launch('pulse', 40, 0.2, false), transitionPaint.materialize(3, 9, 0.1, true),
      transitionPaint.seal('failure', 40, 0.4), transitionPaint.echoRule('failure', 40, 0.2, true), transitionPaint.echoInput('longSuccess', 40, 0.5), transitionPaint.morph(2, 8, 0.4, true, 'changed')]];
  for (const cells of all) for (const paint of cells.values()) assert.equal(paint.background, undefined, 'no ANSI cell background from any motion paint');
  const painted = overlayRow('\u001b[38;2;200;200;200mgit status\u001b[0m', transitionPaint.materialize(4, 10, 0.1, false));
  assert.doesNotMatch(painted, /\u001b\[48;/u);
  assert.match(painted, /\u001b\[4m/u, 'the inserted text is underlined');
  assert.equal(stripAnsi(painted), 'git status');
});

test('completion highlight touches only the inserted range', () => {
  const cells = transitionPaint.materialize(4, 10, 0.1, false);
  assert.deepEqual([...cells.keys()], [4, 5, 6, 7, 8, 9]);
});

test('context preview: the unchanged module gets no effect, at every frame, and the panel height is fixed', () => {
  const motion = {...DEFAULT_MOTION, contextTransitions: 'expressive' as const};
  const columns = 100;
  let sawChangedPainted = false;
  for (let now = 0; now <= 400; now += 20) {
    const preview = renderMotionPreview('contextTransitions', motion, gate, columns, 0, now);
    assert.equal(preview.rows.length, PREVIEW_HEIGHT, 'fixed height on every frame');
    const frame = preview.rows[1]!;
    assert.match(stripAnsi(frame), /after +~\/src +feature\/theme +Node 22/u);
    // The unchanged module is drawn in the row's own style only: no tint, dim, bold or underline reaches it.
    assert.match(frame, /(?:\u001b\[0m\u001b\[38;2;\d+;\d+;\d+m|e) {2}Node 22\u001b\[0m$/u, `frame ${now}: Node 22 untouched`);
    assert.doesNotMatch(frame, /\u001b\[48;/u, 'no backgrounds');
    sawChangedPainted ||= /\u001b\[[124]m/u.test(frame);
  }
  assert.ok(sawChangedPainted, 'the changed modules are painted at some frame');
  const settled = renderMotionPreview('contextTransitions', motion, gate, columns, 0, 5_000);
  assert.equal(settled.busy, false);
  assert.equal(settled.rows.length, PREVIEW_HEIGHT);
});

test('every Motion preview paints no background on any frame and keeps a fixed height', () => {
  const motion = {...DEFAULT_MOTION, contextTransitions: 'expressive' as const, commandLaunch: 'pulse' as const, completionHighlight: 'vivid' as const, completionEffect: 'seal' as const, eventFeedback: 'expressive' as const};
  for (const row of ['contextTransitions', 'commandLaunch', 'completionHighlight', 'completionEffect', 'eventFeedback'] as const) {
    for (let now = 0; now <= 800; now += 25) {
      const preview = renderMotionPreview(row, motion, gate, 90, 0, now);
      assert.equal(preview.rows.length, PREVIEW_HEIGHT, `${row} height`);
      assert.doesNotMatch(preview.rows.join('\n'), /\u001b\[48;/u, `${row} paints no background`);
    }
    assert.equal(renderMotionPreview(row, motion, gate, 90, 0, 10_000).busy, false, `${row} stops its clock`);
  }
  const narrow = renderMotionPreview('contextTransitions', motion, gate, 12, 0, 50);
  assert.equal(narrow.rows.length, PREVIEW_HEIGHT);
});

function harness(config: object): {app: TerminalApp; frames: TerminalFrame[]; writes: string[]; cleanup: () => void} {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  const frames: TerminalFrame[] = [];
  const writes: string[] = [];
  app['renderer'].render = (frame: TerminalFrame) => { frames.push(frame); };
  app['fetchSuggestions'] = async () => {};
  app['presentationStarted'] = true;
  app['configuration'] = normalizePromptConfiguration({...DEFAULT_PROMPT_CONFIGURATION, ...config});
  const session = app['session'] as unknown as {submit: (text: string) => void};
  const original = session.submit.bind(session);
  session.submit = (text: string) => { writes.push(text); original(text); };
  return {app, frames, writes, cleanup: () => { app['stop'](0); app['session'].kill(); applyUiTheme(undefined); isolation.restore(); }};
}

test('Command Transfer: Enter submits at once; the sweep is presentation only and ends; Ask never launches', async () => {
  const {app, writes, frames, cleanup} = harness({motion: DEFAULT_MOTION, presentation: {...DEFAULT_PROMPT_CONFIGURATION.presentation, reducedMotion: false, effectsOff: false}});
  try {
    app['startupPending'] = false;
    app['editor'].insert('echo hi');
    await app['submit']();
    assert.ok(writes.some(text => text.includes('echo hi')), 'the command reached the shell during submit itself');
    assert.equal(app['editor'].text, '');
    const launch = app['transitions']['active'].find((item: {kind: string}) => item.kind === 'launch');
    assert.ok(launch, 'a launch sweep started');
    {
      app['render']();
      assert.ok(frames.length > 0);
      assert.ok(frames.every(frame => !frame.rows.some(row => stripAnsi(row).includes('→'))), 'no characters fly; nothing is inserted into text');
      app['paintPresentation'](launch.start + DURATIONS.launch + 1);
      assert.equal(app['transitionClock'], undefined, 'no clock after the sweep ends');
    }
    assert.equal(app['output'].transcript().records.filter((record: {command?: string}) => record.command === 'echo hi').length <= 1, true, 'stored once');
  } finally { cleanup(); }
});
