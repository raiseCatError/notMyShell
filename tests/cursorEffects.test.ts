import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CursorEngine, MAX_PARTICLES, seededRandom} from '../src/cursor/CursorEngine.js';
import {CursorPresenter} from '../src/cursor/CursorPresenter.js';
import {chooseBackend, hostCursorFacts, GHOSTTY_BACKEND} from '../src/cursor/backends.js';
import {effectPalette} from '../src/cursor/palette.js';
import {overlayRow} from '../src/presentation/cellOverlay.js';
import {fragmentContent, includeLine, nativeCursorIntegrated, setupPlan, shaderSource, writeManagedFiles} from '../src/cursor/native.js';
import {createCursorPanel, cursorPanelKey, previewCaret, renderCursorPanel} from '../src/cursor/CursorPanel.js';
import {DEFAULT_CURSOR, normalizeCursor, type CursorSettings} from '../src/prompt/configuration.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const settings = (extra: Partial<CursorSettings> = {}): CursorSettings => ({...structuredClone(DEFAULT_CURSOR), ...extra});
const bounds = {top: 0, bottom: 2, columns: 80};

test('defaults: no motion, no effect, no idle effect; old configs normalize without surprise animation', () => {
  assert.deepEqual([DEFAULT_CURSOR.motion, DEFAULT_CURSOR.effect, DEFAULT_CURSOR.idleEffect, DEFAULT_CURSOR.renderer], ['off', 'none', 'off', 'auto']);
  const old = normalizeCursor({shape: 'bar', blink: 'off'});
  assert.equal(old.shape, 'bar');
  assert.equal(old.motion, 'off');
  assert.equal(normalizeCursor({color: {source: 'custom', custom: 'red'}}).color.custom, undefined, 'custom colors must be #RRGGBB');
  assert.equal(normalizeCursor({color: {source: 'custom', custom: '#aa66ff'}}).color.custom, '#aa66ff');
});

test('phases: movement → settling → idle; the logical target is exact at once; retargeting never queues', () => {
  const engine = new CursorEngine(settings({motion: 'smear'}), seededRandom(1));
  engine.target({row: 1, column: 2}, 0);
  assert.equal(engine.phase, 'idle', 'the first placement is instant');
  engine.target({row: 1, column: 30}, 0, 'jump');
  assert.equal(engine.phase, 'movement');
  engine.step(60);
  // Retarget mid-flight: starts from the current visual position, still one movement.
  engine.target({row: 1, column: 5}, 60, 'jump');
  assert.equal(engine.phase, 'movement');
  for (let now = 60; now < 2000 && engine.phase !== 'idle'; now += 16) engine.step(now);
  assert.equal(engine.phase, 'idle');
  assert.equal(engine.cadence(3000), 0, 'nothing scheduled at rest without an idle effect');
});

test('short adjacent typing barely animates; jumps travel the full long duration', () => {
  const engine = new CursorEngine(settings({motion: 'smooth'}), seededRandom(2));
  engine.target({row: 0, column: 0}, 0);
  engine.target({row: 0, column: 1}, 0, 'typing');
  engine.step(41);
  assert.notEqual(engine.phase, 'movement', 'typing settles within the short-move duration');
  engine.target({row: 0, column: 40}, 100, 'jump');
  engine.step(141);
  assert.equal(engine.phase, 'movement', 'a jump is still travelling');
});

test('particles are bounded, seeded and expire; Fire rises', () => {
  const engine = new CursorEngine(settings({motion: 'tail', effect: 'fire', particleAmount: 'high'}), seededRandom(3));
  engine.target({row: 1, column: 0}, 0);
  for (let index = 1; index < 30; index += 1) { engine.target({row: 1, column: (index * 13) % 70}, index * 30, 'jump'); engine.step(index * 30 + 15); }
  assert.ok(engine.particles.length > 0 && engine.particles.length <= MAX_PARTICLES);
  const before = new Map(engine.particles.map(particle => [particle, particle.y]));
  engine.step(1000);
  assert.ok(engine.particles.every(particle => !before.has(particle) || particle.y <= before.get(particle)! + 0.01), 'fire particles drift upward');
  for (let now = 1000; now < 4000; now += 16) engine.step(now);
  assert.equal(engine.particles.length, 0);
  // Determinism.
  const replay = (seed: number) => { const run = new CursorEngine(settings({effect: 'sparks', motion: 'smear'}), seededRandom(seed)); run.target({row: 0, column: 0}, 0); run.target({row: 0, column: 40}, 0); run.step(50); return JSON.stringify(run.particles); };
  assert.equal(replay(9), replay(9));
});

test('overlay: text keeps its glyphs and foreground; only blank cells get glyphs; width never changes', () => {
  const row = '\u001b[38;2;200;200;200mgit status\u001b[0m';
  const painted = overlayRow(row, new Map([[1, {background: {red: 90, green: 40, blue: 20}, glyph: '*'}], [14, {glyph: '*', foreground: {red: 255, green: 120, blue: 0}}]]));
  assert.equal(stripAnsi(painted).slice(0, 10), 'git status', 'text unchanged');
  assert.equal(stripAnsi(painted)[14], '*', 'a particle on a blank cell');
  assert.equal(displayWidth(stripAnsi(painted)), 15);
  assert.match(painted, /48;2;90;40;20mi/u, 'the text cell only gets a background tint');
  assert.ok(painted.includes('\u001b[0m\u001b[38;2;200;200;200m'), 'the row\'s own style is replayed after a painted cell');
});

test('presenter: disabled or Off means no overlay and no clock; native-handled parts are not drawn twice', () => {
  let repaints = 0;
  const current = settings({motion: 'smear', effect: 'fire'});
  const presenter = new CursorPresenter(() => current, () => { repaints += 1; }, seededRandom(4));
  const rows = ['', '> git status', ''];
  presenter.apply(rows, {row: 1, column: 2}, bounds, 'jump', true, 0);
  const moved = presenter.apply(rows, {row: 1, column: 12}, bounds, 'jump', true, 16);
  assert.ok(presenter.scheduled, 'a clock while moving');
  assert.ok(moved.hideCaret, 'NMSh draws the travelling caret');
  const off = presenter.apply(rows, {row: 1, column: 12}, bounds, 'jump', false, 32);
  assert.deepEqual(off.rows, rows);
  assert.ok(!presenter.scheduled, 'Reduced Motion / Effects Off / NO_COLOR: nothing scheduled');
  const plain = new CursorPresenter(() => settings(), () => {}, seededRandom(5));
  plain.apply(rows, {row: 1, column: 2}, bounds, 'jump', true, 0);
  assert.deepEqual(plain.apply(rows, {row: 1, column: 9}, bounds, 'jump', true, 16).rows, rows, 'motion Off + effect None: identical rows');
  assert.ok(!plain.scheduled);
  presenter.dispose();
  void repaints;
});

test('backends: Auto is native only when set up; forced native on another host falls back to Portable', () => {
  const env = (value: Record<string, string>) => value as NodeJS.ProcessEnv;
  assert.equal(chooseBackend(settings({renderer: 'auto'}), hostCursorFacts(env({TERM_PROGRAM: 'zed'}), () => false)).backend.id, 'portable');
  const forced = chooseBackend(settings({renderer: 'native'}), hostCursorFacts(env({TERM_PROGRAM: 'Apple_Terminal'}), () => false));
  assert.equal(forced.backend.id, 'portable');
  assert.match(forced.reason, /unavailable/u);
  const ghostty = hostCursorFacts(env({TERM_PROGRAM: 'ghostty', TERM_PROGRAM_VERSION: '1.2.0'}), () => true);
  const native = chooseBackend(settings({renderer: 'auto', motion: 'smear', effect: 'fire'}), ghostty);
  assert.equal(native.backend, GHOSTTY_BACKEND);
  assert.deepEqual(native.nativeHandles, {motion: true, effect: true});
  assert.equal(chooseBackend(settings({motion: 'smear'}), hostCursorFacts(env({TERM_PROGRAM: 'ghostty', TERM_PROGRAM_VERSION: '1.1.3'}), () => true)).backend.id, 'portable', 'older Ghostty has no cursor uniforms');
  const kitty = chooseBackend(settings({motion: 'tail', effect: 'fire'}), hostCursorFacts(env({KITTY_WINDOW_ID: '1'}), () => true));
  assert.deepEqual(kitty.nativeHandles, {motion: true, effect: false}, 'Kitty draws the tail; Fire stays portable');
});

test('native setup: one include line through a verified plan; existing shaders kept; managed files only afterwards', () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-cursor-native-'));
  const env = {XDG_CONFIG_HOME: join(home, '.config'), NMSH_CONFIG_HOME: join(home, 'nmsh')} as NodeJS.ProcessEnv;
  try {
    mkdirSync(join(home, '.config', 'ghostty'), {recursive: true});
    const config = join(home, '.config', 'ghostty', 'config');
    writeFileSync(config, 'font-size = 14\ncustom-shader = /me/crt.glsl\n');
    const setup = setupPlan('ghostty', env, home);
    assert.equal(setup.configPath, config);
    assert.deepEqual(setup.related, ['custom-shader = /me/crt.glsl']);
    assert.equal(setup.plan.kind, 'plan');
    assert.ok(setup.plan.kind === 'plan' && setup.plan.plan.edits.every(edit => !edit.text.includes('crt.glsl') || edit.text.includes('font-size')), 'nothing of the person\'s config is removed');
    assert.match(includeLine('ghostty', env), /^config-file = \?.*ghostty-cursor\.conf$/u, 'an optional include');
    assert.equal(nativeCursorIntegrated('ghostty', env), false);
    writeManagedFiles('ghostty', settings({motion: 'smear', effect: 'fire'}), env);
    writeFileSync(config, `${readFileSync(config, 'utf8')}${includeLine('ghostty', env)}\n`);
    assert.equal(nativeCursorIntegrated('ghostty', env), true);
    assert.match(readFileSync(config, 'utf8'), /custom-shader = \/me\/crt\.glsl/u, 'the person\'s shader stays');
    const shader = shaderSource(settings({motion: 'tail', effect: 'fire', color: {source: 'custom', custom: '#aa66ff'}}));
    assert.match(shader, /iCurrentCursor[\s\S]*iPreviousCursor[\s\S]*iTimeCursorChange/u);
    assert.match(shader, /void mainImage/u);
    assert.match(fragmentContent('kitty', settings({motion: 'tail'}), env), /^cursor_trail 3$/mu);
    assert.match(fragmentContent('kitty', settings({motion: 'off'}), env), /^cursor_trail 0$/mu);
  } finally { rmSync(home, {recursive: true, force: true}); }
});

test('colors: Fire is not fixed to orange; custom colors and gradients apply', () => {
  assert.notDeepEqual(effectPalette(settings({effect: 'fire'})).particles[0], effectPalette(settings({effect: 'fire', particles: {source: 'custom', colors: ['#aa66ff']}})).particles[0]);
  assert.deepEqual(effectPalette(settings({effect: 'fire', particles: {source: 'custom', colors: ['#aa66ff']}})).particles[0], {red: 170, green: 102, blue: 255});
  assert.equal(effectPalette(settings({effect: 'sparks', trail: {source: 'gradient', colors: ['#00ff88', '#00aaff']}})).trail.length, 2);
});

test('/cursor panel: changes apply at once; Advanced holds physics; the preview runs the real engine', () => {
  const state = createCursorPanel(DEFAULT_CURSOR, 0);
  state.selected = 3; // Motion
  const action = cursorPanelKey(state, {kind: 'right'});
  assert.equal(action?.kind === 'apply' && action.settings.motion, 'smooth');
  assert.equal(cursorPanelKey(state, {kind: 'text', value: 'a'}), undefined);
  assert.ok(state.advanced);
  const tune = cursorPanelKey(state, {kind: 'right'});
  assert.equal(tune?.kind === 'apply' && tune.settings.advanced.shortMoveMs, 50);
  assert.equal(previewCaret(1600).cause, 'jump');
  const text = stripAnsi(renderCursorPanel(createCursorPanel(settings({motion: 'smear'}), 0), 100, 2400,
    chooseBackend(settings(), hostCursorFacts({} as NodeJS.ProcessEnv, () => false)), false).join('\n'));
  assert.match(text, /Cursor & effects/u);
  assert.match(text, /Preview/u);
  assert.match(text, /Motion\s+Smear/u);
  assert.doesNotMatch(text, /Stiffness/u, 'physics stay in Advanced');
});
