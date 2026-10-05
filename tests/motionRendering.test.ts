import test from 'node:test';
import assert from 'node:assert/strict';
import {appearanceHubKey, createAppearanceHub, renderAppearanceHub} from '../src/appearance/AppearanceHub.js';
import {MOTION_ITEMS, MOTION_RENDERING_ITEM, MOTION_TUNING_ITEMS} from '../src/motion/motionRows.js';
import {PREVIEW_HEIGHT, renderMotionPreview} from '../src/motion/MotionPreview.js';
import {CLEAN_LOOK, DURATIONS, lookFor, richDecayCells, richMorphCells, richSweepCells, transitionPaint, Transitions, type MotionGate} from '../src/motion/transitions.js';
import {mixRgb} from '../src/chroma/chroma.js';
import {overlayRow} from '../src/presentation/cellOverlay.js';
import {DEFAULT_MOTION, DEFAULT_PROMPT_CONFIGURATION, MIGRATED_MOTION, normalizeMotion, normalizePromptConfiguration, type MotionSettings} from '../src/prompt/configuration.js';
import {adjustSettingsRow, SETTINGS_ROWS, settingsRowValue} from '../src/ui/SettingsPanel.js';
import {SETUP_SECTIONS} from '../src/setup/SetupCat.js';
import {UI_COLORS} from '../src/ui/palette.js';
import {stripAnsi} from '../src/util/text.js';

const ON: MotionGate = {reducedMotion: false, effectsOff: false, color: true};
const withRendering = (rendering: 'clean' | 'rich', extra: Partial<MotionSettings> = {}): MotionSettings => ({...structuredClone(DEFAULT_MOTION), rendering, ...extra});
const set = (motion: MotionSettings, id: string, value: string) => [...MOTION_ITEMS, ...MOTION_TUNING_ITEMS].find(item => item.id === id)!.set(motion, value);
const rich = lookFor(withRendering('rich'));
const BASE = {red: 18, green: 18, blue: 22};

test('Motion rendering: fresh installs and existing configs are Clean; explicit settings are kept', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.motion.rendering, 'clean');
  assert.equal(normalizePromptConfiguration({}).motion.rendering, 'clean');
  // A config saved before rendering existed (the five effect choices only) stays on today's Clean look.
  const old = normalizeMotion({contextTransitions: 'expressive', commandLaunch: 'pulse', completionHighlight: 'vivid', completionEffect: 'seal', eventFeedback: 'expressive'});
  assert.equal(old.rendering, 'clean');
  assert.deepEqual([old.contextTransitions, old.commandLaunch, old.completionHighlight, old.eventFeedback], ['expressive', 'pulse', 'vivid', 'expressive']);
  assert.deepEqual(old.tuning, {clean: {intensity: 'medium', speed: 'normal'}, rich: {intensity: 'medium', speed: 'normal'}});
  assert.equal(normalizeMotion(undefined).rendering, 'clean');
  assert.deepEqual(MIGRATED_MOTION.tuning, DEFAULT_MOTION.tuning);
  assert.equal(normalizeMotion({rendering: 'rich', commandLaunch: 'sweep'}).rendering, 'rich');
  assert.equal(normalizeMotion({rendering: 'bogus'}).rendering, 'clean');
  assert.deepEqual(normalizeMotion({tuning: {rich: {intensity: 'high', speed: 'nope'}}}).tuning.rich, {intensity: 'high', speed: 'normal'});
});

test('Clean and Rich keep separate tuning; switching restores each one\'s values', () => {
  let motion = withRendering('rich');
  motion = set(motion, 'intensity', 'high');
  motion = set(motion, 'speed', 'slow');
  motion = set(motion, 'rendering', 'clean');
  assert.deepEqual([motion.tuning.clean.intensity, motion.tuning.clean.speed], ['medium', 'normal'], 'Clean never saw Rich\'s tuning');
  motion = set(motion, 'intensity', 'low');
  motion = set(motion, 'speed', 'fast');
  motion = set(motion, 'rendering', 'rich');
  assert.deepEqual(motion.tuning.rich, {intensity: 'high', speed: 'slow'}, 'Rich is exactly as it was left');
  assert.deepEqual(motion.tuning.clean, {intensity: 'low', speed: 'fast'});
  assert.equal(MOTION_TUNING_ITEMS[0]!.get(motion), 'high', 'the tuning rows read the selected rendering');
  assert.equal(MOTION_TUNING_ITEMS[1]!.get(set(motion, 'rendering', 'clean')), 'fast');
  const saved = normalizePromptConfiguration(JSON.parse(JSON.stringify({...DEFAULT_PROMPT_CONFIGURATION, motion}))).motion;
  assert.deepEqual(saved.tuning, motion.tuning, 'both survive a save and load');
});

test('Rich restores the 4b04351 painting: blended against the old dark base, filled behind the cell', () => {
  const color = UI_COLORS.accent;
  const sweep = richSweepCells(40, 0.5, color, 0.8);
  const center = sweep.get(Math.floor(-10 + 0.5 * 60))!;
  assert.deepEqual(center.fill, mixRgb(BASE, color, 0.8), 'the band centre is the old blend');
  assert.equal(richSweepCells(40, 1, color, 0.8).size, 0);
  const decay = richDecayCells(2, 6, 0, color, 0.7);
  assert.deepEqual([...decay.keys()], [2, 3, 4, 5]);
  assert.deepEqual(decay.get(2)!.fill, mixRgb(BASE, color, 0.7));
  const morph = richMorphCells(10, 20, 0.3, color, true, 'changed');
  assert.deepEqual(morph.get(19)!.fill, mixRgb(BASE, {red: 0, green: 0, blue: 0}, 0.5), 'cells ahead of the front are darkened as before');
  // The per-effect strengths are the old ones.
  assert.deepEqual(transitionPaint.launch('sweep', 40, 0.5, true, rich).get(20)!.fill, richSweepCells(40, 0.5, color, 0.8).get(20)!.fill);
  assert.deepEqual(transitionPaint.materialize(0, 4, 0, true, rich).get(0)!.fill, mixRgb(BASE, color, 0.7));
  assert.deepEqual(transitionPaint.materialize(0, 4, 0, false, rich).get(0)!.fill, mixRgb(BASE, color, 0.45));
  assert.deepEqual(transitionPaint.echoRule('failure', 40, 0, true, rich).get(0)!.fill, mixRgb(BASE, UI_COLORS.failure, 0.6));
  const painted = overlayRow('\u001b[38;2;200;200;200mgit status\u001b[0m', transitionPaint.materialize(4, 10, 0.1, false, rich));
  assert.match(painted, /\u001b\[48;2;/u, 'Rich fills behind the text');
  assert.equal(stripAnsi(painted), 'git status');
});

test('Clean never fills; the same events feed either renderer', () => {
  for (const cells of [transitionPaint.launch('sweep', 40, 0.5, true), transitionPaint.launch('pulse', 40, 0.2, false), transitionPaint.materialize(3, 9, 0.1, true),
    transitionPaint.seal('failure', 40, 0.4), transitionPaint.echoRule('failure', 40, 0.2, true), transitionPaint.echoInput('longSuccess', 40, 0.5), transitionPaint.morph(2, 8, 0.4, true, 'changed')]) {
    for (const paint of cells.values()) assert.ok(!paint.fill && !paint.background, 'Clean paints no backgrounds');
  }
  const transitions = new Transitions(() => withRendering('rich'), () => ON);
  transitions.launch(0); transitions.materialize(0, 3, 'abc', 0); transitions.seal(1, 'success', 0); transitions.echo('failure', 0); transitions.morph([{id: 'a', text: 'b', change: 'changed'}], 0);
  const live = transitions.live(1);
  assert.deepEqual(live.map(item => item.kind).sort(), ['echo', 'launch', 'materialize', 'morph', 'seal']);
  assert.ok(live.every(item => item.look.rendering === 'rich'), 'one lifecycle, drawn by the selected renderer');
  const clean = new Transitions(() => withRendering('clean'), () => ON);
  clean.launch(0);
  assert.equal(clean.live(1)[0]!.look.rendering, 'clean');
});

test('tuning matters: intensity changes strength, speed changes duration, both within bounds', () => {
  const at = (rendering: 'clean' | 'rich', intensity: 'low' | 'medium' | 'high') => {
    const motion = set(withRendering(rendering), 'intensity', intensity);
    const look = lookFor(motion);
    return transitionPaint.launch('sweep', 40, 0.5, true, look).get(20)!;
  };
  const amount = (paint: ReturnType<typeof at>) => paint.tint?.amount ?? 0;
  assert.ok(amount(at('clean', 'low')) < amount(at('clean', 'medium')) && amount(at('clean', 'medium')) < amount(at('clean', 'high')));
  const lum = (paint: ReturnType<typeof at>) => paint.fill!.red + paint.fill!.green + paint.fill!.blue;
  assert.ok(lum(at('rich', 'low')) < lum(at('rich', 'medium')) && lum(at('rich', 'medium')) < lum(at('rich', 'high')));
  const duration = (speed: 'slow' | 'normal' | 'fast') => {
    const transitions = new Transitions(() => set(withRendering('rich'), 'speed', speed), () => ON);
    transitions.launch(0);
    return transitions.live(0)[0]!.duration;
  };
  assert.equal(duration('normal'), DURATIONS.launch, 'Normal is each renderer\'s baseline');
  assert.ok(duration('fast') < duration('normal') && duration('normal') < duration('slow'));
  assert.deepEqual(lookFor({...DEFAULT_MOTION, tuning: undefined as never}), {...CLEAN_LOOK, speed: 1}, 'old in-memory settings still resolve');
});

test('Reduced Motion, Decorative Effects Off and NO_COLOR gate both renderers', () => {
  for (const rendering of ['clean', 'rich'] as const) {
    for (const gate of [{...ON, reducedMotion: true}, {...ON, effectsOff: true}, {...ON, color: false}]) {
      const transitions = new Transitions(() => withRendering(rendering), () => gate);
      transitions.launch(0); transitions.materialize(0, 3, 'abc', 0); transitions.seal(1, 'failure', 0); transitions.echo('failure', 0); transitions.morph([{id: 'a', text: 'b', change: 'changed'}], 0);
      assert.equal(transitions.live(1).length, 0, `${rendering} ${JSON.stringify(gate)}`);
      for (const row of ['contextTransitions', 'commandLaunch', 'completionHighlight', 'completionEffect', 'eventFeedback'] as const) {
        const preview = renderMotionPreview(row, withRendering(rendering), gate, 90, 0, 50);
        assert.equal(preview.busy, false);
        assert.doesNotMatch(preview.rows.join('\n'), /\u001b\[48;/u, `${rendering}/${row} paints no fill when gated`);
      }
    }
  }
});

test('previews use the selected renderer: Rich fills, Clean does not, same height, R replays', () => {
  for (const row of ['contextTransitions', 'commandLaunch', 'completionHighlight', 'completionEffect', 'eventFeedback'] as const) {
    const motion = {...withRendering('rich'), contextTransitions: 'expressive' as const, eventFeedback: 'expressive' as const, completionHighlight: 'vivid' as const};
    let richFilled = false;
    for (let now = 0; now <= 700; now += 25) {
      const richFrame = renderMotionPreview(row, motion, ON, 90, 0, now);
      const cleanFrame = renderMotionPreview(row, {...motion, rendering: 'clean'}, ON, 90, 0, now);
      assert.equal(richFrame.rows.length, PREVIEW_HEIGHT);
      assert.equal(cleanFrame.rows.length, PREVIEW_HEIGHT);
      assert.doesNotMatch(cleanFrame.rows.join('\n'), /\u001b\[48;/u, `Clean ${row} keeps the host background`);
      richFilled ||= /\u001b\[48;/u.test(richFrame.rows.join('\n'));
    }
    assert.ok(richFilled, `Rich ${row} shows its filled look`);
    assert.equal(renderMotionPreview(row, motion, ON, 90, 0, 20_000).busy, false, 'the clock stops after the run');
  }
  // Replay is a restart of the same deterministic frames.
  const motion = withRendering('rich');
  assert.equal(renderMotionPreview('commandLaunch', motion, ON, 90, 1000, 1060).rows.join(), renderMotionPreview('commandLaunch', motion, ON, 90, 5000, 5060).rows.join());
  for (const columns of [12, 40]) assert.equal(renderMotionPreview('contextTransitions', motion, ON, columns, 0, 50).rows.length, PREVIEW_HEIGHT);
});

test('the Motion screen: Rendering first, Advanced edits the selected rendering only, previews follow it', () => {
  const hub = createAppearanceHub('Zed');
  hub.view = 'motion';
  hub.previewStart = 0;
  let config = {...structuredClone(DEFAULT_PROMPT_CONFIGURATION), motion: withRendering('clean')};
  const render = (height?: number) => stripAnsi(renderAppearanceHub(hub, config, 100, 'Lavender Native', 'Portable', {gate: ON, now: 60}, height).join('\n'));
  assert.match(render(), /Rendering\s+‹ Clean ›/u);
  assert.match(render(), /Preview · Clean/u);
  // Clean → Rich changes the preview at once.
  const change = appearanceHubKey(hub, {kind: 'right'}, config, 10);
  assert.equal(change?.kind === 'motion' && change.motion.rendering, 'rich');
  config = {...config, motion: (change as {motion: MotionSettings}).motion};
  assert.match(render(), /Preview · Rich/u);
  assert.match(renderAppearanceHub(hub, config, 100, 'Lavender Native', 'Portable', {gate: ON, now: 60}).join('\n'), /\u001b\[48;/u, 'the Rich preview is filled');
  // Advanced opens the selected rendering's tuning and keeps the other's values.
  hub.selected = MOTION_ITEMS.length;
  appearanceHubKey(hub, {kind: 'enter'}, config, 20);
  assert.equal(hub.view, 'motionAdvanced');
  assert.match(render(), /Motion › Advanced \(Rich\)/u);
  assert.match(render(), /Intensity\s+‹ Medium ›/u);
  const tuned = appearanceHubKey(hub, {kind: 'right'}, config, 30);
  config = {...config, motion: (tuned as {motion: MotionSettings}).motion};
  assert.equal(config.motion.tuning.rich.intensity, 'high');
  assert.equal(config.motion.tuning.clean.intensity, 'medium', 'Clean untouched');
  appearanceHubKey(hub, {kind: 'escape'}, config, 40);
  assert.equal(hub.view, 'motion');
  // A short terminal keeps the list and the controls.
  for (const height of [30, 20, 14, 12]) {
    const text = render(height);
    assert.match(text, /Rendering/u);
    assert.match(text, /Esc back/u);
  }
});

test('Settings and Setup expose Motion rendering and its tuning from the same definitions', () => {
  const row = (id: string) => SETTINGS_ROWS.find(item => item.id === id)!;
  const base = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  assert.equal(settingsRowValue(row('motion_rendering'), base), 'Clean');
  const rich = adjustSettingsRow(row('motion_rendering'), base, 1)!;
  assert.equal(rich.motion.rendering, 'rich');
  const tuned = adjustSettingsRow(row('motion_intensity'), rich, 1)!;
  assert.equal(tuned.motion.tuning.rich.intensity, 'high');
  assert.equal(tuned.motion.tuning.clean.intensity, 'medium');
  const ids = SETUP_SECTIONS.find(section => section.id === 'motion')!.rows.map(item => item.row.id);
  for (const id of ['motion_rendering', 'motion_contextTransitions', 'motion_commandLaunch', 'motion_intensity', 'motion_speed']) assert.ok(ids.includes(id), id);
  assert.equal(MOTION_RENDERING_ITEM.values.join(), 'clean,rich');
});
