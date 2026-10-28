import test from 'node:test';
import assert from 'node:assert/strict';
import {ANIMATION_LIMITS} from '../src/graphics/animation.js';
import {generateLogoAnimation, logoWorkingSize, LOGO_ANIMATIONS, LOGO_PLAYS, LOGO_ANIMATION_LIMITS, type LogoAnimation} from '../src/graphics/logoAnimation.js';
import type {Raster} from '../src/graphics/raster.js';
import {scaleBox} from '../src/graphics/scale.js';
import {GraphicsService} from '../src/graphics/service.js';
import type {GraphicsDecision} from '../src/graphics/capabilities.js';
import {composeWelcome} from '../src/welcome/compose.js';
import {createWelcomeEditor, renderWelcomeEditor, welcomeEditorKey} from '../src/welcome/editor.js';
import {exportWelcomePreset, importWelcomePreset, normalizeWelcomeStudio, type WelcomeStudio} from '../src/welcome/model.js';
import {assetCapabilities, motionAsset} from '../src/welcome/render.js';
import {NativeWelcomePresentation} from '../src/welcome/startup.js';
import type {WelcomeAsset} from '../src/welcome/assets.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {presentationClock} from '../src/motion/PresentationClock.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const PRESETS = LOGO_ANIMATIONS.filter((p): p is Exclude<LogoAnimation, 'off'> => p !== 'off');

/** A transparent canvas with a colorful opaque square in the middle. */
function logo(size = 120, square = 40): Raster {
  const data = new Uint8ClampedArray(size * size * 4);
  const from = (size - square) / 2;
  for (let y = from; y < from + square; y++) for (let x = from; x < from + square; x++) {
    const o = (y * size + x) * 4;
    data[o] = 40 + x; data[o + 1] = 200 - y; data[o + 2] = 180; data[o + 3] = 255;
  }
  return {width: size, height: size, data};
}
function asset(raster: Raster, frames = 1): WelcomeAsset {
  const image = {key: 'welcome:test', name: 'Welcome image', path: '/logo.png', info: {format: 'png' as const, width: raster.width, height: raster.height, animated: frames > 1, alpha: true, bytes: 10}, raster, fileBytes: 10};
  const animation = frames > 1 ? {width: raster.width, height: raster.height, frames: Array.from({length: frames}, () => ({raster, delayMs: 100})), loopCount: 0, truncated: false} : undefined;
  return {kind: 'image', image, ...(animation ? {animation} : {}), metadata: {format: 'png', bytes: 10, frames, width: raster.width, height: raster.height}};
}
const model = (patch: Partial<WelcomeStudio> = {}) => normalizeWelcomeStudio({customized: true, logo: 'image', assetPath: '/logo.png', ...patch});
const snapshot = (studio: WelcomeStudio) => ({identity: {version: '1', commit: 'abc'}, cwd: '.', shell: 'zsh' as const, studio, facts: {shell: 'zsh', version: '1'}});
function service(sent: string[] = [], kitty = false): GraphicsService {
  const decision: GraphicsDecision = {backend: kitty ? 'kitty' : 'unicode', evidence: kitty ? 'query' : 'none', inline: kitty ? 'placeholder' : 'unicode', unicode: 'half', cell: {width: 8, height: 16, source: 'estimated'}, reason: 'Character art.'};
  return new GraphicsService({decision: () => decision, send: data => { sent.push(data); }, scratchDir: () => '.', color: () => 'truecolor', safeGlyphs: () => false});
}

test('generated logo animations are deterministic and fit every animation budget', () => {
  const big: Raster = {width: 1400, height: 1000, data: new Uint8ClampedArray(1400 * 1000 * 4).fill(200)};
  for (const preset of PRESETS) for (const play of LOGO_PLAYS) {
    const a = generateLogoAnimation(logo(), preset, play), b = generateLogoAnimation(logo(), preset, play);
    assert.equal(a.frames.length, b.frames.length);
    a.frames.forEach((frame, i) => { assert.deepEqual(frame.raster.data, b.frames[i]!.raster.data, `${preset}/${play} frame ${i}`); assert.equal(frame.delayMs, b.frames[i]!.delayMs); });
    assert.ok(a.frames.some(frame => !frame.raster.data.every((v, i) => v === a.frames.at(-1)!.raster.data[i])), `${preset} moves`);
    const large = generateLogoAnimation(big, preset, play);
    for (const result of [a, large]) {
      assert.ok(result.frames.length <= ANIMATION_LIMITS.maxFrames);
      assert.ok(result.frames.reduce((sum, f) => sum + f.delayMs, 0) <= ANIMATION_LIMITS.maxTotalMs, `${preset}/${play} time`);
      assert.ok(result.frames.reduce((sum, f) => sum + f.raster.data.length, 0) <= ANIMATION_LIMITS.maxDecodedBytes);
      assert.ok(result.width * result.height <= LOGO_ANIMATION_LIMITS.pixels && Math.max(result.width, result.height) <= LOGO_ANIMATION_LIMITS.longSide);
      assert.equal(result.loopCount, play === 'once' ? 1 : 0);
      assert.equal(result.loopFrom, play === 'once' ? result.frames.length : result.loopFrom);
    }
    if (play === 'loop') assert.ok(a.loopFrom > 0 && a.loopFrom < a.frames.length && a.playMs === LOGO_ANIMATION_LIMITS.loopPlayMs);
  }
});

test('the last frame is the still image; a reduced still is the shared box-filtered picture', () => {
  const small = logo();
  for (const preset of PRESETS) for (const play of LOGO_PLAYS) assert.deepEqual(generateLogoAnimation(small, preset, play).frames.at(-1)!.raster.data, small.data);
  const big = logo(800, 300);
  const size = logoWorkingSize(800, 800, 60);
  const reduced = scaleBox(big, size.width, size.height);
  for (const preset of PRESETS) assert.deepEqual(generateLogoAnimation(big, preset, 'once').frames.at(-1)!.raster.data, reduced.data);
});

test('transparent pixels stay transparent outside each effect area', () => {
  const size = 120, raster = logo(size, 40);
  const lo = 40, hi = 79; // the square, inclusive
  const distance = (x: number, y: number) => Math.hypot(Math.max(0, lo - x, x - hi), Math.max(0, lo - y, y - hi));
  const outside: Record<string, (x: number, y: number) => boolean> = {
    shine: (x, y) => distance(x, y) > 28, // the rim light and the closing glint
    glow: (x, y) => distance(x, y) > 20,
    glitch: (x, y) => y < lo || y > hi || Math.abs(x - (lo + hi) / 2) > 40,
    embers: (x, y) => y > hi + 6 || distance(x, y) > 70,
  };
  for (const [preset, far] of Object.entries(outside)) for (const play of LOGO_PLAYS) {
    for (const frame of generateLogoAnimation(raster, preset as Exclude<LogoAnimation, 'off'>, play).frames) {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (far(x, y)) assert.equal(frame.raster.data[(y * size + x) * 4 + 3], 0, `${preset} ${x},${y}`);
    }
  }
  // Assemble's sparks fly across the picture, but it settles exactly on the still.
  const settled = generateLogoAnimation(raster, 'assemble', 'once').frames.at(-1)!.raster;
  assert.deepEqual(settled.data, raster.data);
});

test('Off, text logos, GIFs and every motion gate keep the admitted asset itself', () => {
  const still = asset(logo());
  const on = {color: true};
  assert.equal(motionAsset(still, model(), on), still);
  assert.equal(motionAsset(still, model({logoAnimation: 'shine', logo: 'art'}), on), still);
  const gif = asset(logo(), 3);
  assert.equal(motionAsset(gif, model({logoAnimation: 'shine'}), on), gif);
  for (const gate of [{color: false}, {color: true, reducedMotion: true}, {color: true, effectsOff: true}, {color: true, hidden: true}]) {
    assert.equal(motionAsset(still, model({logoAnimation: 'glitch'}), gate), still);
  }
  const moving = motionAsset(still, model({logoAnimation: 'glitch'}), on)!;
  assert.notEqual(moving, still);
  assert.ok(moving.kind === 'image' && moving.animation && moving.animation.frames.length > 1 && moving.image.key !== still.image.key);
  // The original asset is never changed.
  assert.equal(still.kind === 'image' && still.animation, undefined);
});

test('Off renders byte-identically to a card saved before logo animation existed', () => {
  const saved = normalizeWelcomeStudio({customized: true, logo: 'image', assetPath: '/logo.png'});
  const legacy: Record<string, unknown> = {...saved};
  delete legacy.logoAnimation; delete legacy.logoPlay;
  for (const kitty of [false, true]) {
    const sentA: string[] = [], sentB: string[] = [];
    const a = new NativeWelcomePresentation(snapshot(saved), service(sentA, kitty), () => ({color: true}), () => ({red: 0, green: 0, blue: 0}), () => {}, asset(logo()));
    const b = new NativeWelcomePresentation(snapshot(normalizeWelcomeStudio(legacy)), service(sentB, kitty), () => ({color: true}), () => ({red: 0, green: 0, blue: 0}), () => {}, asset(logo()));
    for (const time of [0, 400, 1200, 5000]) assert.deepEqual(a.frame(80, 40, time).rows, b.frame(80, 40, time).rows);
    assert.deepEqual(sentA, sentB);
    a.dispose(); b.dispose();
  }
});

test('startup plays the generated frames, settles on the still, and a gate shows the still', () => {
  const sent: string[] = [];
  const still = asset(logo());
  const off = new NativeWelcomePresentation(snapshot(model()), service(), () => ({color: true}), () => ({red: 0, green: 0, blue: 0}), () => {}, still);
  const stillRows = off.frame(80, 40, 0).rows;
  for (const preset of PRESETS) {
    const native = new NativeWelcomePresentation(snapshot(model({logoAnimation: preset})), service(sent, true), () => ({color: true}), () => ({red: 0, green: 0, blue: 0}), () => {}, still);
    const first = native.frame(80, 40, 0);
    assert.equal(first.active, true);
    const done = native.frame(80, 40, 4000);
    assert.equal(done.active, false, `${preset} once ends`);
    assert.equal(presentationClock.subscriberCount, 0, `${preset}: no frame timer after Once ends`);
    native.dispose();
    const gated = new NativeWelcomePresentation(snapshot(model({logoAnimation: preset})), service(), () => ({color: true, reducedMotion: true}), () => ({red: 0, green: 0, blue: 0}), () => {}, still);
    const frame = gated.frame(80, 40, 0);
    assert.equal(frame.active, false);
    assert.deepEqual(frame.rows, stillRows, `${preset} reduced motion is the still`);
    gated.dispose();
  }
  const cells = new NativeWelcomePresentation(snapshot(model({logoAnimation: 'assemble'})), service(), () => ({color: true}), () => ({red: 0, green: 0, blue: 0}), () => {}, still);
  assert.notDeepEqual(cells.frame(80, 40, 300).rows, stillRows, 'character art animates too');
  assert.deepEqual(cells.frame(80, 40, 5000).rows, stillRows, 'and settles on the still');
  cells.cancelMotion();
  assert.deepEqual(cells.frame(80, 40, 600).rows, stillRows, 'a cancelled animation shows the still');
  cells.dispose();
  assert.ok(sent.some(data => data.includes('\x1b_G')), 'Kitty frames go through the graphics service');
});

test('a gentle loop repeats past the intro, keeps sampling within budget and settles when its time is up', () => {
  const still = asset(logo());
  const moving = motionAsset(still, model({logoAnimation: 'shine', logoPlay: 'loop'}), {color: true})!;
  const caps = {color: true, asset: assetCapabilities(moving)};
  assert.ok(caps.asset?.loopFrom && caps.asset.playMs === LOGO_ANIMATION_LIMITS.loopPlayMs);
  const m = model({logoAnimation: 'shine', logoPlay: 'loop'});
  const frames = caps.asset!.frameDelays!;
  const intro = frames.slice(0, caps.asset!.loopFrom).reduce((a, b) => a + b, 0), cycle = frames.slice(caps.asset!.loopFrom).reduce((a, b) => a + b, 0);
  const at = (time: number) => composeWelcome(m, {}, {columns: 80, rows: 40}, caps, time);
  assert.equal(at(intro + 1).frameIndex, caps.asset!.loopFrom);
  assert.equal(at(intro + cycle + 1).frameIndex, caps.asset!.loopFrom, 'the loop wraps to its own start, not the intro');
  assert.equal(at(12_000).active, true);
  const end = at(LOGO_ANIMATION_LIMITS.loopPlayMs);
  assert.equal(end.active, false);
  assert.equal(end.frameIndex, frames.length - 1);
  for (const time of [0, 500, intro + 10, 9_000]) {
    const frame = at(time);
    assert.ok(frame.nextFrameMs! >= 1 && frame.nextFrameMs! <= 5000);
  }
});

test('settings persist, normalize and round-trip through presets', () => {
  const config = normalizePromptConfiguration({welcomeStudio: {customized: true, logo: 'image', logoAnimation: 'embers', logoPlay: 'loop'}});
  assert.equal(config.welcomeStudio.logoAnimation, 'embers');
  assert.equal(config.welcomeStudio.logoPlay, 'loop');
  assert.equal(normalizePromptConfiguration({}).welcomeStudio.logoAnimation, 'off');
  assert.equal(normalizeWelcomeStudio({logoAnimation: 'evil', logoPlay: 2}).logoAnimation, 'off');
  assert.equal(normalizeWelcomeStudio({logoAnimation: 'evil', logoPlay: 2}).logoPlay, 'once');
  const imported = importWelcomePreset(exportWelcomePreset(config.welcomeStudio));
  assert.equal(imported.logoAnimation, 'embers');
  assert.throws(() => importWelcomePreset('{"version":1,"model":{"logoAnimation":"gif"}}'));
});

test('Welcome Studio shows Logo animation and Play in the Animation section at 120x40 and 60x20', () => {
  for (const [columns, height] of [[120, 40], [60, 20]] as const) {
    const state = createWelcomeEditor(normalizePromptConfiguration({welcomeStudio: {customized: true, logo: 'image'}}));
    // Tab to the Animation section: its first row is Logo animation.
    for (let i = 0; i < 5; i++) welcomeEditorKey(state, {kind: 'complete'} as never);
    assert.equal(state.selected, 31);
    let rows = renderWelcomeEditor(state, columns, height, {}, {color: false}, 0).map(stripAnsi);
    assert.ok(rows.length <= height && rows.every(row => displayWidth(row) <= columns));
    assert.ok(rows.some(row => row.startsWith('›') && row.includes('Logo animation') && row.includes('Off')), rows.join('\n'));
    welcomeEditorKey(state, {kind: 'right'});
    assert.equal(state.draft.logoAnimation, 'assemble');
    rows = renderWelcomeEditor(state, columns, height, {}, {color: false}, 0).map(stripAnsi);
    assert.ok(rows.some(row => row.startsWith('›') && row.includes('Assemble')));
    welcomeEditorKey(state, {kind: 'down'});
    assert.equal(state.selected, 32);
    welcomeEditorKey(state, {kind: 'right'});
    assert.equal(state.draft.logoPlay, 'loop');
    rows = renderWelcomeEditor(state, columns, height, {}, {color: false}, 0).map(stripAnsi);
    assert.ok(rows.some(row => row.startsWith('›') && row.includes('Play') && row.includes('Gentle loop')), rows.join('\n'));
    assert.match(rows.at(-1)!, /Esc/);
    if (height >= 40) assert.match(rows.join('\n'), /Gentle loop repeats softly/);
  }
});
