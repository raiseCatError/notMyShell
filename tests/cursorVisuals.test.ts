import test from 'node:test';
import assert from 'node:assert/strict';
import {CursorEngine, seededRandom} from '../src/cursor/CursorEngine.js';
import {effectPalette} from '../src/cursor/palette.js';
import {renderCursorPreview} from '../src/cursor/CursorPreview.js';
import {chooseBackend} from '../src/cursor/backends.js';
import {DEFAULT_CURSOR, type CursorSettings} from '../src/prompt/configuration.js';
import {hostCursorFacts} from '../src/cursor/backends.js';
import {stripAnsi} from '../src/util/text.js';

const settings = (extra: Partial<CursorSettings> = {}): CursorSettings => ({...structuredClone(DEFAULT_CURSOR), ...extra});
const bounds = {top: 0, bottom: 1, columns: 80};

/** Every glyph and fill the engine paints over a jump (and then a rest), in order of first appearance. */
function run(extra: Partial<CursorSettings>, rest = 0) {
  const config = settings(extra);
  const engine = new CursorEngine(config, seededRandom(21));
  const palette = effectPalette(config);
  const glyphs: string[] = [];
  const seen = new Set<string>();
  let backgrounds = 0;
  let paintedCells = 0;
  engine.target({row: 1, column: 6}, 0, 'typing');
  engine.target({row: 1, column: 40}, 100, 'jump');
  for (let now = 116; now < 1500 + rest; now += 16) {
    engine.step(now);
    for (const line of engine.paints(palette, bounds, now).values()) for (const paint of line.values()) {
      paintedCells += 1;
      if (paint.background && !paint.caret) backgrounds += 1;
      if (paint.fill) backgrounds += 1;
      if (paint.glyph && !seen.has(paint.glyph)) { seen.add(paint.glyph); glyphs.push(paint.glyph); }
    }
  }
  return {glyphs: new Set(glyphs), backgrounds, paintedCells, engine};
}
const has = (result: {glyphs: Set<string>}, ...wanted: string[]) => wanted.every(glyph => result.glyphs.has(glyph));
const hasAny = (result: {glyphs: Set<string>}, ...wanted: string[]) => wanted.some(glyph => result.glyphs.has(glyph));

test('each movement effect has its own visual language', () => {
  const fire = run({effect: 'fire'});
  const sparks = run({effect: 'sparks'});
  const lightning = run({effect: 'lightning'});
  const railgun = run({effect: 'railgun'});
  const ripple = run({effect: 'ripple'});
  const wireframe = run({effect: 'wireframe', motion: 'smooth'});
  assert.ok(hasAny(fire, '▲', '▴', '^', '˄'), 'Fire climbs: flame glyphs');
  assert.ok(!hasAny(fire, '✦', '╱', '╲', '━', '(', '┌'));
  assert.ok(hasAny(sparks, '✦', '*'), 'Sparks twinkle');
  assert.ok(!hasAny(sparks, '▲', '▴', '^', '╱', '━', '(', '┌'));
  assert.ok(has(lightning, '╱') || has(lightning, '╲'), 'Lightning is slanted segments');
  assert.ok(lightning.glyphs.has('╱') && lightning.glyphs.has('╲') || lightning.glyphs.has('─'), 'a jagged bolt');
  assert.ok(has(railgun, '━'), 'Railgun is a straight heavy beam');
  assert.ok(has(railgun, '◉'), 'with a flash where it lands');
  assert.ok(!hasAny(railgun, '╱', '╲'));
  assert.ok(has(ripple, '(', ')'), 'Ripple is a wave with a crest on each side');
  assert.ok(has(wireframe, '┌', '┐', '│'), 'Wireframe is a bracket');
  // No two effects share a signature.
  const signature = (result: {glyphs: Set<string>}) => [...result.glyphs].sort().join('');
  const all = [fire, sparks, lightning, railgun, ripple, wireframe].map(signature);
  assert.equal(new Set(all).size, all.length);
});

test('Smooth, Smear and Tail are three different movements', () => {
  const smooth = run({motion: 'smooth'});
  const smear = run({motion: 'smear'});
  const tail = run({motion: 'tail'});
  assert.equal(smooth.glyphs.has('▒') || smooth.glyphs.has('•'), false, 'Smooth leaves no trail');
  assert.ok(smear.glyphs.has('▒') || smear.glyphs.has('░'), 'Smear is a solid band of shading');
  assert.ok(tail.glyphs.has('•') || tail.glyphs.has('·') || tail.glyphs.has('˙'), 'Tail is a comet of shrinking dots');
  assert.ok(!tail.glyphs.has('▒'), 'Tail does not use the band');
  assert.ok(smear.paintedCells > smooth.paintedCells && tail.paintedCells > smooth.paintedCells);
});

test('idle effects differ: Glow breathes beside the caret, Embers drift, Flame climbs, Sparks twinkle', () => {
  const idle = (idleEffect: CursorSettings['idleEffect']) => run({idleEffect}, 1500);
  const glow = idle('glow');
  const embers = idle('embers');
  const flame = idle('flame');
  const sparks = idle('sparks');
  assert.ok(glow.glyphs.has('░') || glow.glyphs.has('▒') || glow.glyphs.has('·'));
  assert.ok(hasAny(embers, '•', '·', '˙') && !hasAny(embers, '▲', '▴', '^', '✦'), 'Embers are soft dots');
  assert.ok(hasAny(flame, '▲', '▴', '^', '˄'), 'Flame uses flame glyphs');
  assert.ok(hasAny(sparks, '✦', '*'), 'idle Sparks twinkle');
  assert.notEqual([...flame.glyphs].sort().join(), [...embers.glyphs].sort().join());
  assert.notEqual([...sparks.glyphs].sort().join(), [...embers.glyphs].sort().join());
});

test('the transparent-terminal rule holds for every effect: no fill and no background behind text', () => {
  for (const effect of ['fire', 'sparks', 'lightning', 'railgun', 'ripple', 'wireframe'] as const) {
    for (const motion of ['smooth', 'smear', 'tail'] as const) assert.equal(run({effect, motion}).backgrounds, 0, `${motion}/${effect}`);
  }
  for (const idleEffect of ['glow', 'embers', 'flame', 'sparks'] as const) assert.equal(run({idleEffect}, 1500).backgrounds, 0, idleEffect);
});

test('effects are finite and bounded: no leftover particles, bolts or boxes after they settle', () => {
  for (const effect of ['fire', 'sparks', 'lightning', 'railgun', 'ripple', 'wireframe'] as const) {
    const config = settings({effect});
    const engine = new CursorEngine(config, seededRandom(5));
    engine.target({row: 1, column: 4}, 0, 'typing');
    engine.target({row: 1, column: 70}, 50, 'jump');
    let peak = 0;
    for (let now = 66; now < 4000; now += 16) { engine.step(now); peak = Math.max(peak, engine.particles.length); }
    assert.equal(engine.particles.length, 0, `${effect} leaves nothing`);
    assert.equal(engine.phase, 'idle');
    assert.ok(peak <= 110, `${effect} stays within its cap (${peak})`);
  }
});

test('shape-specific jumps only: a typing step draws no bolt, beam or box', () => {
  for (const effect of ['lightning', 'railgun', 'wireframe'] as const) {
    const engine = new CursorEngine(settings({effect}), seededRandom(2));
    engine.target({row: 1, column: 4}, 0, 'typing');
    engine.target({row: 1, column: 5}, 40, 'typing');
    engine.step(56);
    assert.equal(engine.particles.length, 0, effect);
    assert.equal([...engine.paints(effectPalette(settings({effect})), bounds, 56).values()].every(line => ![...line.values()].some(paint => ['┌', '━', '╱'].includes(paint.glyph ?? ''))), true);
  }
});

test('the /cursor preview draws exactly what the engine paints (one engine, no preview art)', () => {
  const facts = hostCursorFacts({} as NodeJS.ProcessEnv, () => false);
  for (const [effect, marks] of [['ripple', [')']], ['railgun', ['━']], ['lightning', ['╱', '╲']], ['wireframe', ['│']]] as const) {
    const config = settings({effect, motion: effect === 'wireframe' ? 'smooth' : 'off'});
    let seenInPreview = false;
    let seenInEngine = false;
    for (let elapsed = 250; elapsed < 900; elapsed += 25) {
      const preview = renderCursorPreview({scene: 'jump', title: effect, settings: config, choice: chooseBackend(config, facts), columns: 100, elapsed, still: false});
      seenInPreview ||= marks.some(mark => stripAnsi(preview.rows.slice(1, 3).join('\n')).includes(mark));
    }
    // The preview's own script (jump at 250 ms) replayed against a fresh engine with the same seed.
    const engine = new CursorEngine(config, seededRandom(7));
    engine.target({row: 1, column: 9}, 0, 'typing');
    for (let now = 0; now < 900; now += 16) {
      if (now === 256) engine.target({row: 1, column: 6 + 23}, now, 'jump');
      engine.step(now);
      for (const line of engine.paints(effectPalette(config), {top: 0, bottom: 1, columns: 98}, now).values()) for (const paint of line.values()) seenInEngine ||= marks.includes(paint.glyph as never);
    }
    assert.ok(seenInEngine, `${effect}: the engine draws ${marks.join(' ')}`);
    assert.ok(seenInPreview, `${effect}: the preview shows what the engine draws`);
  }
});
