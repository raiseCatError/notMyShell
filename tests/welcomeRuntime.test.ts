import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, chmod, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WelcomeStudioController, type StudioHost} from '../src/welcome/studio.js';
import {GraphicsService} from '../src/graphics/service.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {exportWelcomePreset, normalizeWelcomeStudio} from '../src/welcome/model.js';
import {encodePng} from '../src/graphics/pngEncode.js';
import {clearProviderDetection} from '../src/providers/providers.js';
import {presentationClock} from '../src/motion/PresentationClock.js';
import {NativeWelcomePresentation} from '../src/welcome/startup.js';
import {composeWelcome} from '../src/welcome/compose.js';
import {paintWelcome} from '../src/welcome/render.js';
import {loadWelcomeAsset} from '../src/welcome/assets.js';
import {displayWidth} from '../src/util/text.js';

function host(directory: string, studio = {}): StudioHost {
  const config = normalizePromptConfiguration({welcomeStudio: studio});
  const decision = {backend: 'unicode', evidence: 'none', inline: 'unicode', unicode: 'half', cell: {width: 8, height: 16, source: 'estimated'}, reason: 'Character art: test terminal has no verified graphics.'} as const;
  const service = new GraphicsService({decision: () => decision, send: () => {}, scratchDir: () => directory, color: () => 'truecolor', safeGlyphs: () => false});
  return {config: () => config, cwd: () => directory, scratch: () => directory, graphics: () => service, decision: () => decision,
    facts: () => ({shell: 'zsh', version: '1'}), capabilities: () => ({color: true}), background: () => ({red: 0, green: 0, blue: 0}),
    render: () => {}, save: () => true, close: () => {}};
}
const enter = {kind: 'enter'} as const;
const escape = {kind: 'escape'} as const;

test('late import respects Esc; before/after retains the original asset; disposing unsubscribes preview', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-runtime-'));
  const h = host(dir, {customized: true, logo: 'image', assetPath: 'red.png', effect: 'float'});
  const controller = new WelcomeStudioController(h);
  const count = presentationClock.subscriberCount;
  try {
    for (const [name, pixel] of [['red', [255, 0, 0, 255]], ['blue', [0, 0, 255, 255]]] as const) await writeFile(join(dir, `${name}.png`), encodePng({width: 1, height: 1, data: new Uint8ClampedArray(pixel)}));
    await writeFile(join(dir, 'preset.json'), exportWelcomePreset(normalizeWelcomeStudio({customized: true, logo: 'image', assetPath: 'blue.png'}), true));
    await controller.start();
    controller.state.selected = 28; await controller.key(enter); await controller.key({kind: 'text', value: 'preset.json'});
    const pending = controller.key(enter); await controller.key(escape); await pending;
    assert.equal(controller.state.draft.assetPath, 'red.png', 'cancelled import cannot replace draft');
    await controller.key(enter); await controller.key({kind: 'text', value: 'preset.json'}); await controller.key(enter);
    assert.equal(controller.state.draft.assetPath, 'blue.png');
    const after = controller.render(80, 24).join('\n');
    await controller.key({kind: 'text', value: 'b'});
    const before = controller.render(80, 24).join('\n');
    assert.match(after, /38;2;0;0;255/); assert.match(before, /38;2;255;0;0/);
    assert.match(before, /Character art/);
  } finally { controller.dispose(); assert.equal(presentationClock.subscriberCount, count); await rm(dir, {recursive: true, force: true}); }
});

test('in-flight external preview capture is reused, and disposal cancels outstanding work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-capture-'));
  const old = process.env.PATH;
  const h = host(dir); h.config().welcome = 'fastfetch';
  const controller = new WelcomeStudioController(h);
  try {
    const binary = join(dir, 'fastfetch');
    await writeFile(binary, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo fastfetch; exit 0; fi\nprintf x >> "$PWD/count"\nsleep 0.2\necho one-capture\n'); await chmod(binary, 0o700);
    process.env.PATH = `${dir}:/usr/bin:/bin`; clearProviderDetection();
    const starts = Promise.all([controller.start(), controller.start()]);
    await controller.key({kind: 'text', value: 'p'});
    await starts;
    assert.match(controller.renderPreview(80, 24).join(''), /one-capture/);
    await controller.key(escape);
    assert.equal(await readFile(join(dir, 'count'), 'utf8'), 'x');
    assert.deepEqual(controller.state.captured, ['one-capture']);
    for (let i = 0; i < 2; i++) { await controller.key({kind: 'text', value: 'p'}); controller.renderPreview(80, 24); await controller.key(escape); }
    assert.equal(await readFile(join(dir, 'count'), 'utf8'), 'x', 'P reuses the one provider capture');
  } finally { controller.dispose(); process.env.PATH = old; clearProviderDetection(); await rm(dir, {recursive: true, force: true}); }
});

test('startup and editor image frame zero share composition and paint; particles survive; all widths fit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-paint-'));
  const h = host(dir);
  try {
    await writeFile(join(dir, 'a.png'), encodePng({width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255)}));
    const asset = await loadWelcomeAsset('a.png', dir, dir);
    for (const layout of ['left', 'right', 'top'] as const) for (const columns of [40, 80, 120]) {
      const model = normalizeWelcomeStudio({customized: true, logo: 'image', assetPath: 'a.png', effect: 'particles', layout});
      const frame = composeWelcome(model, h.facts(model), {columns, rows: 20}, {color: true, asset: {width: 2, height: 2}}, 500);
      const painted = paintWelcome(frame, asset, h.graphics(), {}, 'inline', h.background());
      assert.ok(painted.rows.some(row => row.includes('·')), 'particle is outside reserved image cells');
      assert.ok(painted.rows.every(row => displayWidth(row) <= columns));
    }
    const model = normalizeWelcomeStudio({customized: true, logo: 'image', assetPath: 'a.png'});
    const snapshot = {identity: {version: '1', commit: 'abc'}, cwd: dir, shell: 'zsh' as const, studio: model, facts: h.facts(model)};
    const startup = new NativeWelcomePresentation(snapshot, h.graphics(), h.capabilities, h.background);
    await startup.load(dir, dir);
    const frame = composeWelcome(model, snapshot.facts, {columns: 80, rows: 40}, {color: true, asset: {width: 2, height: 2}}, 0);
    assert.deepEqual(startup.rows(snapshot, 80).map(r => r.ansi), paintWelcome(frame, asset, h.graphics(), {}, 'inline', h.background()).rows);
    startup.dispose();
  } finally { await rm(dir, {recursive: true, force: true}); }
});

import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';

test('/welcome opens canonical Studio; native overlay keys include final geometry; shutdown releases timers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'welcome-app-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  const count = presentationClock.subscriberCount;
  try {
    assert.deepEqual(parseSlashCommand('/welcome'), {kind: 'providers', family: 'welcome'});
    app['startProviderPanel']('welcome');
    const studio = app['welcomeStudio']; assert.ok(studio); assert.equal(app['providerPanelState'], undefined);
    studio.overlay = {x: 3, y: 2, placement: {key: 'same-image', size: {columns: 4, rows: 2}, transmit: '', place: '', cleanup: ''}};
    const plan = {panelActive: true, panelPosition: 'bottom'} as any;
    const first = app['imageOverlay'](plan, {top: 1, height: 20});
    const second = app['imageOverlay'](plan, {top: 3, height: 20});
    assert.notEqual(first?.key, second?.key);
    await studio.key(escape);
    assert.equal(app['welcomeStudio'], undefined);
    assert.equal(presentationClock.subscriberCount, count);
  } finally { app['stop'](0); app['session'].kill(); if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; await rm(directory, {recursive: true, force: true}); }
});

test('startup still effects use the shared clock and stop on cancellation', () => {
  const h = host('.');
  const model = normalizeWelcomeStudio({customized: true, effect: 'float'});
  const snapshot = {identity: {version: '1', commit: 'abc'}, cwd: '.', shell: 'zsh' as const, studio: model};
  const native = new NativeWelcomePresentation(snapshot, h.graphics(), h.capabilities, h.background);
  const count = presentationClock.subscriberCount;
  native.rows(snapshot, 80);
  assert.equal(presentationClock.subscriberCount, count + 1);
  native.cancelMotion();
  assert.equal(presentationClock.subscriberCount, count);
  native.rows(snapshot, 80);
  assert.equal(presentationClock.subscriberCount, count);
  native.dispose();
});

test('still-image treatments and alpha compositing preserve original pixels and cell geometry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-treat-'));
  const h = host(dir);
  try {
    await writeFile(join(dir, 'a.png'), encodePng({width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(120)}));
    const asset = await loadWelcomeAsset('a.png', dir, dir);
    assert.equal(asset.kind, 'image');
    if (asset.kind !== 'image') return;
    const original = asset.image.raster.data.slice();
    for (const effect of ['pulse', 'glow', 'shimmer', 'parallax', 'reveal', 'panZoom'] as const) {
      const model = normalizeWelcomeStudio({customized: true, logo: 'image', effect, alpha: 'white'});
      const frame = composeWelcome(model, {}, {columns: 80, rows: 20}, {color: true, asset: {width: 16, height: 16}}, 500);
      const painted = paintWelcome(frame, asset, h.graphics(), {}, 'inline', h.background());
      assert.ok(painted.rows.every(row => displayWidth(row) <= 80));
      assert.deepEqual(asset.image.raster.data, original, effect);
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

import {TranscriptStore} from '../src/sessions/TranscriptStore.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';

test('all external provider snapshots remain readable after archive, including Macchina and Zigfetch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'welcome-archive-'));
  try {
    const store = new TranscriptStore(directory);
    for (const provider of ['fastfetch', 'neofetch', 'macchina', 'zigfetch'] as const) {
      const output = new OutputBuffer();
      output.setWelcome({identity: {version: '1', commit: 'abc'}, cwd: directory, shell: 'zsh', provider, captured: [provider]});
      await store.archive({startCwd: directory, finalCwd: directory, transcript: output.transcript()});
    }
    assert.deepEqual((await store.list()).map(s => s.transcript.welcome?.provider).sort(), ['fastfetch', 'macchina', 'neofetch', 'zigfetch']);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

import {renderWelcome} from '../src/output/Welcome.js';
import {renderLegacyWelcome} from '../src/welcome/legacy.js';
import {savePromptConfiguration, loadPromptConfiguration} from '../src/prompt/configuration.js';

test('old configuration preserves byte-identical historical rows; Studio save persists native layout and presets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-save-'));
  try {
    const config = normalizePromptConfiguration({welcome: 'vespyr'});
    assert.equal(config.welcomeStudio.customized, false);
    const snapshot = {identity: {version: '1', commit: 'abc'}, cwd: '/work', shell: 'zsh' as const, studio: config.welcomeStudio};
    assert.deepEqual(renderWelcome(snapshot, 80), renderLegacyWelcome(snapshot, 80));
    const h = host(dir); const controller = new WelcomeStudioController(h);
    h.save = config => { savePromptConfiguration(config, join(dir, 'config.json')); return true; };
    controller.state.presets.push({name: 'Saved', model: normalizeWelcomeStudio({title: 'My layout'})});
    await controller.key({kind: 'text', value: 's'});
    const saved = loadPromptConfiguration(join(dir, 'config.json'));
    assert.equal(saved.welcomeStudio.customized, true);
    assert.equal(saved.welcomePresets[0]?.name, 'Saved');
    assert.notDeepEqual(renderWelcome({...snapshot, studio: saved.welcomeStudio}, 80), renderLegacyWelcome(snapshot, 80));
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('focus and pointer movement preserve motion; handover retains image card and clears panel origin; snapshots omit asset paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-review-'));
  const previous = process.env.XDG_CONFIG_HOME; process.env.XDG_CONFIG_HOME = dir;
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  try {
    await writeFile(join(dir, 'private.png'), encodePng({width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255])}));
    app['promptConfiguration'].welcomeStudio = normalizeWelcomeStudio({logo: 'image', assetPath: join(dir, 'private.png'), effect: 'float'});
    app['startWelcome'](dir);
    const native = app['nativeWelcome']!; await native.load(dir, dir);
    const count = presentationClock.subscriberCount;
    app['output'].wrapped(80);
    for (const kind of ['focusIn', 'focusOut', 'mouseMove'] as const) app['handleKey']({kind} as any);
    assert.equal(presentationClock.subscriberCount, count + 1);
    app['handleKey']({kind: 'escape'});
    assert.equal(presentationClock.subscriberCount, count);
    app['openWelcomeStudio'](); app['panelOrigin'] = 'settings';
    app['handOverTerminal']();
    assert.equal(app['panelOrigin'], undefined);
    assert.equal(app['nativeWelcome'], native);
    assert.doesNotMatch(app['output'].wrapped(80).map(r => r.plain).join(''), /\(image\)/);
    const stored = JSON.stringify(app['output'].transcript());
    assert.ok(!stored.includes('private.png')); assert.ok(!stored.includes(dir + '/private'));
  } finally { app['stop'](0); app['session'].kill(); if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; await rm(dir, {recursive: true, force: true}); }
});
