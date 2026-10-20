import test from 'node:test';
import assert from 'node:assert/strict';
import {ImageError, type Raster} from '../src/graphics/raster.js';
import {fitCells, flatten, scaleBox} from '../src/graphics/scale.js';

const make = (width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Raster => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  return {width, height, data};
};
const px = (raster: Raster, x: number, y: number) => [...raster.data.subarray((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 4)];

test('scaleBox averages a 2x2 block exactly', () => {
  const colors: [number, number, number, number][] = [[10, 100, 200, 255], [40, 60, 80, 255], [0, 0, 0, 255], [50, 180, 20, 255]];
  const src = make(2, 2, (x, y) => colors[y * 2 + x]!);
  assert.deepEqual(px(scaleBox(src, 1, 1), 0, 0), [25, 85, 75, 255]);
});

test('scaleBox is exact for integer ratios and a pure mean', () => {
  const src = make(4, 2, x => [x * 10, 0, 255 - x, 255]);
  const out = scaleBox(src, 2, 1);
  assert.deepEqual(px(out, 0, 0), [5, 0, 255, 255]);
  assert.deepEqual(px(out, 1, 0), [25, 0, 253, 255]);
});

test('scaleBox weights by alpha: a transparent pixel does not tint', () => {
  const src = make(2, 1, x => (x ? [0, 0, 0, 0] : [200, 100, 50, 255]));
  assert.deepEqual(px(scaleBox(src, 1, 1), 0, 0), [200, 100, 50, 128]);
  const half = make(2, 1, x => (x ? [0, 0, 255, 64] : [255, 0, 0, 192]));
  const [r, g, b, a] = px(scaleBox(half, 1, 1), 0, 0);
  assert.equal(a, 128);
  assert.equal(g, 0);
  assert.ok(Math.abs(r! - 255 * 0.75) <= 1 && Math.abs(b! - 255 * 0.25) <= 1);
});

test('scaleBox upscales as nearest and never exceeds the target size', () => {
  const src = make(2, 2, (x, y) => [x * 255, y * 255, 0, 255]);
  const out = scaleBox(src, 4, 4);
  assert.equal(out.data.length, 64);
  assert.deepEqual(px(out, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(px(out, 1, 1), [0, 0, 0, 255]);
  assert.deepEqual(px(out, 2, 3), [255, 255, 0, 255]);
  const odd = scaleBox(src, 3, 3);
  assert.deepEqual(px(odd, 1, 1), [128, 128, 0, 255]);
});

test('scaleBox keeps same-size rasters, extremes and non-integer ratios sane', () => {
  const src = make(3, 3, (x, y) => [x * 40, y * 40, 7, 255]);
  const same = scaleBox(src, 3, 3);
  assert.deepEqual([...same.data], [...src.data]);
  assert.notEqual(same.data, src.data);
  const strip = make(1, 1000, (_x, y) => [y % 256, 0, 0, 255]);
  const small = scaleBox(strip, 1, 7);
  assert.equal(small.height, 7);
  const wide = make(1000, 1, x => [0, x % 256, 0, 255]);
  assert.equal(scaleBox(wide, 9, 1).width, 9);
  assert.deepEqual(px(scaleBox(make(1, 1, () => [9, 8, 7, 255]), 5, 3), 4, 2), [9, 8, 7, 255]);
});

test('scaleBox refuses bad input with ImageError only', () => {
  const ok = make(1, 1, () => [0, 0, 0, 255]);
  assert.throws(() => scaleBox(ok, 0, 1), ImageError);
  assert.throws(() => scaleBox(ok, 1.5, 1), ImageError);
  assert.throws(() => scaleBox(ok, 99999, 1), (error: unknown) => error instanceof ImageError && error.code === 'too-large');
  assert.throws(() => scaleBox({width: 4, height: 4, data: new Uint8ClampedArray(3)}, 1, 1), (error: unknown) => error instanceof ImageError && error.code === 'malformed');
  assert.throws(() => scaleBox({width: NaN, height: 4, data: new Uint8ClampedArray(64)}, 1, 1), ImageError);
});

test('flatten composites over a color and makes alpha opaque', () => {
  const src = make(3, 1, x => [[255, 0, 0, 255], [255, 0, 0, 0], [255, 0, 0, 128]][x] as [number, number, number, number]);
  const out = flatten(src, {red: 0, green: 0, blue: 255});
  assert.deepEqual(px(out, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(px(out, 1, 0), [0, 0, 255, 255]);
  assert.deepEqual(px(out, 2, 0), [128, 0, 127, 255]);
});

test('fitCells keeps aspect from the real cell size, stays within bounds and never upscales unless asked', () => {
  assert.deepEqual(fitCells(800, 400, 100, 50), {columns: 100, rows: 25});
  assert.deepEqual(fitCells(800, 800, 100, 50), {columns: 100, rows: 50});
  assert.deepEqual(fitCells(800, 800, 100, 50, {width: 10, height: 20}), {columns: 80, rows: 40});
  assert.deepEqual(fitCells(800, 800, 100, 50, {width: 10, height: 20}, true), {columns: 100, rows: 50});
  assert.deepEqual(fitCells(80, 160, 100, 50), {columns: 10, rows: 10});
  assert.deepEqual(fitCells(80, 160, 100, 50, undefined, true), {columns: 50, rows: 50});
  assert.deepEqual(fitCells(1, 1, 10, 10), {columns: 1, rows: 1});
  assert.deepEqual(fitCells(10000, 1, 40, 10), {columns: 40, rows: 1});
  assert.deepEqual(fitCells(1, 10000, 40, 10), {columns: 1, rows: 10});
  assert.deepEqual(fitCells(500, 500, 0, NaN), {columns: 1, rows: 1});
  assert.throws(() => fitCells(0, 5, 10, 10), ImageError);
});
