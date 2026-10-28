import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {decodeAnimation, ANIMATION_LIMITS} from '../src/graphics/animation.js';
import {ImageError, IMAGE_LIMITS} from '../src/graphics/raster.js';
import {decodeGif} from '../src/graphics/gif.js';
import {decodePng} from '../src/graphics/png.js';
import {encodeGif, type GifFrame} from './support/gifEncoder.js';
import {chunk, concat, encodePng, ihdr, PNG_SIGNATURE} from './support/pngEncoder.js';

const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255], clear = [0, 0, 0, 0];
const palette = [red.slice(0, 3), green.slice(0, 3), blue.slice(0, 3), [0, 0, 0]];
const pixels = (animation: ReturnType<typeof decodeAnimation>, frame: number): number[] => Array.from(animation.frames[frame]!.raster.data);
const imageError = (fn: () => unknown, code?: string): void => {
  assert.throws(fn, (error: unknown) => error instanceof ImageError && (!code || error.code === code));
};

/** The fixture encoder supplies real LZW/sub-blocks; insert explicit GCEs and the Netscape extension here. */
function gif(frames: (GifFrame & {dispose?: number; delay?: number})[], loop?: number): Uint8Array {
  const first = encodeGif({width: 2, height: 1, palette, frames: []});
  const parts = [first.subarray(0, first.length - 1)];
  if (loop !== undefined) parts.push(Uint8Array.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, loop & 255, loop >> 8, 0]));
  for (const frame of frames) {
    const encoded = encodeGif({width: 2, height: 1, palette, frames: [frame]});
    const body = encoded.slice(first.length - 1, encoded.length - 1);
    body[3] = ((frame.dispose ?? 0) << 2) | (frame.transparent !== undefined ? 1 : 0);
    body[4] = (frame.delay ?? 2) & 255;
    body[5] = (frame.delay ?? 2) >> 8;
    parts.push(body);
  }
  parts.push(Uint8Array.of(0x3b));
  return concat(parts);
}
const base: GifFrame = {width: 2, height: 1, indices: [0, 0]};
for (const dispose of [0, 1, 2, 3]) {
  test(`GIF disposal ${dispose}, transparency and independent snapshots`, () => {
    const animation = decodeAnimation(gif([base,
      {width: 1, height: 1, indices: [2], dispose},
      {width: 2, height: 1, indices: [3, 1], transparent: 3},
    ]));
    assert.deepEqual(pixels(animation, 0), [...red, ...red]);
    assert.deepEqual(pixels(animation, 1), [...blue, ...red]);
    assert.deepEqual(pixels(animation, 2), [...(dispose === 2 ? clear : dispose === 3 ? red : blue), ...green]);
    animation.frames[2]!.raster.data.fill(0);
    assert.deepEqual(pixels(animation, 0), [...red, ...red]);
  });
}

test('GIF local palettes, offsets, interlace and GCE reset', () => {
  const indices = Array.from({length: 3 * 11}, (_, i) => i % 4);
  const bytes = encodeGif({width: 5, height: 12, frames: [{left: 1, top: 1, width: 3, height: 11, indices, interlaced: true, localPalette: palette}]});
  const result = decodeAnimation(bytes);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 5; x++) {
    assert.deepEqual(Array.from(result.frames[0]!.raster.data.slice((y * 5 + x) * 4, (y * 5 + x + 1) * 4)),
      x >= 1 && x < 4 && y >= 1 ? [...palette[indices[(y - 1) * 3 + x - 1]!]!, 255] : clear);
  }
  const reset = gif([{...base, transparent: 0}, base]);
  // Remove the second GCE: the first frame's transparency must not leak.
  const secondGce = reset.indexOf(0x21, 27 + 8);
  const noGce = concat([reset.subarray(0, secondGce), reset.subarray(secondGce + 8)]);
  assert.deepEqual(pixels(decodeAnimation(noGce), 1), [...red, ...red]);
});

test('GIF loop count, missing loop extension and centisecond delay normalization', () => {
  for (const loop of [0, 1, 7]) assert.equal(decodeAnimation(gif([base], loop)).loopCount, loop);
  assert.equal(decodeAnimation(gif([base])).loopCount, 1);
  assert.deepEqual(decodeAnimation(gif([0, 1, 2, 5].map((delay) => ({...base, delay})))).frames.map((f) => f.delayMs), [100, 100, 20, 50]);
});

interface PngFrame {
  width?: number; height?: number; left?: number; top?: number;
  pixels: number[]; dispose?: number; blend?: number; num?: number; den?: number;
}
const uints = (...values: number[]): Uint8Array => {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, value));
  return bytes;
};
function apng(frames: PngFrame[], options: {defaultImage?: boolean; plays?: number; sequences?: number[]; declared?: number} = {}): Uint8Array {
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr(2, 1, 8, 6)), chunk('acTL', uints(options.declared ?? frames.length, options.plays ?? 0))];
  let sequence = 0;
  const next = (): number => options.sequences?.[sequence] ?? sequence;
  if (options.defaultImage) parts.push(chunk('IDAT', zlib.deflateSync(Uint8Array.from([0, ...green, ...green]))));
  frames.forEach((frame, i) => {
    const width = frame.width ?? 2, height = frame.height ?? 1;
    const control = concat([uints(next(), width, height, frame.left ?? 0, frame.top ?? 0), new Uint8Array(6)]);
    sequence++;
    const view = new DataView(control.buffer);
    view.setUint16(20, frame.num ?? 1); view.setUint16(22, frame.den ?? 10);
    control[24] = frame.dispose ?? 0; control[25] = frame.blend ?? 0;
    parts.push(chunk('fcTL', control));
    const raw: number[] = [];
    for (let y = 0; y < height; y++) raw.push(0, ...frame.pixels.slice(y * width * 4, (y + 1) * width * 4));
    const compressed = zlib.deflateSync(Uint8Array.from(raw));
    if (!options.defaultImage && i === 0) parts.push(chunk('IDAT', compressed));
    else { parts.push(chunk('fdAT', concat([uints(next()), compressed]))); sequence++; }
  });
  parts.push(chunk('IEND', new Uint8Array()));
  return concat(parts);
}

for (const dispose of [0, 1, 2]) for (const blend of [0, 1]) {
  test(`APNG disposal ${dispose}, blend ${blend}, offsets and exact alpha`, () => {
    const animation = decodeAnimation(apng([
      {pixels: [...red, ...red]},
      {width: 1, pixels: [0, 0, 255, 128], dispose, blend},
      {width: 1, left: 1, pixels: clear},
    ]));
    const painted = blend ? [127, 0, 128, 255] : [0, 0, 255, 128];
    assert.deepEqual(pixels(animation, 0), [...red, ...red]);
    assert.deepEqual(pixels(animation, 1), [...painted, ...red]);
    assert.deepEqual(pixels(animation, 2), [...(dispose === 1 ? clear : dispose === 2 ? red : painted), ...clear]);
  });
}

test('APNG over with two translucent pixels, transparent source, previous on first frame', () => {
  const bytes = apng([{pixels: [255, 0, 0, 128, ...clear]}, {pixels: [0, 0, 255, 128, ...clear], blend: 1}, {pixels: [...clear, ...clear], blend: 1}]);
  const animation = decodeAnimation(bytes);
  assert.deepEqual(pixels(animation, 1), [85, 0, 170, 192, ...clear]);
  assert.deepEqual(pixels(animation, 2), pixels(animation, 1));
  const previous = decodeAnimation(apng([{pixels: [...red, ...red], dispose: 2}, {width: 1, pixels: blue}]));
  assert.deepEqual(pixels(previous, 1), [...blue, ...clear]);
});

test('APNG excluded default image, loop count, zero denominator and fractional timing', () => {
  const bytes = apng([{width: 1, pixels: red, num: 3, den: 0}, {width: 1, left: 1, pixels: blue, num: 1, den: 60}], {defaultImage: true, plays: 4});
  const animation = decodeAnimation(bytes);
  assert.equal(animation.frames.length, 2);
  assert.equal(animation.loopCount, 4);
  assert.deepEqual(pixels(animation, 0), [...red, ...clear]);
  assert.deepEqual(animation.frames.map((f) => f.delayMs), [30, 1000 / 60]);
  assert.deepEqual(Array.from(decodePng(bytes).data), [...green, ...green]);
});

const fixtures = [gif([base, base, base]), apng(Array.from({length: 3}, () => ({pixels: [...red, ...red], num: 2, den: 100})))];
for (const [i, bytes] of fixtures.entries()) {
  test(`budgets ${i}: frames, bytes and cumulative time, including exact boundaries`, () => {
    for (const budget of [{maxFrames: 2}, {maxDecodedBytes: 16}, {maxTotalMs: 40}]) {
      const animation = decodeAnimation(bytes, budget);
      assert.equal(animation.frames.length, 2);
      assert.equal(animation.truncated, true);
    }
    assert.equal(decodeAnimation(bytes, {maxFrames: 3, maxDecodedBytes: 24, maxTotalMs: 60}).truncated, false);
    for (const budget of [{maxFrames: 0}, {maxDecodedBytes: 7}, {maxTotalMs: 19}]) imageError(() => decodeAnimation(bytes, budget), 'too-large');
    for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_VALUE]) imageError(() => decodeAnimation(bytes, {maxFrames: value}));
  });
}

test('defaults bound frames and duration', () => {
  assert.deepEqual(ANIMATION_LIMITS, {maxFrames: 75, maxDecodedBytes: 32 * 1024 * 1024, maxTotalMs: 5000});
  assert.equal(decodeAnimation(gif(Array.from({length: 76}, () => ({...base, delay: 2})))).frames.length, 75);
  assert.equal(decodeAnimation(gif(Array.from({length: 51}, () => ({...base, delay: 0})))).frames.length, 50);
});

test('abort before decoding and during frame work only produces ImageError', () => {
  const controller = new AbortController(); controller.abort();
  for (const bytes of fixtures) imageError(() => decodeAnimation(bytes, {}, controller.signal), 'unavailable');
  for (const bytes of fixtures) {
    let reads = 0;
    const signal = {get aborted() { return ++reads > 8; }} as AbortSignal;
    imageError(() => decodeAnimation(bytes, {}, signal), 'unavailable');
  }
});

test('still images return one frame and preserve existing first/default frame decoders', () => {
  const g = gif([base]);
  const p = encodePng({width: 2, height: 1, colorType: 6, bitDepth: 8, samples: [...red, ...blue]});
  for (const [bytes, decoder] of [[g, decodeGif], [p, decodePng]] as const) {
    const animation = decodeAnimation(bytes);
    assert.equal(animation.frames.length, 1); assert.equal(animation.truncated, false);
    assert.deepEqual(animation.frames[0]!.raster, decoder(bytes));
  }
  assert.deepEqual(decodeGif(fixtures[0]!), decodeGif(g));
  assert.deepEqual(decodePng(fixtures[1]!), decodePng(encodePng({width: 2, height: 1, colorType: 6, bitDepth: 8, samples: [...red, ...red]})));
});

test('malformed APNG control, sequence, rectangle and frame count', () => {
  const two = [{pixels: [...red, ...red]}, {width: 1, pixels: blue}];
  for (const sequences of [[1], [0, 0], [0, 2], [0, 1, 1], [0, 1, 3]]) imageError(() => decodeAnimation(apng(two, {sequences})), 'malformed');
  for (const frame of [{width: 3, pixels: red}, {left: 2, width: 1, pixels: red}, {height: 0, pixels: []}, {dispose: 3, pixels: [...red, ...red]}, {blend: 2, pixels: [...red, ...red]}]) imageError(() => decodeAnimation(apng([frame])), 'malformed');
  for (const declared of [0, 1, 3]) imageError(() => decodeAnimation(apng(two, {declared})), 'malformed');
  imageError(() => decodeAnimation(apng([])), 'malformed');
});

test('hostile/truncated GIF and APNG inputs never escape as another exception', () => {
  for (const bytes of fixtures) {
    for (let end = 0; end < bytes.length; end++) imageError(() => decodeAnimation(bytes.subarray(0, end)));
    // Deterministic mutations may remain valid, but failures must always be ImageError.
    for (let at = 0; at < bytes.length; at++) {
      const mutated = bytes.slice(); mutated[at] ^= 255;
      try { decodeAnimation(mutated); } catch (error) { assert.ok(error instanceof ImageError); }
    }
  }
  const noFrames = encodeGif({width: 1, height: 1, palette, frames: []});
  imageError(() => decodeAnimation(noFrames), 'malformed');
  imageError(() => decodeAnimation(encodeGif({width: 2, height: 1, palette, frames: [base]}, {rawLzw: Uint8Array.of(255)})), 'malformed');
  imageError(() => decodeAnimation(gif([{...base, dispose: 4}])), 'malformed');
  imageError(() => decodeAnimation(gif([{...base, width: 3, indices: [0, 0, 0]}])), 'malformed');
  const hugeHeader = concat([PNG_SIGNATURE, chunk('IHDR', ihdr(4000, 6000, 8, 6))]);
  // A valid but very large canvas is rejected by the byte budget before inflation/allocation.
  const large = concat([hugeHeader, chunk('IDAT', Uint8Array.of(1)), chunk('IEND', new Uint8Array())]);
  imageError(() => decodeAnimation(large), 'too-large');
  imageError(() => decodeAnimation(new Uint8Array(IMAGE_LIMITS.maxFileBytes + 1)), 'too-large');
});

test('WebP is explicitly unsupported', () => {
  const vp8x = new Uint8Array(18); vp8x.set(Buffer.from('VP8X')); vp8x[4] = 10; vp8x[8] = 2;
  const riff = Buffer.from('RIFF....WEBP'); riff.writeUInt32LE(4 + vp8x.length, 4);
  assert.throws(() => decodeAnimation(concat([riff, vp8x])), (error: unknown) => error instanceof ImageError && error.code === 'unsupported' && /WebP.*external converter/.test(error.message));
});

/** Rewrite chunks with fresh CRCs so malformed-container tests exercise ordering, not checksums. */
function rewritePng(bytes: Uint8Array, transform: (kind: string, data: Uint8Array) => Uint8Array[]): Uint8Array {
  const parts = [PNG_SIGNATURE];
  for (let at = 8; at < bytes.length;) {
    const size = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
    const kind = Buffer.from(bytes.subarray(at + 4, at + 8)).toString('ascii');
    parts.push(...transform(kind, bytes.subarray(at + 8, at + 8 + size)));
    at += 12 + size;
  }
  return concat(parts);
}

test('APNG concatenates split IDAT and fdAT streams', () => {
  const original = apng([{pixels: [...red, ...red]}, {pixels: [...blue, ...blue]}]);
  let sequence = 0;
  const split = rewritePng(original, (kind, data) => {
    if (kind === 'fcTL') {
      const control = data.slice(); new DataView(control.buffer).setUint32(0, sequence++);
      return [chunk(kind, control)];
    }
    if (kind === 'IDAT') return [chunk(kind, data.subarray(0, 3)), chunk(kind, data.subarray(3))];
    if (kind === 'fdAT') return [chunk(kind, concat([uints(sequence++), data.subarray(4, 7)])), chunk(kind, concat([uints(sequence++), data.subarray(7)]))];
    return [chunk(kind, data)];
  });
  assert.deepEqual(decodeAnimation(split), decodeAnimation(original));
});

test('APNG shares palette/transparency, filters and Adam7 decoding with still PNG', () => {
  for (const spec of [
    {width: 2, height: 1, colorType: 3 as const, bitDepth: 2 as const, samples: [0, 1], palette: [[255, 0, 0], [0, 255, 0]], trns: [128, 0], interlace: true, filter: 4},
    {width: 2, height: 1, colorType: 0 as const, bitDepth: 16 as const, samples: [0x1234, 0xffff], interlace: true, filter: 3},
  ]) {
    const still = encodePng(spec);
    let data: Uint8Array[] = [], metadata: Uint8Array[] = [];
    rewritePng(still, (kind, body) => {
      if (kind === 'IDAT') data.push(body);
      else if (kind !== 'IEND') metadata.push(chunk(kind, body));
      return [];
    });
    const control = (sequence: number): Uint8Array => {
      const bytes = concat([uints(sequence, 2, 1, 0, 0), Uint8Array.of(0, 1, 0, 10, 0, 0)]);
      return chunk('fcTL', bytes);
    };
    const animated = concat([PNG_SIGNATURE, ...metadata, chunk('acTL', uints(2, 0)), control(0), ...data.map((d) => chunk('IDAT', d)), control(1), chunk('fdAT', concat([uints(2), ...data])), chunk('IEND', new Uint8Array())]);
    const animation = decodeAnimation(animated);
    assert.deepEqual(animation.frames[0]!.raster, decodePng(still));
    assert.deepEqual(animation.frames[1]!.raster, decodePng(still));
  }
});

test('APNG rejects invalid chunk ordering and compressed pixel data', () => {
  const original = apng([{pixels: [...red, ...red]}, {pixels: [...blue, ...blue]}]);
  for (const transform of [
    (kind: string, data: Uint8Array) => kind === 'acTL' ? [] : [chunk(kind, data)],
    (kind: string, data: Uint8Array) => kind === 'acTL' ? [chunk(kind, data), chunk(kind, data)] : [chunk(kind, data)],
    (kind: string, data: Uint8Array) => kind === 'fdAT' ? [chunk(kind, uints(2))] : [chunk(kind, data)],
    (kind: string, data: Uint8Array) => kind === 'fdAT' ? [chunk(kind, concat([uints(2), Uint8Array.of(255)]))] : [chunk(kind, data)],
    (kind: string, data: Uint8Array) => kind === 'IDAT' ? [] : [chunk(kind, data)],
    (kind: string, data: Uint8Array) => kind === 'fdAT' ? [chunk('IDAT', data.subarray(4))] : [chunk(kind, data)],
    (kind: string, data: Uint8Array) => kind === 'IEND' ? [chunk('ABCD', new Uint8Array()), chunk(kind, data)] : [chunk(kind, data)],
  ]) imageError(() => decodeAnimation(rewritePng(original, transform)), 'malformed');
});

test('GIF sub-block bookkeeping is bounded even for tiny blocks', () => {
  const header = gif([base]).subarray(0, 25);
  const tiny = new Uint8Array((IMAGE_LIMITS.maxChunkScan + 1) * 2 + 1);
  for (let at = 0; at < tiny.length - 1; at += 2) tiny[at] = 1;
  imageError(() => decodeAnimation(concat([header, Uint8Array.of(0x21, 0xfe), tiny, Uint8Array.of(0x3b)])), 'malformed');
});
