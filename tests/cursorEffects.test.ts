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
import {createCursorPanel, cursorPanelKey, renderCursorPanel, type CursorPanelEnv} from '../src/cursor/CursorPanel.js';
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
  assert.doesNotMatch(painted, /\u001b\[48;/u, 'a background is never painted behind text: only the caret may fill a cell');
  const tinted = overlayRow(row, new Map([[0, {tint: {color: {red: 255, green: 0, blue: 0}, amount: 0.5}, underline: true}]]));
  assert.match(tinted, /\u001b\[4m\u001b\[38;2;228;100;100mg/u, 'a text cell blends its own foreground toward the tint and may underline');
  assert.equal(stripAnsi(tinted), 'git status');
  const caret = overlayRow(row, new Map([[0, {caret: true, background: {red: 90, green: 40, blue: 20}}]]));
  assert.match(caret, /\u001b\[48;2;90;40;20mg/u, 'the caret cell may fill');
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
  assert.match(forced.reason, /not available/u);
  assert.deepEqual(forced.portableDraws, {motion: false, effect: false, idle: false}, 'a forced host renderer without a host backend draws nothing, and says so');
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

const panelEnv = (extra: Partial<CursorPanelEnv> = {}, draft = settings()): CursorPanelEnv => {
  const facts = hostCursorFacts({} as NodeJS.ProcessEnv, () => false);
  return {choice: chooseBackend(draft, facts), facts, context: {palette: 'lavender', accent: 'mauve'}, still: false, level: 'truecolor', ...extra};
};

test('/cursor panel: changes apply at once; Advanced holds physics; the preview runs the real engine', () => {
  const state = createCursorPanel(DEFAULT_CURSOR, 0);
  state.selected = 3; // Motion
  const action = cursorPanelKey(state, {kind: 'right'}, panelEnv(), 10);
  assert.equal(action?.kind === 'apply' && action.settings.motion, 'smooth');
  assert.equal(state.started, 10, 'changing a value restarts the preview');
  assert.equal(cursorPanelKey(state, {kind: 'text', value: 'a'}, panelEnv(), 20), undefined);
  assert.ok(state.advanced);
  state.selected = 2; // Short-move duration (after Trail color and Particle color; their Edit rows appear only for Custom or Gradient)
  const tune = cursorPanelKey(state, {kind: 'right'}, panelEnv(), 30);
  assert.equal(tune?.kind === 'apply' && tune.settings.advanced.shortMoveMs, 50);
  const text = stripAnsi(renderCursorPanel(createCursorPanel(settings({motion: 'smear'}), 0), 100, 400, panelEnv({}, settings({motion: 'smear'}))).join('\n'));
  assert.match(text, /Cursor & effects/u);
  assert.match(text, /Preview · Shape: Host default/u);
  assert.match(text, /Motion\s+‹? ?Smear/u);
  assert.doesNotMatch(text, /Stiffness/u, 'physics stay in Advanced');
});

test('portable effects paint foreground tints and shading glyphs, never a background behind text', () => {
  for (const [motion, effect, idleEffect] of [['smear', 'fire', 'off'], ['tail', 'sparks', 'off'], ['smear', 'ripple', 'off'], ['off', 'none', 'glow']] as const) {
    const engine = new CursorEngine(settings({motion, effect, idleEffect}), seededRandom(3));
    const palette = effectPalette(settings({motion, effect, idleEffect}));
    engine.target({row: 1, column: 2}, 0);
    engine.target({row: 1, column: 30}, 0);
    const seen: Array<{background?: unknown; caret?: boolean; tint?: unknown; glyph?: string}> = [];
    for (let now = 16; now < 3000; now += 16) {
      engine.step(now);
      for (const line of engine.paints(palette, bounds, now).values()) for (const paint of line.values()) seen.push(paint);
    }
    assert.ok(seen.length > 0 || motion === 'off', `${motion}/${effect} painted something`);
    assert.ok(seen.every(paint => !paint.background || paint.caret), `${motion}/${effect}: backgrounds only for the caret cell`);
  }
});

test('live cursor frames never paint a background behind text; only the travelling caret fills one cell', () => {
  const current = settings({motion: 'tail', effect: 'fire', idleEffect: 'glow', shape: 'bar'});
  const presenter = new CursorPresenter(() => current, () => {}, seededRandom(11));
  const rows = ['', '\u001b[38;2;200;200;200m❯ git commit -m "hello world"\u001b[0m', ''];
  let withBackground = 0;
  presenter.apply(rows, {row: 1, column: 4}, bounds, 'jump', true, 0);
  for (let now = 16; now < 2500; now += 16) {
    const column = now < 600 ? 4 + Math.floor(now / 20) : 30;
    const frame = presenter.apply(rows, {row: 1, column}, bounds, now < 100 ? 'jump' : 'typing', true, now);
    for (const row of frame.rows) {
      const fills = row.match(/\u001b\[48;/gu)?.length ?? 0;
      assert.ok(fills <= 1, `at most the caret cell is filled (${now}ms)`);
      withBackground += fills;
    }
  }
  assert.equal(withBackground, 0, 'a Bar caret and every effect draw with foreground colors only');
  presenter.dispose();
});

test('idle repaints (animated Chroma rules, clock) with an unchanged logical caret never start trail movement', () => {
  const presenter = new CursorPresenter(() => settings({motion: 'smear', effect: 'fire'}), () => {}, seededRandom(9));
  const caret = {row: 1, column: 4};
  presenter.apply(['── a', '> ls', '── a'], caret, bounds, 'jump', true, 0);
  presenter.apply(['── a', '> ls', '── a'], {row: 1, column: 5}, bounds, 'typing', true, 10);
  for (let now = 1000; now < 3000; now += 100) presenter.apply([`── ${now}`, '> ls', `── ${now}`], {row: 1, column: 5}, bounds, 'jump', true, now);
  assert.equal(presenter.engine.phase, 'idle', 'the trail settled and stays settled while only other rows repaint');
  assert.ok(!presenter.scheduled, 'no animation clock keeps running for an idle caret');
  presenter.apply(['── x', '> lsx', '── x'], {row: 1, column: 6}, bounds, 'typing', true, 3100);
  assert.equal(presenter.engine.phase, 'movement', 'a real caret move still animates');
  presenter.dispose();
});

test('Ghostty shader: Tmux-safe (default) draws no path effect for moves across rows; Full keeps them; old settings migrate to Tmux-safe', () => {
  assert.equal(DEFAULT_CURSOR.ghosttyTrail, 'tmuxSafe');
  assert.equal(normalizeCursor({motion: 'smear'}).ghosttyTrail, 'tmuxSafe', 'settings saved before this choice get the safe default');
  assert.equal(normalizeCursor({ghosttyTrail: 'full'}).ghosttyTrail, 'full');
  assert.equal(normalizeCursor({ghosttyTrail: 'sideways'}).ghosttyTrail, 'tmuxSafe');
  const safe = shaderSource(settings({motion: 'smear', effect: 'fire'}));
  const full = shaderSource(settings({motion: 'smear', effect: 'fire', ghosttyTrail: 'full'}));
  // Measured under tmux 3.7: every redraw artifact Ghostty sees is a row change to column 1; typing and Left/Right never change row.
  assert.match(safe, /if \(1 == 1 && abs\(current\.y - previous\.y\) > iCurrentCursor\.w \* 0\.5\) fade = 0\.0;/u, 'cross-row moves draw no path');
  assert.match(full, /if \(0 == 1 && abs\(current\.y - previous\.y\)/u, 'Full: the rule is off');
  assert.ok(safe.indexOf('fade = 0.0;') < safe.indexOf('if (1 == 1 && fade > 0.0)'), 'the rule runs before the smear');
  for (const source of [safe, full]) for (const uniform of source.match(/\bi[A-Z]\w*/gu) ?? []) {
    assert.ok(['iChannel0', 'iResolution', 'iCurrentCursor', 'iPreviousCursor', 'iTime', 'iTimeCursorChange'].includes(uniform), `only documented Ghostty uniforms (${uniform})`);
  }
});

test('/cursor offers Across rows only where NMSh\'s Ghostty shader draws something', () => {
  const ghostty = {host: 'ghostty' as const, caretColor: 'host-controlled' as const, integrated: true, version: '1.3.1'};
  const kitty = {host: 'kitty' as const, caretColor: 'host-controlled' as const, integrated: true};
  const rowFor = (facts: typeof ghostty | typeof kitty, draft: CursorSettings) => {
    const env = panelEnv({facts: facts as never, choice: chooseBackend(draft, facts as never)}, draft);
    return renderCursorPanel(createCursorPanel(draft, 0), 120, 400, env).map(stripAnsi).find(row => row.includes('Across rows')) ?? '';
  };
  assert.match(rowFor(ghostty, settings({motion: 'smear'})), /Tmux-safe/u);
  assert.match(rowFor(kitty, settings({motion: 'tail'})), /Unavailable/u);
  assert.match(rowFor(ghostty, settings()), /Unavailable/u, 'nothing to trail');
});

test('launch refresh rewrites only NMSh\'s own managed shader when it is out of date, and says why and how to apply it', async () => {
  const {refreshManagedCursor, hostConfigPath, includeLine, shaderPath} = await import('../src/cursor/native.js');
  const home = mkdtempSync(join(tmpdir(), 'nmsh-cursor-refresh-'));
  const env = {XDG_CONFIG_HOME: join(home, '.config'), NMSH_CONFIG_HOME: join(home, 'nmsh'), HOME: home} as NodeJS.ProcessEnv;
  try {
    assert.equal(refreshManagedCursor(settings({motion: 'smear'}), env, 'darwin'), undefined, 'not installed: nothing is written');
    const config = hostConfigPath('ghostty', env, 'darwin', home);
    mkdirSync(join(config, '..'), {recursive: true});
    writeFileSync(config, `font-size = 14\n${includeLine('ghostty', env)}\n`);
    writeManagedFiles('ghostty', settings({motion: 'smear', ghosttyTrail: 'full'}), env);
    const message = refreshManagedCursor(settings({motion: 'smear'}), env, 'darwin');
    assert.match(message ?? '', /tmux-safe: moves across rows no longer trail.*⌘⇧,.*Across rows: Full/u);
    assert.match(readFileSync(shaderPath(env), 'utf8'), /if \(1 == 1 && abs\(current\.y - previous\.y\)/u);
    assert.equal(readFileSync(config, 'utf8'), `font-size = 14\n${includeLine('ghostty', env)}\n`, 'the person\'s own config is untouched');
    assert.equal(refreshManagedCursor(settings({motion: 'smear'}), env, 'darwin'), undefined, 'up to date: silent');
  } finally { rmSync(home, {recursive: true, force: true}); }
});
