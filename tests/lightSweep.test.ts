import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {sweepAnsiRow, sweepCells, sweepColor, sweepCrest, sweepCycleMs, sweepDurationMs, sweepEnvelope, sweepAnimates, sweepOnce, type SweepCell, type SweepStyle} from '../src/motion/lightSweep.js';
import {sweepStyleFor, sweepStill} from '../src/motion/sweepStyle.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {toOklch} from '../src/chroma/color.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';

const BLUE = {red: 0x2f, green: 0x8f, blue: 0xd8};
const GREEN = {red: 0x4f, green: 0xae, blue: 0x5a};
const RED = {red: 0xcd, green: 0x5c, blue: 0x64};
const VIOLET = {red: 0x8f, green: 0x6c, blue: 0xf5};
const style = (patch: Partial<SweepStyle> = {}): SweepStyle => ({level: 'vivid', speed: 'normal', semantic: 'override', grayscale: false, tint: () => VIOLET, ...patch});
const cells = (text: string, color = BLUE): SweepCell[] => [...text].map(glyph => ({glyph, color: glyph === ' ' ? undefined : color}));
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const fgColors = (ansi: string) => [...ansi.matchAll(/\u001B\[38;2;(\d+);(\d+);(\d+)m/gu)].map(match => `${match[1]},${match[2]},${match[3]}`);

test('glyphs and widths never change; only foreground color does', () => {
  const text = 'Working on it… 世界 ✔';
  for (let time = 0; time <= 6000; time += 137) {
    const out = sweepCells(cells(text), time, style(), 'truecolor');
    assert.equal(stripAnsi(out), text);
    assert.equal(displayWidth(out), displayWidth(text));
    assert.doesNotMatch(out, /\u001B\[(?:48;|[0-9]*[ABCDHJK])/u, 'no backgrounds or cursor movement');
  }
});

test('the wave travels: the crest advances over time and only nearby cells light up', () => {
  const width = 30;
  assert.ok(sweepCrest(width, 1000, 'normal') > sweepCrest(width, 500, 'normal'));
  assert.ok(sweepCrest(width, 500, 'fast') > sweepCrest(width, 500, 'slow'));
  const crest = 10;
  assert.equal(sweepEnvelope(10, crest), 1);
  assert.ok(sweepEnvelope(11, crest) < 1 && sweepEnvelope(11, crest) > sweepEnvelope(13, crest), 'smooth falloff, neighbours phase-offset');
  assert.equal(sweepEnvelope(30, crest), 0, 'far cells exactly untouched');
  // The brightest cell is the crest; it moves right as time advances.
  const brightest = (time: number) => {
    const sums = fgColors(sweepCells(cells('x'.repeat(width)), time, style(), 'truecolor')).map(color => color.split(',').reduce((sum, part) => sum + Number(part), 0));
    return sums.indexOf(Math.max(...sums));
  };
  const early = brightest(900), later = brightest(1400);
  assert.ok(later > early, `band moves right (${early} → ${later})`);
});

test('after the band passes, the exact base colors return', () => {
  const row = cells('a'.repeat(20));
  const base = sweepCells(row, 0, style({level: 'off'}), 'truecolor');
  const cycle = sweepCycleMs(20, 'normal');
  // The quiet stretch at the end of each cycle is the untouched base presentation.
  assert.equal(sweepCells(row, cycle - 50, style(), 'truecolor'), base);
  assert.equal(sweepColor(BLUE, 0, 0.5, style()), BLUE, 'zero envelope returns the base object itself');
});

test('differently colored cells keep distinct hue identity under the band', () => {
  for (const level of ['subtle', 'vivid'] as const) {
    const blue = toOklch(sweepColor(BLUE, 1, 0.5, style({level, tint: undefined})));
    const green = toOklch(sweepColor(GREEN, 1, 0.5, style({level, tint: undefined})));
    assert.ok(hueGap(blue.h, toOklch(BLUE).h) < 12 && hueGap(green.h, toOklch(GREEN).h) < 12, `${level}: hues kept`);
    assert.ok(blue.l > toOklch(BLUE).l + 0.08, `${level}: brighter`);
    assert.ok(hueGap(blue.h, green.h) > 60, `${level}: still told apart`);
  }
});

test('Full Chroma tints the band; Semantic Preserve keeps semantic hues, Override lets them participate', () => {
  const chroma = sweepColor(BLUE, 1, 0.5, style());
  const plain = sweepColor(BLUE, 1, 0.5, style({tint: undefined}));
  assert.ok(hueGap(toOklch(chroma).h, toOklch(VIOLET).h) < hueGap(toOklch(plain).h, toOklch(VIOLET).h), 'Chroma pulls the band toward the gradient');
  const preserved = toOklch(sweepColor(RED, 1, 0.5, style({semantic: 'preserve'}), true));
  const overridden = toOklch(sweepColor(RED, 1, 0.5, style({semantic: 'override'}), true));
  assert.ok(hueGap(preserved.h, toOklch(RED).h) < 10, 'Preserve: failure stays red');
  assert.ok(hueGap(overridden.h, toOklch(RED).h) > hueGap(preserved.h, toOklch(RED).h) + 5, 'Override: Chroma participates');
  // From configuration: Full Chroma (Aurora) tints with its gradient; Chroma off uses a hint of the accent.
  const full = sweepStyleFor(normalizePromptConfiguration({presentation: {preset: 'aurora'}}));
  assert.notDeepEqual(full.tint!(0), full.tint!(1), 'the gradient varies along the text');
  assert.equal(full.semantic, 'override');
  const accent = sweepStyleFor(normalizePromptConfiguration({}));
  assert.deepEqual(accent.tint!(0), accent.tint!(1), 'a single accent hint without Chroma');
});

test('Grayscale chrome: luminance only, never a colored fringe', () => {
  const gray = sweepStyleFor(normalizePromptConfiguration({uiChrome: {source: 'custom', preset: 'grayscale'}, presentation: {preset: 'rainbow'}}));
  assert.equal(gray.grayscale, true);
  assert.equal(gray.tint, undefined);
  for (const value of [40, 90, 160]) {
    const lifted = toOklch(sweepColor({red: value, green: value, blue: value}, 1, 0.5, gray));
    assert.ok(lifted.c < 0.01, `gray ${value} stays gray`);
    assert.ok(lifted.l > toOklch({red: value, green: value, blue: value}).l, 'and gets lighter');
  }
  assert.ok(toOklch(sweepColor(BLUE, 1, 0.5, gray)).c <= toOklch(BLUE).c + 0.001, 'no added colorfulness');
});

test('Decorative effects Off and Shimmer Off suppress it; Reduced Motion has no traveling wave; NO_COLOR stays plain', () => {
  const off = sweepStyleFor(normalizePromptConfiguration({presentation: {effectsOff: true, shimmer: 'on'}}));
  assert.equal(sweepStyleFor(normalizePromptConfiguration({presentation: {shimmer: 'off'}})).level, 'off', 'Shimmer Off');
  assert.equal(off.level, 'off');
  const row = cells('abcdefghij');
  const base = sweepCells(row, 0, style({level: 'off'}), 'truecolor');
  for (const time of [100, 400, 700]) {
    assert.equal(sweepCells(row, time, off, 'truecolor'), base);
    assert.equal(sweepCells(row, time, style(), 'truecolor', true), base, 'still');
  }
  assert.equal(sweepStill(normalizePromptConfiguration({presentation: {reducedMotion: true}}), {}), true);
  assert.equal(sweepCells(row, 300, style(), 'none'), 'abcdefghij');
  assert.equal(sweepAnimates('subtle', false, 'none'), false);
  assert.equal(sweepAnimates('off', false, 'truecolor'), false);
  assert.ok(sweepCells(row, 300, style(), 'ansi256').match(/38;5;/u), '256-color quantized');
  const setting = SETTINGS_ROWS.find(item => item.id === 'shimmer');
  assert.ok(setting && setting.control === 'enum' && setting.options.join('/') === 'On/Off', 'one simple On/Off setting');
  assert.equal(normalizePromptConfiguration({}).presentation.shimmer, 'on');
});

test('one sweep across a multicolored line: T0 base, leading edge, first third, middle, end, then exact base again', () => {
  const colors = [BLUE, GREEN, VIOLET, RED];
  const row: SweepCell[] = [...'abcdefghijklmnopqrstuvwx'].map((glyph, index) => ({glyph, color: colors[Math.floor(index / 6)]}));
  const width = row.length;
  const duration = sweepDurationMs(width);
  const base = sweepOnce(row, 0, style({level: 'off'}), 'truecolor');
  const brightest = (ansi: string) => {
    const sums = fgColors(ansi).map((color, index) => {
      const [r, g, b] = color.split(',').map(Number);
      const own = colors[Math.floor(index / 6)]!;
      return (r! - own.red) + (g! - own.green) + (b! - own.blue);
    });
    return sums.indexOf(Math.max(...sums));
  };
  assert.equal(sweepOnce(row, 0, style(), 'truecolor'), base, 'T0: not entered');
  const lead = sweepOnce(row, duration * 0.22, style(), 'truecolor');
  assert.notEqual(lead, base, 'T1: a faint leading edge');
  assert.ok(brightest(lead) <= 2, 'T1: only the first cells');
  const third = brightest(sweepOnce(row, duration * 0.38, style(), 'truecolor'));
  const middle = brightest(sweepOnce(row, duration * 0.5, style(), 'truecolor'));
  const end = brightest(sweepOnce(row, duration * 0.72, style(), 'truecolor'));
  assert.ok(third < middle && middle < end, `T2..T4: the core travels left to right (${third}, ${middle}, ${end})`);
  assert.ok(Math.abs(middle - width / 2) <= 3, 'T3: near the middle');
  assert.equal(sweepOnce(row, duration + 1, style(), 'truecolor'), base, 'T5: gone, exact base colors');
  for (const time of [0, duration * 0.3, duration * 0.6, duration]) assert.equal(stripAnsi(sweepOnce(row, time, style(), 'truecolor')), 'abcdefghijklmnopqrstuvwx');
});

test('sweeping an already-rendered row keeps text, positions, backgrounds and bold; only foreground changes', () => {
  const row = `  \u001B[38;2;197;185;232m› \u001B[1m\u001B[38;2;242;240;236mComposer position\u001B[0m  \u001B[48;2;88;96;145m\u001B[38;2;197;185;232mBottom\u001B[0m`;
  const width = displayWidth(row);
  for (let time = 0; time <= 1200; time += 100) {
    const swept = sweepAnsiRow(row, time, style(), 'truecolor', {from: 4, to: width});
    assert.equal(stripAnsi(swept), stripAnsi(row));
    assert.equal(displayWidth(swept), width);
    assert.equal((swept.match(/\u001B\[48;2;88;96;145m/gu) ?? []).length, 1, 'background kept');
    assert.ok(swept.includes('\u001B[1m'), 'bold kept');
  }
  assert.notEqual(sweepAnsiRow(row, 500, style(), 'truecolor', {from: 4, to: width}), row, 'mid-sweep differs');
  assert.equal(sweepAnsiRow(row, 5000, style(), 'truecolor', {from: 4, to: width}), row, 'after the sweep: byte-identical');
  assert.equal(sweepAnsiRow(row, 500, style(), 'none'), row, 'NO_COLOR untouched');
});

function setupApp(config: object = {}): {app: TerminalApp; cleanup: () => void} {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  app['renderer'].render = () => {};
  app['fetchSuggestions'] = async () => {};
  app['presentationStarted'] = true;
  app['configuration'] = normalizePromptConfiguration(config);
  return {app, cleanup: () => { app['stop'](0); app['session'].kill(); isolation.restore(); }};
}

test('app: event-driven; a new selection or value starts one sweep, rapid moves replace it, and it ends with no timer left', () => {
  const {app, cleanup} = setupApp();
  try {
    app['openSettingsPanel']('config');
    app['render']();
    assert.ok(app['sweep'], 'opening a panel selects a row: one sweep');
    assert.ok(app['sweepTimer']);
    const first = app['sweep'];
    for (let i = 0; i < 6; i++) app['handleKey']({kind: 'down'});
    app['render']();
    assert.notEqual(app['sweep'], first, 'the newest selection replaces the old sweep');
    const subscribers = app['sweepTimer'];
    assert.equal(app['sweepTimer'], subscribers, 'still exactly one timer, no backlog');
    app['render']();
    const same = app['sweep'];
    app['render']();
    assert.equal(app['sweep'], same, 'leaving the selection sitting there starts nothing new');
    app['handleKey']({kind: 'right'});
    app['render']();
    assert.notEqual(app['sweep'], same, 'a changed value replays the sweep');
    app['sweep']!.startedAt = Date.now() - 10_000;
    app['endSweep']();
    assert.equal(app['sweepTimer'], undefined, 'no timer once it is done');
  } finally { cleanup(); }
});

test('app: Effects Off, Shimmer Off and Reduced Motion start no sweep and no timer', () => {
  for (const presentation of [{effectsOff: true}, {shimmer: 'off'}, {reducedMotion: true}]) {
    const {app, cleanup} = setupApp({presentation});
    try {
      app['openSettingsPanel']('config');
      app['render']();
      app['handleKey']({kind: 'down'});
      app['render']();
      assert.equal(app['sweep'], undefined, JSON.stringify(presentation));
      assert.equal(app['sweepTimer'], undefined);
    } finally { cleanup(); }
  }
});

test('app: submitting sweeps the prompt row once; the transcript record never carries shimmer', async () => {
  const {app, cleanup} = setupApp();
  try {
    app['startupPending'] = false;
    app['session'].submit = () => {};
    app['editor'].insert('echo hi');
    await app['submit']();
    assert.equal(app['sweep']?.target, 'prompt');
    assert.equal(app['sweep']?.strength, 'vivid');
    const transcript = JSON.stringify(app['output'].transcript());
    assert.ok(!/38;2;/u.test(JSON.stringify(app['output'].view().completed.map((record: {command: string}) => record.command))), 'command text untouched');
    assert.ok(transcript.length > 0);
  } finally { cleanup(); }
});

test('app: Setup Cat title takes the pass when the step changes and rests otherwise', () => {
  const {app, cleanup} = setupApp();
  try {
    app['startSetup']();
    app['render']();
    const state = app['setupState']!;
    assert.equal(stripAnsi(app['setupTitle'](state)), 'Setup Cat');
    app['handleKey']({kind: 'complete'});
    app['render']();
    assert.equal(app['sweep']?.titled, true, 'a new step: the title sweeps');
    app['endSweep']();
    const resting = app['setupTitle'](state);
    assert.equal(resting, app['setupTitle'](state), 'stable when no sweep runs');
  } finally { cleanup(); }
});
