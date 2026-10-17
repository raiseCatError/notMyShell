import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPromptConfiguration, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {createQuickSetup, setupKey, renderSetup} from '../src/setup/SetupCat.js';
import {STARTING_POINT_COPY, STARTING_POINTS} from '../src/setup/startup/startingPoints.js';
import {startupLayout} from '../src/setup/startup/view.js';
import * as setup from '../src/setup/SetupCat.js';
import {NEVER_EXPORTED} from '../src/configuration/portability.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';

/** The starting-point selector: four choices under the Horizon sky, explicit review and Apply, Stay-first leave. */
const LABELS = STARTING_POINTS.map(id => STARTING_POINT_COPY[id].title);
const text = (state: Parameters<typeof renderSetup>[0], columns = 80, height = 24) =>
  renderSetup(state, columns, height).map(stripAnsi).join('\n');

test('fresh intro marker differs from legacy objects and survives normalized persistence', () => {
  assert.equal(normalizePromptConfiguration(undefined).introSeen, false);
  assert.equal(normalizePromptConfiguration({}).introSeen, true);
  assert.equal(normalizePromptConfiguration({onboardingComplete: true}).introSeen, true);
  assert.equal(normalizePromptConfiguration({introSeen: false}).introSeen, false);
});

test('fresh onboarding opens the static picker once, persists introSeen before display and never replays after leaving', () => {
  const f = executionFrameFixture();
  try {
    Object.assign(f.app['promptConfiguration'], {introSeen: false, onboardingComplete: false, toolsSetupComplete: false});
    f.app['startOnboarding']();
    const state = f.app['setupState']!;
    assert.ok(state.quick, 'fresh onboarding starts the quick picker');
    assert.ok(!('intro' in state), 'no animated introduction state exists');
    assert.equal(loadPromptConfiguration().introSeen, true, 'introSeen persists before the picker shows');
    assert.equal(loadPromptConfiguration().onboardingComplete, false);
    assert.equal(f.app['setupCursorClock'], undefined, 'the modal schedules nothing');
    // Leaving for now: Esc asks first, Exit for now closes without completing.
    f.app['handleKey']({kind: 'escape'});
    assert.equal(state.quick?.confirm, true);
    assert.equal(state.quick?.confirmIndex, 0, 'Continue is the default');
    f.app['handleKey']({kind: 'right'});
    f.app['handleKey']({kind: 'enter'});
    assert.equal(f.app['setupState'], undefined);
    assert.equal(f.app['promptConfiguration'].onboardingComplete, false);
    // Never auto-replays; an explicit /setup quick still opens the picker.
    f.app['startOnboarding']();
    assert.equal(f.app['setupState'], undefined, 'onboarding does not auto-reopen after leaving');
    f.app['startSetup']('quick');
    assert.ok(f.app['setupState']?.quick);
  } finally { f.dispose(); }
});

test('gate: completed or previously introduced installations never auto-open onboarding', () => {
  const f = executionFrameFixture();
  try {
    for (const configuration of [{onboardingComplete: true, introSeen: true, toolsSetupComplete: true}, {onboardingComplete: false, introSeen: true, toolsSetupComplete: true}]) {
      Object.assign(f.app['promptConfiguration'], configuration);
      f.app['setupState'] = undefined;
      f.app['startOnboarding']();
      assert.equal(f.app['setupState'], undefined, JSON.stringify(configuration));
    }
    assert.equal(normalizePromptConfiguration({onboardingComplete: false}).introSeen, true, 'missing introSeen counts as seen');
  } finally { f.dispose(); }
});

test('the selector shows the four starting points under the Horizon, with no replay', () => {
  const f = executionFrameFixture(80, 24);
  try {
    f.app['startSetup']('quick');
    const first = f.capture().frame.rows.map(stripAnsi);
    const shown = first.join('\n');
    for (const label of LABELS) assert.ok(shown.includes(label), label);
    assert.deepEqual(LABELS, ['NMSh Recommended', 'Minimal Terminal', 'Customize Everything', 'Keep Existing']);
    assert.ok(!shown.includes('Replay'), 'the replay affordance is gone');
    assert.equal(f.app['setupCursorClock'], undefined, 'no preview playback timer');
    f.tick(5700); f.capture();
    assert.equal(f.app['setupCursorClock'], undefined, 'nothing re-schedules a preview over time');
    const rows = renderSetup(f.app['setupState']!, 80, 24, 9000).map(stripAnsi);
    assert.equal(rows[startupLayout(80, 24).skyHeight], '▔'.repeat(80), 'the horizon sits under the sky band');
    assert.deepEqual(renderSetup(f.app['setupState']!, 80, 24, 9000), renderSetup(f.app['setupState']!, 80, 24, 9000), 'a frame is a pure function of state and time');
  } finally { f.dispose(); }
});

test('choices: Up/Down wrap over the four starting points and 1–4 jump', () => {
  const state = createQuickSetup(normalizePromptConfiguration({onboardingComplete: true}));
  assert.equal(state.quick?.choice, 0);
  setupKey(state, {kind: 'down'}); assert.equal(state.quick?.choice, 1);
  setupKey(state, {kind: 'down'}); assert.equal(state.quick?.choice, 2);
  setupKey(state, {kind: 'down'}); assert.equal(state.quick?.choice, 3);
  setupKey(state, {kind: 'down'}); assert.equal(state.quick?.choice, 0);
  setupKey(state, {kind: 'up'}); assert.equal(state.quick?.choice, 3);
  setupKey(state, {kind: 'text', value: '1'}); assert.equal(state.quick?.choice, 0);
  setupKey(state, {kind: 'text', value: '3'}); assert.equal(state.quick?.choice, 2);
  setupKey(state, {kind: 'text', value: '4'}); assert.equal(state.quick?.choice, 3);
});

test('minimal: Two-line first; Left/Right/Tab toggle One-line and Two-line on the real draft and apply persists it', () => {
  const state = createQuickSetup(normalizePromptConfiguration({onboardingComplete: true}));
  setupKey(state, {kind: 'text', value: '2'});
  assert.equal(state.quick?.choice, 1);
  assert.equal(state.draft.composerLayout, 'twoLine');
  setupKey(state, {kind: 'right'});
  assert.equal(state.draft.composerLayout, 'oneLine');
  setupKey(state, {kind: 'complete'});
  assert.equal(state.draft.composerLayout, 'twoLine');
  setupKey(state, {kind: 'left'});
  assert.equal(state.draft.composerLayout, 'oneLine');
  assert.match(text(state), /One-line/u);
  setupKey(state, {kind: 'enter'});
  const applied = setupKey(state, {kind: 'enter'});
  assert.equal(applied?.kind, 'apply');
  if (applied?.kind === 'apply') assert.equal(applied.configuration.composerLayout, 'oneLine');
});

test('review: Enter applies the preset and a customized installation is told it replaces preferences', () => {
  const saved = normalizePromptConfiguration({onboardingComplete: true});
  const state = createQuickSetup(saved);
  setupKey(state, {kind: 'enter'});
  assert.equal(state.quick?.review, true);
  assert.match(text(state, 130, 38), /replaces NMSh's current look and feel/u);
  const applied = setupKey(state, {kind: 'enter'});
  assert.equal(applied?.kind, 'apply');
  if (applied?.kind === 'apply') {
    assert.equal(applied.configuration.onboardingComplete, true);
    assert.equal(applied.configuration.glyphChoiceComplete, true);
    assert.equal(applied.configuration.toolsSetupComplete, true);
    assert.equal(applied.tools, 'recommended', 'Recommended reviews the recommended tools by default');
    assert.equal(applied.preselect, true);
    assert.equal(applied.changed, true);
  }
  const fresh = createQuickSetup(normalizePromptConfiguration({}));
  setupKey(fresh, {kind: 'enter'});
  assert.match(text(fresh, 130, 38), /sets NMSh's look and feel/u);
  assert.equal(fresh.saved.onboardingComplete, false);
});

test('leave confirmation: Escape opens it with Stay focused; arrows cycle; Leave cancels without applying', () => {
  const state = createQuickSetup(normalizePromptConfiguration({onboardingComplete: true}));
  assert.equal(setupKey(state, {kind: 'escape'}), undefined);
  assert.equal(state.quick?.confirm, true);
  assert.equal(state.quick?.confirmIndex, 0);
  const shown = text(state);
  assert.match(shown, /Leave setup\?/u); assert.match(shown, /Stay/u); assert.match(shown, /Leave/u);
  setupKey(state, {kind: 'right'});
  assert.equal(state.quick?.confirmIndex, 1);
  setupKey(state, {kind: 'complete'});
  assert.equal(state.quick?.confirmIndex, 0);
  setupKey(state, {kind: 'focusPrevious'});
  assert.equal(state.quick?.confirmIndex, 1);
  setupKey(state, {kind: 'left'});
  assert.equal(state.quick?.confirmIndex, 0);
  // Stay returns to the picker untouched.
  assert.equal(setupKey(state, {kind: 'enter'}), undefined);
  assert.equal(state.quick?.confirm, false);
  assert.equal(state.quick?.review, false);
  // Esc from the confirmation keeps editing too.
  setupKey(state, {kind: 'escape'});
  setupKey(state, {kind: 'escape'});
  assert.equal(state.quick?.confirm, false);
  // Leave cancels; nothing was applied.
  setupKey(state, {kind: 'escape'});
  setupKey(state, {kind: 'right'});
  assert.equal(setupKey(state, {kind: 'enter'})?.kind, 'cancel');
});

test('review: Esc goes back to the choices; only Esc from the choices asks to leave', () => {
  const state = createQuickSetup(normalizePromptConfiguration({onboardingComplete: true}));
  setupKey(state, {kind: 'enter'});
  assert.equal(state.quick?.review, true);
  setupKey(state, {kind: 'escape'});
  assert.equal(state.quick?.review, false);
  assert.equal(state.quick?.confirm ?? false, false);
  setupKey(state, {kind: 'escape'});
  assert.equal(state.quick?.confirm, true);
  setupKey(state, {kind: 'enter'});
  assert.equal(state.quick?.confirm, false, 'Stay returns to the choices');
});

test('customize: Enter opens the manual wizard from the saved configuration and leaving it returns to the picker', () => {
  const saved = normalizePromptConfiguration({onboardingComplete: true});
  const state = createQuickSetup(saved);
  setupKey(state, {kind: 'text', value: '3'});
  assert.equal(setupKey(state, {kind: 'enter'})?.kind, 'manual');
  assert.equal(state.quick?.manual, true);
  assert.deepEqual(state.draft, saved);
  setupKey(state, {kind: 'down'});
  assert.equal(state.row, 1, 'the full wizard owns the keys while manual is open');
  assert.doesNotMatch(text(state), /Customize Everything/u, 'the wizard replaces the modal');
  assert.equal(setupKey(state, {kind: 'escape'}), undefined);
  assert.equal(state.quick?.manual, false, 'leaving the wizard without changes returns to the modal');
  assert.match(text(state), /Customize Everything/u);
  assert.deepEqual(state.draft, saved);
});

test('backdrop: defaults to aurora, normalizes explicit levels and is never exported', () => {
  assert.equal(normalizePromptConfiguration({}).onboardingBackdrop, 'aurora');
  assert.equal(normalizePromptConfiguration({onboardingBackdrop: 'off'}).onboardingBackdrop, 'off');
  assert.equal(normalizePromptConfiguration({onboardingBackdrop: 'subtle'}).onboardingBackdrop, 'subtle');
  assert.equal(normalizePromptConfiguration({onboardingBackdrop: 'noise'}).onboardingBackdrop, 'aurora');
  assert.ok((NEVER_EXPORTED as readonly string[]).includes('onboardingBackdrop'));
  assert.equal(createQuickSetup(normalizePromptConfiguration({})).quick?.backdrop, 'aurora');
  assert.equal(createQuickSetup(normalizePromptConfiguration({onboardingBackdrop: 'subtle'})).quick?.backdrop, 'subtle');
});

test('backdrop: Off leaves the sky band unpainted; Subtle and Aurora paint it; all inside the frame', () => {
  const saved = process.env.NMSH_COLOR;
  process.env.NMSH_COLOR = 'truecolor';
  try {
    const sky = startupLayout(80, 24).skyHeight;
    for (const level of ['off', 'subtle', 'aurora'] as const) {
      const state = createQuickSetup(normalizePromptConfiguration({onboardingComplete: false, onboardingBackdrop: level}));
      const rows = renderSetup(state, 80, 24, 9000);
      assert.equal(rows.length, 24);
      assert.ok(rows.every(row => displayWidth(row) <= 80));
      assert.equal(rows.slice(0, sky - 4).some(row => /\u001B\[48;2;/u.test(row)), level !== 'off', `sky paint for ${level}`);
    }
  } finally {
    if (saved === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = saved;
  }
});

test('the plain list at 16x6 still shows the layout, Apply and Leave', () => {
  const state = createQuickSetup(normalizePromptConfiguration({onboardingComplete: true}));
  setupKey(state, {kind: 'text', value: '2'});
  let shown = text(state, 16, 6);
  for (const word of [/Two-line/u, /⏎|Enter/u, /esc/iu, /Keep Existing/u]) assert.match(shown, word);
  assert.ok(!/[╭╰│┌└|]/u.test(shown), 'unframed');
  setupKey(state, {kind: 'right'});
  shown = text(state, 16, 6);
  assert.match(shown, /One-line/u);
  setupKey(state, {kind: 'enter'});
  shown = text(state, 16, 6);
  assert.match(shown, /apply/iu);
  const rows = renderSetup(state, 16, 6);
  assert.ok(rows.length <= 6); assert.ok(rows.every(row => displayWidth(row) <= 16));
});

for (const [columns, height] of [[32, 12], [50, 16], [80, 24], [120, 40], [200, 50]] as const) {
  test(`fits: every starting point, the keys and Leave stay visible inside ${columns}x${height}`, () => {
    const state = createQuickSetup(normalizePromptConfiguration({onboardingComplete: true}));
    const rows = renderSetup(state, columns, height, 9000);
    assert.equal(rows.length, height);
    assert.ok(rows.every(row => displayWidth(row) <= columns));
    const shown = rows.map(stripAnsi).join('\n');
    for (const word of [/Recommended/u, /Minimal/u, /Customize/u, /Keep Existing/u, /⏎|Enter/u, /esc/iu]) assert.match(shown, word);
    if (startupLayout(columns, height).skyHeight) assert.match(shown, /▔{8,}|-{8,}/u, 'the horizon where there is a sky');
  });
}

test('explicit routes keep the manual wizard and the quick selector; only first run opens onboarding', () => {
  const f = executionFrameFixture();
  try {
    f.app['loadSetupContext'] = async () => {};
    f.app['startSetup'](); assert.equal(f.app['setupState']?.quick, undefined);
    f.app['startSetup']('prompt'); assert.equal(setup.SETUP_SECTIONS[f.app['setupState']!.section]?.id, 'prompt');
    f.app['startSetup']('quick'); assert.ok(f.app['setupState']?.quick);
    assert.equal(f.app['setupState']?.quick?.choice, 0);
    assert.deepEqual(parseSlashCommand('/setup quick'), {kind: 'setup', entry: 'quick'});
  } finally { f.dispose(); }
});

test('retained introduction renderer: finite, narrow-safe and a static accessible fallback', () => {
  assert.equal(typeof setup.renderSetupIntro, 'function');
  for (const width of [16, 32, 50, 80]) for (const still of [false, true]) {
    const frame = setup.renderSetupIntro(width, 18, 1500, still);
    assert.ok(frame.rows.every(row => displayWidth(row) <= width));
    assert.match(frame.rows.map(stripAnsi).join('\n'), /notMyShell/u);
    assert.equal(setup.renderSetupIntro(width, 18, 3000, still).busy, false);
  }
});

test('failed preset persistence keeps draft and modal ownership for retry or cancel', async () => {
  const {mkdirSync, writeFileSync, readFileSync} = await import('node:fs');
  const {join} = await import('node:path');
  const f = executionFrameFixture();
  try {
    const path = join(process.env.XDG_CONFIG_HOME!, 'nmsh', 'config.json');
    mkdirSync(join(process.env.XDG_CONFIG_HOME!, 'nmsh'), {recursive: true});
    writeFileSync(path, '{invalid');
    const before = JSON.stringify(f.app['promptConfiguration']);
    f.app['startSetup']('quick'); f.app['handleKey']({kind: 'text', value: '2'});
    f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
    assert.ok(f.app['setupState']); assert.match(f.app['setupState']?.message ?? '', /Could not save/u);
    assert.match(text(f.app['setupState']!), /Could not save/u, 'the modal shows the failure');
    assert.equal(JSON.stringify(f.app['promptConfiguration']), before);
    assert.equal(readFileSync(path, 'utf8'), '{invalid');
    f.app['handleKey']({kind: 'escape'});
    assert.equal(f.app['setupState']?.quick?.review, false, 'Esc returns to the choices with the draft kept');
    f.app['handleKey']({kind: 'escape'});
    f.app['handleKey']({kind: 'right'});
    f.app['handleKey']({kind: 'enter'});
    assert.equal(f.app['setupState'], undefined);
    assert.equal(f.app['setupCursorClock'], undefined);
  } finally { f.dispose(); }
});

test('rapid keys, resize and cancellation leave no stale preview subscription or live activity', () => {
  const f = executionFrameFixture(32, 18);
  try {
    f.app['startSetup']('quick'); f.capture();
    const before = JSON.stringify(f.app['output'].transcript());
    for (let i = 0; i < 15; i++) {
      f.app['handleKey']({kind: 'text', value: String(i % 3 + 1)}); f.capture();
      f.app['handleKey']({kind: 'right'}); f.capture();
      assert.equal(f.app['setupCursorClock'], undefined, 'no playback at any point');
    }
    Object.defineProperty(f.app, 'dimensions', {value: () => ({columns: 16, rows: 6}), configurable: true});
    Object.defineProperty(f.app, 'terminalDimensions', {value: () => ({columns: 16, rows: 6}), configurable: true});
    f.capture(); assert.equal(f.app['setupCursorClock'], undefined, 'no animation clock at the minimum size');
    f.app['handleKey']({kind: 'escape'});
    f.app['handleKey']({kind: 'right'});
    f.app['handleKey']({kind: 'enter'});
    assert.equal(f.app['setupState'], undefined); assert.equal(f.app['setupCursorClock'], undefined);
    assert.equal(f.app['running'], undefined); assert.equal(JSON.stringify(f.app['output'].transcript()), before);
  } finally { f.dispose(); }
});

test('Minimal hides an archived welcome on restore without deleting archived data', () => {
  const f = executionFrameFixture();
  try {
    f.app['output'].setWelcome({version: 1, identity: {name: 'nmsh', version: '0.20.0'}, cwd: '/demo', shell: 'zsh'} as never);
    const saved = f.app['output'].transcript();
    f.app['startSetup']('quick'); f.app['handleKey']({kind: 'text', value: '2'});
    f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
    f.app['output'].restoreTranscript(saved);
    assert.equal(f.app['output'].view().welcome, undefined);
    assert.deepEqual(f.app['output'].transcript().welcome, saved.welcome);
    f.app['startWelcome']('/demo'); assert.equal(f.app['output'].view().welcome, undefined);
    f.app['startOnboarding'](); assert.equal(f.app['setupState'], undefined);
  } finally { f.dispose(); }
});

test('independent review: resizing below the modal minimum renders the unframed TINY tier with no playback', () => {
  const f = executionFrameFixture();
  try {
    f.app['startSetup']('quick'); f.capture(); assert.equal(f.app['setupCursorClock'], undefined);
    Object.defineProperty(f.app, 'dimensions', {value: () => ({columns: 16, rows: 6}), configurable: true});
    Object.defineProperty(f.app, 'terminalDimensions', {value: () => ({columns: 16, rows: 6}), configurable: true});
    const rows = f.capture().frame.rows.map(stripAnsi);
    assert.ok(rows.every(row => displayWidth(row) <= 16));
    assert.match(rows.join('\n'), /Recommended/u);
    assert.equal(f.app['setupCursorClock'], undefined);
  } finally { f.dispose(); }
});

test('independent review: attached sessions never start installation onboarding with fresh settings', () => {
  const f = executionFrameFixture();
  try {
    Object.assign(f.app['promptConfiguration'], {introSeen: false, onboardingComplete: false});
    f.app['attachedSession'] = {} as never;
    f.app['startOnboarding'](); assert.equal(f.app['setupState'], undefined);
    assert.equal(f.app['promptConfiguration'].introSeen, false);
  } finally { f.dispose(); }
});

test('independent review: explicit Welcome provider changes can restore greetings after Minimal', async () => {
  const {createProviderPanel} = await import('../src/providers/ProviderPanel.js');
  const {WELCOME_PROVIDERS} = await import('../src/output/WelcomeProviders.js');
  const f = executionFrameFixture();
  try {
    f.app['promptConfiguration'].welcome = 'none'; f.app['output'].setWelcomeVisible(false);
    const state = createProviderPanel('welcome', 'Welcome', WELCOME_PROVIDERS, 'none');
    state.selectedIndex = WELCOME_PROVIDERS.findIndex(provider => provider.id === 'vespyr');
    f.app['saveProviderChoice'](state); f.app['startWelcome']('/demo');
    assert.equal(f.app['promptConfiguration'].welcome, 'vespyr'); assert.ok(f.app['output'].view().welcome);
  } finally { f.dispose(); }
});

test('independent review: full Manual Setup visibly reports failed persistence while retaining the draft', async () => {
  const {mkdirSync, writeFileSync} = await import('node:fs'); const {join} = await import('node:path');
  const f = executionFrameFixture(80, 30);
  try {
    mkdirSync(join(process.env.XDG_CONFIG_HOME!, 'nmsh'), {recursive: true});
    writeFileSync(join(process.env.XDG_CONFIG_HOME!, 'nmsh', 'config.json'), '{invalid');
    f.app['loadSetupContext'] = async () => {}; f.app['startSetup']();
    f.app['setupState']!.draft.welcome = 'none'; f.app['setupState']!.section = setup.sectionIndex('review');
    f.app['handleKey']({kind: 'enter'}); assert.ok(f.app['setupState']);
    assert.match(f.app['settingsPanelRows'](80).map(stripAnsi).join('\n'), /Could not save/u);
  } finally { f.dispose(); }
});

for (const choice of [0, 1]) test(`quick preset ${choice} saves only after review and never starts optional discovery`, () => {
  const f = executionFrameFixture();
  try {
    let discoveries = 0; f.app['loadSetupContext'] = async () => { discoveries++; };
    f.app['startSetup']('quick');
    f.app['handleKey']({kind: 'text', value: String(choice + 1)});
    f.app['handleKey']({kind: 'enter'});
    assert.ok(f.app['setupState']);
    f.app['handleKey']({kind: 'enter'});
    assert.equal(f.app['setupState'], undefined); assert.equal(discoveries, 0);
    assert.equal(f.app['promptConfiguration'].onboardingComplete, true);
    if (choice === 1) {
      assert.equal(f.app['promptConfiguration'].welcome, 'none');
      assert.equal(f.app['output'].view().welcome, undefined);
      assert.equal(f.app['promptConfiguration'].composerLayout, 'twoLine');
    }
    f.app['startOnboarding'](); assert.equal(f.app['setupState'], undefined);
    assert.equal(f.app['setupCursorClock'], undefined);
  } finally { f.dispose(); }
});
