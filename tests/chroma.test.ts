import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCurve, BRAND_LAVENDER, foregroundOf, gradientCells, gradientText, identity, linearGradient, luminance, resolveColor, sampleGradient,
  solid, status, statusMeaning, theme,
} from '../src/chroma/chroma.js';
import {colorEscape, rgbTo256} from '../src/chroma/escape.js';
import {colorLevel} from '../src/presentation/capabilities.js';
import {foreground, UI_COLORS} from '../src/ui/palette.js';

const red = {red: 255, green: 0, blue: 0};
const blue = {red: 0, green: 0, blue: 255};

test('categories stay distinct: an identity color never carries status meaning', () => {
  const language = identity(UI_COLORS.success);
  assert.equal(statusMeaning(language), undefined);
  assert.equal(statusMeaning(theme('accent')), undefined);
  assert.equal(statusMeaning(solid(UI_COLORS.failure)), undefined);
  assert.equal(statusMeaning(status('failure')), 'failure');
  assert.deepEqual(resolveColor(status('success')), UI_COLORS.success);
  assert.deepEqual(resolveColor(theme('subtle')), UI_COLORS.subtle);
});

test('multi-stop gradients sample, clamp and accept unordered stops', () => {
  const gradient = {stops: [{at: 1, color: solid(blue)}, {at: 0, color: solid(red)}, {at: 0.5, color: solid({red: 0, green: 255, blue: 0})}]};
  assert.deepEqual(sampleGradient(gradient, 0), red);
  assert.deepEqual(sampleGradient(gradient, 0.5), {red: 0, green: 255, blue: 0});
  assert.deepEqual(sampleGradient(gradient, 1), blue);
  assert.deepEqual(sampleGradient(gradient, 2), blue);
  assert.deepEqual(sampleGradient(gradient, 0.25), {red: 128, green: 128, blue: 0});
  assert.deepEqual(gradientCells(linearGradient(solid(red), solid(blue)), 3)[1], {red: 128, green: 0, blue: 128});
  assert.deepEqual(gradientCells(linearGradient(solid(red), solid(blue)), 1), [red]);
  assert.throws(() => sampleGradient({stops: []}, 0.5));
});

test('curves are monotonic, bounded and hit both ends', () => {
  for (const curve of ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
    assert.equal(applyCurve(curve, 0), 0);
    assert.equal(applyCurve(curve, 1), 1);
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const value = applyCurve(curve, step / 20);
      assert.ok(value >= previous && value >= 0 && value <= 1);
      previous = value;
    }
  }
  assert.ok(applyCurve('ease-in', 0.5) < 0.5 && applyCurve('ease-out', 0.5) > 0.5);
  assert.equal(applyCurve('linear', 5), 1);
});

test('capability fallback: truecolor, 256-color and none', () => {
  assert.equal(colorEscape(38, red, 'truecolor'), '\u001B[38;2;255;0;0m');
  assert.equal(colorEscape(48, red, 'ansi256'), '\u001B[48;5;196m');
  assert.equal(colorEscape(38, red, 'none'), '');
  assert.equal(rgbTo256({red: 0, green: 0, blue: 0}), 16);
  assert.equal(rgbTo256({red: 255, green: 255, blue: 255}), 231);
  const mid = rgbTo256({red: 128, green: 128, blue: 128});
  assert.ok(mid >= 232 && mid <= 255);
  assert.equal(colorLevel({NMSH_COLOR: '256'}), 'ansi256');
});

test('the palette follows the capability level and no-color yields plain gradient text', () => {
  const saved = {NMSH_COLOR: process.env.NMSH_COLOR};
  try {
    process.env.NMSH_COLOR = '256';
    assert.match(foreground(UI_COLORS.accent), /^\u001B\[38;5;\d+m$/u);
    process.env.NMSH_COLOR = 'none';
    assert.equal(foregroundOf(theme('accent')), '');
    assert.equal(gradientText([...'abc'], linearGradient(solid(red), solid(blue))), 'abc');
  } finally {
    if (saved.NMSH_COLOR === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = saved.NMSH_COLOR;
  }
});

test('brand lavender and luminance', () => {
  assert.deepEqual(BRAND_LAVENDER, {red: 166, green: 124, blue: 243});
  assert.ok(luminance({red: 255, green: 255, blue: 255}) > luminance(BRAND_LAVENDER));
  assert.equal(luminance({red: 0, green: 0, blue: 0}), 0);
});
