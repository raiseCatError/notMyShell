import test from 'node:test';
import assert from 'node:assert/strict';
import {ImageError, type Raster} from '../src/graphics/raster.js';
import {encodeSixel, SIXEL_MAX_PIXELS} from '../src/graphics/sixel.js';

type Px = [number, number, number, number];
const make = (width: number, height: number, pixel: (x: number, y: number) => Px): Raster => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  return {width, height, data};
};

/** TEST-ONLY sixel decoder: enough of DEC STD 070 to read what the encoder writes. Undrawn pixels stay alpha 0. */
function decodeSixel(stream: string): Raster & {p2: number} {
  const head = /^\u001BP(\d+);(\d+);(\d+)q"1;1;(\d+);(\d+)/u.exec(stream);
  assert.ok(head, 'header');
  assert.ok(stream.endsWith('\u001B\\'), 'ST terminator');
  const p2 = Number(head[2]);
  const width = Number(head[4]);
  const height = Number(head[5]);
  const data = new Uint8ClampedArray(width * height * 4);
  const palette = new Map<number, [number, number, number]>();
  let color = 0;
  let x = 0;
  let band = 0;
  let i = head[0].length;
  const end = stream.length - 2;
  const number = () => { let n = ''; while (i < end && /\d/u.test(stream[i]!)) { n += stream[i]; i += 1; } return Number(n); };
  while (i < end) {
    const char = stream[i]!;
    if (char === '#') {
      i += 1;
      color = number();
      if (stream[i] === ';') {
        i += 1;
        assert.equal(number(), 2);
        const channels: number[] = [];
        for (let k = 0; k < 3; k += 1) { assert.equal(stream[i], ';'); i += 1; channels.push(number()); }
        assert.ok(channels.every(v => v >= 0 && v <= 100));
        palette.set(color, channels.map(v => Math.round((v * 255) / 100)) as [number, number, number]);
      } else assert.ok(palette.has(color), 'color selected before definition');
    } else if (char === '$') { x = 0; i += 1; } else if (char === '-') { x = 0; band += 1; i += 1; } else {
      let run = 1;
      if (char === '!') { i += 1; run = number(); assert.ok(run >= 1); }
      const code = stream.charCodeAt(i);
      assert.ok(code >= 63 && code <= 126, `sixel char ${code}`);
      i += 1;
      const bits = code - 63;
      const rgb = palette.get(color)!;
      for (let r = 0; r < run; r += 1, x += 1) {
        assert.ok(x < width, 'row overflow');
        for (let b = 0; b < 6; b += 1) {
          const y = band * 6 + b;
          if (bits & (1 << b) && y < height) data.set([...rgb, 255], (y * width + x) * 4);
        }
      }
    }
  }
  return {width, height, data, p2};
}

const maxError = (a: Raster, b: Raster) => {
  let worst = 0;
  for (let i = 0; i < a.width * a.height; i += 1) for (let c = 0; c < 3; c += 1) worst = Math.max(worst, Math.abs(a.data[i * 4 + c]! - b.data[i * 4 + c]!));
  return worst;
};

test('a stream has the DCS header, raster attributes, palette, bands and ST', () => {
  const text = encodeSixel(make(3, 7, x => (x === 1 ? [255, 0, 0, 255] : [0, 0, 255, 255])));
  assert.match(text, /^\u001BP0;0;0q"1;1;3;7#0;2;0;0;100#1;2;100;0;0/u);
  assert.equal(text.split('-').length, 2, 'two bands for seven rows');
  assert.ok(text.endsWith('\u001B\\'));
  assert.ok(!/[^\u001B\\P0-9;q"#$!\-?-~]/u.test(text));
  // Runs of 4 or more are RLE-compressed.
  assert.match(encodeSixel(make(40, 6, () => [255, 255, 255, 255])), /!40~/u);
});

test('a two-color image round-trips exactly with maxColors 16', () => {
  const src = make(23, 17, (x, y) => ((x * 3 + y) % 5 < 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  for (const dither of ['none', 'ordered', 'floyd'] as const) {
    const out = decodeSixel(encodeSixel(src, {maxColors: 16, dither}));
    assert.deepEqual([...out.data], [...src.data], dither);
  }
});

test('photo-like images round-trip within a quantization tolerance', () => {
  const src = make(48, 30, (x, y) => [(x * 255) / 47, (y * 255) / 29, ((x + y) * 255) / 77, 255]);
  const plain = decodeSixel(encodeSixel(src, {maxColors: 256}));
  assert.ok(maxError(src, plain) <= 40, `max error ${maxError(src, plain)}`);
  assert.ok(maxError(src, decodeSixel(encodeSixel(src, {maxColors: 16}))) <= 120);
  for (const dither of ['ordered', 'floyd'] as const) {
    const out = decodeSixel(encodeSixel(src, {maxColors: 64, dither}));
    // Dithering trades per-pixel error for a faithful local mean.
    let diff = 0;
    for (let i = 0; i < out.data.length; i += 4) diff += Math.abs(out.data[i]! - src.data[i]!) + Math.abs(out.data[i + 1]! - src.data[i + 1]!) + Math.abs(out.data[i + 2]! - src.data[i + 2]!);
    assert.ok(diff / (48 * 30 * 3) < 40, dither);
  }
});

test('palette size is bounded by maxColors', () => {
  const src = make(64, 64, (x, y) => [x * 4, y * 4, (x * y) & 255, 255]);
  for (const maxColors of [16, 64, 128, 256] as const) {
    const text = encodeSixel(src, {maxColors});
    const defined = text.match(/#\d+;2;/gu)?.length ?? 0;
    assert.ok(defined > 0 && defined <= maxColors, `${maxColors}: ${defined}`);
  }
});

test('transparent pixels are left undrawn with P2=1 and are flattened otherwise', () => {
  const src = make(8, 8, x => (x < 4 ? [0, 255, 0, 255] : [255, 0, 0, 100]));
  const on = decodeSixel(encodeSixel(src, {transparent: true}));
  assert.equal(on.p2, 1);
  assert.equal(on.data[3], 255);
  assert.equal(on.data[4 * 4 + 3], 0);
  const off = decodeSixel(encodeSixel(src));
  assert.equal(off.p2, 0);
  // 100 / 255 is 39%, which a terminal draws as 99: the palette is percent-quantized.
  assert.deepEqual([...off.data.subarray(16, 20)], [99, 0, 0, 255]);
  const all = encodeSixel(make(5, 5, () => [1, 2, 3, 0]), {transparent: true});
  assert.equal(decodeSixel(all).data.every(v => v === 0), true);
  assert.deepEqual([...decodeSixel(encodeSixel(make(1, 1, () => [200, 0, 0, 0]), {background: {red: 0, green: 0, blue: 255}})).data], [0, 0, 255, 255]);
});

test('extreme shapes work: 1x1, 1xN, Nx1, and partial bands', () => {
  for (const [w, h] of [[1, 1], [1, 13], [200, 1], [5, 6], [5, 7], [3, 12]] as const) {
    const src = make(w, h, (x, y) => [(x * 70) & 255, (y * 40) & 255, 255, 255]);
    const out = decodeSixel(encodeSixel(src, {maxColors: 256}));
    assert.equal(out.width, w);
    assert.equal(out.height, h);
    assert.ok(maxError(src, out) <= 3, `${w}x${h}`);
  }
});

test('size limits refuse with ImageError too-large, bad input is malformed', () => {
  const tooWide = {width: 4097, height: 1, data: new Uint8ClampedArray(4097 * 4)};
  const tooTall = {width: 1, height: 4097, data: new Uint8ClampedArray(4097 * 4)};
  for (const raster of [tooWide, tooTall]) assert.throws(() => encodeSixel(raster), (error: unknown) => error instanceof ImageError && error.code === 'too-large');
  assert.equal(SIXEL_MAX_PIXELS, 4096 * 4096);
  assert.ok(encodeSixel({width: 4096, height: 1, data: new Uint8ClampedArray(4096 * 4)}).length > 0);
  assert.throws(() => encodeSixel({width: 2, height: 2, data: new Uint8ClampedArray(3)}), (error: unknown) => error instanceof ImageError && error.code === 'malformed');
});

test('deterministic, and seeded fuzzing never throws anything but ImageError', () => {
  let seed = 99;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let n = 0; n < 60; n += 1) {
    const w = 1 + Math.floor(rnd() * 30);
    const h = 1 + Math.floor(rnd() * 30);
    const src = make(w, h, () => [rnd() * 256, rnd() * 256, rnd() * 256, rnd() < 0.4 ? rnd() * 256 : 255]);
    const options = {maxColors: ([16, 64, 128, 256] as const)[Math.floor(rnd() * 4)]!, dither: (['none', 'ordered', 'floyd'] as const)[Math.floor(rnd() * 3)]!, transparent: rnd() < 0.5};
    const text = encodeSixel(src, options);
    assert.equal(encodeSixel(src, options), text);
    const out = decodeSixel(text);
    assert.equal(out.width, w);
    assert.ok(!text.includes('NaN'));
  }
});
