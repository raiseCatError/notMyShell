import test from 'node:test';
import assert from 'node:assert/strict';
import {contrastRatio, relativeLuminance, surfaceFor, type Rgb} from '../src/chroma/color.js';
import {DEFAULT_TREATMENT_SETTINGS, motionCycleMs, normalizeTreatmentSettings, treatmentFor, TREATMENT_PRESETS, type TreatmentSettings} from '../src/chroma/treatment.js';
import {renderPowerlineBlocks, type PowerlineBlock} from '../src/prompt/powerline.js';
import {defaultStyleProfiles, type PromptStyle} from '../src/prompt/styles.js';

process.env.COLORTERM = 'truecolor';

const hex = (value: string): Rgb => ({red: parseInt(value.slice(1, 3), 16), green: parseInt(value.slice(3, 5), 16), blue: parseInt(value.slice(5, 7), 16)});
/** Base fills from light to dark: the ones whose animated fill straddles the light/dark text threshold flickered before. */
const FILLS = ['#a67cf3', '#7aa2f7', '#9ece6a', '#e0af68', '#f7768e', '#c0caf5', '#565f89', '#2ac3de'];

/** Foreground and background of every letter of the module labels, per render. */
function letterColors(rendered: string): Array<{fg: Rgb; bg: Rgb}> {
  const cells: Array<{fg: Rgb; bg: Rgb}> = [];
  let fg: Rgb | undefined, bg: Rgb | undefined;
  for (let index = 0; index < rendered.length;) {
    const sgr = /^\u001b\[([0-9;]*)m/u.exec(rendered.slice(index));
    if (sgr) {
      const parts = sgr[1]!.split(';').map(Number);
      for (let at = 0; at < parts.length; at += 1) {
        const code = parts[at]!;
        if (code === 0 || sgr[1] === '') { fg = undefined; bg = undefined; } else if ((code === 38 || code === 48) && parts[at + 1] === 2) {
          const color = {red: parts[at + 2]!, green: parts[at + 3]!, blue: parts[at + 4]!};
          if (code === 38) fg = color; else bg = color;
          at += 4;
        } else if (code === 39) fg = undefined; else if (code === 49) bg = undefined;
      }
      index += sgr[0].length;
      continue;
    }
    const char = rendered[index]!;
    if (/[a-z]/u.test(char) && fg && bg) cells.push({fg, bg});
    index += 1;
  }
  return cells;
}

const isLight = (cell: {fg: Rgb; bg: Rgb}) => relativeLuminance(cell.fg) > relativeLuminance(cell.bg);

function frames(settings: TreatmentSettings, style: PromptStyle = 'powerline', fills = FILLS): Array<Array<{fg: Rgb; bg: Rgb}>> {
  const treatment = treatmentFor(settings)!;
  const blocks: PowerlineBlock[] = fills.map((fill, index) => ({text: `mod${'abcdefgh'[index]}`, style, background: hex(fill), foreground: {red: 245, green: 245, blue: 245}, treatment: settings}));
  const cycle = motionCycleMs(settings.motion, settings.speed) || 1000;
  return Array.from({length: 48}, (_, frame) => letterColors(renderPowerlineBlocks(blocks, 0, 1, 'wedge', false, 'wedge', 'wedge', undefined, 'previous', 'normal',
    {profiles: defaultStyleProfiles(0, 1), chroma: {treatment, time: frame * cycle / 48, still: false}})));
}

function assertStable(sampled: Array<Array<{fg: Rgb; bg: Rgb}>>, label: string, minimum: number): void {
  assert.ok(sampled[0]!.length > 0, `${label}: text cells rendered`);
  for (let cell = 0; cell < sampled[0]!.length; cell += 1) {
    const colors = new Set(sampled.map(frame => JSON.stringify(frame[cell]!.fg)));
    const polarities = new Set(sampled.map(frame => isLight(frame[cell]!)));
    assert.equal(polarities.size, 1, `${label}: cell ${cell} text flips between light and dark`);
    for (const frame of sampled) assert.ok(contrastRatio(frame[cell]!.fg, frame[cell]!.bg) >= minimum - 0.01, `${label}: cell ${cell} contrast ${contrastRatio(frame[cell]!.fg, frame[cell]!.bg).toFixed(2)}`);
    if (minimum >= 4.5) assert.equal(colors.size, 1, `${label}: filled-module text color is fixed for the presentation state`);
  }
}

const animated = (preset: TreatmentSettings['preset'], motion: TreatmentSettings['motion'], extra: Partial<TreatmentSettings> = {}) =>
  normalizeTreatmentSettings({...DEFAULT_TREATMENT_SETTINGS, preset, motion, intensity: 1, ...extra});

test('Breathe: filled module text never alternates light/dark and keeps 4.5:1 on every frame', () => {
  for (const preset of TREATMENT_PRESETS.filter(name => name !== 'off' && name !== 'custom')) {
    assertStable(frames(animated(preset, 'breathe')), `${preset} breathe`, 4.5);
  }
});

test('every animated motion keeps a stable text polarity on filled styles', () => {
  for (const motion of ['travel', 'comet', 'pulse', 'breathe'] as const) {
    for (const preset of ['lavender', 'aurora', 'rainbow', 'warm', 'monochrome', 'theme'] as const) {
      for (const style of ['powerline', 'soft', 'compact'] as const) assertStable(frames(animated(preset, motion), style), `${preset} ${motion} ${style}`, 4.5);
    }
  }
});

test('ribbon: animated text on the fixed band keeps its polarity and 3:1', () => {
  for (const motion of ['travel', 'comet', 'pulse', 'breathe'] as const) assertStable(frames(animated('rainbow', motion), 'ribbon'), `ribbon ${motion}`, 3);
});

test('static changes may still choose a different foreground', () => {
  const darkText = frames(animated('lavender', 'static', {intensity: 0.1}), 'powerline', ['#f2f2f2'])[0]![0]!;
  const lightText = frames(animated('lavender', 'static', {intensity: 0.1}), 'powerline', ['#202030'])[0]![0]!;
  assert.notEqual(isLight(darkText), isLight(lightText), 'a different base picks the polarity that reads on it');
});

test('surfaceFor moves a fill away from fixed text and leaves readable fills alone', () => {
  const white = {red: 255, green: 255, blue: 255}, black = {red: 0, green: 0, blue: 0};
  const pale = hex('#d8c8ff');
  assert.ok(contrastRatio(white, surfaceFor(pale, white)) >= 4.5);
  assert.ok(relativeLuminance(surfaceFor(pale, white)) < relativeLuminance(pale), 'darkened under light text');
  assert.ok(contrastRatio(black, surfaceFor(hex('#303040'), black)) >= 4.5);
  assert.deepEqual(surfaceFor(hex('#202030'), white), hex('#202030'));
});

test('reduced motion: the still render is frame-independent', () => {
  const settings = animated('aurora', 'breathe');
  const treatment = treatmentFor(settings)!;
  const blocks: PowerlineBlock[] = [{text: 'still', background: hex('#a67cf3'), foreground: {red: 245, green: 245, blue: 245}, treatment: settings}];
  const at = (time: number) => renderPowerlineBlocks(blocks, 0, 1, 'wedge', false, 'wedge', 'wedge', undefined, 'previous', 'normal', {chroma: {treatment, time, still: true}});
  assert.equal(at(0), at(1234));
});
