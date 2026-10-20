import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import jpeg from 'jpeg-js';
import {identify} from '../src/graphics/formats.js';
import {crc32, decodePng} from '../src/graphics/png.js';
import {decodeGif} from '../src/graphics/gif.js';
import {decodeJpeg} from '../src/graphics/jpeg.js';
import {decodeWebp} from '../src/graphics/webp.js';
import {decodeImage} from '../src/graphics/decode.js';
import {ImageError} from '../src/graphics/raster.js';
import {chunk, concat, encodePng, ihdr, PNG_SIGNATURE, rawScanlines} from './support/pngEncoder.js';
import {encodeGif, lzwEncode} from './support/gifEncoder.js';
import {LOSSLESS_WEBP, LOSSY_WEBP, sampleSpec, webp, withOrientation} from './support/graphicsFixtures.js';

const imageError = (code?: string) => (e: unknown): boolean => e instanceof ImageError && (code === undefined || e.code === code);

const png = encodePng(sampleSpec(6, 8, 6, 5, {filter: 'cycle'}));
const pngAdam7 = encodePng(sampleSpec(3, 4, 5, 6, {interlace: true}));
const palette = [[10, 20, 30], [200, 100, 50], [0, 255, 0], [1, 2, 3]];
const gif = encodeGif({width: 5, height: 4, palette, frames: [{width: 5, height: 4, indices: Array.from({length: 20}, (_, i) => i % 4), interlaced: true}]});
const jpg = jpeg.encode({width: 17, height: 9, data: Uint8Array.from({length: 17 * 9 * 4}, (_, i) => (i * 31) & 255)}, 70).data;

function pngWithIdat(width: number, height: number, inflated: Uint8Array, colorType = 0, depth = 8): Uint8Array {
  return concat([PNG_SIGNATURE, chunk('IHDR', ihdr(width, height, depth, colorType)), chunk('IDAT', zlib.deflateSync(inflated)), chunk('IEND', new Uint8Array(0))]);
}

test('truncating a PNG or GIF at every byte offset is always an ImageError', () => {
  for (const file of [png, pngAdam7]) for (let n = 0; n < file.length; n++) assert.throws(() => decodePng(file.subarray(0, n)), imageError(), `png ${n}`);
  for (let n = 0; n < gif.length - 1; n++) assert.throws(() => decodeGif(gif.subarray(0, n)), imageError(), `gif ${n}`);
});

test('truncating a JPEG or WebP never yields anything but a raster or an ImageError', () => {
  for (let n = 0; n < jpg.length; n++) {
    try { decodeJpeg(jpg.subarray(0, n)); } catch (error) { assert.ok(error instanceof ImageError, `jpeg ${n}`); }
  }
  for (const base64 of [LOSSY_WEBP, LOSSLESS_WEBP]) {
    const file = webp(base64);
    for (let n = 0; n < file.length; n++) {
      if (n < 12) assert.equal(identify(file.subarray(0, n)).format, 'unknown');
      else assert.throws(() => identify(file.subarray(0, n)), imageError(), `webp ${n}`);
    }
  }
});

test('PNG: a wrong critical-chunk CRC is malformed', () => {
  for (const offset of [29, png.length - 20, png.length - 1]) {
    const bad = Uint8Array.from(png);
    bad[offset] = bad[offset]! ^ 0x55;
    assert.throws(() => decodePng(bad), imageError('malformed'));
  }
});

test('PNG: pixel data that does not match the header', () => {
  const inflated = rawScanlines({width: 4, height: 4, colorType: 0, bitDepth: 8, samples: new Array(16).fill(9)});
  decodePng(pngWithIdat(4, 4, inflated));
  assert.throws(() => decodePng(pngWithIdat(4, 4, concat([inflated, new Uint8Array(1)]))), imageError('malformed'), 'extra data');
  assert.throws(() => decodePng(pngWithIdat(4, 4, inflated.subarray(0, inflated.length - 1))), imageError('malformed'), 'short data');
  const badFilter = Uint8Array.from(inflated);
  badFilter[0] = 5;
  assert.throws(() => decodePng(pngWithIdat(4, 4, badFilter)), imageError('malformed'), 'filter byte');
});

test('PNG: a decompression bomb behind a 1x1 header is refused without inflating it', () => {
  const bomb = pngWithIdat(1, 1, new Uint8Array(40 * 1024 * 1024));
  const started = Date.now();
  assert.throws(() => decodePng(bomb), imageError('malformed'));
  assert.ok(Date.now() - started < 3000);
});

test('PNG: size lies and impossible headers', () => {
  const header = (w: number, h: number, depth = 8, type = 0, interlace = 0): Uint8Array => concat([PNG_SIGNATURE, chunk('IHDR', ihdr(w, h, depth, type, interlace)), chunk('IEND', new Uint8Array(0))]);
  assert.throws(() => identify(header(60000, 60000)), imageError('too-large'));
  assert.throws(() => decodePng(header(60000, 60000)), imageError('too-large'));
  assert.throws(() => decodePng(header(0, 1)), imageError('malformed'));
  assert.throws(() => decodePng(header(1, 0)), imageError('malformed'));
  assert.throws(() => decodePng(header(0xffffffff, 1)), imageError());
  assert.throws(() => decodePng(header(1, 1, 3, 0)), imageError('malformed'));
  assert.throws(() => decodePng(header(1, 1, 8, 5)), imageError('malformed'));
  assert.throws(() => decodePng(header(1, 1, 8, 3, 2)), imageError('malformed'));
  assert.throws(() => decodePng(header(4001, 6000)), imageError('too-large'));
  assert.throws(() => decodePng(concat([PNG_SIGNATURE, chunk('IHDR', ihdr(1, 1, 8, 0))])), imageError('malformed'), 'no IEND');
});

test('PNG: palette problems', () => {
  const spec = sampleSpec(3, 8, 2, 1, {palette: [[1, 2, 3], [4, 5, 6]], samples: [0, 5]});
  assert.throws(() => decodePng(encodePng(spec)), imageError('malformed'), 'index past the palette');
  const noPalette = concat([PNG_SIGNATURE, chunk('IHDR', ihdr(1, 1, 8, 3)), chunk('IDAT', zlib.deflateSync(Uint8Array.from([0, 0]))), chunk('IEND', new Uint8Array(0))]);
  assert.throws(() => decodePng(noPalette), imageError('malformed'));
  assert.throws(() => decodePng(encodePng({...spec, palette: [[1, 2, 3, 4]], samples: [0, 0]})), imageError('malformed'), 'PLTE not a multiple of 3');
});

test('GIF: code size, LZW overrun, bad frames and bad indices', () => {
  const frame = {width: 3, height: 3, indices: [0, 1, 2, 3, 0, 1, 2, 3, 0]};
  const spec = {width: 3, height: 3, palette, frames: [frame]};
  decodeGif(encodeGif(spec));
  for (const size of [0, 9, 12, 13, 255]) assert.throws(() => decodeGif(encodeGif(spec, {minCodeSizeByte: size})), imageError('malformed'), `code size ${size}`);
  assert.throws(() => decodeGif(encodeGif(spec, {rawLzw: lzwEncode(new Array(40).fill(1), 2)})), imageError('malformed'), 'too many pixels');
  assert.throws(() => decodeGif(encodeGif(spec, {rawLzw: lzwEncode([1, 2], 2)})), imageError('malformed'), 'too few pixels');
  assert.throws(() => decodeGif(encodeGif(spec, {rawLzw: Uint8Array.from([0x44, 0x01, 0xff, 0xff, 0xff])})), imageError('malformed'), 'garbage codes');
  assert.throws(() => decodeGif(encodeGif({width: 3, height: 3, palette, frames: [{...frame, left: 2}]})), imageError('malformed'), 'frame right of the screen');
  assert.throws(() => decodeGif(encodeGif({width: 3, height: 3, palette, frames: [{...frame, top: 1}]})), imageError('malformed'), 'frame below the screen');
  assert.throws(() => decodeGif(encodeGif({width: 3, height: 3, palette, frames: [{...frame, width: 0, indices: []}]})), imageError('malformed'), 'empty frame');
  assert.throws(() => decodeGif(encodeGif({width: 3, height: 3, palette: palette.slice(0, 2), frames: [frame]})), imageError('malformed'), 'colour index past the table');
  assert.throws(() => decodeGif(encodeGif({width: 3, height: 3, frames: [frame]})), imageError('malformed'), 'no colour table');
  assert.throws(() => decodeGif(encodeGif({width: 0, height: 3, palette, frames: []})), imageError('malformed'), 'zero screen');
  assert.throws(() => decodeGif(encodeGif({width: 65535, height: 65535, palette, frames: [frame]})), imageError('too-large'));
});

test('JPEG: forged dimensions and garbage', () => {
  const sof = jpg.findIndex((value, i) => value === 0xff && jpg[i + 1] === 0xc0);
  const forged = (width: number, height: number): Uint8Array => {
    const copy = Uint8Array.from(jpg);
    copy[sof + 5] = height >> 8; copy[sof + 6] = height & 255; copy[sof + 7] = width >> 8; copy[sof + 8] = width & 255;
    return copy;
  };
  assert.throws(() => decodeJpeg(forged(20000, 20000)), imageError('too-large'));
  assert.throws(() => decodeJpeg(forged(0, 9)), imageError('malformed'));
  assert.throws(() => decodeJpeg(forged(65535, 400)), imageError('too-large'));
  for (const [w, h] of [[16, 8], [64, 64], [1, 1]] as const) {
    try { decodeJpeg(forged(w, h)); } catch (error) { assert.ok(error instanceof ImageError); }
  }
  assert.throws(() => decodeJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), imageError('malformed'));
  assert.throws(() => decodeJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x01])), imageError('malformed'));
  assert.throws(() => decodeJpeg(Uint8Array.from([0x00, 0x01, 0x02])), imageError('malformed'));
  assert.doesNotThrow(() => decodeJpeg(withOrientation(jpg, 6)));
});

test('WebP: a lying chunk size or RIFF size is malformed', () => {
  for (const base64 of [LOSSY_WEBP, LOSSLESS_WEBP]) {
    const file = webp(base64);
    const chunkLie = Uint8Array.from(file);
    new DataView(chunkLie.buffer).setUint32(16, 0x7fffff00, true);
    assert.throws(() => identify(chunkLie), imageError('malformed'));
    const riffLie = Uint8Array.from(file);
    new DataView(riffLie.buffer).setUint32(4, file.length + 1000, true);
    assert.throws(() => identify(riffLie), imageError('malformed'));
    const noHeader = Uint8Array.from(file);
    noHeader[20] = 0;
    noHeader[23] = 0;
    assert.throws(() => identify(noHeader), imageError());
  }
});

test('WebP: decodeWebp on a hostile file is an ImageError and leaves no temp files', async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'nmsh-gfx-'));
  try {
    const lying = Uint8Array.from(webp(LOSSY_WEBP));
    new DataView(lying.buffer).setUint32(16, 0x7fffff00, true);
    await assert.rejects(decodeWebp(lying, {scratchDir: dir}), imageError('malformed'));
    await assert.rejects(decodeWebp(png, {scratchDir: dir}), imageError('malformed'));
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Recompute every chunk CRC that still fits, so a mutation reaches the decoder instead of dying at the checksum. */
function fixCrcs(bytes: Uint8Array): Uint8Array {
  const out = Uint8Array.from(bytes);
  const view = new DataView(out.buffer);
  for (let at = 8; at + 12 <= out.length;) {
    const length = view.getUint32(at);
    if (at + 12 + length > out.length) break;
    view.setUint32(at + 8 + length, crc32(out, at + 4, at + 8 + length));
    at += 12 + length;
  }
  return out;
}

function mutate(source: Uint8Array, random: () => number): Uint8Array {
  let bytes: Uint8Array = Uint8Array.from(source);
  const edits = 1 + Math.floor(random() * 4);
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(random() * bytes.length);
    const kind = Math.floor(random() * 5);
    if (kind === 0) bytes[at] = Math.floor(random() * 256);
    else if (kind === 1) bytes[at] = bytes[at]! ^ (1 << Math.floor(random() * 8));
    else if (kind === 2) bytes = bytes.subarray(0, Math.max(1, at));
    else if (kind === 3) bytes = concat([bytes.subarray(0, at), Uint8Array.from({length: 1 + Math.floor(random() * 8)}, () => Math.floor(random() * 256)), bytes.subarray(at)]);
    else bytes = concat([bytes.subarray(0, at), bytes.subarray(Math.min(bytes.length, at + 1 + Math.floor(random() * 6)))]);
    if (bytes.length === 0) bytes = Uint8Array.from([0]);
  }
  return source[0] === 0x89 && random() < 0.7 ? fixCrcs(bytes) : bytes;
}

test('seeded fuzzing: at least 600 mutations per format only ever yield a raster or an ImageError, in time', async () => {
  const seeds: [string, Uint8Array][] = [['png', png], ['png', pngAdam7], ['gif', gif], ['gif', encodeGif({width: 9, height: 7, frames: [{width: 9, height: 7, indices: Array.from({length: 63}, (_, i) => (i * 5) % 4), localPalette: palette, transparent: 2}]})], ['jpeg', jpg], ['jpeg', withOrientation(jpg, 5)], ['webp', webp(LOSSY_WEBP)], ['webp', webp(LOSSLESS_WEBP)]];
  const random = rng(0x22);
  const started = Date.now();
  let accepted = 0;
  for (const [format, seed] of seeds) {
    for (let i = 0; i < 300; i++) {
      const input = mutate(seed, random);
      const before = Date.now();
      try {
        if (format === 'png') decodePng(input);
        else if (format === 'gif') decodeGif(input);
        else if (format === 'jpeg') decodeJpeg(input);
        else identify(input);
        accepted++;
        const via = await decodeImage(input);
        assert.ok(via.raster.width > 0 || format === 'webp');
      } catch (error) {
        assert.ok(error instanceof ImageError, `${format} mutation ${i}: ${String(error)}`);
      }
      assert.ok(Date.now() - before < 3000, `${format} mutation ${i} took too long`);
    }
  }
  assert.ok(Date.now() - started < 60_000);
  assert.ok(accepted > 100, `only ${accepted} mutations reached a decoder`);
});
