import test from 'node:test';
import assert from 'node:assert/strict';
import {contrastRatio, toOklch} from '../src/chroma/color.js';
import {arcadePalette} from '../src/arcade/palette.js';
import {arcadeLook, deltaE, distinctColors, HUE_NAMES} from '../src/arcade/look.js';

const accents = [
  {red: 0xa6, green: 0x7c, blue: 0xf3}, // NMSh lavender
  {red: 0x3b, green: 0x9e, blue: 0xff}, // an ocean theme
  {red: 0xf5, green: 0x8a, blue: 0x3c}, // a warm theme
  {red: 0x7a, green: 0x7a, blue: 0x7a}, // a grey theme
];
const looks = accents.map(accent => arcadeLook({...arcadePalette(), accent}));

test('look: surface tiers are clearly separated steps, never near-identical purples', () => {
  for (const look of looks) {
    const s = look.surface;
    const steps: Array<[string, typeof s.base, typeof s.base]> = [['sunken/base', s.sunken, s.base], ['base/raised', s.base, s.raised],
      ['raised/raised2', s.raised, s.raised2], ['raised2/selected', s.raised2, s.selected]];
    for (const [name, a, b] of steps) {
      assert.ok(toOklch(b).l - toOklch(a).l >= 0.045, `${name} lightness step`);
      assert.ok(deltaE(a, b) >= 4.5, `${name} distance ${deltaE(a, b).toFixed(1)}`);
    }
    assert.ok(deltaE(s.selected, s.raised) >= 12, 'the selected band stands out from its neighbours');
  }
});

test('look: text is readable on every surface; the Arcade stays recognizably lavender', () => {
  for (const look of looks) {
    for (const [name, surface] of Object.entries(look.surface)) {
      if (name === 'line' || name === 'edge') continue;
      assert.ok(contrastRatio(look.text.strong, surface) >= 7, `strong on ${name}`);
      assert.ok(contrastRatio(look.text.normal, surface) >= 4.5, `normal on ${name}`);
    }
    assert.ok(contrastRatio(look.text.dim, look.surface.base) >= 3, 'dim on base');
    assert.ok(contrastRatio(look.text.onAccent, look.accent) >= 4.5, 'text on the accent fill');
    const hue = toOklch(look.accent).h;
    assert.ok(hue > 240 && hue < 330, `accent hue ${hue.toFixed(0)} stays violet`);
  }
});

test('look: gameplay hues are distinct from each other and readable on a board', () => {
  for (const look of looks) {
    for (const name of HUE_NAMES) assert.ok(contrastRatio(look.hue[name], look.surface.sunken) >= 4.5, `${name} readable`);
    for (let a = 0; a < HUE_NAMES.length; a += 1) for (let b = a + 1; b < HUE_NAMES.length; b += 1) {
      const distance = deltaE(look.hue[HUE_NAMES[a]!], look.hue[HUE_NAMES[b]!]);
      assert.ok(distance >= 6, `${HUE_NAMES[a]} vs ${HUE_NAMES[b]}: ${distance.toFixed(1)}`);
    }
    const twelve = distinctColors(12, look);
    assert.equal(twelve.length, 12);
    for (let index = 1; index < twelve.length; index += 1) assert.ok(deltaE(twelve[index - 1]!, twelve[index]!) >= 8, `neighbours ${index}`);
  }
});
