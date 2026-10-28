import test from 'node:test';
import assert from 'node:assert/strict';
import {PREVIEW_MS, PREVIEW_ROWS, previewKind, previewValues, renderShaderPreview, type PreviewInput} from '../src/appearance/shaderPreview.js';
import {KITTY_PRESETS} from '../src/appearance/kittyShaderCatalog.js';
import {buildGhosttyCatalog} from '../src/appearance/ghosttyShaderCatalog.js';
import {createGhosttyShaderPanel, ghosttyShaderKey, renderGhosttyShaderPanel} from '../src/appearance/GhosttyShaderPanel.js';
import {studioPreviewContext} from '../src/appearance/ShaderStudioPanel.js';
import {DEFAULT_HOST_SHADERS} from '../src/appearance/kittyShaderSettings.js';
import {stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const colors = {background: {red: 20, green: 20, blue: 20}, foreground: {red: 230, green: 230, blue: 230}, accent: {red: 200, green: 180, blue: 240}, cursor: {red: 255, green: 200, blue: 0}};
const input = (value: Partial<PreviewInput> = {}): PreviewInput => ({kind: 'trail', values: {}, width: 40, elapsed: 200, still: false, colors, ...value});
const key = (kind: string, value = ''): Key => ({kind, value} as unknown as Key);

test('every preset family maps to a preview or honestly to none', () => {
  assert.equal(previewKind('smear', 'cursor'), 'trail');
  assert.equal(previewKind('cursor-trail-default', 'cursor'), 'trail');
  assert.equal(previewKind('cursor-trail-blaze', 'cursor'), 'blaze');
  assert.equal(previewKind('cursor-trail-lightning', 'cursor'), 'lightning');
  assert.equal(previewKind('cursor-trail-motion-blur', 'cursor'), 'motion-blur');
  assert.equal(previewKind('comet', 'cursor'), 'comet');
  assert.equal(previewKind('northern-lights', 'ambient'), 'aurora');
  assert.equal(previewKind('focus-dim', 'focus'), 'dim');
  assert.equal(previewKind('crt', 'display'), 'scanlines');
  assert.equal(previewKind('fireworks', 'ambient'), undefined);
});

test('previews are deterministic, bounded, play once and settle; Reduced Motion is one still frame', () => {
  for (const kind of ['trail', 'comet', 'blaze', 'lightning', 'motion-blur', 'aurora', 'dim', 'vignette', 'scanlines', 'glow'] as const) {
    const frame = renderShaderPreview(input({kind}));
    assert.equal(frame.rows.length, PREVIEW_ROWS, kind);
    assert.deepEqual(frame, renderShaderPreview(input({kind})), `${kind} is deterministic`);
    assert.ok(frame.rows.every(row => stripAnsi(row).length === 40), kind);
    assert.equal(frame.busy, PREVIEW_MS[kind] > 0, `${kind} busy only while it animates`);
    assert.equal(renderShaderPreview(input({kind, elapsed: PREVIEW_MS[kind] + 1})).busy, false, `${kind} settles`);
    const still = renderShaderPreview(input({kind, still: true, elapsed: 50}));
    assert.equal(still.busy, false);
    assert.deepEqual(still.rows, renderShaderPreview(input({kind, still: true, elapsed: 5000})).rows, `${kind} still frame does not move`);
  }
  assert.equal(stripAnsi(renderShaderPreview(input({width: 500})).rows[0]!).length, 64, 'width is capped');
});

test('parameters change the preview; Aurora tints only the background, never text colors', () => {
  const base = renderShaderPreview(input({kind: 'vignette', values: {INTENSITY: 0.2}})).rows;
  assert.notDeepEqual(base, renderShaderPreview(input({kind: 'vignette', values: {INTENSITY: 0.9}})).rows);
  assert.notDeepEqual(renderShaderPreview(input({values: {HEAD: [1, 0, 0]}})).rows, renderShaderPreview(input({values: {HEAD: [0, 0, 1]}})).rows);
  const aurora = renderShaderPreview(input({kind: 'aurora', values: {INTENSITY: 0.8, COLOR_A: [1, 0, 0], COLOR_B: [1, 0, 0]}, elapsed: 1000})).rows[0]!;
  // The first sample cell is text ("❯"): its foreground and background are the untouched theme colors.
  assert.ok(aurora.startsWith('\u001b[38;2;200;180;240m\u001b[48;2;20;20;20m❯'), aurora.slice(0, 40));
});

test('the studio shows the selected preset’s preview, replays on P, and drops it rather than cutting controls', () => {
  const state = createGhosttyShaderPanel(structuredClone(DEFAULT_HOST_SHADERS.ghostty), {reducedMotion: false, effectsOff: false, cursorRenderer: 'auto', cursorMotion: 'tail'});
  state.catalog = buildGhosttyCatalog('1.3.1');
  const context = studioPreviewContext(10_000, false, true);
  const text = renderGhosttyShaderPanel(state, 120, undefined, context).map(stripAnsi).join('\n');
  assert.match(text, /Preview · Smear trail · approximate, drawn by NMSh; Ghostty’s GPU shader is the real effect/u);
  assert.match(text, /P replay/u);
  assert.equal(state.previewStart, 10_000);
  assert.equal(state.previewBusy, true);
  renderGhosttyShaderPanel(state, 120, undefined, {...context, now: 20_000});
  assert.equal(state.previewBusy, false, 'settled');
  ghosttyShaderKey(state, key('text', 'p'));
  renderGhosttyShaderPanel(state, 120, undefined, {...context, now: 30_000});
  assert.equal(state.previewStart, 30_000, 'P replays');
  const still = renderGhosttyShaderPanel(state, 120, undefined, {...context, still: true}).map(stripAnsi).join('\n');
  assert.match(still, /Still frame \(Reduced Motion or Effects Off\)/u);
  assert.doesNotMatch(still, /P replay/u);
  assert.match(renderGhosttyShaderPanel(state, 120, undefined, {...context, color: false}).map(stripAnsi).join('\n'), /Preview needs color/u);
  const short = renderGhosttyShaderPanel(state, 80, 14, context).map(stripAnsi);
  assert.ok(short.length <= 14 && short.at(-1)!.includes('Esc'));
  assert.ok(!short.some(row => row.includes('Preview ·')), 'no room: the preview is dropped');
  assert.equal(state.previewBusy, false, 'a hidden preview keeps no frame clock');
});

test('review fixes: color level, fewer escapes, Kitty sliders move the preview, hostile values, CRT exclusivity', () => {
  const ansi256 = renderShaderPreview(input({kind: 'aurora', level: 'ansi256'})).rows.join('');
  assert.doesNotMatch(ansi256, /\[38;2;|\[48;2;/u, 'no 24-bit escapes on a 256-color terminal');
  assert.match(ansi256, /\[38;5;\d+m/u);
  const row = renderShaderPreview(input({kind: 'scanlines', level: 'truecolor'})).rows[1]!;
  assert.ok((row.match(/\u001b\[48;2;/gu) ?? []).length < 3, 'escapes only where colors change');
  assert.notDeepEqual(renderShaderPreview(input({kind: 'vignette', values: previewValues('spotlight', {SPOTLIGHT_RADIUS: 0.05})})).rows,
    renderShaderPreview(input({kind: 'vignette', values: previewValues('spotlight', {SPOTLIGHT_RADIUS: 0.6})})).rows);
  assert.equal(previewValues('dim-inactive-windows', {INACTIVE_DIM: 0.8}).DIM, 1 - 0.8, 'brightness kept inverts');
  assert.deepEqual(previewValues('cursor-trail-lightning', {BOLT_COLOR: [1, 0, 0]}).HEAD, [1, 0, 0]);
  assert.doesNotMatch(renderShaderPreview(input({values: {HEAD: [Number.NaN, 7, -1] as unknown as number[]}})).rows.join(''), /NaN/u);
  assert.equal(KITTY_PRESETS.find(p => p.id === 'crt')!.exclusive, KITTY_PRESETS.find(p => p.id === 'crt-blue')!.exclusive);
});

test('a dropped preview shows no replay hint and restarts when it can be seen; very narrow studios skip it', () => {
  const state = createGhosttyShaderPanel(structuredClone(DEFAULT_HOST_SHADERS.ghostty), {reducedMotion: false, effectsOff: false, cursorRenderer: 'auto', cursorMotion: 'tail'});
  state.catalog = buildGhosttyCatalog('1.3.1');
  const short = renderGhosttyShaderPanel(state, 80, 14, studioPreviewContext(1000, false, true)).map(stripAnsi).join('\n');
  assert.doesNotMatch(short, /P replay/u);
  assert.equal(state.previewStart, undefined);
  renderGhosttyShaderPanel(state, 120, undefined, studioPreviewContext(5000, false, true));
  assert.equal(state.previewStart, 5000, 'the run starts when the preview is visible');
  assert.doesNotMatch(renderGhosttyShaderPanel(state, 20, undefined, studioPreviewContext(6000, false, true)).map(stripAnsi).join('\n'), /Preview ·/u);
});

test('preview at a footer wrap boundary never advertises replay or keeps a clock for a hidden sample', () => {
  for (const columns of [60, 80, 100, 120]) for (let height = 14; height <= 40; height++) {
    const state = createGhosttyShaderPanel(structuredClone(DEFAULT_HOST_SHADERS.ghostty), {reducedMotion: false, effectsOff: false, cursorRenderer: 'auto', cursorMotion: 'tail'});
    state.catalog = buildGhosttyCatalog('1.3.1');
    const rows = renderGhosttyShaderPanel(state, columns, height, studioPreviewContext(1000, false, true)).map(stripAnsi);
    if (!rows.some(row => row.includes('Preview ·'))) {
      assert.ok(!rows.some(row => row.includes('P replay')), `${columns}x${height}`);
      assert.equal(state.previewBusy, false);
    }
    assert.ok(rows.length <= height);
    assert.match(rows.at(-1)!, /Esc/);
  }
});

test('trail styles differ in shape, not only in color: Lightning is never drawn like Blaze', () => {
  // The same colors for every style, so only the drawing can tell them apart.
  const values = {HEAD: [1, 0.8, 0.6], TAIL: [0.8, 0.1, 0.1]};
  const cells = (kind: PreviewInput['kind'], elapsed: number) => renderShaderPreview(input({kind, values, elapsed})).rows.join('\n');
  const kinds = ['trail', 'comet', 'blaze', 'lightning', 'motion-blur'] as const;
  for (const elapsed of [80, 300]) {
    const frames = kinds.map(kind => cells(kind, elapsed));
    assert.equal(new Set(frames).size, kinds.length, `every style draws its own frame at ${elapsed} ms`);
  }
  // Lightning flashes and is gone long before Blaze burns out; both settle (no idle loop).
  assert.equal(renderShaderPreview(input({kind: 'lightning', values, elapsed: 900})).rows.join(''), renderShaderPreview(input({kind: 'lightning', values, elapsed: 1000})).rows.join(''));
  assert.notEqual(cells('blaze', 900), cells('blaze', 1300), 'Blaze is still burning');
  assert.ok(PREVIEW_MS.lightning < PREVIEW_MS.blaze);
  for (const kind of kinds) assert.equal(renderShaderPreview(input({kind, values, elapsed: PREVIEW_MS[kind]})).busy, false, `${kind} settles`);
});
