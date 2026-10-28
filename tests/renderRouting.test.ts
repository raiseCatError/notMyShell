import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderRoutes, type RoutingInput} from '../src/motion/renderRouting.js';
import {chooseBackend, type HostCursorFacts} from '../src/cursor/backends.js';
import {DEFAULT_CURSOR, DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {buildGhosttyCatalog, generateGhosttyShader, presetById} from '../src/appearance/ghosttyShaderCatalog.js';
import {applyGhosttyShaderPlan, planGhosttyShaders, syncGhosttyShaders} from '../src/appearance/ghosttyShaders.js';
import {writtenNativePasses} from '../src/appearance/nativePasses.js';
import {chromaEnds} from '../src/appearance/glslStudio.js';
import {appearanceHubKey, createAppearanceHub, renderAppearanceHub} from '../src/appearance/AppearanceHub.js';
import {stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const open = {reducedMotion: false, effectsOff: false, color: true};
const ghostty: HostCursorFacts = {host: 'ghostty', hostName: 'Ghostty', caretColor: 'host-controlled', version: '1.3.1', integrated: false};
const base = (value: Partial<RoutingInput> = {}): RoutingInput => ({gate: open, look: 'rich', cursor: chooseBackend({...structuredClone(DEFAULT_CURSOR), motion: 'tail', effect: 'ripple'}, ghostty),
  cursorMotion: 'tail', cursorEffect: 'ripple', hostName: 'Ghostty', nativePasses: [], idleTimeout: 5, idleScreenMode: false,
  motionOff: {launch: false, context: false, events: false}, ...value});
const by = (routes: ReturnType<typeof renderRoutes>) => Object.fromEntries(routes.map(route => [route.surface, route.route]));

test('NMSh’s own rows are always Portable or off: no per-widget GPU targeting is claimed', () => {
  const passes = [{id: 'aurora', label: 'Aurora', category: 'ambient' as const}, {id: 'focus-dim', label: 'Dim when unfocused', category: 'focus' as const}];
  const routes = renderRoutes(base({nativePasses: passes}));
  for (const surface of ['promptTransitions', 'commandFeedback', 'notifications', 'idle', 'welcome']) assert.equal(by(routes)[surface], 'portable', surface);
  assert.match(routes.find(route => route.surface === 'promptTransitions')!.reason, /Rich look · .*whole window, not NMSh’s rows/u);
  assert.deepEqual([by(routes).hostFocus, by(routes).hostDisplay], ['native', 'native']);
  assert.match(routes.find(route => route.surface === 'hostDisplay')!.reason, /Ghostty shader: Aurora \(written; the host loads it on its next config reload\)/u);
  const none = renderRoutes(base());
  assert.deepEqual([by(none).hostFocus, by(none).hostDisplay], ['off', 'off']);
  assert.match(none.find(route => route.surface === 'hostFocus')!.reason, /no Portable equivalent[\s\S]*\/appearance › Ghostty shaders/u);
  const elsewhere = renderRoutes(base({hostName: undefined}));
  assert.match(elsewhere.find(route => route.surface === 'hostDisplay')!.reason, /no NMSh shader studio/u);
});

test('the cursor routes come from the one cursor backend choice; gates switch NMSh rows off', () => {
  const trail = renderRoutes(base({cursor: chooseBackend({...structuredClone(DEFAULT_CURSOR), renderer: 'auto', motion: 'tail', effect: 'ripple'}, {...ghostty, ghosttyTrail: 'comet'})}));
  assert.deepEqual([by(trail).cursorTrail, by(trail).cursorEffect], ['native', 'portable'], 'Ghostty draws the studio trail, Portable the effect: never two trails');
  const off = renderRoutes(base({cursorMotion: 'off', cursorEffect: 'none'}));
  assert.deepEqual([by(off).cursorTrail, by(off).cursorEffect], ['off', 'off']);
  assert.match(off.find(route => route.surface === 'cursorEffect')!.reason, /Effect is None/u);
  // Portable cursor motion obeys the same gate as NMSh's rows; a native trail is removed on the next sync.
  const gatedCursor = renderRoutes(base({gate: {...open, reducedMotion: true}}));
  assert.deepEqual([by(gatedCursor).cursorTrail, by(gatedCursor).cursorEffect], ['off', 'off']);
  const gatedNative = renderRoutes(base({gate: {...open, reducedMotion: true}, cursor: chooseBackend({...structuredClone(DEFAULT_CURSOR), renderer: 'auto', motion: 'tail', effect: 'ripple'}, {...ghostty, ghosttyTrail: 'comet'})}));
  assert.match(gatedNative.find(route => route.surface === 'cursorTrail')!.reason, /removes its host shader on the next sync/u);
  const motionOff = renderRoutes(base({motionOff: {launch: true, context: true, events: false}}));
  assert.deepEqual([by(motionOff).commandFeedback, by(motionOff).promptTransitions, by(motionOff).notifications], ['off', 'off', 'portable']);
  const screen = renderRoutes(base({gate: {...open, reducedMotion: true}, idleScreenMode: true}));
  assert.equal(by(screen).idle, 'off');
  assert.match(screen.find(route => route.surface === 'idle')!.reason, /Does not start by itself/u);
  const reduced = renderRoutes(base({gate: {...open, reducedMotion: true}}));
  assert.deepEqual([by(reduced).promptTransitions, by(reduced).notifications, by(reduced).idle], ['off', 'off', 'portable']);
  assert.match(reduced.find(route => route.surface === 'idle')!.reason, /Held still/u);
  const effectsOff = renderRoutes(base({gate: {...open, effectsOff: true}}));
  assert.equal(by(effectsOff).idle, 'off');
  assert.match(effectsOff.find(route => route.surface === 'welcome')!.reason, /^Still \(Effects Off\)/u);
  const mono = renderRoutes(base({gate: {...open, color: false}}));
  assert.match(mono.find(route => route.surface === 'commandFeedback')!.reason, /NO_COLOR/u);
  assert.equal(by(renderRoutes(base({idleTimeout: 0}))).idle, 'off');
});

test('Aurora follows Chroma by default (the idle visuals’ resolver) or uses its own colors', () => {
  const aurora = presetById('aurora')!;
  const chroma = {a: [0.25, 0.5, 0.75], b: [1, 0, 0.5]};
  const followed = generateGhosttyShader(aurora, {}, {cursorColors: {head: [1, 1, 1], tail: [0, 0, 0]}, chroma}).source;
  assert.match(followed, /vec3 auroraA\(\) \{ return vec3\(0\.25, 0\.5, 0\.75\); \}/u);
  assert.match(followed, /vec3 auroraB\(\) \{ return vec3\(1\.0, 0\.0, 0\.5\); \}/u);
  // Settings saved before the Colors choice keep their own colors.
  assert.match(generateGhosttyShader(aurora, {COLOR_A: [0.1, 0.2, 0.3]}, {cursorColors: {head: [1, 1, 1], tail: [0, 0, 0]}, chroma}).source, /auroraA\(\) \{ return COLOR_A; \}/u);
  const custom = generateGhosttyShader(aurora, {COLORS: 1}, {cursorColors: {head: [1, 1, 1], tail: [0, 0, 0]}, chroma}).source;
  assert.match(custom, /auroraA\(\) \{ return COLOR_A; \}/u);
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  config.presentation.preset = 'custom';
  config.presentation.customStops = ['#ff0000', '#00ff00', '#0000ff'];
  assert.deepEqual(chromaEnds(config), {a: [1, 0, 0], b: [0, 0, 1]});
});

test('a Chroma change rewrites only NMSh’s Aurora pass; written passes are reported to routing', t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-route-')));
  t.after(() => rmSync(home, {recursive: true, force: true}));
  const env = {HOME: home, XDG_CONFIG_HOME: join(home, '.config'), NMSH_CONFIG_HOME: join(home, '.config/nmsh'), TERM_PROGRAM: 'ghostty', TERM_PROGRAM_VERSION: '1.3.1'};
  mkdirSync(join(home, '.config/ghostty'), {recursive: true});
  writeFileSync(join(home, '.config/ghostty/config.ghostty'), 'font-size = 13\n');
  const gates = {reducedMotion: false, effectsOff: false, cursorRenderer: 'auto' as const, cursorMotion: 'tail'};
  const context = (a: number[]) => ({env, platform: 'linux' as const, catalog: buildGhosttyCatalog('1.3.1'), gates, launch: {}, colors: {cursorColors: {head: [1, 1, 1], tail: [0, 0, 0]}, chroma: {a, b: [0, 0, 1]}}});
  const settings = {effects: [{id: 'aurora', enabled: true, values: {}}, {id: 'focus-dim', enabled: true, values: {}}]};
  const planned = planGhosttyShaders(settings, context([1, 0, 0]));
  assert.ok(planned.ok && applyGhosttyShaderPlan(planned.plan).ok);
  const native = writtenNativePasses(env, 'linux');
  assert.equal(native.hostName, 'Ghostty');
  assert.deepEqual(native.passes.map(pass => [pass.id, pass.category]), [['aurora', 'ambient'], ['focus-dim', 'focus']]);
  const changed = syncGhosttyShaders(settings, context([0, 1, 0]));
  assert.equal(changed.kind, 'written');
  assert.equal(syncGhosttyShaders(settings, context([0, 1, 0])).kind, 'unchanged', 'same palette: nothing rewritten');
  assert.deepEqual(writtenNativePasses({...env, TERM_PROGRAM: 'Apple_Terminal'}, 'linux').passes, [], 'only the running host’s passes count');
});

test('/appearance › Effects routing is a read-only view; Esc returns to its row', () => {
  const hub = createAppearanceHub('Ghostty');
  hub.routes = renderRoutes(base({nativePasses: [{id: 'aurora', label: 'Aurora', category: 'ambient'}]}));
  const key = (kind: string): Key => ({kind, value: ''} as unknown as Key);
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const hubText = renderAppearanceHub(hub, config, 120, 'Theme', 'Portable').map(stripAnsi).join('\n');
  assert.match(hubText, /Effects routing\s+1 on host GPU · 7 Portable · 1 off/u);
  for (let i = 0; i < 20 && !renderAppearanceHub(hub, config, 120, 'Theme', 'Portable').map(stripAnsi).some(row => row.startsWith('›') && row.includes('Effects routing')); i++) appearanceHubKey(hub, key('down'), config);
  assert.equal(appearanceHubKey(hub, key('enter'), config), undefined);
  assert.equal(hub.view, 'routing');
  const text = renderAppearanceHub(hub, config, 120, 'Theme', 'Portable').map(stripAnsi).join('\n');
  assert.match(text, /Appearance › Effects routing[\s\S]*Cursor trail\s+Portable[\s\S]*Window display\s+Host GPU[\s\S]*Esc back/u);
  assert.ok(renderAppearanceHub(hub, config, 80, 'Theme', 'Portable', undefined, 8).length <= 8);
  appearanceHubKey(hub, key('escape'), config);
  assert.equal(hub.view, 'hub');
});
