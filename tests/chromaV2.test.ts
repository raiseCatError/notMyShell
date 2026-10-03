import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {buildContextLine, moduleShowcaseContext, promptChroma, themeChromaStops, themePreviewContext, NATIVE_PROMPT_THEMES} from '../src/prompt/prompt.js';
import {PROMPT_STYLES, type PromptStyle} from '../src/prompt/styles.js';
import {
  motionCycleMs, normalizeTreatmentSettings, PRESET_STOPS, samplePromptTreatment, treatmentFor, treatmentInfluence, TREATMENT_PRESETS,
  DEFAULT_TREATMENT_SETTINGS, type TreatmentSettings,
} from '../src/chroma/treatment.js';
import {contrastRatio, parseHexColor, toOklch} from '../src/chroma/color.js';
import {closeGradientEditor, handlePromptPanelKey, openGradientEditor, parseStopInput, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {presentationClock} from '../src/motion/PresentationClock.js';
import {stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const FG = /\u001B\[38;2;(\d+);(\d+);(\d+)m/gu;
const BG = /\u001B\[48;2;(\d+);(\d+);(\d+)m/gu;
const colors = (ansi: string, pattern: RegExp) => [...ansi.matchAll(pattern)].map(match => ({red: +match[1]!, green: +match[2]!, blue: +match[3]!}));
const config = (style: PromptStyle, presentation: Partial<TreatmentSettings> = {}, nmsh: Partial<PromptConfiguration['nmsh']> = {}): PromptConfiguration => {
  const value = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  value.nmsh = {...value.nmsh, style, ...nmsh};
  value.presentation = {...value.presentation, ...presentation};
  value.modules = value.modules.map(module => ({...module, visible: true}));
  return value;
};
const line = (value: PromptConfiguration, time = 0) => buildContextLine(themePreviewContext(), 200, value, 'composer', time);
const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test('settings: v2 fields normalize additively; pre-v2 values keep their exact meaning', () => {
  const legacy = normalizeTreatmentSettings({preset: 'aurora', geometry: 'center-out', motion: 'travel', intensity: 0.65});
  assert.deepEqual([legacy.speed, legacy.curve, legacy.direction, legacy.scope, legacy.customColors], ['normal', 'linear', 'forward', 'identity', false]);
  assert.equal(treatmentInfluence(legacy), 'mixed', 'the 0.65 default reads as Mixed');
  assert.equal(motionCycleMs('travel', 'normal'), 6000, 'pre-v2 travel timing');
  assert.equal(motionCycleMs('breathe', 'normal'), 4000, 'pre-v2 breathe timing');
  assert.ok(motionCycleMs('travel', 'very-slow') > motionCycleMs('travel', 'slow') && motionCycleMs('travel', 'slow') > motionCycleMs('travel', 'fast'));
  for (const preset of TREATMENT_PRESETS) assert.equal(normalizeTreatmentSettings({preset, customStops: ['#000000', '#ffffff']}).preset, preset);
  assert.equal(normalizeTreatmentSettings({preset: 'plasma'}).preset, 'off');
  assert.equal(normalizeTreatmentSettings({speed: 'warp', curve: 'bounce', direction: 'sideways', scope: 'everything'}).speed, 'normal');
  assert.deepEqual(normalizeTreatmentSettings({customStops: ['#ABCDEF', '#000000']}).customStops, ['#abcdef', '#000000']);
  assert.deepEqual(normalizeTreatmentSettings({customStops: ['javascript:alert(1)', '#000000']}).customStops, [], 'never an expression');
});

test('presets are visibly distinct families; Aurora is not Lavender', () => {
  const family = (preset: keyof typeof PRESET_STOPS) => PRESET_STOPS[preset].map(hex => toOklch(parseHexColor(hex)!));
  const lavender = family('lavender'), aurora = family('aurora');
  assert.ok(lavender.every(stop => stop.h > 270 && stop.h < 320), 'Lavender stays violet');
  assert.ok(aurora.some(stop => stop.h > 140 && stop.h < 200), 'Aurora reaches green-teal');
  assert.ok(Math.max(...aurora.map(stop => stop.h)) - Math.min(...aurora.map(stop => stop.h)) > 120, 'Aurora sweeps hue');
  const rendered = new Map<string, string>();
  for (const preset of TREATMENT_PRESETS) {
    const value = config('powerline', {preset, scope: 'prompt', intensity: 0.9, customStops: ['#ff0000', '#00ff00']});
    rendered.set(preset, line(value));
  }
  assert.equal(new Set(rendered.values()).size, TREATMENT_PRESETS.length, 'every preset renders differently on the real prompt');
});

test('Current Theme derives from the actual Native theme roles, stays recognizable, and never washes to white', () => {
  for (const palette of ['cool', 'warm', 'lavender', 'brand', 'aurora', 'sunset'] as const) {
    const stops = themeChromaStops(palette);
    const roles = ['project', 'cwd', 'gitBranch', 'node', 'go', 'python', 'docker', 'kubernetes'] as const;
    const themeHues = roles.map(role => toOklch(NATIVE_PROMPT_THEMES[palette].colors(role).background)).filter(lch => lch.c > 0.03).map(lch => lch.h);
    for (const stop of stops) {
      const lch = toOklch(stop);
      assert.ok(lch.l <= 0.75, `${palette} stop not near-white`);
      if (lch.c > 0.03) assert.ok(themeHues.some(hue => hueDistance(hue, lch.h) < 12), `${palette} stop hue comes from the theme`);
    }
    const treated = colors(line(config('powerline', {preset: 'theme', scope: 'prompt', intensity: 0.9}, {palette})), BG);
    const mean = treated.reduce((sum, color) => sum + toOklch(color).l, 0) / treated.length;
    assert.ok(mean < 0.8, `${palette} treated prompt is not washed out`);
  }
  // Cool stays cool and Warm stays warm under theme-aware Chroma: the hue family share holds.
  const share = (palette: 'cool' | 'warm', preset: 'off' | 'theme') => {
    const fills = colors(line(config('powerline', {preset, scope: 'prompt', intensity: 0.65}, {palette, vibrance: 'vibrant'})), BG)
      .map(color => toOklch(color)).filter(lch => lch.c > 0.05);
    return fills.filter(lch => (palette === 'cool' ? lch.h > 150 && lch.h < 300 : lch.h < 110 || lch.h > 330)).length / fills.length;
  };
  for (const palette of ['cool', 'warm'] as const) {
    assert.ok(share(palette, 'theme') >= share(palette, 'off') - 0.1, `${palette} keeps its hue family (${share(palette, 'theme')} vs ${share(palette, 'off')})`);
  }
  // Not generic UI colors: two themes give two different treatments.
  assert.notDeepEqual(themeChromaStops('cool'), themeChromaStops('warm'));
});

test('vibrance and Chroma compose deterministically into four distinct appearances; Off restores the exact base', () => {
  const combos = [
    config('powerline', {}, {vibrance: 'soft'}),
    config('powerline', {}, {vibrance: 'vibrant'}),
    config('powerline', {preset: 'aurora', scope: 'prompt'}, {vibrance: 'standard'}),
    config('powerline', {preset: 'aurora', scope: 'prompt'}, {vibrance: 'vibrant'}),
  ];
  const renders = combos.map(value => line(value));
  assert.equal(new Set(renders).size, 4);
  assert.deepEqual(combos.map(value => line(value)), renders, 'same input, same output');
  for (const style of PROMPT_STYLES) {
    const base = config(style);
    const off = line(base);
    const on = line({...base, presentation: {...base.presentation, preset: 'aurora', scope: 'prompt'}});
    assert.notEqual(on, off, `${style} Chroma visible`);
    assert.equal(stripAnsi(on), stripAnsi(off), `${style} Chroma changes color only`);
    const back = {...base, presentation: {...base.presentation, preset: 'aurora' as const}};
    back.presentation.preset = 'off';
    assert.equal(line(back), off, `${style} Off → Aurora → Off restores the exact prompt`);
  }
});

test('protected meaning: with Preserve, status and Rich Git state segments are not treated; explicit module colors stay authoritative', () => {
  const failing = {...moduleShowcaseContext(), exitStatus: 1};
  const value = config('powerline', {preset: 'rainbow', scope: 'prompt', intensity: 1, semantic: 'preserve'});
  const overridden = buildContextLine(failing, 220, config('powerline', {preset: 'rainbow', scope: 'prompt', intensity: 1, semantic: 'override'}), 'composer');
  const off = config('powerline');
  const treated = buildContextLine(failing, 220, value, 'composer');
  const plain = buildContextLine(failing, 220, off, 'composer');
  const failureFill = NATIVE_PROMPT_THEMES.lavender.colors('failure').background;
  const has = (ansi: string, color: {red: number; green: number; blue: number}) => colors(ansi, BG).some(fill => JSON.stringify(fill) === JSON.stringify(color));
  assert.ok(has(plain, failureFill) && has(treated, failureFill), 'failure fill unchanged under Chroma');
  assert.ok(!has(overridden, failureFill), 'Override recolors the failure fill');
  assert.match(stripAnsi(overridden), /✘ 1|x 1/u, 'its symbol and code still say failure');
  const custom = normalizePromptConfiguration({presentation: {preset: 'rainbow', scope: 'prompt', intensity: 1},
    modules: [{id: 'project', visible: true, condition: 'always', background: '#203040'}]});
  assert.ok(has(line(custom), {red: 0x20, green: 0x30, blue: 0x40}), 'explicit color untouched by default');
  custom.presentation.customColors = true;
  assert.ok(!has(line(custom), {red: 0x20, green: 0x30, blue: 0x40}), 'opt-in treats explicit colors too');
});

test('filled styles keep readable text under every preset; text styles treat text, separators and outlines', () => {
  // Each filled text cell is "fg bg text"; treated cells reach 4.5:1 or never read worse than untreated.
  const pairs = (ansi: string) => new Map([...ansi.matchAll(/\u001B\[38;2;(\d+);(\d+);(\d+)m\u001B\[48;2;(\d+);(\d+);(\d+)m( [^\u001B]+)/gu)]
    .map(match => [match[7]!, contrastRatio({red: +match[1]!, green: +match[2]!, blue: +match[3]!}, {red: +match[4]!, green: +match[5]!, blue: +match[6]!})]));
  for (const style of ['powerline', 'soft', 'compact'] as const) {
    const plain = pairs(line(config(style)));
    for (const preset of TREATMENT_PRESETS.filter(preset => preset !== 'off')) {
      for (const [text, ratio] of pairs(line(config(style, {preset, scope: 'prompt', intensity: 0.9, customStops: ['#ffffff', '#000000']})))) {
        assert.ok(ratio >= 4.5 || ratio >= (plain.get(text) ?? 4.5) - 0.01, `${style} ${preset} '${text}' ${ratio.toFixed(2)}`);
      }
    }
  }
  for (const style of ['minimal', 'outline'] as const) {
    const off = colors(line(config(style)), FG);
    const on = colors(line(config(style, {preset: 'rainbow', scope: 'prompt'})), FG);
    assert.ok(new Set(on.map(color => JSON.stringify(color))).size > new Set(off.map(color => JSON.stringify(color))).size + 4, `${style} per-cell gradient`);
    for (const color of on) assert.ok(toOklch(color).l >= 0.6, `${style} treated text stays readable on a dark terminal`);
  }
  const outline = line(config('outline', {preset: 'rainbow', scope: 'prompt'}));
  assert.match(outline, /\u001B\[38;2;[\d;]+m/u, 'Outline caps take a treated color');
});

test('color capability degradation stays coherent at 256, 16 and no color', () => {
  const value = config('powerline', {preset: 'aurora', scope: 'prompt'});
  for (const [level, pattern] of [['256', /\u001B\[(?:38|48);5;\d+m/u], ['16', /\u001B\[(?:3|4|9|10)\dm/u]] as const) {
    process.env.NMSH_COLOR = level;
    try {
      const ansi = line(value);
      assert.match(ansi, pattern, level);
      assert.doesNotMatch(ansi, /;2;\d+;\d+;\d+m/u, `${level}: no truecolor escapes`);
      assert.equal(stripAnsi(ansi), stripAnsi(line(config('powerline'))));
    } finally { delete process.env.NMSH_COLOR; }
  }
  process.env.NO_COLOR = '1';
  try { assert.doesNotMatch(line(value), /\u001B\[[34]8;/u); } finally { delete process.env.NO_COLOR; }
});

test('motion: speed, ramp and direction change sampling; Reduced Motion and Effects Off hold a stable static treatment', () => {
  const base = {red: 90, green: 90, blue: 120};
  const sample = (settings: Partial<TreatmentSettings>, time: number, position = 0.3) =>
    samplePromptTreatment(treatmentFor({...DEFAULT_TREATMENT_SETTINGS, preset: 'rainbow', ...settings})!, base, position, time, false);
  const at = (settings: Partial<TreatmentSettings>) => [0, 700, 1400, 2100].map(time => JSON.stringify(sample(settings, time)));
  assert.notDeepEqual(at({motion: 'travel'}), at({motion: 'travel', speed: 'fast'}), 'speed');
  assert.notDeepEqual(at({motion: 'travel'}), at({motion: 'travel', curve: 'ease-in-out'}), 'ramp');
  assert.notDeepEqual(at({motion: 'travel'}), at({motion: 'travel', direction: 'reverse'}), 'direction');
  for (const motion of ['travel', 'breathe', 'comet', 'pulse'] as const) {
    assert.ok(new Set(at({motion})).size > 1, `${motion} animates`);
    const still = samplePromptTreatment(treatmentFor({...DEFAULT_TREATMENT_SETTINGS, preset: 'rainbow', motion})!, base, 0.3, 1234, true);
    assert.deepEqual(still, samplePromptTreatment(treatmentFor({...DEFAULT_TREATMENT_SETTINGS, preset: 'rainbow'})!, base, 0.3, 0, true));
  }
  for (const guard of [{reducedMotion: true}, {effectsOff: true}]) {
    const value = config('minimal', {preset: 'rainbow', motion: 'travel', ...guard});
    assert.equal(promptChroma(value, 5000)?.still, true);
    assert.equal(line(value, 0), line(value, 2500), 'no movement');
  }
  const moving = config('minimal', {preset: 'rainbow', motion: 'travel', scope: 'prompt'});
  assert.notEqual(line(moving, 0), line(moving, 2500), 'the live prompt animates over time');
  assert.equal(stripAnsi(line(moving, 0)), stripAnsi(line(moving, 2500)));
});

test('custom gradient editor: add, remove, edit, reorder, validate, reset; bounds 2–8; values are hex only', () => {
  assert.equal(parseStopInput('A67CF3'), '#a67cf3');
  assert.equal(parseStopInput('#12345'), undefined);
  assert.equal(parseStopInput('red'), undefined);
  const saved = normalizePromptConfiguration({presentation: {preset: 'custom', customStops: ['#111111', '#222222']}});
  const state: PromptPanelState = {onboarding: false, step: 'appearance', view: 'chroma', selectedIndex: 1, draft: structuredClone(saved), saved};
  openGradientEditor(state);
  const key = (kind: Key['kind'], value?: string) => handlePromptPanelKey((value === undefined ? {kind} : {kind, value}) as Key, state);
  key('text', 'd');
  assert.match(state.gradient!.error!, /At least 2/u);
  key('text', 'a');
  assert.equal(state.gradient!.stops.length, 3);
  assert.equal(state.gradient!.editing, '#111111', 'a new stop opens for editing');
  for (let index = 0; index < 7; index += 1) key('backspace');
  key('text', 'zz');
  assert.equal(state.gradient!.editing, '', 'non-hex keys are ignored');
  key('text', '#ff00');
  key('enter');
  assert.match(state.gradient!.error!, /hex color/u, 'invalid hex is refused');
  key('text', '88');
  key('enter');
  assert.deepEqual(state.gradient!.stops, ['#111111', '#ff0088', '#222222']);
  key('selectUp');
  assert.deepEqual(state.gradient!.stops, ['#ff0088', '#111111', '#222222']);
  for (let index = 0; index < 5; index += 1) { key('text', 'a'); key('enter'); }
  assert.equal(state.gradient!.stops.length, 8);
  key('text', 'a');
  assert.match(state.gradient!.error!, /At most 8/u);
  assert.equal(state.gradient!.stops.length, 8);
  key('text', 'r');
  assert.deepEqual(state.gradient!.stops, ['#111111', '#222222'], 'reset to the saved stops');
  key('text', 'a'); key('enter');
  closeGradientEditor(state);
  assert.equal(state.step, 'appearance');
  assert.equal(state.draft.presentation.preset, 'custom');
  assert.equal(state.draft.presentation.customStops.length, 3);
  assert.deepEqual(saved.presentation.customStops, ['#111111', '#222222'], 'saved config untouched until Enter saves');
});

function panelApp() {
  const app = new TerminalApp();
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 120, rows: 60})});
  Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
  const frames: string[][] = [];
  app['renderer'].render = ((frame: {rows: string[]}) => { frames.push(frame.rows); }) as never;
  app['session'].resize = (() => {}) as never;
  app['session'].write = (() => {}) as never;
  return {app, frames};
}

test('/chroma opens the same Chroma view as /prompt; previews are the real renderer for current and showcase prompts', async () => {
  const {app, frames} = panelApp();
  try {
    app['configuration'].presentation = normalizeTreatmentSettings({preset: 'aurora', scope: 'prompt'});
    await app['runSlash']('/chroma', {kind: 'chroma'});
    const state = app['promptPanelState']!;
    assert.equal(state.view, 'chroma');
    assert.equal(state.step, 'appearance');
    const rows = frames.at(-1)!.map(stripAnsi);
    assert.ok(rows.some(row => row.includes('Palette') && row.includes('Aurora')));
    assert.ok(rows.some(row => row.trim().startsWith('Current')));
    assert.ok(rows.some(row => row.trim().startsWith('Showcase')));
    assert.ok(rows.some(row => row.includes('Black Hole')), 'palette gallery');
    const preview = app['chromaPanelPreview'](120, 0);
    const showcase = structuredClone(state.draft);
    showcase.modules = showcase.modules.map(module => ({...module, visible: true}));
    assert.ok(preview[1]!.includes(buildContextLine(moduleShowcaseContext(), 104, showcase, 'composer', 0)), 'showcase is the real renderer');
    assert.ok(preview[0]!.includes(buildContextLine(app['promptContext'](), 104, state.draft, 'composer', 0)), 'current prompt is the real renderer');
  } finally { app['stop'](0); app['session'].kill(); }
});

test('animated previews tick through the shared clock only while visible and animated; static adds zero wakeups', async () => {
  const {app} = panelApp();
  const before = presentationClock.subscriberCount;
  try {
    // Shimmer is its own one-shot effect (tested in lightSweep.test.ts); this test is about Chroma preview ticks.
    app['configuration'].presentation = normalizeTreatmentSettings({preset: 'aurora', shimmer: 'off'});
    await app['runSlash']('/chroma', {kind: 'chroma'});
    assert.equal(presentationClock.subscriberCount, before, 'static Chroma: no subscription');
    app['promptPanelState']!.draft.presentation.motion = 'travel';
    app['render']();
    assert.equal(presentationClock.subscriberCount, before + 1, 'animated preview subscribes once');
    app['render']();
    assert.equal(presentationClock.subscriberCount, before + 1, 'no duplicate subscriptions');
    app['promptPanelState']!.draft.presentation.reducedMotion = true;
    app['render']();
    assert.equal(presentationClock.subscriberCount, before, 'Reduced Motion stops ticking');
    app['promptPanelState']!.draft.presentation.reducedMotion = false;
    app['render']();
    app['promptPanelState'] = undefined;
    app['render']();
    assert.equal(presentationClock.subscriberCount, before, 'closing the panel unsubscribes');
  } finally { app['stop'](0); app['session'].kill(); }
  assert.equal(presentationClock.subscriberCount, before);
});
