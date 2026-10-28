import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {buildGhosttyCatalog} from '../src/appearance/ghosttyShaderCatalog.js';
import {createGhosttyShaderPanel, ghosttyShaderKey, renderGhosttyShaderPanel} from '../src/appearance/GhosttyShaderPanel.js';
import {appearanceHubKey, createAppearanceHub, renderAppearanceHub} from '../src/appearance/AppearanceHub.js';
import {DEFAULT_HOST_SHADERS} from '../src/appearance/kittyShaderSettings.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {applyGhosttyShaderPlan, ghosttyShaderPaths, planGhosttyShaders, type GhosttyShaderGates, type GhosttyShaderInspection} from '../src/appearance/ghosttyShaders.js';
import {GlslShaderStudio} from '../src/appearance/glslStudio.js';
import {stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const key = (kind: string, value = ''): Key => ({kind, value} as unknown as Key);
const plain = (rows: string[]) => rows.map(stripAnsi);
const gates: GhosttyShaderGates = {reducedMotion: false, effectsOff: false, cursorRenderer: 'auto', cursorMotion: 'tail'};
const inspection = (value: Partial<GhosttyShaderInspection> = {}): GhosttyShaderInspection => ({hostPath: '/h/config.ghostty', entries: [], userEntries: ['mine.glsl'], resets: [],
  animation: {value: 'true', source: 'default'}, cursorShaderActive: false, problems: [], notes: [], dependencies: [], configured: false, drifted: false, activePresets: [], ...value});

function panel(version = '1.3.1', g = gates) {
  const state = createGhosttyShaderPanel(structuredClone(DEFAULT_HOST_SHADERS.ghostty), g);
  state.catalog = buildGhosttyCatalog(version);
  state.inspection = inspection();
  return state;
}
const select = (state: ReturnType<typeof panel>, label: string) => {
  for (let i = 0; i < 40; i++) {
    if (plain(renderGhosttyShaderPanel(state, 160)).some(row => row.startsWith('›') && row.includes(label))) return;
    ghosttyShaderKey(state, key('down'));
  }
  assert.fail(`row ${label} not found`);
};

test('studio lists capability-aware presets by category; one trail at a time; parameters appear when enabled', () => {
  const state = panel();
  const text = plain(renderGhosttyShaderPanel(state, 160)).join('\n');
  assert.match(text, /Appearance › Ghostty shaders[\s\S]*Ghostty 1\.3\.1 · NMSh’s own GLSL passes[\s\S]*Your shaders \(kept, in order; NMSh’s run after them\): mine\.glsl/u);
  assert.match(text, /Cursor trail \(one\)[\s\S]*Smear trail[\s\S]*Comet trail[\s\S]*Ambient[\s\S]*Aurora[\s\S]*Focus & tabs[\s\S]*Dim when unfocused[\s\S]*Display[\s\S]*Vignette/u);
  assert.ok(!/Placement/u.test(text), 'Ghostty has no placement choice');
  select(state, 'Smear trail');
  ghosttyShaderKey(state, key('enter'));
  select(state, 'Comet trail');
  ghosttyShaderKey(state, key('enter'));
  assert.deepEqual(state.draft.effects.map(effect => [effect.id, effect.enabled]), [['smear', false], ['comet', true]], 'exclusive trails');
  select(state, 'Glow radius');
  ghosttyShaderKey(state, key('right'));
  assert.equal(state.draft.effects.find(effect => effect.id === 'comet')!.values.GLOW, 1.3);
  select(state, 'Colors');
  ghosttyShaderKey(state, key('right'));
  assert.equal(state.draft.effects.find(effect => effect.id === 'comet')!.values.COLOR_SOURCE, 1);
  assert.equal(state.dirty, true);
  assert.deepEqual(ghosttyShaderKey(state, key('text', 's')), {kind: 'review'});
});

test('Ghostty 1.2 shows what needs 1.3; unsupported and unknown versions explain and still allow removal', () => {
  const old = panel('1.2.0');
  assert.match(plain(renderGhosttyShaderPanel(old, 200)).join('\n'), /Not available in this version: Aurora \(Ghostty 1\.3\+\), Dim when unfocused \(Ghostty 1\.3\+\)/u);
  const unknown = panel('');
  unknown.catalog = buildGhosttyCatalog(undefined);
  unknown.inspection = inspection({configured: true});
  const text = plain(renderGhosttyShaderPanel(unknown, 160)).join('\n');
  assert.match(text, /did not report its version[\s\S]*Cursor effects stay with \/cursor/u);
  assert.equal(ghosttyShaderKey(unknown, key('text', 's')), undefined);
  assert.deepEqual(ghosttyShaderKey(unknown, key('text', 'r')), {kind: 'remove'});
});

test('gates and reload state are visible; L confirms a reload only while one is pending', () => {
  const portable = panel('1.3.1', {...gates, cursorRenderer: 'portable'});
  assert.match(plain(renderGhosttyShaderPanel(portable, 160)).join('\n'), /Portable, so NMSh draws the trail itself/u);
  const smooth = panel('1.3.1', {...gates, cursorMotion: 'smooth'});
  assert.match(plain(renderGhosttyShaderPanel(smooth, 160)).join('\n'), /Smooth \(a caret glide, not a trail\)/u);
  const reduced = panel('1.3.1', {...gates, reducedMotion: true});
  assert.match(plain(renderGhosttyShaderPanel(reduced, 160)).join('\n'), /Reduced Motion is on: NMSh writes no Ghostty effects/u);
  const state = panel();
  assert.equal(ghosttyShaderKey(state, key('text', 'l')), undefined);
  state.reloadPending = 'smear';
  assert.match(plain(renderGhosttyShaderPanel(state, 200)).join('\n'), /may still draw NMSh’s previous trail[\s\S]*L reloaded/u);
  assert.deepEqual(ghosttyShaderKey(state, key('text', 'l')), {kind: 'reloaded'});
  const short = plain(renderGhosttyShaderPanel(state, 80, 12));
  assert.ok(short.at(-1)!.includes('Esc'), 'controls survive a short window');
  assert.ok(short.some(row => row.includes('Reload pending: press L')), 'a pending reload stays visible in a short window');
  assert.ok(short.length <= 12);
});

test('the review screen shows the exact plan and Esc changes nothing', () => {
  const state = panel();
  state.confirmation = {plan: {host: 'ghostty', operation: 'save', hostPath: '/h', fragmentPath: '/f', preview: ['File: /h', '+ config-file = ?/f'], notes: [], guidance: 'Reload Ghostty’s configuration',
    home: '/', changes: [], dependencies: [], shaders: [], effectiveShaders: []}, offset: 0};
  assert.match(plain(renderGhosttyShaderPanel(state, 120)).join('\n'), /Review Ghostty shader configuration[\s\S]*\+ config-file = \?\/f[\s\S]*Reload Ghostty/u);
  assert.equal(ghosttyShaderKey(state, key('escape')), undefined);
  assert.equal(state.confirmation, undefined);
  assert.equal(state.message, 'Nothing was changed.');
});

test('the /appearance hub offers Ghostty shaders only in Ghostty', () => {
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const hub = createAppearanceHub('Ghostty');
  hub.ghosttyShaders = 'Off · Ghostty GPU effects';
  assert.match(plain(renderAppearanceHub(hub, config, 120, 'Lavender', 'Portable')).join('\n'), /Ghostty shaders\s+Off · Ghostty GPU effects/u);
  for (let index = 0; index < 3; index++) appearanceHubKey(hub, key('down'), config);
  assert.deepEqual(appearanceHubKey(hub, key('enter'), config), {kind: 'open', destination: 'glslShaders'});
  const other = createAppearanceHub('Terminal.app');
  assert.ok(!plain(renderAppearanceHub(other, config, 120, 'Lavender', 'Portable')).join('\n').includes('Ghostty shaders'));
});

test('app: /appearance › Ghostty shaders reviews, writes only after Enter, makes Ghostty own the trail, and Esc returns to the hub', async t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-gpanel-')));
  const saved = {...process.env};
  Object.assign(process.env, {HOME: home, XDG_CONFIG_HOME: join(home, '.config'), NMSH_CONFIG_HOME: join(home, '.config/nmsh'), TERM_PROGRAM: 'ghostty', TERM_PROGRAM_VERSION: '1.3.1', TERM: 'xterm-ghostty'});
  for (const name of ['KITTY_WINDOW_ID', 'KITTY_PID', 'TMUX']) delete process.env[name];
  const app = new TerminalApp();
  t.after(() => {
    app['stop'](0); app['session'].kill();
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
    rmSync(home, {recursive: true, force: true});
  });
  const config = join(home, '.config/ghostty/config.ghostty');
  mkdirSync(join(home, '.config/ghostty'), {recursive: true, mode: 0o700});
  writeFileSync(config, 'font-size = 13\n', {mode: 0o600});
  app['promptConfiguration'].cursor.motion = 'tail';
  app['glslStudio'].open();
  const state = app['glslStudio'].panel!;
  assert.ok(state.inspection && state.catalog?.supported, state.message);
  select(state, 'Smear trail');
  app['onInput']('\r');
  app['onInput']('s');
  assert.ok(state.confirmation, state.message);
  assert.equal(existsSync(join(home, '.config/nmsh/host-appearance/ghostty-shaders.conf')), false, 'review writes nothing');
  assert.equal(readFileSync(config, 'utf8'), 'font-size = 13\n');
  app['onInput']('\r');
  assert.equal(state.confirmation, undefined, state.message);
  assert.match(readFileSync(join(home, '.config/nmsh/host-appearance/ghostty-shaders.conf'), 'utf8'), /^custom-shader = .*ghostty-shaders\/smear\.glsl$/mu);
  assert.deepEqual(app['promptConfiguration'].hostShaders.ghostty.effects.map((effect: {id: string; enabled: boolean}) => [effect.id, effect.enabled]), [['smear', true]]);
  // Ghostty now draws the trail: Portable does not draw a second one.
  assert.equal(app['cursorFacts']().ghosttyTrail, 'smear');
  assert.equal(app['cursorBackend']().portableDraws.motion, false);
  app['onInput']('\u001b[27u');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(app['glslStudio'].panel, undefined);
  assert.ok(app['appearanceHub']?.ghosttyShaders?.startsWith('1 effect chosen'), app['appearanceHub']?.ghosttyShaders);
});

test('controller: a reload record that cannot be saved still keeps Portable from drawing a second trail in this process', t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-gstudio-')));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  const env = {HOME: home, XDG_CONFIG_HOME: join(home, '.config'), NMSH_CONFIG_HOME: join(home, '.config/nmsh'), TERM_PROGRAM: 'ghostty', TERM_PROGRAM_VERSION: '1.3.1'};
  const configuration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const studio = new GlslShaderStudio({configuration: () => configuration, update: () => {}, invalidateCursor: () => {}, notify: () => {}, render: () => {}, back: () => {}}, env, 'linux');
  // A directory where the record belongs: saving it fails.
  mkdirSync(ghosttyShaderPaths({env, platform: 'linux'}).reload, {recursive: true});
  studio['noteTrailChange']('nmsh-cursor', 'smear');
  studio['noteTrailChange']('smear', undefined);
  assert.equal(studio.trailFacts().pending, 'nmsh-cursor');
  const state = createGhosttyShaderPanel(structuredClone(DEFAULT_HOST_SHADERS.ghostty), gates);
  state.catalog = buildGhosttyCatalog('1.3.1');
  state.reloadPending = 'nmsh-cursor';
  studio.panel = state;
  rmSync(ghosttyShaderPaths({env, platform: 'linux'}).reload, {recursive: true});
  studio.key(key('text', 'l'));
  assert.equal(studio.trailFacts().pending, undefined, 'L clears the in-memory record too');
});

test('app: starting NMSh applies gate changes made while it was not running (Reduced Motion removes NMSh’s passes)', t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-gstart-')));
  const saved = {...process.env};
  Object.assign(process.env, {HOME: home, XDG_CONFIG_HOME: join(home, '.config'), NMSH_CONFIG_HOME: join(home, '.config/nmsh'), TERM_PROGRAM: 'ghostty', TERM_PROGRAM_VERSION: '1.3.1', TERM: 'xterm-ghostty'});
  for (const name of ['KITTY_WINDOW_ID', 'KITTY_PID', 'TMUX', 'NMSH_REDUCED_MOTION']) delete process.env[name];
  let app: TerminalApp | undefined;
  t.after(() => {
    if (app) { app['stop'](0); app['session'].kill(); }
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
    rmSync(home, {recursive: true, force: true});
  });
  mkdirSync(join(home, '.config/ghostty'), {recursive: true, mode: 0o700});
  writeFileSync(join(home, '.config/ghostty/config.ghostty'), '', {mode: 0o600});
  const context = {env: process.env, platform: process.platform, catalog: buildGhosttyCatalog('1.3.1'), gates, launch: {}, colors: {cursorColors: {head: [1, 1, 1], tail: [0, 0, 0]}, chroma: {a: [0, 1, 0], b: [0, 0, 1]}}};
  const planned = planGhosttyShaders({effects: [{id: 'vignette', enabled: true, values: {}}]}, context);
  assert.ok(planned.ok && applyGhosttyShaderPlan(planned.plan).ok);
  const fragment = ghosttyShaderPaths(context).fragment;
  assert.match(readFileSync(fragment, 'utf8'), /vignette\.glsl/u);
  process.env.NMSH_REDUCED_MOTION = '1';
  app = new TerminalApp();
  assert.doesNotMatch(readFileSync(fragment, 'utf8'), /^custom-shader =/mu, 'startup removed NMSh’s passes');
});
