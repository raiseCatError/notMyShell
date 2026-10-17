import test from 'node:test';
import assert from 'node:assert/strict';
import {CellGrid, luminance, NO_COLOR_VALUE} from '../src/idle/CellGrid.js';
import {renderScene} from '../src/idle/scenes.js';
import {IDLE_SEED} from '../src/idle/IdleVisuals.js';
import {CAT_BODY, CAT_EYE} from '../src/idle/catSprite.js';
import {DEFAULT_PROMPT_CONFIGURATION, type PromptConfiguration} from '../src/prompt/configuration.js';
import {
  blendPalettes, CROSSFADE_MS, fadeMix, mixPalette, MOOD_SPEED, moodPalette, pureMix, SKY_MOODS, skyStops, type SkyMood,
} from '../src/idle/auroraMoods.js';
import {AURORA_EPOCH, renderSkyBand, SKY_HOLD_MS, skyCatPose, skyFrameMs, skyMix, skySceneTime, type SkyBandInput} from '../src/setup/startup/sky.js';
import {UI_COLORS} from '../src/ui/palette.js';
import {stripAnsi} from '../src/util/text.js';

/** The starting-point sky: the real Aurora engine with palette moods, a horizon below it, one bounded cadence. */
const config: PromptConfiguration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);

const input = (over: Partial<SkyBandInput> = {}): SkyBandInput => ({
  width: 64, height: 10, now: 20_000, started: 0, mood: 'aurora', previousMood: 'aurora', changedAt: Number.NEGATIVE_INFINITY,
  backdrop: 'aurora', reduced: false, config, level: 'truecolor', nerd: true, ...over,
});

const hasBackground = (rows: readonly string[]) => rows.some(row => /\u001b\[48;/u.test(row));
const stopLight = (stops: readonly number[]) => stops.reduce((sum, stop) => sum + luminance(stop), 0) / stops.length;
const channels = (value: number) => [(value >> 16) & 255, (value >> 8) & 255, value & 255];
const distance = (a: readonly number[], b: readonly number[]) => a.reduce((sum, stop, i) => sum + channels(stop).reduce((s, c, k) => s + Math.abs(c - channels(b[i]!)[k]!), 0), 0);

test('each mood draws through renderScene and differs from the others', () => {
  const frames = new Map<SkyMood, string[]>();
  for (const mood of ['aurora', 'calm', 'spectrum'] as const) {
    const shown = renderSkyBand(new CellGrid(), input({mood, previousMood: mood}));
    assert.equal(shown.rows.length, 10);
    // The rows are exactly the real engine's, drawn with the mood's palette at the mood's own scene time.
    const grid = new CellGrid();
    grid.resize(64, 10);
    renderScene('aurora', grid, {time: AURORA_EPOCH + 20_000 * MOOD_SPEED[mood], seed: IDLE_SEED, palette: moodPalette(mood, config), level: 'truecolor', nerd: true});
    assert.deepEqual(shown.rows, grid.toRows('truecolor'), mood);
    frames.set(mood, shown.rows);
  }
  assert.notDeepEqual(frames.get('aurora'), frames.get('calm'));
  assert.notDeepEqual(frames.get('aurora'), frames.get('spectrum'));
  assert.notDeepEqual(frames.get('calm'), frames.get('spectrum'));
  assert.deepEqual([...SKY_MOODS], ['aurora', 'calm', 'spectrum', 'out']);
  // Aurora keeps the theme's accent in its upper curtains; Spectrum is the Aurora preset's four colors.
  assert.equal(skyStops(config).length, 4);
  assert.notDeepEqual(moodPalette('aurora', config).stops, moodPalette('spectrum', config).stops);
  assert.ok(stopLight(moodPalette('calm', config).stops) < stopLight(moodPalette('aurora', config).stops) * 0.3, 'Calm is dimmed toward the night');
});

test('cross-fade at 0, 350 and 700 ms moves monotonically from the old palette to the new one', () => {
  const from = moodPalette('aurora', config), to = moodPalette('spectrum', config);
  const at = (elapsed: number) => mixPalette(skyMix(input({mood: 'spectrum', previousMood: 'aurora', changedAt: 1000, now: 1000 + elapsed})), config, 'aurora');
  const start = at(0), middle = at(350), end = at(700);
  assert.deepEqual(start.stops, from.stops, 'the fade starts on the old palette');
  assert.deepEqual(end.stops, to.stops, 'and ends on the new one');
  assert.ok(distance(middle.stops, to.stops) < distance(start.stops, to.stops));
  assert.ok(distance(middle.stops, from.stops) > 0);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) {
    const values = [start, middle, end].map(palette => channels(palette.stops[i]!)[k]!);
    assert.ok((values[0]! <= values[1]! && values[1]! <= values[2]!) || (values[0]! >= values[1]! && values[1]! >= values[2]!), `stop ${i} channel ${k} is monotonic: ${values}`);
  }
  assert.equal(CROSSFADE_MS, 700);
  assert.deepEqual(blendPalettes(from, to, 0).stops, from.stops);
  assert.deepEqual(blendPalettes(from, to, 1).stops, to.stops);
});

test('a newer change restarts from the current blend: no queue, no flash', () => {
  const first = input({mood: 'spectrum', previousMood: 'aurora', changedAt: 0, now: 300});
  const shown = skyMix(first);
  // A change to Calm at 300 ms starts from what is on screen at that moment.
  const second = input({mood: 'calm', previousMood: 'spectrum', changedAt: 300, now: 300, from: shown});
  assert.deepEqual(mixPalette(skyMix(second), config, 'aurora'), mixPalette(shown, config, 'aurora'));
  const settled = skyMix({...second, now: 300 + CROSSFADE_MS});
  assert.deepEqual(settled, pureMix('calm'));
  // The mix is a blend of moods that always sums to one.
  const mid = fadeMix(shown, 'calm', 200);
  assert.ok(Math.abs(Object.values(mid).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('scene time integrates the mood speed, so a change of mood never jumps the curtains', () => {
  const before = input({mood: 'aurora', previousMood: 'aurora', changedAt: Number.NEGATIVE_INFINITY, now: 10_000});
  const at = skySceneTime(before);
  const after = input({mood: 'calm', previousMood: 'aurora', changedAt: 10_000, now: 10_000, timeAt: at - AURORA_EPOCH});
  assert.equal(skySceneTime(after), at);
  assert.ok(skySceneTime({...after, now: 10_040}) > at, 'it keeps moving through the cross-fade');
  const later = skySceneTime({...after, now: 30_000}) - skySceneTime({...after, now: 20_000});
  assert.ok(Math.abs(later - 10_000 * MOOD_SPEED.calm) < 1e-6, 'Calm runs at its own speed once settled');
});

test('out draws no sky rows after the fade but keeps the horizon', () => {
  const fading = renderSkyBand(new CellGrid(), input({mood: 'out', previousMood: 'aurora', changedAt: 0, now: 350}));
  assert.ok(hasBackground(fading.rows), 'the curtains fade to night while the scene keeps moving');
  const gone = renderSkyBand(new CellGrid(), input({mood: 'out', previousMood: 'aurora', changedAt: 0, now: CROSSFADE_MS + 1}));
  assert.equal(gone.rows.length, 10, 'the band keeps its height, so the ground never jumps');
  assert.ok(!hasBackground(gone.rows), 'no sky is drawn');
  assert.equal(stripAnsi(gone.horizon), '▔'.repeat(64));
  // Vespyr remains, standing on the horizon.
  const cat = renderSkyBand(new CellGrid(), input({mood: 'out', previousMood: 'out', cat: {x: 3, pose: 'idle'}}));
  assert.ok(cat.rows.slice(-4).every(row => row.includes('▀') || row.includes('▄')));
});

test('subtle is dimmer than aurora', () => {
  for (const mood of ['aurora', 'calm', 'spectrum'] as const) {
    assert.ok(stopLight(moodPalette(mood, config, 'subtle').stops) < stopLight(moodPalette(mood, config, 'aurora').stops), mood);
  }
  const light = (rows: readonly string[]) => {
    let sum = 0, count = 0;
    for (const row of rows) for (const match of row.matchAll(/\u001b\[(?:38|48);2;(\d+);(\d+);(\d+)m/gu)) {
      sum += luminance((Number(match[1]) << 16) | (Number(match[2]) << 8) | Number(match[3])); count++;
    }
    return sum / Math.max(1, count);
  };
  assert.ok(light(renderSkyBand(new CellGrid(), input({backdrop: 'subtle'})).rows) < light(renderSkyBand(new CellGrid(), input()).rows));
});

test('reduced motion renders the same frame at any time and switches mood at once', () => {
  const a = renderSkyBand(new CellGrid(), input({reduced: true, now: 0}));
  const b = renderSkyBand(new CellGrid(), input({reduced: true, now: 123_456}));
  assert.deepEqual(a, b);
  const changed = renderSkyBand(new CellGrid(), input({reduced: true, mood: 'spectrum', previousMood: 'aurora', changedAt: 0, now: 10}));
  assert.deepEqual(changed, renderSkyBand(new CellGrid(), input({reduced: true, mood: 'spectrum', previousMood: 'spectrum', now: 99_999})));
  assert.equal(skyCatPose({now: 10, started: 0, changedAt: 0, reduced: true}), 'idle');
});

test('backdrop off returns no sky and a separator hairline', () => {
  const shown = renderSkyBand(new CellGrid(), input({backdrop: 'off'}));
  assert.equal(shown.rows.length, 10);
  assert.ok(!hasBackground(shown.rows));
  assert.ok(shown.rows.every(row => stripAnsi(row).trim() === ''));
  assert.equal(stripAnsi(shown.horizon), '▔'.repeat(64));
  const {red, green, blue} = UI_COLORS.separator;
  assert.ok(shown.horizon.includes(`38;2;${red};${green};${blue}m`), 'the hairline is the separator color');
  // Vespyr stands on the hairline without a background rectangle.
  const cat = renderSkyBand(new CellGrid(), input({backdrop: 'off', cat: {x: 3, pose: 'idle'}}));
  const rgb = (value: number) => `${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}`;
  const own = new Set([rgb(CAT_BODY), rgb(CAT_EYE)]);
  for (const row of cat.rows) for (const match of row.matchAll(/\u001b\[48;2;(\d+;\d+;\d+)m/gu)) assert.ok(own.has(match[1]!), `background ${match[1]} is Vespyr's own`);
  assert.ok(cat.rows.slice(-4).some(row => row.includes(`38;2;${rgb(CAT_BODY)}m`)));
});

test('the horizon follows the light in the sky\'s bottom row and is never inside the band', () => {
  const shown = renderSkyBand(new CellGrid(), input({cat: {x: 4, pose: 'idle'}}));
  assert.equal(shown.rows.length, 10);
  assert.ok(shown.rows.every(row => !row.includes('▔')), 'the band holds no horizon glyph');
  assert.equal(stripAnsi(shown.horizon), '▔'.repeat(64));
  const colors = new Set([...shown.horizon.matchAll(/\u001b\[38;2;(\d+;\d+;\d+)m/gu)].map(match => match[1]));
  assert.ok(colors.size > 3, 'its color varies with the light above it');
  // The cat's feet are in the band's bottom row; the horizon below does not change with the cat.
  const without = renderSkyBand(new CellGrid(), input());
  assert.equal(shown.horizon, without.horizon);
  assert.ok(shown.rows[9]!.includes(`${(CAT_BODY >> 16) & 255};${(CAT_BODY >> 8) & 255};${CAT_BODY & 255}`));
});

test('NO_COLOR and 16 colors draw no sky; the horizon is a plain rule', () => {
  const plain = renderSkyBand(new CellGrid(), input({level: 'none', cat: {x: 3, pose: 'idle'}}));
  assert.ok(plain.rows.every(row => !row.includes('\u001b') && row.trim() === ''), 'no sky and no colorless Vespyr');
  assert.equal(plain.horizon, '─'.repeat(64));
  assert.equal(renderSkyBand(new CellGrid(), input({level: 'none', nerd: false})).horizon, '-'.repeat(64));
  const ansi16 = renderSkyBand(new CellGrid(), input({level: 'ansi16'}));
  assert.ok(!hasBackground(ansi16.rows));
  assert.equal(stripAnsi(ansi16.horizon), '▔'.repeat(64));
  assert.equal(stripAnsi(renderSkyBand(new CellGrid(), input({nerd: false})).horizon), '-'.repeat(64), 'Safe glyphs use an ASCII rule');
  assert.deepEqual(renderSkyBand(new CellGrid(), input({height: 0})), {rows: [], horizon: ''});
});

test('skyFrameMs is 40 during a cross-fade, 200/320 at rest, 0 when still', () => {
  assert.equal(skyFrameMs(input({changedAt: 19_900})), 40);
  assert.equal(skyFrameMs(input()), 200);
  assert.equal(skyFrameMs(input({backdrop: 'subtle'})), 320);
  assert.equal(skyFrameMs(input({reduced: true})), 0);
  assert.equal(skyFrameMs(input({reduced: true, changedAt: 19_990})), 0);
  assert.equal(skyFrameMs(input({backdrop: 'off'})), 0);
  assert.equal(skyFrameMs(input({level: 'none'})), 0);
  assert.equal(skyFrameMs(input({mood: 'out', previousMood: 'out'})), 200, 'Vespyr still blinks under an empty sky');
  // After 60 s without a key the sky holds still: no clock, and the frame stops changing.
  assert.equal(skyFrameMs(input({activeAt: 20_000 - SKY_HOLD_MS})), 0);
  assert.equal(skyFrameMs(input({activeAt: 20_000 - SKY_HOLD_MS + 1})), 200);
  const held = (now: number) => renderSkyBand(new CellGrid(), input({activeAt: 0, now}));
  assert.deepEqual(held(SKY_HOLD_MS + 5_000), held(SKY_HOLD_MS + 50_000));
});

test('Vespyr blinks now and then and flicks its tail when the highlight changes', () => {
  assert.equal(skyCatPose({now: 100, started: 0, changedAt: 0, reduced: false}), 'tail');
  assert.equal(skyCatPose({now: 2_000, started: 0, changedAt: 0, reduced: false}), 'idle');
  const poses = new Set(Array.from({length: 7000 / 20}, (_, i) => skyCatPose({now: i * 20, started: 0, changedAt: Number.NEGATIVE_INFINITY, reduced: false})));
  assert.ok(poses.has('blink') && poses.has('idle'));
  // A blink lasts longer than the slowest cadence, so a frame always lands on it.
  let longest = 0, run = 0;
  for (let t = 0; t < 13_000; t += 10) {
    if (skyCatPose({now: t, started: 0, changedAt: Number.NEGATIVE_INFINITY, reduced: false}) === 'blink') longest = Math.max(longest, ++run * 10); else run = 0;
  }
  assert.ok(longest >= 320, `blink lasts ${longest} ms`);
  void NO_COLOR_VALUE;
});
