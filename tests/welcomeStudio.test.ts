import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {normalizeWelcomeStudio, exportWelcomePreset, importWelcomePreset, DEFAULT_WELCOME_STUDIO} from '../src/welcome/model.js';
import {composeWelcome} from '../src/welcome/compose.js';
import {colorLevel} from '../src/presentation/capabilities.js';
import {displayWidth} from '../src/util/text.js';
import {createWelcomeSnapshot, renderWelcome} from '../src/output/Welcome.js';

test('Studio normalization rejects unknown fields and sensitive facts are opt in', () => {
  const m = normalizeWelcomeStudio({logo: 'evil', effect: 'exec', modules: ['os', 'command', 'hostname'], title: '\x1b]0;bad\x07ok', command: 'rm'});
  assert.equal(m.logo, 'mascot'); assert.equal(m.effect, 'original');
  assert.deepEqual(m.modules, ['os', 'hostname']); assert.equal(m.title, 'ok');
  assert.ok(!('command' in m));
  assert.ok(!DEFAULT_WELCOME_STUDIO.modules.includes('hostname'));
  assert.deepEqual(normalizePromptConfiguration({welcome: 'fastfetch', welcomeStudio: {effect: 'float'}}).welcomeStudio.effect, 'float');
  assert.equal(normalizePromptConfiguration({welcome: 'fastfetch'}).welcome, 'fastfetch');
});

test('preset JSON omits paths and never includes bytes; imports fail closed', () => {
  const model = normalizeWelcomeStudio({logo: 'image', assetPath: '/private/logo.png'});
  assert.ok(!exportWelcomePreset(model).includes('/private'));
  assert.ok(exportWelcomePreset(model, true).includes('/private/logo.png'));
  assert.equal(importWelcomePreset(exportWelcomePreset(model, true)).assetPath, '/private/logo.png');
  for (const value of ['{}', '{"version":1,"model":{"command":"echo"}}', '{"version":1,"model":{"effect":"evil"}}']) assert.throws(() => importWelcomePreset(value));
});

test('composition is deterministic, bounded, private by default and still under every gate', () => {
  const model = normalizeWelcomeStudio({customized: true, effect: 'float'});
  const facts = {os: 'TestOS', shell: 'fish', version: '1', hostname: 'SECRET'};
  for (const columns of [40, 80, 120]) {
    const args = [model, facts, {columns, rows: 20}, {color: true}] as const;
    assert.deepEqual(composeWelcome(...args, 100), composeWelcome(...args, 100));
    assert.ok(composeWelcome(...args, 100).rows.every(r => displayWidth(r.plain) <= columns));
    assert.ok(!JSON.stringify(composeWelcome(...args, 100)).includes('SECRET'));
    for (const gate of [{reducedMotion: true}, {effectsOff: true}, {color: false}]) {
      assert.deepEqual(composeWelcome(model, facts, {columns, rows: 20}, {color: true, ...gate}, 0), composeWelcome(model, facts, {columns, rows: 20}, {color: true, ...gate}, 900));
    }
  }
});

test('startup wrapper and preview use the same composition', () => {
  const model = normalizeWelcomeStudio({customized: true, title: 'Hello'});
  const facts = {shell: 'zsh', version: '1'};
  const snapshot = {...createWelcomeSnapshot({version: '1', commit: 'abc'}, '/private'), studio: model, facts};
  assert.deepEqual(renderWelcome(snapshot, 80), composeWelcome(model, facts, {columns: 80, rows: 40}, {color: colorLevel() !== 'none'}, 0).rows);
});

test('still image effects produce bounded image plans and every gate restores original image treatment', () => {
  const caps = {color: true, asset: {width: 100, height: 100}};
  for (const effect of ['pulse', 'glow', 'shimmer'] as const) {
    const m = normalizeWelcomeStudio({customized: true, logo: 'image', effect});
    const moving = composeWelcome(m, {}, {columns: 80, rows: 20}, caps, 500);
    assert.ok(moving.images.some(p => p.treatment !== undefined));
    const still = composeWelcome(m, {}, {columns: 80, rows: 20}, {...caps, reducedMotion: true}, 500);
    assert.ok(still.images.every(p => p.treatment === undefined));
  }
});

test('fresh normalized native welcome never displays a path without opting in', () => {
  const config = normalizePromptConfiguration({welcomeStudio: {customized: true}});
  const snapshot = {...createWelcomeSnapshot({version: '1', commit: 'abc'}, '/PRIVATE/WORK'), studio: config.welcomeStudio, facts: {shell: 'zsh', version: '1', path: '/PRIVATE/WORK'}};
  assert.doesNotMatch(renderWelcome(snapshot, 80).map(r => r.plain).join('\n'), /PRIVATE/);
});

test('composition does not consult ambient color or HOME preferences', () => {
  const model = normalizeWelcomeStudio({customized: false});
  const legacy = createWelcomeSnapshot({version: '1', commit: 'abc'}, '/opt/work');
  const caps = {color: true, home: '/opt', legacy};
  const expected = composeWelcome(model, {}, {columns: 80, rows: 20}, caps, 0);
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try { assert.deepEqual(composeWelcome(model, {}, {columns: 80, rows: 20}, caps, 0), expected); }
  finally { if (previous === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = previous; }
});

test('editor animation samples decoded frame delays; reduced motion holds frame zero', () => {
  const model = normalizeWelcomeStudio({logo: 'image'});
  const caps = {color: true, asset: {width: 1, height: 1, frameDelays: [100, 200], loopCount: 0}};
  assert.equal(composeWelcome(model, {}, {columns: 80, rows: 20}, caps, 150).frameIndex, 1);
  assert.equal(composeWelcome(model, {}, {columns: 80, rows: 20}, caps, 350).frameIndex, 0);
  assert.equal(composeWelcome(model, {}, {columns: 80, rows: 20}, {...caps, reducedMotion: true}, 150).frameIndex, 0);
});
