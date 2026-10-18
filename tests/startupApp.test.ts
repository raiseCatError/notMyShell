import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadPromptConfiguration, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {parseSlashCommand, slashSuggestions} from '../src/commands/slashCommands.js';
import {SETTINGS_ENTRIES, SETTINGS_ROWS, settingsRowValue} from '../src/ui/SettingsPanel.js';
import {resolveChrome} from '../src/appearance/uiChrome.js';
import {uiColorsFor} from '../src/appearance/uiTheme.js';
import {NATIVE_PROMPT_THEMES} from '../src/prompt/prompt.js';
import type {EnvironmentEvidence} from '../src/setup/environment/detect.js';
import {startupLayout} from '../src/setup/startup/view.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/** The selector inside the real TerminalApp: its routes, its one bounded sky clock, its evidence and its saves. */
const evidence = (over: Partial<EnvironmentEvidence> = {}): EnvironmentEvidence => ({shell: {id: 'zsh', path: '/bin/zsh', label: 'zsh 5.9'}, files: ['~/.zshrc'],
  prompts: [], custom: [], tools: [], notes: [], ...over});
const text = (rows: readonly string[]) => rows.map(stripAnsi).join('\n');

test('/startup opens the same selector as /setup quick; /setup, /presets and --preset keep their meaning; there is no /preset', async () => {
  assert.deepEqual(parseSlashCommand('/startup'), {kind: 'setup', entry: 'quick'});
  assert.deepEqual(parseSlashCommand('/setup quick'), {kind: 'setup', entry: 'quick'});
  assert.deepEqual(parseSlashCommand('/setup'), {kind: 'setup'});
  assert.deepEqual(parseSlashCommand('/presets'), {kind: 'presets'});
  assert.notDeepEqual(parseSlashCommand('/startup now'), {kind: 'setup', entry: 'quick'}, '/startup takes no arguments');
  assert.notDeepEqual(parseSlashCommand('/preset'), {kind: 'presets'});
  assert.ok(slashSuggestions('/sta').some(item => item.name === '/startup'), '/startup is discoverable');
  assert.ok(!slashSuggestions('/pres').some(item => item.name === '/preset'));
  const f = executionFrameFixture(130, 38);
  try {
    await f.app['runSlash']('/startup', parseSlashCommand('/startup')!);
    const state = f.app['setupState'];
    assert.ok(state?.quick, 'the selector is open');
    assert.equal(state.onboarding, undefined, 'an explicit route is not the first run');
    assert.match(text(f.capture().frame.rows), /Your starting point/u);
    f.app['setupState'] = undefined;
    await f.app['runSlash']('/setup quick', parseSlashCommand('/setup quick')!);
    assert.ok(f.app['setupState']?.quick);
    f.app['setupState'] = undefined;
    f.app['loadSetupContext'] = async () => {};
    await f.app['runSlash']('/setup', parseSlashCommand('/setup')!);
    assert.equal(f.app['setupState']?.quick, undefined, '/setup is still the full guided setup');
  } finally { f.dispose(); }
});

test('Settings → General → Starting point opens the selector, and a backdrop row offers Aurora on, subtle and off', () => {
  const entry = SETTINGS_ENTRIES.find(item => item.id === 'setupQuick');
  assert.equal(entry?.label, 'Starting point');
  assert.equal(entry?.category, 'General');
  const row = SETTINGS_ROWS.find(item => item.id === 'onboardingBackdrop');
  assert.ok(row && row.control === 'enum');
  assert.deepEqual(row.control === 'enum' ? row.options : [], ['Aurora on', 'Subtle', 'Off']);
  assert.equal(settingsRowValue(row, normalizePromptConfiguration({onboardingBackdrop: 'subtle'})), 'Subtle');
  const f = executionFrameFixture(100, 30);
  try {
    f.app['openDestinationPanel']('setupQuick');
    assert.ok(f.app['setupState']?.quick);
  } finally { f.dispose(); }
});

test('A saves the backdrop at once, and a later Apply keeps it', () => {
  const f = executionFrameFixture(100, 30);
  try {
    f.app['startSetup']('quick');
    f.app['handleKey']({kind: 'text', value: 'A'});
    assert.equal(loadPromptConfiguration().onboardingBackdrop, 'subtle', 'saved immediately');
    assert.equal(f.app['promptConfiguration'].onboardingBackdrop, 'subtle');
    f.app['handleKey']({kind: 'text', value: 'a'});
    assert.equal(loadPromptConfiguration().onboardingBackdrop, 'off');
    f.app['handleKey']({kind: 'text', value: '2'});
    f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
    assert.equal(f.app['setupState'], undefined);
    assert.equal(loadPromptConfiguration().onboardingBackdrop, 'off', 'Apply does not put the old backdrop back');
    assert.equal(loadPromptConfiguration().startingPoint, 'minimal');
  } finally { f.dispose(); }
});

test('the selector draws in the saved theme\'s chrome; its previews draw with the highlighted draft', () => {
  const f = executionFrameFixture(130, 38);
  try {
    f.app['promptConfiguration'] = normalizePromptConfiguration({...f.app['promptConfiguration'], provider: 'nmsh', nmsh: {...f.app['promptConfiguration'].nmsh, palette: 'ocean'}});
    f.app['startSetup']('quick');
    f.app['handleKey']({kind: 'text', value: '1'});
    const rows = f.capture().frame.rows;
    const saved = f.app['setupState']!.saved;
    const ocean = uiColorsFor(resolveChrome(saved.uiChrome, 'ocean', saved.nmsh.accent, undefined)).accent;
    const segment = rows.find(row => stripAnsi(row).includes('1  NMSh Recommended'))!;
    assert.ok(segment.includes(`48;2;${ocean.red};${ocean.green};${ocean.blue}m`), 'the highlighted choice sits on the saved theme\'s accent');
    const lavender = NATIVE_PROMPT_THEMES.lavender.colors('project').background;
    assert.ok(rows.some(row => row.includes(`48;2;${lavender.red};${lavender.green};${lavender.blue}m`)), 'Recommended\'s composer preview is in Lavender');
  } finally { f.dispose(); }
});

test('the sky clock repaints only the panel and stops on close, on the guided setup, after 60 s idle and under Reduced Motion', () => {
  const f = executionFrameFixture(130, 38);
  try {
    f.app['startSetup']('quick');
    const first = f.capture().frame.rows;
    assert.ok(f.app['startupSkyClock'], 'one clock while the sky moves');
    assert.equal(f.app['startupSkyInterval'], 200);
    let renders = 0;
    const render = f.app['render'].bind(f.app);
    f.app['render'] = () => { renders++; render(); };
    f.tick(400);
    f.app['paintStartupSky']();
    assert.equal(renders, 0, 'a sky frame repaints only the panel, never the whole app');
    const sky = startupLayout(130, 38).skyHeight;
    const frame = f.capture().frame.rows;
    assert.notDeepEqual(frame.slice(0, sky), first.slice(0, sky), 'the sky moved');
    assert.deepEqual(frame.slice(sky + 1), first.slice(sky + 1), 'the ground did not');
    // A highlight change runs the cross-fade and tail flick at 40 ms, then settles back.
    f.app['handleKey']({kind: 'down'}); f.capture();
    assert.equal(f.app['startupSkyInterval'], 40);
    f.tick(800); f.app['paintStartupSky']();
    assert.equal(f.app['startupSkyInterval'], 200);
    // 60 s without a key: the sky holds still and no clock remains; the next key resumes it.
    f.tick(61_000); f.app['paintStartupSky']();
    assert.equal(f.app['startupSkyClock'], undefined);
    f.app['handleKey']({kind: 'up'}); f.capture();
    assert.ok(f.app['startupSkyClock']);
    // The guided setup has its own previews; the sky stops while it is open.
    f.app['loadSetupContext'] = async () => {};
    f.app['handleKey']({kind: 'text', value: '3'}); f.app['handleKey']({kind: 'enter'}); f.capture();
    assert.equal(f.app['setupState']?.quick?.manual, true);
    assert.equal(f.app['startupSkyClock'], undefined);
    f.app['handleKey']({kind: 'escape'}); f.capture();
    assert.ok(f.app['startupSkyClock'], 'back on the choices, the sky moves again');
    // Leaving closes the selector and its clock.
    f.app['handleKey']({kind: 'escape'}); f.app['handleKey']({kind: 'right'}); f.app['handleKey']({kind: 'enter'}); f.capture();
    assert.equal(f.app['setupState'], undefined);
    assert.equal(f.app['startupSkyClock'], undefined);
  } finally { f.dispose(); }
  const reduced = executionFrameFixture(130, 38, 'reduced');
  try {
    reduced.app['startSetup']('quick'); reduced.capture();
    assert.equal(reduced.app['startupSkyClock'], undefined, 'Reduced Motion: one still frame, no clock');
    reduced.app['handleKey']({kind: 'down'}); reduced.capture();
    assert.equal(reduced.app['startupSkyClock'], undefined);
  } finally { reduced.dispose(); }
  const effectsOff = executionFrameFixture(130, 38, 'effects-off');
  try {
    effectsOff.app['startSetup']('quick'); effectsOff.capture();
    assert.equal(effectsOff.app['startupSkyClock'], undefined, 'Effects Off: no sky motion');
  } finally { effectsOff.dispose(); }
});

test('evidence is read once per open, in the background, and keys never wait for it', async () => {
  const f = executionFrameFixture(130, 38);
  try {
    let calls = 0;
    let deliver: ((value: EnvironmentEvidence) => void) | undefined;
    f.app['detectStartupEnvironment'] = () => { calls++; return new Promise<EnvironmentEvidence>(resolve => { deliver = resolve; }); };
    f.app['startSetup']('quick');
    assert.equal(calls, 1);
    f.app['handleKey']({kind: 'down'});
    assert.equal(f.app['setupState']?.quick?.choice, 1, 'keys work while detection runs');
    f.capture(); f.capture();
    assert.equal(calls, 1, 'rendering never detects');
    deliver!(evidence({prompts: [{id: 'starship', label: 'Starship', state: 'active', started: true, runnable: true, configExists: false, startedBy: '~/.zshrc'}]}));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.app['setupState']?.quick?.evidence?.prompts[0]?.id, 'starship');
    // R on a configured install reads it again; a stale read never lands on a newer one.
    f.app['handleKey']({kind: 'text', value: '4'}); f.app['handleKey']({kind: 'enter'});
    f.app['handleKey']({kind: 'text', value: 'R'});
    assert.equal(calls, 2);
    f.app['setupState'] = undefined;
    f.app['startSetup']('quick');
    assert.equal(calls, 3, 'a new open reads it again');
  } finally { f.dispose(); }
});

test('Keep Existing shows the detected Starship prompt as NMSh draws it, without writing anything', async () => {
  const f = executionFrameFixture(130, 38);
  try {
    const root = process.env.HOME!;
    const bin = join(root, 'bin');
    mkdirSync(bin, {recursive: true});
    const starship = join(bin, 'starship');
    writeFileSync(starship, `#!/bin/sh\necho "$STARSHIP_CACHE" > '${join(root, 'cache.txt')}'\nprintf '\\033[1;36m~/project\\033[0m on main\\n\\033[1;32m❯\\033[0m '\n`, {mode: 0o755});
    f.app['detectStartupEnvironment'] = async () => evidence({prompts: [{id: 'starship', label: 'Starship', state: 'active', started: true, runnable: true, binary: starship, configExists: false, startedBy: '~/.zshrc'}]});
    // A first run: Keep Existing keeps the one active prompt (a configured install would keep its NMSh settings instead).
    Object.assign(f.app['promptConfiguration'], {onboardingComplete: false, introSeen: true});
    f.app['startSetup']('quick');
    f.app['handleKey']({kind: 'text', value: '4'});
    // The adapter runs a real (fake) Starship process: allow for a loaded machine.
    for (let i = 0; i < 200 && !f.app['setupState']?.context.startup?.sample; i++) await new Promise(resolve => setTimeout(resolve, 25));
    const shown = text(f.capture().frame.rows);
    assert.match(shown, /~\/project on main/u);
    assert.ok(!shown.split('\n').find(line => line.includes('~/project on main'))!.includes('❯'), 'its own trailing prompt character is dropped');
    assert.match(shown, /your prompt, as NMSh will draw it/u);
    assert.match(readFileSync(join(root, 'cache.txt'), 'utf8'), /^\/dev\/null\//u, 'Starship cannot create its cache');
  } finally { f.dispose(); }
});

test('a failed save keeps the selector, its draft and the error, and starts nothing else', () => {
  const f = executionFrameFixture(130, 38);
  try {
    mkdirSync(join(process.env.XDG_CONFIG_HOME!, 'nmsh'), {recursive: true});
    writeFileSync(join(process.env.XDG_CONFIG_HOME!, 'nmsh', 'config.json'), '{invalid');
    f.app['startSetup']('quick');
    f.app['handleKey']({kind: 'text', value: '2'});
    const draft = structuredClone(f.app['setupState']!.draft);
    f.app['handleKey']({kind: 'enter'}); f.app['handleKey']({kind: 'enter'});
    const state = f.app['setupState'];
    assert.ok(state?.quick?.review, 'still reviewing');
    assert.deepEqual(state.draft, draft);
    assert.match(state.message ?? '', /Could not save/u);
    assert.match(text(f.capture().frame.rows), /Could not save/u);
    assert.equal(f.app['startupEnding'], undefined, 'no ending starts');
    assert.ok(f.app['startupSkyClock'], 'the selector keeps going');
  } finally { f.dispose(); }
});
