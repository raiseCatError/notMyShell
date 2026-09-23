import test from 'node:test';
import assert from 'node:assert/strict';
import {GLYPHS} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {
  ACTIVE_SHIMMER_CYCLE_MS,
  SHIMMER_CYCLE_MS,
  SHIMMER_WAVELENGTH,
  interpolateRgb,
  shimmerIntensity,
  shimmerText,
  shimmerTextWithColors,
  wrappedPhase,
} from '../src/status/shimmer.js';
import {graphemes} from '../src/input/inputLayout.js';
import {UI_COLORS} from '../src/ui/palette.js';
import {completedActivity} from '../src/status/activity.js';

test('shimmer interpolates RGB without changing string width', () => {
  assert.deepEqual(interpolateRgb({red: 0, green: 10, blue: 20}, {red: 10, green: 30, blue: 40}, 0.5), {
    red: 5,
    green: 20,
    blue: 30,
  });
  const text = '✻ Meowing… (4.2s)';
  const rendered = shimmerText(text, 425, false);
  assert.equal(stripAnsi(rendered), text);
  assert.equal(displayWidth(rendered), displayWidth(text));
  assert.match(rendered, /\u001B\[38;2;\d+;\d+;\d+m/u);
  assert.notDeepEqual(UI_COLORS.workingBase, UI_COLORS.workingPeak);
});

test('completed status text is static and retains completion time', () => {
  const completedAt = new Date(2026, 8, 21, 22, 51);
  assert.deepEqual(completedActivity('npm test', 18_700, completedAt, 0, false), {
    main: `${GLYPHS.success} Completed · 18.7s`,
    detail: ' · 22:51',
  });
});

const glyphColors = (rendered: string): string[] =>
  [...rendered.matchAll(/\u001B\[38;2;(\d+;\d+;\d+)m/gu)].map(match => match[1]!);

test('shimmer is a per-glyph wave: neighbours differ and the line never pulses as one', () => {
  for (const isActive of [false, true]) {
    for (let time = 0; time < 4000; time += 137) {
      const values = Array.from({length: 24}, (_, index) => shimmerIntensity(time, index, 24, isActive));
      for (let index = 1; index < values.length; index += 1) {
        assert.notEqual(values[index], values[index - 1], `adjacent glyphs share a value at t=${time}`);
        assert.ok(Math.abs(values[index]! - values[index - 1]!) < 0.3, 'phase offset between neighbours stays small');
      }
      assert.ok(Math.max(...values) - Math.min(...values) > 0.5, `whole string has one luminance at t=${time} active=${isActive}`);
    }
  }
});

test('shimmer crest travels smoothly left to right, independent of text length', () => {
  const crest = (time: number) => {
    let best = 0;
    for (let tenth = 0; tenth < SHIMMER_WAVELENGTH * 10; tenth += 1) {
      if (shimmerIntensity(time, tenth / 10, 40, false) > shimmerIntensity(time, best, 40, false)) best = tenth / 10;
    }
    return best;
  };
  const frame = 100;
  const step = crest(frame) - crest(0);
  assert.ok(step > 0 && step < 1, `a 100 ms frame moves the crest under one glyph (moved ${step})`);
  assert.equal(shimmerIntensity(500, 7, 10, false), shimmerIntensity(500, 7, 200, false), 'speed does not depend on length');
  assert.equal(shimmerIntensity(250, 3, 20, false), shimmerIntensity(250 + SHIMMER_CYCLE_MS, 3, 20, false), 'periodic');
  assert.equal(shimmerIntensity(250, 3, 20, true), shimmerIntensity(250 + ACTIVE_SHIMMER_CYCLE_MS, 3, 20, true), 'periodic when active');
  assert.equal(wrappedPhase(-100, 1000), 0.9);
});

test('shimmer changes only luminance: text, glyph count and width are preserved', () => {
  const base = {red: 148, green: 155, blue: 166};
  const peak = {red: 248, green: 250, blue: 252};
  for (const text of ['  ◌ node --test slow-fixture · 1.2s ›', 'ビルド中 🐈 テスト']) {
    for (const time of [0, 90, 1234]) {
      const rendered = shimmerTextWithColors(text, time, false, base, peak);
      assert.equal(stripAnsi(rendered), text);
      assert.equal(displayWidth(rendered), displayWidth(text));
      assert.equal(glyphColors(rendered).length, graphemes(text).length, 'one color per glyph');
      assert.equal(rendered, shimmerTextWithColors(text, time, false, base, peak), 'deterministic for a given time');
      for (const color of glyphColors(rendered)) {
        const [red, green, blue] = color.split(';').map(Number) as [number, number, number];
        assert.ok(red >= base.red && red <= peak.red && blue >= base.blue && blue <= peak.blue, 'stays between silver base and peak');
        assert.ok(green >= base.green && green <= peak.green);
      }
    }
    assert.notEqual(shimmerTextWithColors(text, 0, false, base, peak), shimmerTextWithColors(text, 300, false, base, peak), 'animation advances');
  }
  const bounds = Array.from({length: 200}, (_, time) => shimmerIntensity(time * 17, time % 13, 13, false));
  assert.ok(Math.min(...bounds) > 0 && Math.max(...bounds) < 1, 'the sheen never hits the full base or peak');
});
