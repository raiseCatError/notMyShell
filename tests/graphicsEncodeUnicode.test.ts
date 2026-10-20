import test from 'node:test';
import assert from 'node:assert/strict';
import {ImageError, type Raster} from '../src/graphics/raster.js';
import {renderCells, type CellMode, type CellOptions} from '../src/graphics/unicode.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

type Px = [number, number, number, number];
const make = (width: number, height: number, pixel: (x: number, y: number) => Px): Raster => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  return {width, height, data};
};
const WHITE: Px = [255, 255, 255, 255];
const BLACK: Px = [0, 0, 0, 255];
const opts = (patch: Partial<CellOptions> = {}): CellOptions => ({columns: 1, rows: 1, mode: 'quadrant', color: 'truecolor', safe: false, ...patch});
const MODES: CellMode[] = ['half', 'quadrant', 'braille', 'ascii'];
const LEVELS = ['none', 'ansi16', 'ansi256', 'truecolor'] as const;
const gradient = (w: number, h: number) => make(w, h, (x, y) => [(x * 255) / Math.max(1, w - 1), (y * 255) / Math.max(1, h - 1), 128, 255]);
const checker = (w: number, h: number) => make(w, h, (x, y) => ((x + y) % 2 ? WHITE : BLACK));
const SGR = /\u001B\[[0-9;]*m/gu;
const onlyGlyphsAndSgr = (row: string) => !/[\u0000-\u001F\u007F-\u009F]/u.test(row.replace(SGR, ''));

test('every row is exactly `columns` cells wide in every mode, level and shape', () => {
  const shapes: Raster[] = [gradient(40, 30), checker(16, 16), make(8, 8, () => BLACK), make(1, 1, () => WHITE), make(1, 50, () => WHITE), make(50, 1, () => WHITE), make(400, 3, () => WHITE), make(3, 400, () => WHITE), make(20, 20, (x) => (x < 10 ? [1, 2, 3, 0] : WHITE))];
  for (const raster of shapes) for (const mode of MODES) for (const color of LEVELS) for (const safe of [false, true]) {
    const art = renderCells(raster, opts({columns: 30, rows: 8, mode, color, safe}));
    assert.equal(art.rows.length, art.height);
    assert.ok(art.height >= 1 && art.height <= 8 && art.columns >= 1 && art.columns <= 30);
    for (const row of art.rows) {
      assert.equal(displayWidth(row), art.columns, `${mode}/${color}/${safe}`);
      assert.ok(onlyGlyphsAndSgr(row));
    }
  }
});

test('the image keeps its aspect ratio inside columns x rows', () => {
  assert.deepEqual(pick(renderCells(checker(100, 100), opts({columns: 40, rows: 40, mode: 'half'}))), [40, 20]);
  assert.deepEqual(pick(renderCells(checker(200, 50), opts({columns: 40, rows: 40, mode: 'quadrant'}))), [40, 5]);
  assert.deepEqual(pick(renderCells(checker(1, 1), opts({columns: 9, rows: 9}))), [9, 5]);
});
const pick = (art: {columns: number; height: number}) => [art.columns, art.height];

test("color 'none' emits no escape sequences and keeps the shape", () => {
  for (const mode of MODES) for (const safe of [false, true]) {
    const art = renderCells(gradient(30, 20), opts({columns: 20, rows: 6, mode, color: 'none', safe}));
    for (const row of art.rows) assert.ok(!row.includes('\u001B'));
  }
  const art = renderCells(make(2, 2, (x, y) => (x === 0 && y === 0 ? WHITE : BLACK)), opts({color: 'none'}));
  assert.deepEqual(art.rows, ['▘']);
});

test('safe mode produces only printable ASCII (bytes 0x20-0x7e) and uses the ramp', () => {
  for (const mode of MODES) {
    const art = renderCells(gradient(60, 40), opts({columns: 30, rows: 10, mode, color: 'none', safe: true}));
    for (const row of art.rows) for (const byte of Buffer.from(row, 'utf8')) assert.ok(byte >= 0x20 && byte <= 0x7e);
  }
  const art = renderCells(make(2, 1, x => (x ? WHITE : BLACK)), opts({columns: 2, rows: 1, color: 'none', safe: true, mode: 'braille'}));
  assert.deepEqual(art.rows, [' @']);
  // Color escapes still follow `color`, but the glyphs between them are ASCII.
  const colored = renderCells(gradient(30, 20), opts({columns: 10, rows: 4, safe: true}));
  for (const row of colored.rows) assert.match(stripAnsi(row), /^[\x20-\x7e]+$/u);
});

test('color levels map to the matching SGR forms', () => {
  const red = make(1, 2, () => [200, 40, 40, 255]);
  const half = (color: CellOptions['color']) => renderCells(red, opts({mode: 'half', color})).rows[0]!;
  assert.equal(half('truecolor'), '\u001B[38;2;200;40;40m█\u001B[0m');
  assert.match(half('ansi256'), /^\u001B\[38;5;\d+m█\u001B\[0m$/u);
  assert.match(half('ansi16'), /^\u001B\[(?:3\d|9\d)m█\u001B\[0m$/u);
  assert.equal(half('none'), '░');
  const two = make(1, 2, (_x, y) => (y ? [0, 0, 255, 255] : [255, 0, 0, 255]));
  assert.equal(renderCells(two, opts({mode: 'half'})).rows[0], '\u001B[38;2;255;0;0m\u001B[48;2;0;0;255m▀\u001B[0m');
  assert.match(renderCells(two, opts({mode: 'half', color: 'ansi16'})).rows[0]!, /^\u001B\[91m\u001B\[104m▀\u001B\[0m$/u);
});

test('quadrant picks the exact glyph for the 15 canonical 2x2 patterns', () => {
  const glyphs = ['', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█'];
  for (let mask = 1; mask < 16; mask += 1) {
    const raster = make(2, 2, (x, y) => (mask & (1 << (y * 2 + x)) ? WHITE : BLACK));
    const row = renderCells(raster, opts()).rows[0]!;
    assert.equal(stripAnsi(row), glyphs[mask], `mask ${mask}`);
    if (mask < 15) assert.equal(row, `\u001B[38;2;255;255;255m\u001B[48;2;0;0;0m${glyphs[mask]}\u001B[0m`);
  }
  // Two colors that are not black/white pick the least-squares split and the brighter side is the foreground.
  const split = make(2, 2, (x) => (x ? [250, 200, 0, 255] : [0, 0, 120, 255]));
  assert.equal(renderCells(split, opts()).rows[0], '\u001B[38;2;250;200;0m\u001B[48;2;0;0;120m▐\u001B[0m');
  // A three-color cell splits where the error is least: the odd pixel joins its nearer neighbour.
  const three = make(2, 2, (x, y) => (x === 1 && y === 1 ? [200, 0, 0, 255] : x === 1 || y === 1 ? [190, 0, 0, 255] : [0, 0, 255, 255]));
  assert.equal(stripAnsi(renderCells(three, opts()).rows[0]!), '▟');
});

test('braille uses the standard dot bit order, fg = lit mean, bg = unlit mean', () => {
  const bits = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]];
  for (let x = 0; x < 2; x += 1) for (let y = 0; y < 4; y += 1) {
    const raster = make(2, 4, (px, py) => (px === x && py === y ? [200, 100, 0, 255] : [0, 0, 100, 255]));
    const row = renderCells(raster, opts({mode: 'braille'})).rows[0]!;
    assert.equal(row, `\u001B[38;2;200;100;0m\u001B[48;2;0;0;100m${String.fromCharCode(0x2800 + bits[x]![y]!)}\u001B[0m`);
  }
  const left = make(2, 4, x => (x ? BLACK : WHITE));
  assert.equal(stripAnsi(renderCells(left, opts({mode: 'braille'})).rows[0]!), '⡇');
});

test('transparency: unpainted without a background, composited with one', () => {
  const clear = make(4, 4, () => [10, 20, 30, 0]);
  for (const mode of MODES) {
    assert.ok(renderCells(clear, opts({columns: 2, rows: 2, mode})).rows.every(row => row.trim() === ''), mode);
    for (const row of renderCells(clear, opts({columns: 2, rows: 2, mode})).rows) assert.ok(!row.includes('\u001B'));
  }
  const withBg = renderCells(clear, opts({columns: 2, rows: 2, mode: 'half', background: {red: 5, green: 6, blue: 7}}));
  assert.equal(withBg.rows[0], '\u001B[38;2;5;6;7m██\u001B[0m');
  // Half transparent: the painted half is drawn, the other half is left to the terminal.
  const upper = make(1, 2, (_x, y) => (y ? [0, 0, 0, 0] : [9, 9, 9, 255]));
  assert.equal(renderCells(upper, opts({mode: 'half'})).rows[0], '\u001B[38;2;9;9;9m▀\u001B[0m');
  const lower = make(1, 2, (_x, y) => (y ? [9, 9, 9, 255] : [0, 0, 0, 0]));
  assert.equal(renderCells(lower, opts({mode: 'half'})).rows[0], '\u001B[38;2;9;9;9m▄\u001B[0m');
  // A transparent edge in quadrant mode keeps the shape and leaves the background default.
  const corner = make(2, 2, (x, y) => (x === 0 && y === 0 ? [9, 9, 9, 255] : [0, 0, 0, 0]));
  assert.equal(renderCells(corner, opts()).rows[0], '\u001B[38;2;9;9;9m▘\u001B[0m');
});

test('identical adjacent SGR runs are merged and rows end with a reset only when styled', () => {
  const solid = renderCells(make(8, 8, () => [1, 2, 3, 255]), opts({columns: 8, rows: 2, mode: 'half'}));
  for (const row of solid.rows) {
    assert.equal(row.match(/\u001B\[38/gu)?.length, 1);
    assert.ok(row.endsWith('\u001B[0m'));
  }
  const bare = renderCells(make(8, 8, () => [1, 2, 3, 0]), opts({columns: 8, rows: 2, mode: 'half'}));
  for (const row of bare.rows) assert.ok(!row.includes('\u001B'));
});

test('deterministic and never NaN or a non-ImageError failure under seeded fuzzing', () => {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let n = 0; n < 150; n += 1) {
    const w = 1 + Math.floor(rnd() * 40);
    const h = 1 + Math.floor(rnd() * 40);
    const raster = make(w, h, () => [rnd() * 256, rnd() * 256, rnd() * 256, rnd() < 0.3 ? rnd() * 256 : 255]);
    const options = opts({columns: 1 + Math.floor(rnd() * 30), rows: 1 + Math.floor(rnd() * 12), mode: MODES[Math.floor(rnd() * 4)]!, color: LEVELS[Math.floor(rnd() * 4)]!, safe: rnd() < 0.2, ...(rnd() < 0.3 ? {background: {red: 20, green: 30, blue: 40}} : {})});
    const art = renderCells(raster, options);
    assert.deepEqual(renderCells(raster, options), art);
    for (const row of art.rows) { assert.ok(!row.includes('NaN') && !row.includes('undefined')); assert.equal(displayWidth(row), art.columns); }
  }
  for (const bad of [{columns: NaN, rows: -4}, {columns: 1e9, rows: 1e9}, {columns: 0.2, rows: Infinity}]) {
    const art = renderCells(gradient(30, 30), opts(bad));
    assert.ok(art.columns >= 1 && art.height >= 1 && art.columns <= 1024 && art.height <= 1024);
  }
  assert.throws(() => renderCells({width: 2, height: 2, data: new Uint8ClampedArray(4)}, opts()), ImageError);
});

test('a large render is fast enough (quadrant, 1600x1200 -> 200x60 cells)', () => {
  const big = make(1600, 1200, (x, y) => [(x * 255) / 1599, (y * 255) / 1199, (x ^ y) & 255, 255]);
  renderCells(big, opts({columns: 200, rows: 60}));
  const start = performance.now();
  const art = renderCells(big, opts({columns: 200, rows: 60}));
  const elapsed = performance.now() - start;
  assert.equal(art.height, 60);
  assert.ok(elapsed < 400, `took ${elapsed.toFixed(1)} ms`);
});
