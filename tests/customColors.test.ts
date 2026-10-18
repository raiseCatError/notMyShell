import test from 'node:test';
import assert from 'node:assert/strict';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {sectionIndex, setupKey, setupSelectedRow, type SetupState} from '../src/setup/SetupCat.js';
import {DEFAULT_CURSOR, normalizeCursor, type CursorSettings} from '../src/prompt/configuration.js';
import {effectPalette, hexToRgb} from '../src/cursor/palette.js';
import {CursorEngine, seededRandom} from '../src/cursor/CursorEngine.js';
import {COLOR_PRESET_IDS, COLOR_PRESET_LABELS, COLOR_PRESET_STOPS} from '../src/chroma/colorPresets.js';
import {gradientEditorControls, gradientEditorKey, renderGradientEditorRows} from '../src/ui/GradientEditor.js';
import {stripAnsi} from '../src/util/text.js';

const cursor = (extra: Partial<CursorSettings> = {}): CursorSettings => ({...structuredClone(DEFAULT_CURSOR), ...extra});
const goTo = (state: SetupState, section: string, row: string) => {
  state.section = sectionIndex(section);
  state.row = 0;
  for (let guard = 0; guard < 80 && setupSelectedRow(state)?.row.id !== row; guard += 1) setupKey(state, {kind: 'down'});
  assert.equal(setupSelectedRow(state)?.row.id, row, `reached ${row}`);
};

test('cursor idle colors: Follow cursor effect is the default and changes nothing; theme, presets and Custom give it its own', () => {
  assert.deepEqual(normalizeCursor({}).idleColors, {source: 'effect', colors: []});
  // A saved legacy particle gradient (and no idle colors) still colors the idle effect, as before.
  const legacy = normalizeCursor({effect: 'fire', idleEffect: 'flame', particles: {source: 'gradient', colors: ['#112233', '#445566']}});
  assert.equal(legacy.idleColors.source, 'effect');
  assert.equal(effectPalette(legacy).idle, undefined, 'follows the movement effect');
  assert.deepEqual(effectPalette(legacy).particles, [hexToRgb('#112233'), hexToRgb('#445566')]);
  assert.equal(normalizeCursor({idleColors: {source: 'bogus'}}).idleColors.source, 'effect');
  assert.deepEqual(normalizeCursor({idleColors: {source: 'custom', colors: ['#ff0000', 'nope', '#00ff00']}}).idleColors.colors, ['#ff0000', '#00ff00']);
  for (const id of COLOR_PRESET_IDS) assert.deepEqual(effectPalette(cursor({idleEffect: 'embers', idleColors: {source: id, colors: []}})).idle, COLOR_PRESET_STOPS[id].map(hexToRgb), id);
  assert.equal(effectPalette(cursor({idleEffect: 'glow', idleColors: {source: 'theme', colors: []}})).idle?.length, 4);
  assert.deepEqual(effectPalette(cursor({idleEffect: 'glow', idleColors: {source: 'custom', colors: ['#ff0000', '#00ff00']}})).idle, [hexToRgb('#ff0000'), hexToRgb('#00ff00')]);
  assert.deepEqual(Object.values(COLOR_PRESET_LABELS), ['Lavender', 'Purple', 'Blue', 'Cyan', 'Teal', 'Green', 'Amber', 'Orange', 'Rose', 'White']);
});

test('the idle effect paints with its own colors, and the movement effect keeps its own', () => {
  const settings = cursor({effect: 'sparks', idleEffect: 'embers', idleColors: {source: 'green', colors: []}, particleAmount: 'high'});
  const palette = effectPalette(settings);
  const engine = new CursorEngine(settings, seededRandom(5));
  engine.target({row: 1, column: 4}, 0);
  const idle = new Set(palette.idle!.map(color => JSON.stringify(color)));
  const seen: string[] = [];
  for (let now = 16; now < 20_000 && !seen.length; now += 16) {
    engine.step(now);
    for (const line of engine.paints(palette, {top: 0, bottom: 3, columns: 40}, now).values()) for (const paint of line.values()) if (paint.foreground) seen.push(JSON.stringify(paint.foreground));
  }
  assert.ok(seen.length, 'the resting caret shed embers');
  // Gradient positions blend stops, so check the hue family: green dominates every ember.
  assert.ok(seen.every(color => { const {red, green, blue} = JSON.parse(color) as {red: number; green: number; blue: number}; return green >= red && green >= blue; }), `green embers: ${seen.slice(0, 3)}`);
  assert.ok(idle.size === 4);
});

test('the shared gradient editor: presets with P, the preset name, a live preview bar and the hex of every stop', () => {
  const gradient = {stops: ['#123456', '#abcdef'], index: 0};
  let rows = renderGradientEditorRows(gradient, 'Idle effect gradient').map(stripAnsi);
  assert.match(rows[1]!, /Preset\s+Custom\s+P changes it/u);
  assert.ok(rows[2]!.trim().length === 24, 'a 24-cell preview bar');
  assert.ok(rows.some(row => row.includes('#123456')) && rows.some(row => row.includes('#abcdef')), 'the current hex of each stop');
  assert.ok(gradientEditorKey(gradient, {kind: 'text', value: 'p'}, () => []));
  assert.deepEqual(gradient.stops, [...COLOR_PRESET_STOPS.lavender]);
  gradientEditorKey(gradient, {kind: 'text', value: 'p'}, () => []);
  assert.deepEqual(gradient.stops, [...COLOR_PRESET_STOPS.purple]);
  gradientEditorKey(gradient, {kind: 'text', value: 'P'}, () => []);
  gradientEditorKey(gradient, {kind: 'text', value: 'P'}, () => []);
  assert.deepEqual(gradient.stops, [...COLOR_PRESET_STOPS.white], 'Shift+P goes back, wrapping');
  rows = renderGradientEditorRows(gradient, 'x').map(stripAnsi);
  assert.match(rows[1]!, /Preset\s+White/u);
  // Hex typed from the keyboard.
  gradientEditorKey(gradient, {kind: 'enter'}, () => []);
  for (let i = 0; i < 7; i++) gradientEditorKey(gradient, {kind: 'backspace'}, () => []);
  gradientEditorKey(gradient, {kind: 'text', value: '#00ff88'}, () => []);
  gradientEditorKey(gradient, {kind: 'enter'}, () => []);
  assert.equal(gradient.stops[0], '#00ff88');
  assert.deepEqual(gradientEditorControls(gradient, true).slice(-2), [['S', 'apply'], ['Esc', 'cancel']]);
});

test('Setup → Cursor: choosing Custom idle colors opens the editor at once; Esc cancels back to the row, S applies to the draft only', () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    app['startSetup']('cursor');
    const state = app['setupState']!;
    state.draft = {...state.draft, cursor: {...state.draft.cursor, idleEffect: 'embers'}};
    goTo(state, 'cursor', 'cursorIdleColor');
    const saved = JSON.stringify(app['promptConfiguration'].cursor);
    const row = state.row;
    app['handleKey']({kind: 'enter'}); // the option chooser
    assert.ok(state.chooser, 'the options open');
    for (let guard = 0; guard < 20 && state.draft.cursor.idleColors.source !== 'custom'; guard++) app['handleKey']({kind: 'down'});
    assert.equal(state.draft.cursor.idleColors.source, 'custom');
    app['handleKey']({kind: 'enter'});
    assert.ok(state.cursorPanel?.gradient, 'Custom opened its gradient editor directly');
    assert.equal(state.cursorPanel!.gradient!.target, 'idle');
    app['handleKey']({kind: 'text', value: 'p'});
    app['handleKey']({kind: 'escape'});
    assert.equal(state.cursorPanel, undefined, 'Esc cancels and comes straight back to Setup');
    assert.equal(state.row, row, 'on the same row');
    assert.deepEqual(state.draft.cursor.idleColors.colors, [...COLOR_PRESET_STOPS.lavender], 'the cancelled preset did not land');
    // Again, and apply with S: the draft changes, the saved configuration does not.
    goTo(state, 'cursor', 'cursorIdleCustom');
    app['handleKey']({kind: 'enter'});
    assert.ok(state.cursorPanel?.gradient, 'Edit idle effect colors opens the same editor');
    app['handleKey']({kind: 'text', value: 'p'}); app['handleKey']({kind: 'text', value: 'p'});
    app['handleKey']({kind: 'text', value: 's'});
    assert.equal(state.cursorPanel, undefined);
    assert.deepEqual(state.draft.cursor.idleColors, {source: 'custom', colors: [...COLOR_PRESET_STOPS.blue]}, 'Lavender → Purple → Blue');
    assert.equal(JSON.stringify(app['promptConfiguration'].cursor), saved, 'nothing saved before Setup\'s Apply');
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});

test('Setup → Idle: Custom opens the stops editor over the draft; S lands in the draft, Esc keeps it as it was', () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    app['startSetup']('idle');
    const state = app['setupState']!;
    goTo(state, 'idle', 'idleTimeout');
    app['handleKey']({kind: 'right'}); // an unapplied change in the same group must survive the editor
    const timeout = state.draft.idleVisuals.timeout;
    goTo(state, 'idle', 'idleColor');
    app['handleKey']({kind: 'enter'});
    for (let guard = 0; guard < 10 && state.draft.idleVisuals.colorSource !== 'custom'; guard++) app['handleKey']({kind: 'down'});
    const saved = JSON.stringify(app['promptConfiguration'].idleVisuals);
    app['handleKey']({kind: 'enter'});
    assert.ok(app['stopsEditor'], 'the stops editor opens at once');
    app['handleKey']({kind: 'text', value: 'p'}); app['handleKey']({kind: 'text', value: 'p'}); app['handleKey']({kind: 'text', value: 'p'}); // Blue
    app['handleKey']({kind: 'text', value: 's'});
    assert.equal(app['stopsEditor'], undefined);
    assert.equal(app['setupState'], state, 'back in the same Setup');
    assert.deepEqual(state.draft.idleVisuals.customStops, [...COLOR_PRESET_STOPS.blue]);
    assert.equal(state.draft.idleVisuals.colorSource, 'custom');
    assert.equal(state.draft.idleVisuals.timeout, timeout, 'the other unapplied idle edit survived');
    assert.equal(JSON.stringify(app['promptConfiguration'].idleVisuals), saved, 'nothing saved before Apply');
    goTo(state, 'idle', 'setupIdleColors');
    app['handleKey']({kind: 'enter'});
    assert.ok(app['stopsEditor']);
    assert.deepEqual(app['stopsEditor'].gradient.stops, [...COLOR_PRESET_STOPS.blue], 'it starts from the draft, not the saved stops');
    app['handleKey']({kind: 'text', value: 'p'});
    app['handleKey']({kind: 'escape'});
    assert.deepEqual(state.draft.idleVisuals.customStops, [...COLOR_PRESET_STOPS.blue], 'Esc cancelled the change');
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});

test('Settings: Enter landing on Custom opens its editor, Esc cancels back to the same row; /cursor from Settings returns to Settings', () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    app['promptConfiguration'].cursor.idleEffect = 'glow';
    app['focusConfigRow']('cursorIdleColor');
    const settings = app['settingsPanelState']!;
    assert.ok(settings, 'Settings is open on the row');
    const before = JSON.stringify(app['promptConfiguration'].cursor.idleColors.colors);
    for (let guard = 0; guard < 20 && !app['cursorPanel']; guard++) app['handleKey']({kind: 'enter'});
    assert.equal(app['promptConfiguration'].cursor.idleColors.source, 'custom', 'Enter cycled to Custom');
    assert.ok(app['cursorPanel']?.gradient, 'and the editor opened at once');
    app['handleKey']({kind: 'text', value: 'p'});
    app['handleKey']({kind: 'escape'});
    assert.equal(app['cursorPanel'], undefined);
    assert.ok(app['settingsPanelState'], 'back in Settings, not the composer');
    // Custom started from the preset before it (White); the preset tried in the editor was cancelled.
    assert.deepEqual(app['promptConfiguration'].cursor.idleColors.colors, [...COLOR_PRESET_STOPS.white]);
    assert.equal(before, '[]');
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});
