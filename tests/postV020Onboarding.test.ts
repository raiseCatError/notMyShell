import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPromptConfiguration, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {createQuickSetup, setupKey, renderSetup} from '../src/setup/SetupCat.js';
import * as setup from '../src/setup/SetupCat.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';

test('fresh intro marker differs from legacy objects and survives normalized persistence', () => {
  assert.equal(normalizePromptConfiguration(undefined).introSeen, false);
  assert.equal(normalizePromptConfiguration({}).introSeen, true);
  assert.equal(normalizePromptConfiguration({onboardingComplete: true}).introSeen, true);
  assert.equal(normalizePromptConfiguration({introSeen: false}).introSeen, false);
});

test('first intro is persisted once; any key only skips, cancel/reopen never replays it', () => {
  const f = executionFrameFixture();
  try {
    Object.assign(f.app['promptConfiguration'], {introSeen: false, onboardingComplete: false, toolsSetupComplete: false});
    f.app['startOnboarding']();
    assert.ok(f.app['setupState']?.intro);
    assert.equal(loadPromptConfiguration().introSeen, true);
    assert.equal(loadPromptConfiguration().onboardingComplete, false);
    f.app['handleKey']({kind: 'text', value: '2'});
    assert.equal(f.app['setupState']?.intro, undefined);
    assert.equal(f.app['setupState']?.quick?.choice, 0, 'skip input is consumed');
    f.app['handleKey']({kind: 'escape'});
    f.app['startOnboarding']();
    assert.equal(f.app['setupState']?.intro, undefined);
    assert.ok(f.app['setupState']?.quick);
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
      assert.equal(f.app['promptConfiguration'].composerLayout, 'oneLine');
    }
    f.app['startOnboarding'](); assert.equal(f.app['setupState'], undefined);
    assert.equal(f.app['setupCursorClock'], undefined);
  } finally { f.dispose(); }
});

test('explicit routes keep manual wizard, quick selector and no installation intro', () => {
  const f = executionFrameFixture();
  try {
    f.app['loadSetupContext'] = async () => {};
    f.app['startSetup'](); assert.equal(f.app['setupState']?.quick, undefined);
    f.app['startSetup']('prompt'); assert.equal(setup.SETUP_SECTIONS[f.app['setupState']!.section]?.id, 'prompt');
    f.app['startSetup']('quick'); assert.ok(f.app['setupState']?.quick); assert.equal(f.app['setupState']?.intro, undefined);
    assert.deepEqual(parseSlashCommand('/setup quick'), {kind: 'setup', entry: 'quick'});
  } finally { f.dispose(); }
});

test('introduction production rows are finite, narrow-safe and have a static accessible fallback', () => {
  assert.equal(typeof setup.renderSetupIntro, 'function');
  for (const width of [16, 32, 50, 80]) for (const still of [false, true]) {
    const frame = setup.renderSetupIntro(width, 18, 1500, still);
    assert.ok(frame.rows.every(row => displayWidth(row) <= width));
    assert.match(frame.rows.map(stripAnsi).join('\n'), /notMyShell/);
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
    assert.ok(f.app['setupState']); assert.match(f.app['setupState']?.message ?? '', /Could not save/);
    assert.equal(JSON.stringify(f.app['promptConfiguration']), before);
    assert.equal(readFileSync(path, 'utf8'), '{invalid');
    f.app['handleKey']({kind: 'escape'}); assert.equal(f.app['setupState'], undefined);
    assert.equal(f.app['setupCursorClock'], undefined);
  } finally { f.dispose(); }
});

test('rapid focus/replay, resize and cancellation leave no stale preview subscription or live activity', () => {
  const f = executionFrameFixture(32, 18);
  try {
    f.app['startSetup']('quick'); f.capture();
    const before = JSON.stringify(f.app['output'].transcript());
    for (let i = 0; i < 15; i++) {
      f.app['handleKey']({kind: 'text', value: String(i % 3 + 1)}); f.capture();
      f.app['handleKey']({kind: 'text', value: 'r'}); f.capture();
    }
    Object.defineProperty(f.app, 'dimensions', {value: () => ({columns: 32, rows: 8}), configurable: true});
    Object.defineProperty(f.app, 'terminalDimensions', {value: () => ({columns: 32, rows: 8}), configurable: true});
    f.capture(); assert.equal(f.app['setupCursorClock'], undefined, 'no animation while preview is hidden');
    f.app['handleKey']({kind: 'escape'});
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

test('independent review: resizing below modal minimum stops preview playback', () => {
  const f = executionFrameFixture();
  try {
    f.app['startSetup']('quick'); f.capture(); assert.ok(f.app['setupCursorClock']);
    Object.defineProperty(f.app, 'dimensions', {value: () => ({columns: 15, rows: 5}), configurable: true});
    f.capture(); assert.equal(f.app['setupCursorClock'], undefined);
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
    assert.match(f.app['settingsPanelRows'](80).map(stripAnsi).join('\n'), /Could not save/);
  } finally { f.dispose(); }
});

test('independent review: compact quick controls show layout, confirm, cancel and setup at 16x6', () => {
  const state = createQuickSetup(normalizePromptConfiguration({onboardingComplete: true}));
  setupKey(state, {kind: 'text', value: '2'});
  let text = renderSetup(state, 16, 6).map(stripAnsi).join('\n');
  for (const word of ['One-line', 'Enter', 'Esc', '/setup']) assert.ok(text.includes(word), word + ': ' + text);
  setupKey(state, {kind: 'right'}); text = renderSetup(state, 16, 6).map(stripAnsi).join('\n'); assert.match(text, /Two-line/);
  setupKey(state, {kind: 'enter'}); text = renderSetup(state, 16, 6).map(stripAnsi).join('\n'); assert.match(text, /Apply/);
});
