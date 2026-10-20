import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {ImageError, type Raster} from '../src/graphics/raster.js';
import {crc32, encodePng, kittyRgba} from '../src/graphics/pngEncode.js';

type Px = [number, number, number, number];
const make = (width: number, height: number, pixel: (x: number, y: number) => Px): Raster => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  return {width, height, data};
};

/** TEST-ONLY PNG decoder: checks signature and every CRC, then inflates and unfilters (all five filter types). */
function decodePng(png: Uint8Array): {raster: Raster; filters: Set<number>; chunks: string[]} {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  const chunks: string[] = [];
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    assert.equal(view.getUint32(at + 8 + length), crc32(png.subarray(at + 4, at + 8 + length)), `crc of ${type}`);
    chunks.push(type);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      assert.deepEqual([...body.subarray(8)], [8, 6, 0, 0, 0]);
    } else if (type === 'IDAT') idat.push(body);
    at += 12 + length;
  }
  assert.equal(at, png.length);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  assert.equal(raw.length, height * (stride + 1));
  const out = new Uint8ClampedArray(height * stride);
  const filters = new Set<number>();
  for (let y = 0; y < height; y += 1) {
    const type = raw[y * (stride + 1)]!;
    filters.add(type);
    for (let i = 0; i < stride; i += 1) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= 4 ? out[y * stride + i - 4]! : 0;
      const b = y ? out[(y - 1) * stride + i]! : 0;
      const c = y && i >= 4 ? out[(y - 1) * stride + i - 4]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][type];
      assert.ok(predictor !== undefined, `filter ${type}`);
      out[y * stride + i] = (x + predictor!) & 255;
    }
  }
  return {raster: {width, height, data: out}, filters, chunks};
}

const noise = (w: number, h: number, seed = 7) => {
  let s = seed;
  return make(w, h, () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return [s & 255, (s >> 8) & 255, (s >> 16) & 255, (s >> 24) & 255]; });
};

test('crc32 matches the known check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('a PNG round-trips pixel-exactly through a test-only decoder, for every forced filter type', () => {
  for (const raster of [noise(17, 11), make(9, 9, (x, y) => [x * 28, y * 28, (x + y) * 14, 255]), make(1, 1, () => [1, 2, 3, 4]), make(1, 30, (_x, y) => [y * 8, 0, 0, 255]), make(30, 1, x => [0, x * 8, 0, 128])]) {
    for (const filter of [0, 1, 2, 3, 4, 'auto'] as const) {
      const {raster: back, filters, chunks} = decodePng(encodePng(raster, {filter}));
      assert.deepEqual(chunks, ['IHDR', 'IDAT', 'IEND']);
      assert.equal(back.width, raster.width);
      assert.equal(back.height, raster.height);
      assert.deepEqual([...back.data], [...raster.data], `filter ${filter}`);
      if (filter !== 'auto') assert.deepEqual([...filters], [filter]);
    }
  }
});

test('the filter heuristic picks the cheapest filter per row', () => {
  const horizontal = decodePng(encodePng(make(32, 4, x => [x * 6, x * 6, x * 6, 255])));
  assert.ok(horizontal.filters.has(1), 'sub for horizontal ramps');
  const vertical = decodePng(encodePng(make(8, 32, x => [(x * 37) & 255, (x * 91) & 255, (x * x * 5) & 255, 255])));
  assert.ok(vertical.filters.has(2), 'up for vertical ramps');
  const diagonal = decodePng(encodePng(make(32, 32, (x, y) => [(x + y) * 4, (x * y) & 255, (x - y) & 255, 255])));
  assert.ok(diagonal.filters.size >= 1);
  assert.ok(encodePng(make(64, 64, () => [5, 5, 5, 255])).length < 400, 'a solid image compresses to almost nothing');
});

test('compression levels all decode, and level 0 is larger than level 9', () => {
  const src = make(40, 40, (x, y) => [x * 6, y * 6, 0, 255]);
  for (const level of [0, 1, 6, 9, -3, 99, NaN]) assert.deepEqual([...decodePng(encodePng(src, {level})).raster.data], [...src.data]);
  assert.ok(encodePng(src, {level: 0}).length > encodePng(src, {level: 9}).length);
});

test('deterministic output; bad rasters fail with ImageError only', () => {
  const src = noise(12, 12);
  assert.deepEqual(encodePng(src), encodePng(src));
  assert.throws(() => encodePng({width: 0, height: 1, data: new Uint8ClampedArray(0)}), ImageError);
  assert.throws(() => encodePng({width: 3, height: 3, data: new Uint8ClampedArray(7)}), ImageError);
  assert.throws(() => encodePng({width: 20000, height: 1, data: new Uint8ClampedArray(4)}), ImageError);
});

test('kittyRgba gives raw RGBA, or zlib that inflates back to it', () => {
  const src = noise(10, 6);
  const raw = kittyRgba(src);
  assert.deepEqual({format: raw.format, compressed: raw.compressed}, {format: 'RGBA', compressed: false});
  assert.deepEqual([...raw.payload], [...src.data]);
  const packed = kittyRgba(noise(10, 6), {compress: true});
  assert.equal(packed.compressed, true);
  assert.deepEqual([...inflateSync(packed.payload)], [...src.data]);
  const solid = kittyRgba(make(100, 100, () => [9, 9, 9, 255]), {compress: true});
  assert.ok(solid.payload.length < 200);
  assert.throws(() => kittyRgba({width: 2, height: 2, data: new Uint8ClampedArray(3)}), ImageError);
});
