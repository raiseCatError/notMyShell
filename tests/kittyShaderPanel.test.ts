import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildKittyCatalog} from '../src/appearance/kittyShaderCatalog.js';
import {createKittyShaderPanel, kittyShaderKey, paramValue, renderKittyShaderPanel} from '../src/appearance/KittyShaderPanel.js';
import {appearanceHubKey, createAppearanceHub, renderAppearanceHub} from '../src/appearance/AppearanceHub.js';
import {DEFAULT_HOST_SHADERS} from '../src/appearance/kittyShaderSettings.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {stripAnsi} from '../src/util/text.js';

const RESOURCES: Record<string, string> = {
  'types.slang': '//\n',
  'cursor-trail-default.pipeline': 'startgroup\nanimation_start cursor-trail-move\nanimation_stop cursor-trail-stop\nshaders cursor-trail-default\nendgroup\n',
  'cursor-trail-default.slang': '//\n',
  'cursor-trail-blaze.pipeline': 'startgroup\nanimation_start cursor-trail-move\nanimation_stop cursor-trail-stop\nshaders cursor-trail-blaze\nendgroup\n',
  'cursor-trail-blaze.slang': 'static const float4 TRAIL_COLOR = float4(1.0, 0.725, 0.161, 1.0);\nstatic const float DURATION = 0.5;\n',
  'spotlight.pipeline': 'startgroup\nanimation_start user-activity\nshaders spotlight\nendgroup\n',
  'spotlight.slang': 'static const float SPOTLIGHT_RADIUS = 0.25;\nstatic const float AMBIENT_LIGHT = 0.5;\n',
  'tab-change.pipeline': 'startgroup\nanimation_start tab-change\nanimation_stop 600\nshaders tab-change\nendgroup\n',
  'tab-change.slang': 'static const int ANIMATION_TYPE = 1;\nstatic const int NUM_BLINDS = 8;\n',
  'fireworks-rockets.pipeline': 'startgroup\nshaders fireworks-rockets\nendgroup\n',
};
const catalog = buildKittyCatalog('0.49.2', RESOURCES);
const gates = {reducedMotion: false, effectsOff: false, cursorRenderer: 'auto' as const};
const key = (kind: string, value?: string) => (value === undefined ? {kind} : {kind, value}) as never;
const plain = (rows: string[]) => rows.map(row => stripAnsi(row));
const panel = () => { const state = createKittyShaderPanel(DEFAULT_HOST_SHADERS.kitty, gates); state.catalog = catalog; return state; };
const select = (state: ReturnType<typeof panel>, label: string) => {
  for (let index = 0; index < 40; index++) {
    const rows = plain(renderKittyShaderPanel(state, 120));
    if (rows.some(row => row.startsWith('›') && row.includes(label))) return;
    kittyShaderKey(state, key('down'));
  }
  throw new Error(`row ${label} not found`);
};

test('panel: one cursor trail at a time; parameters appear only for enabled effects and stay within bounds', () => {
  const state = panel();
  select(state, 'Default trail');
  kittyShaderKey(state, key('enter'));
  select(state, 'Blaze trail');
  kittyShaderKey(state, key('enter'));
  assert.deepEqual(state.draft.effects.map(effect => [effect.id, effect.enabled]), [['cursor-trail-default', false], ['cursor-trail-blaze', true]]);
  select(state, 'Duration (s)');
  for (let index = 0; index < 60; index++) kittyShaderKey(state, key('right'));
  const blaze = catalog.offered.find(item => item.definition.id === 'cursor-trail-blaze')!;
  assert.equal(paramValue(state, blaze, blaze.params.find(param => param.name === 'DURATION')!), 2, 'clamped to NMSh’s safe range');
  select(state, 'Fill color');
  kittyShaderKey(state, key('enter'));
  for (const char of '#3399ff') kittyShaderKey(state, key('text', char));
  kittyShaderKey(state, key('enter'));
  assert.deepEqual(state.draft.effects[1]!.values.TRAIL_COLOR, [0.2, 0.6, 1, 1], 'RGB from hex, shipped alpha kept');
  assert.equal(state.dirty, true);
  // Choices cycle through the shader's documented values only.
  select(state, 'Tab change');
  kittyShaderKey(state, key('text', ' '));
  select(state, 'Style');
  kittyShaderKey(state, key('right'));
  assert.equal(state.draft.effects.find(effect => effect.id === 'tab-change')!.values.ANIMATION_TYPE, 2);
});

test('panel: Shift+↑↓ reorders enabled effects; S, R and Enter map to review, remove and confirm; Esc backs out', () => {
  const state = panel();
  select(state, 'Spotlight'); kittyShaderKey(state, key('enter'));
  select(state, 'Tab change'); kittyShaderKey(state, key('enter'));
  assert.deepEqual(state.draft.effects.map(effect => effect.id), ['spotlight', 'tab-change']);
  select(state, 'Tab change');
  kittyShaderKey(state, key('selectUp'));
  assert.deepEqual(state.draft.effects.map(effect => effect.id), ['tab-change', 'spotlight']);
  assert.ok(plain(renderKittyShaderPanel(state, 120)).some(row => /Tab change\s+#1/u.test(row)));
  assert.deepEqual(kittyShaderKey(state, key('text', 's')), {kind: 'review'});
  assert.deepEqual(kittyShaderKey(state, key('text', 'R')), {kind: 'remove'});
  state.confirmation = {plan: {preview: ['File: x', '+ include y'], guidance: 'Reload Kitty.'} as never, offset: 0};
  assert.match(plain(renderKittyShaderPanel(state, 120)).join('\n'), /Review Kitty shader configuration[\s\S]*\+ include y[\s\S]*Reload Kitty/u);
  assert.deepEqual(kittyShaderKey(state, key('enter')), {kind: 'confirm'});
  kittyShaderKey(state, key('escape'));
  assert.equal(state.confirmation, undefined);
  assert.deepEqual(kittyShaderKey(state, key('escape')), {kind: 'back'});
});

test('panel: honest states — unsupported Kitty, gates, missing parameters, installed-but-not-offered; fits narrow and short windows', () => {
  const unsupported = createKittyShaderPanel(DEFAULT_HOST_SHADERS.kitty, gates);
  unsupported.catalog = buildKittyCatalog('0.48.0', {});
  assert.match(plain(renderKittyShaderPanel(unsupported, 100)).join('\n'), /need Kitty 0\.49 or newer[\s\S]*Cursor effects stay with \/cursor/u);
  assert.equal(kittyShaderKey(unsupported, key('text', 's')), undefined, 'nothing to review without support');
  assert.deepEqual(kittyShaderKey(unsupported, key('text', 'r')), {kind: 'remove'}, 'removal still works on an unsupported Kitty');
  const reduced = panel();
  reduced.gates = {...gates, reducedMotion: true};
  assert.match(plain(renderKittyShaderPanel(reduced, 120)).join('\n'), /Reduced Motion is on/u);
  const state = panel();
  select(state, 'Default trail');
  assert.match(plain(renderKittyShaderPanel(state, 160)).join('\n'), /Kitty exposes no shader settings for this trail/u);
  assert.match(plain(renderKittyShaderPanel(state, 160)).join('\n'), /Installed, not offered yet: fireworks-rockets/u);
  for (const columns of [40, 60]) for (const row of renderKittyShaderPanel(state, columns, 14)) assert.ok(stripAnsi(row).length <= columns, `${columns}: ${stripAnsi(row)}`);
  assert.ok(renderKittyShaderPanel(state, 80, 14).length <= 14);
  assert.ok(plain(renderKittyShaderPanel(state, 80, 14)).at(-1)!.includes('Esc'), 'controls survive a short window');
});

test('hub: the Kitty shaders row exists only in Kitty and opens its studio', () => {
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const zed = createAppearanceHub('Zed');
  assert.doesNotMatch(plain(renderAppearanceHub(zed, config, 120, 'Lavender', 'Portable')).join('\n'), /Kitty shaders/u);
  const kitty = createAppearanceHub('Kitty');
  kitty.kittyShaders = 'Off · Kitty 0.49+ GPU effects';
  assert.match(plain(renderAppearanceHub(kitty, config, 120, 'Lavender', 'Portable')).join('\n'), /Kitty shaders\s+Off · Kitty 0\.49\+ GPU effects/u);
  for (let index = 0; index < 3; index++) appearanceHubKey(kitty, key('down'), config);
  assert.deepEqual(appearanceHubKey(kitty, key('enter'), config), {kind: 'open', destination: 'kittyShaders'});
});

test('app: /appearance › Kitty shaders reviews, writes only after Enter, saves the settings, and Esc returns to the hub', async t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-kpanel-')));
  const saved = {...process.env};
  Object.assign(process.env, {HOME: home, XDG_CONFIG_HOME: join(home, '.config'), KITTY_WINDOW_ID: '1', KITTY_PID: String(process.pid), TERM: 'xterm-kitty'});
  for (const name of ['KITTY_CONFIG_DIRECTORY', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TMUX']) delete process.env[name];
  const app = new TerminalApp();
  t.after(() => {
    app['stop'](0); app['session'].kill();
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
    rmSync(home, {recursive: true, force: true});
  });
  const kittyConf = join(home, '.config/kitty/kitty.conf');
  mkdirSync(join(home, '.config/kitty'), {recursive: true, mode: 0o700});
  writeFileSync(kittyConf, 'cursor_trail 3\ncustom_shaders spotlight\n', {mode: 0o600});
  app['kittyCatalogRead'] = Promise.resolve(catalog);
  await app['openKittyShaders']();
  const state = app['kittyShaderPanel']!;
  assert.ok(state.inspection);
  assert.deepEqual(state.inspection.userEntries, ['spotlight']);
  select(state, 'Blaze trail');
  app['onInput']('\r');
  app['onInput']('s');
  assert.ok(state.confirmation, state.message);
  assert.equal(existsSync(join(home, '.config/nmsh/host-appearance/kitty-shaders.pipeline')), false, 'review writes nothing');
  assert.equal(readFileSync(kittyConf, 'utf8'), 'cursor_trail 3\ncustom_shaders spotlight\n');
  app['onInput']('\r');
  assert.equal(state.confirmation, undefined);
  assert.match(readFileSync(join(home, '.config/nmsh/host-appearance/kitty-shaders.conf'), 'utf8'), /^custom_shaders spotlight .*kitty-shaders\.pipeline$/mu);
  assert.deepEqual(app['promptConfiguration'].hostShaders.kitty.effects.map((effect: {id: string; enabled: boolean}) => [effect.id, effect.enabled]), [['cursor-trail-blaze', true]]);
  // The cursor now knows Kitty draws the trail: Portable does not draw a second one.
  assert.equal(app['cursorFacts']().kittyTrail, 'cursor-trail-blaze');
  app['onInput']('\u001b[27u');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(app['kittyShaderPanel'], undefined);
  assert.ok(app['appearanceHub']?.kittyShaders?.startsWith('1 effect chosen'));
});
