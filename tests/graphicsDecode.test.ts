import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jpeg from 'jpeg-js';
import {identify} from '../src/graphics/formats.js';
import {decodePng} from '../src/graphics/png.js';
import {decodeGif} from '../src/graphics/gif.js';
import {applyOrientation, decodeJpeg, readExifOrientation} from '../src/graphics/jpeg.js';
import {decodeWebp, webpDecoderAvailable} from '../src/graphics/webp.js';
import {decodeImage, readImageFile} from '../src/graphics/decode.js';
import {IMAGE_LIMITS, ImageError, type Raster} from '../src/graphics/raster.js';
import {chunk, concat, encodePng, ihdr, PNG_SIGNATURE, type PngSpec} from './support/pngEncoder.js';
import {LOSSLESS_WEBP, LOSSY_WEBP, expectedRgba, sampleSpec, webp, withOrientation} from './support/graphicsFixtures.js';
import {encodeGif} from './support/gifEncoder.js';


function tmpDir(): string {
  return fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'nmsh-gfx-'));
}

const COMBOS: [PngSpec['colorType'], PngSpec['bitDepth']][] = [
  [0, 1], [0, 2], [0, 4], [0, 8], [0, 16], [2, 8], [2, 16], [3, 1], [3, 2], [3, 4], [3, 8], [4, 8], [4, 16], [6, 8], [6, 16],
];

test('PNG: every colour type and depth, every filter, plain and Adam7, decodes to the exact pixels', () => {
  for (const [colorType, bitDepth] of COMBOS) {
    for (const interlace of [false, true]) {
      for (const filter of [0, 1, 2, 3, 4, 'cycle'] as const) {
        const spec = sampleSpec(colorType, bitDepth, 11, 9, {interlace, filter});
        const raster = decodePng(encodePng(spec));
        assert.equal(raster.width, 11);
        assert.equal(raster.height, 9);
        assert.deepEqual(Array.from(raster.data), expectedRgba(spec), `type ${colorType} depth ${bitDepth} interlace ${interlace} filter ${filter}`);
      }
    }
  }
});

test('PNG: tiny sizes, including images smaller than the Adam7 pattern', () => {
  for (const [w, h] of [[1, 1], [1, 5], [5, 1], [2, 2], [3, 3]]) {
    const spec = sampleSpec(6, 8, w!, h!, {interlace: true, filter: 'cycle'});
    assert.deepEqual(Array.from(decodePng(encodePng(spec)).data), expectedRgba(spec));
  }
});

test('PNG: palette alpha and colour-key transparency', () => {
  const indexed = sampleSpec(3, 2, 4, 2, {trns: [0, 128]});
  const raster = decodePng(encodePng(indexed));
  assert.deepEqual(Array.from(raster.data), expectedRgba(indexed));
  assert.equal(raster.data[3], 128);

  const gray = decodePng(encodePng({width: 2, height: 1, colorType: 0, bitDepth: 16, samples: [0x1234, 0x4321], trns: [0x12, 0x34]}));
  assert.deepEqual(Array.from(gray.data), [0x12, 0x12, 0x12, 0, 0x43, 0x43, 0x43, 255]);

  const rgb = decodePng(encodePng({width: 2, height: 1, colorType: 2, bitDepth: 8, samples: [1, 2, 3, 1, 2, 4], trns: [0, 1, 0, 2, 0, 3]}));
  assert.deepEqual(Array.from(rgb.data), [1, 2, 3, 0, 1, 2, 4, 255]);
});

test('PNG: ancillary chunks are ignored and only the default image of an APNG is decoded', () => {
  const spec = sampleSpec(6, 8, 3, 3, {extraChunks: [{type: 'tEXt', data: Uint8Array.from([97, 0, 98])}, {type: 'acTL', data: new Uint8Array(8)}]});
  const bytes = encodePng(spec);
  assert.equal(identify(bytes).animated, true);
  assert.deepEqual(Array.from(decodePng(bytes).data), expectedRgba(spec));
});

test('identify: PNG size, alpha and animation come from the header alone', () => {
  assert.deepEqual(identify(encodePng(sampleSpec(2, 8, 7, 3))), {format: 'png', width: 7, height: 3, animated: false, alpha: false, bytes: encodePng(sampleSpec(2, 8, 7, 3)).length});
  assert.equal(identify(encodePng(sampleSpec(6, 8, 2, 2))).alpha, true);
  assert.equal(identify(encodePng(sampleSpec(4, 8, 2, 2))).alpha, true);
  assert.equal(identify(encodePng(sampleSpec(2, 8, 2, 2, {trns: [0, 1, 0, 1, 0, 1]}))).alpha, true);
  // a header followed by nothing is enough
  const headerOnly = concat([PNG_SIGNATURE, chunk('IHDR', ihdr(40, 30, 8, 2))]);
  assert.equal(identify(headerOnly).width, 40);
});

test('identify: GIF, JPEG, WebP, SVG and unknown data', () => {
  const palette = [[0, 0, 0], [255, 255, 255]];
  const one = encodeGif({width: 3, height: 2, palette, frames: [{width: 3, height: 2, indices: [0, 1, 0, 1, 0, 1], transparent: 0}]});
  assert.deepEqual(identify(one), {format: 'gif', width: 3, height: 2, animated: false, alpha: true, bytes: one.length});
  const two = encodeGif({width: 3, height: 2, palette, frames: [{width: 3, height: 2, indices: [0, 1, 0, 1, 0, 1]}, {width: 3, height: 2, indices: [1, 1, 1, 1, 1, 1]}]});
  assert.equal(identify(two).animated, true);
  assert.equal(identify(two).alpha, false);

  const jpg = jpeg.encode({width: 13, height: 7, data: new Uint8Array(13 * 7 * 4).fill(200)}, 80).data;
  assert.deepEqual(identify(jpg), {format: 'jpeg', width: 13, height: 7, animated: false, alpha: false, bytes: jpg.length});

  assert.deepEqual(identify(webp(LOSSY_WEBP)), {format: 'webp', width: 8, height: 8, animated: false, alpha: false, bytes: 110});
  assert.deepEqual(identify(webp(LOSSLESS_WEBP)), {format: 'webp', width: 8, height: 8, animated: false, alpha: false, bytes: 66});

  const riff = (chunks: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + chunks.length);
    out.set(Buffer.from('RIFF....WEBP', 'latin1'));
    new DataView(out.buffer).setUint32(4, 4 + chunks.length, true);
    out.set(chunks, 12);
    return out;
  };
  const vp8x = new Uint8Array(18);
  vp8x.set(Buffer.from('VP8X'));
  vp8x[4] = 10;
  vp8x[8] = 0x12; // animation + alpha
  vp8x[12] = 99; // canvas width - 1 = 100
  vp8x[15] = 49; // canvas height - 1 = 50
  const animated = identify(riff(vp8x));
  assert.deepEqual([animated.width, animated.height, animated.animated, animated.alpha], [100, 50, true, true]);

  assert.equal(identify(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="5"/>')).format, 'svg');
  assert.equal(identify(Buffer.from('\n  <?xml version="1.0"?><svg/>')).format, 'svg');
  assert.equal(identify(Buffer.from('<?xml version="1.0"?><note/>')).format, 'unknown');
  assert.equal(identify(Buffer.from('hello')).format, 'unknown');
  assert.equal(identify(new Uint8Array(0)).format, 'unknown');
});

test('GIF: palettes, transparency, interlace, frame offsets, first frame only', () => {
  const palette = [[10, 20, 30], [200, 100, 50], [0, 255, 0], [1, 2, 3]];
  const indices = Array.from({length: 7 * 11}, (_, i) => (i * 7) % 4);
  const rgba = (idx: number[]): number[] => idx.flatMap((i) => [...palette[i]!, 255]);
  const plain = decodeGif(encodeGif({width: 7, height: 11, palette, frames: [{width: 7, height: 11, indices}]}));
  assert.deepEqual(Array.from(plain.data), rgba(indices));
  const interlaced = decodeGif(encodeGif({width: 7, height: 11, palette, frames: [{width: 7, height: 11, indices, interlaced: true}]}));
  assert.deepEqual(Array.from(interlaced.data), rgba(indices));

  const local = decodeGif(encodeGif({width: 2, height: 1, frames: [{width: 2, height: 1, indices: [0, 1], localPalette: [[9, 9, 9], [8, 8, 8]]}]}));
  assert.deepEqual(Array.from(local.data), [9, 9, 9, 255, 8, 8, 8, 255]);

  const transparent = decodeGif(encodeGif({width: 3, height: 1, palette, frames: [{width: 3, height: 1, indices: [0, 1, 2], transparent: 1}]}));
  assert.deepEqual(Array.from(transparent.data), [10, 20, 30, 255, 0, 0, 0, 0, 0, 255, 0, 255]);

  const offset = decodeGif(encodeGif({width: 4, height: 3, palette, frames: [{left: 1, top: 2, width: 2, height: 1, indices: [2, 2]}]}));
  assert.equal(offset.width, 4);
  assert.equal(offset.data[3], 0);
  assert.deepEqual(Array.from(offset.data.slice((2 * 4 + 1) * 4, (2 * 4 + 3) * 4)), [0, 255, 0, 255, 0, 255, 0, 255]);

  const big = Array.from({length: 64 * 64}, (_, i) => (i * i + (i >> 3)) % 4);
  const long = decodeGif(encodeGif({width: 64, height: 64, palette, frames: [{width: 64, height: 64, indices: big}, {width: 64, height: 64, indices: indices.slice(0, 1).concat(big.slice(1))}]}));
  assert.deepEqual(Array.from(long.data), rgba(big), 'LZW survives table growth and first frame wins');

  const huge = Array.from({length: 200 * 200}, (_, i) => (i * 2654435761 >>> 11) % 256);
  const wide = Array.from({length: 256}, (_, i) => [i, 255 - i, i >> 1]);
  assert.deepEqual(Array.from(decodeGif(encodeGif({width: 200, height: 200, palette: wide, frames: [{width: 200, height: 200, indices: huge}]})).data), huge.flatMap((i) => [...wide[i]!, 255]), 'table resets');
});

test('JPEG: decodes through jpeg-js and reports the size', () => {
  const source = new Uint8Array(16 * 8 * 4);
  for (let i = 0; i < 16 * 8; i++) source.set(i % 16 < 8 ? [240, 30, 30, 255] : [30, 30, 240, 255], i * 4);
  const raster = decodeJpeg(jpeg.encode({width: 16, height: 8, data: source}, 95).data);
  assert.deepEqual([raster.width, raster.height, raster.data.length], [16, 8, 16 * 8 * 4]);
  assert.ok(raster.data[0]! > 200 && raster.data[2]! < 80, 'left half red');
  assert.ok(raster.data[15 * 4]! < 80 && raster.data[15 * 4 + 2]! > 200, 'right half blue');
  assert.equal(raster.data[3], 255);
});

test('JPEG: EXIF orientation 1..8 is applied', () => {
  const base = jpeg.encode({width: 24, height: 16, data: Uint8Array.from({length: 24 * 16 * 4}, (_, i) => (i % 4 === 3 ? 255 : (i >> 2) % 24 < 12 ? 230 : 25))}, 98).data;
  const upright = decodeJpeg(base);
  for (let orientation = 1; orientation <= 8; orientation++) {
    for (const little of [true, false]) {
      const file = withOrientation(base, orientation, little);
      assert.equal(readExifOrientation(file), orientation);
      const raster = decodeJpeg(file);
      assert.deepEqual([raster.width, raster.height], orientation >= 5 ? [16, 24] : [24, 16]);
    }
  }
  // 6 turns the picture clockwise: the left (bright) half ends up on top
  const six = decodeJpeg(withOrientation(base, 6));
  assert.ok(six.data[0]! > 180 && six.data[(23 * 16) * 4]! < 80);
  // 3 is a half turn, 2 mirrors
  const three = decodeJpeg(withOrientation(base, 3));
  assert.ok(three.data[0]! < 80 && three.data[23 * 4]! > 180);
  assert.deepEqual(Array.from(applyOrientation(applyOrientation(upright, 6), 8).data), Array.from(upright.data));
  assert.deepEqual(Array.from(applyOrientation(applyOrientation(upright, 6), 6).data), Array.from(applyOrientation(upright, 3).data));
  assert.deepEqual(Array.from(applyOrientation(applyOrientation(upright, 5), 5).data), Array.from(upright.data));
  assert.deepEqual(Array.from(applyOrientation(applyOrientation(upright, 2), 4).data), Array.from(applyOrientation(upright, 3).data));
  assert.equal(readExifOrientation(base), 1);
  // hostile EXIF: an out-of-range IFD offset and a nonsense value fall back to upright
  const bad = Buffer.from(withOrientation(base, 6));
  bad.writeUInt32LE(0xfffffff0, 2 + 2 + 2 + 6 + 4);
  assert.equal(readExifOrientation(bad), 1);
  assert.equal(readExifOrientation(withOrientation(base, 9)), 1);
});

test('boundaries: 1x1, the widest allowed image, and one pixel over each limit', () => {
  assert.deepEqual(Array.from(decodePng(encodePng({width: 1, height: 1, colorType: 6, bitDepth: 8, samples: [1, 2, 3, 4]})).data), [1, 2, 3, 4]);
  const widest = decodePng(encodePng({width: IMAGE_LIMITS.maxDimension, height: 1, colorType: 0, bitDepth: 8, samples: new Array(IMAGE_LIMITS.maxDimension).fill(7)}));
  assert.equal(widest.width, IMAGE_LIMITS.maxDimension);
  const header = (w: number, h: number): Uint8Array => concat([PNG_SIGNATURE, chunk('IHDR', ihdr(w, h, 8, 0))]);
  assert.throws(() => identify(header(IMAGE_LIMITS.maxDimension + 1, 1)), (e: unknown) => e instanceof ImageError && e.code === 'too-large');
  assert.throws(() => identify(header(5000, 5000)), (e: unknown) => e instanceof ImageError && e.code === 'too-large');
  assert.equal(identify(header(4000, 6000)).width, 4000);
  assert.throws(() => identify(header(0, 5)), (e: unknown) => e instanceof ImageError && e.code === 'malformed');
});

const converter = await webpDecoderAvailable();

test('WebP: lossy and lossless fixtures decode through an installed converter', {skip: converter.available ? false : 'no WebP converter installed'}, async () => {
  const dir = tmpDir();
  try {
    for (const fixture of [LOSSY_WEBP, LOSSLESS_WEBP]) {
      const raster = await decodeWebp(webp(fixture), {scratchDir: dir});
      assert.deepEqual([raster.width, raster.height], [8, 8]);
      const at = (x: number, y: number): number[] => Array.from(raster.data.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 3));
      const near = (actual: number[], want: number[]): void => assert.ok(actual.every((v, i) => Math.abs(v - want[i]!) <= 40), `${actual} vs ${want}`);
      near(at(1, 1), [220, 200, 90]);
      near(at(6, 1), [20, 200, 90]);
      near(at(1, 6), [220, 40, 90]);
      near(at(6, 6), [20, 40, 90]);
    }
    assert.deepEqual(fs.readdirSync(dir), [], 'the temp directory is removed');
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('WebP: without a converter the error names what to install', async () => {
  if (converter.available) return;
  await assert.rejects(decodeWebp(webp(LOSSY_WEBP), {scratchDir: tmpDir()}), (e: unknown) => e instanceof ImageError && e.code === 'unavailable' && /install/.test(e.message));
});

test('decodeImage dispatches on content and refuses SVG and unknown data', async () => {
  const png = encodePng(sampleSpec(6, 8, 3, 2));
  const {info, raster} = await decodeImage(png);
  assert.equal(info.format, 'png');
  assert.equal(raster.width, 3);
  await assert.rejects(decodeImage(Buffer.from('<svg/>')), (e: unknown) => e instanceof ImageError && e.code === 'unsupported' && /SVG/.test(e.message));
  await assert.rejects(decodeImage(Buffer.from('plain text')), (e: unknown) => e instanceof ImageError && e.code === 'unsupported');
  await assert.rejects(decodeImage(webp(LOSSY_WEBP)), (e: unknown) => e instanceof ImageError && e.code === 'unavailable');
  if (converter.available) {
    const dir = tmpDir();
    try {
      assert.equal((await decodeImage(webp(LOSSLESS_WEBP), {scratchDir: dir})).info.format, 'webp');
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  }
});

test('readImageFile: regular files only, size bounded, FIFOs and directories refused', async () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'a.png');
    fs.writeFileSync(file, encodePng(sampleSpec(0, 8, 2, 2)));
    assert.equal((await readImageFile(file)).bytes.length, fs.statSync(file).size);
    await assert.rejects(readImageFile(file, {maxBytes: 10}), (e: unknown) => e instanceof ImageError && e.code === 'too-large');

    await assert.rejects(readImageFile(dir), (e: unknown) => e instanceof ImageError && e.code === 'unsafe');
    const fifo = path.join(dir, 'pipe');
    execFileSync('mkfifo', [fifo]);
    await assert.rejects(readImageFile(fifo), (e: unknown) => e instanceof ImageError && e.code === 'unsafe');

    const big = path.join(dir, 'big.bin');
    fs.closeSync(fs.openSync(big, 'w'));
    fs.truncateSync(big, IMAGE_LIMITS.maxFileBytes + 1);
    await assert.rejects(readImageFile(big), (e: unknown) => e instanceof ImageError && e.code === 'too-large');
    await assert.rejects(readImageFile(path.join(dir, 'missing')), (e: unknown) => e instanceof ImageError);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
