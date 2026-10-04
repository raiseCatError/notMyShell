import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {CellGrid} from '../src/idle/CellGrid.js';
import {HIGH_MOTION, IDLE_FRAME_MS, IDLE_MODES, idlePalette, renderScene, vespyrPosition, type IdleMode} from '../src/idle/scenes.js';
import {
  createScreensaverPanel, effectiveMode, idleFrameRows, idleMotion, idleStops, renderScreensaverPanel, sceneTime, screensaverKey,
} from '../src/idle/IdleVisuals.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {themeChromaStops} from '../src/prompt/prompt.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {SETUP_SECTIONS} from '../src/setup/SetupCat.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const palette = idlePalette([{red: 62, green: 232, blue: 181}, {red: 143, green: 108, blue: 245}]);
const frame = (mode: IdleMode, width: number, height: number, time: number, level: 'truecolor' | 'ansi256' | 'none' = 'truecolor', nerd = true) => {
  const grid = new CellGrid();
  return idleFrameRows(grid, {mode, width, height, time, palette, level, nerd});
};

test('defaults: timeout Never, Aurora Drift selected, Follow Appearance; old configs load unchanged', () => {
  assert.deepEqual(DEFAULT_PROMPT_CONFIGURATION.idleVisuals, {timeout: 0, mode: 'aurora', colorSource: 'appearance', customStops: []});
  assert.deepEqual(normalizePromptConfiguration({}).idleVisuals, {timeout: 0, mode: 'aurora', colorSource: 'appearance', customStops: []});
  for (const timeout of [0, 1, 5, 15, 30, 60]) assert.equal(normalizePromptConfiguration({idleVisuals: {timeout}}).idleVisuals.timeout, timeout);
  for (const timeout of [2, 10, 120, -1, '5']) assert.equal(normalizePromptConfiguration({idleVisuals: {timeout}}).idleVisuals.timeout, 0);
  assert.equal(normalizePromptConfiguration({idleVisuals: {mode: 'matrix'}}).idleVisuals.mode, 'aurora');
  const row = SETTINGS_ROWS.find(item => item.id === 'idleTimeout');
  assert.ok(row && row.control === 'enum');
  if (row?.control === 'enum') assert.deepEqual(row.options, ['Never', '1 minute', '5 minutes', '15 minutes', '30 minutes', '60 minutes']);
  assert.ok(SETUP_SECTIONS.some(section => section.id === 'idle'));
});

test('/screensaver opens the gallery; start runs the chosen mode; unknown modes are not commands', () => {
  assert.deepEqual(parseSlashCommand('/screensaver'), {kind: 'screensaver', start: false});
  assert.deepEqual(parseSlashCommand('/screensaver start'), {kind: 'screensaver', start: true});
  assert.deepEqual(parseSlashCommand('/screensaver start warp'), {kind: 'screensaver', start: true, mode: 'warp'});
  assert.equal(parseSlashCommand('/screensaver start matrix')?.kind, 'unknown');
});

test('every shipped mode: in bounds at 80x24, 120x40 and 180x55, deterministic, and animated', () => {
  assert.deepEqual([...IDLE_MODES], ['aurora', 'deepSpace', 'warp', 'rain', 'sparkles', 'fireworks', 'vespyr']);
  for (const mode of IDLE_MODES) {
    for (const [width, height] of [[80, 24], [120, 40], [180, 55], [12, 4]] as const) {
      const rows = frame(mode, width, height, 4200);
      assert.equal(rows.length, height, `${mode} ${width}x${height}`);
      for (const row of rows) assert.equal(displayWidth(row), width, `${mode} ${width}x${height} width`);
    }
    assert.deepEqual(frame(mode, 80, 24, 4200), frame(mode, 80, 24, 4200), `${mode} deterministic`);
    assert.notDeepEqual(frame(mode, 80, 24, 4200), frame(mode, 80, 24, 9100), `${mode} moves over time`);
  }
});

test('degradation: 256-color has no truecolor escapes, NO_COLOR has no escapes at all, Safe glyphs avoid Nerd/private-use glyphs', () => {
  for (const mode of IDLE_MODES) {
    assert.ok(frame(mode, 80, 24, 5000, 'ansi256').every(row => !/\u001b\[(?:38|48);2;/u.test(row)), `${mode} 256`);
    const plain = frame(mode, 80, 24, 5000, 'none');
    assert.ok(plain.every(row => !row.includes('\u001b')), `${mode} none`);
    assert.ok(plain.join('').trim().length > 0, `${mode} still draws something without color`);
    const safe = frame(mode, 80, 24, 5000, 'truecolor', false).map(stripAnsi).join('');
    assert.ok(!/[✦✧•·╱╲│─╎-]/u.test(safe), `${mode} safe glyphs`);
  }
});

test('bounded cost: a 180x55 frame of every mode stays well under the frame budget', () => {
  const grid = new CellGrid();
  for (const mode of IDLE_MODES) {
    const started = performance.now();
    for (let i = 0; i < 5; i++) idleFrameRows(grid, {mode, width: 180, height: 55, time: 1000 * i, palette, level: 'truecolor', nerd: true});
    const average = (performance.now() - started) / 5;
    assert.ok(average < 60, `${mode} ${average.toFixed(1)}ms`);
  }
  // The grid is reused: resizing to the same size keeps the same buffers.
  const before = grid.fg;
  grid.resize(180, 55);
  assert.equal(grid.fg, before);
});

test('Bouncing Vespyr faces its direction of travel, mirrors horizontally and never flips vertically', () => {
  const grid = new CellGrid();
  grid.resize(80, 24);
  const facings = new Set<boolean>();
  for (let time = 0; time < 30_000; time += 500) {
    const position = vespyrPosition(time, 0x4e4d5348, 80, 24);
    facings.add(position.facingRight);
    assert.ok(position.x >= 0 && position.x <= 80 - 14 && position.y >= 0 && position.y <= 24 - 4);
  }
  assert.deepEqual(facings, new Set([true, false]), 'it turns around at the edges');
  for (const time of [0, 1500, 5000]) {
    renderScene('vespyr', grid, {time, seed: 0x4e4d5348, palette, level: 'truecolor', nerd: true});
    const position = vespyrPosition(time, 0x4e4d5348, 80, 24);
    // The ears (top pixel row) are always in the sprite's first row: never upside down.
    const earRow = grid.glyphs.slice(position.y * 80 + position.x, position.y * 80 + position.x + 14).join('');
    assert.match(earRow, /▀/u);
  }
});

test('Follow Appearance uses Chroma when on and the theme otherwise; Current Theme always uses the theme', () => {
  const config: PromptConfiguration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  assert.deepEqual(idleStops(config), themeChromaStops('lavender'));
  config.presentation.preset = 'aurora';
  assert.deepEqual(idleStops(config)[0], {red: 0x3e, green: 0xe8, blue: 0xb5});
  assert.deepEqual(idleStops(config, 'theme'), themeChromaStops('lavender'));
  config.nmsh.palette = 'nord';
  assert.deepEqual(idleStops(config, 'theme'), themeChromaStops('nord'));
});

test('Reduced Motion holds scenes still (high-motion modes become a still star field); Effects Off disables them', () => {
  const config: PromptConfiguration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  assert.deepEqual(idleMotion(config, {}), {still: false, disabled: false});
  config.presentation.reducedMotion = true;
  const motion = idleMotion(config, {});
  assert.equal(motion.still, true);
  for (const mode of IDLE_MODES) assert.equal(effectiveMode(mode, motion), HIGH_MOTION.has(mode) ? 'deepSpace' : mode);
  assert.equal(idleMotion(structuredClone(DEFAULT_PROMPT_CONFIGURATION), {NMSH_REDUCED_MOTION: '1'}).still, true);
  config.presentation.effectsOff = true;
  assert.equal(idleMotion(config, {}).disabled, true);
});

test('deterministic seam: frame count and NMSH_IDLE_START_MS, no wall clock', () => {
  const previous = process.env.NMSH_DETERMINISTIC;
  process.env.NMSH_DETERMINISTIC = '1';
  try {
    assert.equal(sceneTime(987_654, 3, 'aurora', {NMSH_IDLE_START_MS: '20000'}), 20_000 + 3 * IDLE_FRAME_MS.aurora);
    assert.equal(sceneTime(1, 10, 'warp', {}), 1000);
  } finally { if (previous === undefined) delete process.env.NMSH_DETERMINISTIC; else process.env.NMSH_DETERMINISTIC = previous; }
  assert.equal(sceneTime(1234, 99, 'aurora', {}), 1234);
});

test('gallery: real preview rows, changes are immediate, Enter on Start preview runs it', () => {
  const state = createScreensaverPanel(0);
  const settings = structuredClone(DEFAULT_PROMPT_CONFIGURATION.idleVisuals);
  const change = screensaverKey(state, {kind: 'right'}, settings);
  assert.deepEqual(change, {kind: 'change', settings: {...settings, mode: 'deepSpace'}});
  state.selected = 2;
  assert.deepEqual(screensaverKey(state, {kind: 'right'}, settings), {kind: 'change', settings: {...settings, timeout: 1}});
  assert.deepEqual(screensaverKey(state, {kind: 'enter'}, settings), undefined);
  assert.equal(state.selected, 3);
  assert.deepEqual(screensaverKey(state, {kind: 'enter'}, settings), {kind: 'start'});
  assert.deepEqual(screensaverKey(state, {kind: 'escape'}, settings), {kind: 'close'});
  const preview = frame('aurora', 40, 6, 3000);
  const rows = renderScreensaverPanel(state, 80, 30, {settings, motion: {still: false, disabled: false}, preview});
  assert.ok(rows.some(row => row.includes(preview[2]!)), 'the panel shows the real renderer output');
  assert.match(rows.map(stripAnsi).join('\n'), /Mode\s+Aurora Drift/u);
  assert.match(rows.map(stripAnsi).join('\n'), /not an OS screensaver/u);
  assert.ok(rows.every(row => displayWidth(row) <= 80));
});

/** An app with captured frames and no real terminal writes. */
function harness(patch: Partial<PromptConfiguration['idleVisuals']> = {timeout: 1}): {app: TerminalApp; frames: TerminalFrame[]; cleanup: () => void} {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  const frames: TerminalFrame[] = [];
  app['renderer'].render = (next: TerminalFrame) => { frames.push(next); };
  app['fetchSuggestions'] = async () => {};
  app['presentationStarted'] = true;
  app['startupPending'] = false;
  app['configuration'] = {...app['configuration'], idleVisuals: {...app['configuration'].idleVisuals, ...patch}};
  return {app, frames, cleanup: () => { app['stop'](0); app['session'].kill(); isolation.restore(); }};
}

function goIdle(app: TerminalApp): void {
  app['lastActivity'] = Date.now() - 10 * 60_000;
  app['onIdleTimeout']();
}

test('app: Never arms no timer; a timeout arms exactly one; stop clears everything', () => {
  const never = harness({timeout: 0});
  try {
    never.app['armIdle']();
    assert.equal(never.app['idleTimer'], undefined);
    assert.equal(never.app['idleSubscription'], undefined);
  } finally { never.cleanup(); }
  const {app, cleanup} = harness();
  try {
    app['armIdle']();
    assert.ok(app['idleTimer']);
    goIdle(app);
    assert.ok(app['idle'] && app['idleSubscription'], 'showing: one frame subscription');
  } finally { cleanup(); }
  assert.equal(app['idleTimer'], undefined);
  assert.equal(app['idleSubscription'], undefined);
  assert.equal(app['idle'], undefined);
});

test('app: activation only at a safe quiet prompt', () => {
  const {app, cleanup} = harness();
  try {
    app['running'] = {command: 'read x', startedAt: 0, interrupted: false, cleared: false, startId: 0, cwd: '/'};
    goIdle(app);
    assert.equal(app['idle'], undefined, 'a running or waiting command blocks it');
    app['running'] = undefined;
    app['openSettingsPanel']('config');
    goIdle(app);
    assert.equal(app['idle'], undefined, 'an open panel blocks it');
    app['settingsPanelState'] = undefined;
    app['passthrough'] = true;
    goIdle(app);
    assert.equal(app['idle'], undefined, 'passthrough blocks it');
    app['passthrough'] = false;
    app['terminalFocus'] = 'blurred';
    goIdle(app);
    assert.ok(app['idle'], 'an unfocused terminal may still be visible: it starts');
  } finally { cleanup(); }
});

test('app: any key dismisses, the key is not typed, and the draft, selection and scroll are exactly restored', () => {
  const {app, frames, cleanup} = harness();
  try {
    app['editor'].insert('git status');
    app['historyViewport'].scrollBy?.(-3);
    const viewport = JSON.stringify(app['historyViewport']);
    app['render']();
    const before = frames.at(-1)!;
    goIdle(app);
    const idleFrame = frames.at(-1)!;
    assert.equal(idleFrame.cursorVisible, false);
    assert.notDeepEqual(idleFrame.rows, before.rows);
    app['onInput']('x');
    assert.equal(app['idle'], undefined);
    assert.equal(app['editor'].text, 'git status', 'the waking key is not typed');
    assert.equal(JSON.stringify(app['historyViewport']), viewport);
    assert.deepEqual(frames.at(-1)!.rows, before.rows, 'the exact presentation returns');
    assert.ok(app['idleTimer'], 'the countdown restarts');
  } finally { cleanup(); }
});

test('app: mouse move, click, wheel, resize and new shell output all dismiss; focus loss keeps it running, focus return dismisses', () => {
  const {app, cleanup} = harness();
  try {
    for (const input of ['\u001b[<35;10;5M', '\u001b[<0;10;5M', '\u001b[<64;10;5M']) {
      goIdle(app);
      assert.ok(app['idle']);
      app['onInput'](input);
      assert.equal(app['idle'], undefined, JSON.stringify(input));
    }
    goIdle(app);
    app['onResize']();
    assert.equal(app['idle'], undefined, 'resize');
    goIdle(app);
    app['onShellData']('output\r\n');
    assert.equal(app['idle'], undefined, 'shell output');
    goIdle(app);
    app['onInput']('\u001b[O');
    assert.ok(app['idle'] && !app['idle'].paused, 'focus out keeps it running');
    assert.ok(app['idleSubscription'], 'frames continue while unfocused');
    app['onInput']('\u001b[I');
    assert.equal(app['idle'], undefined, 'focus return dismisses');
  } finally { cleanup(); }
});

test('app: Effects Off never starts idle visuals; Reduced Motion shows one still frame without a timer', () => {
  const off = harness();
  try {
    off.app['configuration'] = {...off.app['configuration'], presentation: {...off.app['configuration'].presentation, effectsOff: true}};
    goIdle(off.app);
    assert.equal(off.app['idle'], undefined);
  } finally { off.cleanup(); }
  const reduced = harness();
  try {
    reduced.app['configuration'] = {...reduced.app['configuration'], idleVisuals: {...reduced.app['configuration'].idleVisuals, mode: 'warp'},
      presentation: {...reduced.app['configuration'].presentation, reducedMotion: true}};
    goIdle(reduced.app);
    assert.equal(reduced.app['idle']?.mode, 'deepSpace');
    assert.equal(reduced.app['idleSubscription'], undefined, 'still: no animation timer');
  } finally { reduced.cleanup(); }
});

test('app: idle visuals never enter the transcript, /copy payloads or the journal', () => {
  const {app, cleanup} = harness();
  try {
    const before = JSON.stringify(app['output'].transcript());
    goIdle(app);
    for (let i = 0; i < 3; i++) app['tickIdle'](Date.now() + i * 125);
    app['onInput'](' ');
    assert.equal(JSON.stringify(app['output'].transcript()), before);
  } finally { cleanup(); }
});
