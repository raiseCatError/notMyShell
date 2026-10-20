/**
 * PNG decoder: all colour types and depths, PLTE/tRNS, the five filters and Adam7. Only the default image of an APNG is decoded.
 * The inflated size is computed from the header and used as the decompressor's hard ceiling, so a bomb is an `ImageError`.
 */
import zlib from 'node:zlib';
import {IMAGE_LIMITS, ImageError, checkDimensions, type Raster} from './raster.js';
import {guard, malformed, tag, u32be, u8} from './formats.js';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** [x offset, y offset, x step, y step] per Adam7 pass. */
const ADAM7: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
];
const CHANNELS: Record<number, number> = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4};
const DEPTHS: Record<number, readonly number[]> = {0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface Header {
  width: number;
  height: number;
  depth: number;
  colorType: number;
  interlaced: boolean;
}

function passSize(header: Header, pass: readonly [number, number, number, number]): {width: number; height: number} {
  const [x0, y0, dx, dy] = pass;
  return {width: Math.ceil((header.width - x0) / dx), height: Math.ceil((header.height - y0) / dy)};
}

function strideOf(width: number, bitsPerPixel: number): number {
  return Math.ceil((width * bitsPerPixel) / 8);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilter(filter: number, row: Uint8Array, previous: Uint8Array, unit: number): void {
  const length = row.length;
  switch (filter) {
    case 0: return;
    case 1:
      for (let i = unit; i < length; i++) row[i] = row[i]! + row[i - unit]!;
      return;
    case 2:
      for (let i = 0; i < length; i++) row[i] = row[i]! + previous[i]!;
      return;
    case 3:
      for (let i = 0; i < length; i++) row[i] = row[i]! + (((i >= unit ? row[i - unit]! : 0) + previous[i]!) >> 1);
      return;
    case 4:
      for (let i = 0; i < length; i++) {
        const left = i >= unit ? row[i - unit]! : 0;
        const upLeft = i >= unit ? previous[i - unit]! : 0;
        row[i] = row[i]! + paeth(left, previous[i]!, upLeft);
      }
      return;
    default:
      throw malformed('unknown filter');
  }
}

export function decodePng(bytes: Uint8Array): Raster {
  return guard(() => decode(bytes));
}

function decode(bytes: Uint8Array): Raster {
  if (bytes.length < 8 || !SIGNATURE.every((value, index) => bytes[index] === value)) throw malformed('not a PNG');
  let header: Header | undefined;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let sawEnd = false;
  let index = 8;
  while (index < bytes.length) {
    const length = u32be(bytes, index);
    if (length > 0x7fffffff || index + 12 + length > bytes.length) throw malformed('chunk overruns file');
    const kind = tag(bytes, index + 4);
    if (!/^[A-Za-z]{4}$/.test(kind)) throw malformed('bad chunk name');
    const data = index + 8;
    const critical = (bytes[index + 4]! & 0x20) === 0;
    if (critical && crc32(bytes, index + 4, data + length) !== u32be(bytes, data + length)) throw malformed('checksum mismatch');
    if (!header && kind !== 'IHDR') throw malformed('missing header');
    if (kind === 'IHDR') {
      if (header || length !== 13) throw malformed('bad header');
      header = readHeader(bytes, data);
    } else if (kind === 'PLTE') {
      if (length === 0 || length % 3 !== 0 || length > 768) throw malformed('bad palette');
      palette = bytes.subarray(data, data + length);
    } else if (kind === 'tRNS') {
      transparency = bytes.subarray(data, data + length);
    } else if (kind === 'IDAT') {
      idat.push(bytes.subarray(data, data + length));
    } else if (kind === 'IEND') {
      sawEnd = true;
      break;
    }
    index = data + length + 4;
  }
  if (!header) throw malformed('missing header');
  if (!sawEnd) throw malformed('truncated');
  if (idat.length === 0) throw malformed('no image data');
  if (header.colorType === 3 && !palette) throw malformed('missing palette');
  return build(header, idat, palette, transparency);
}

function readHeader(bytes: Uint8Array, at: number): Header {
  const width = u32be(bytes, at);
  const height = u32be(bytes, at + 4);
  checkDimensions(width, height);
  const depth = u8(bytes, at + 8);
  const colorType = u8(bytes, at + 9);
  if (!DEPTHS[colorType]?.includes(depth)) throw malformed('bad colour type or depth');
  if (u8(bytes, at + 10) !== 0 || u8(bytes, at + 11) !== 0) throw malformed('bad compression or filter method');
  const interlace = u8(bytes, at + 12);
  if (interlace > 1) throw malformed('bad interlace method');
  return {width, height, depth, colorType, interlaced: interlace === 1};
}

function build(header: Header, idat: Uint8Array[], palette: Uint8Array | undefined, transparency: Uint8Array | undefined): Raster {
  const {width, height, depth, colorType} = header;
  const channels = CHANNELS[colorType]!;
  const bitsPerPixel = channels * depth;
  const unit = Math.max(1, bitsPerPixel >> 3);
  const passes = header.interlaced ? ADAM7 : ([[0, 0, 1, 1]] as const);

  let expected = 0;
  for (const pass of passes) {
    const size = passSize(header, pass);
    if (size.width > 0 && size.height > 0) expected += size.height * (1 + strideOf(size.width, bitsPerPixel));
  }
  if (expected > IMAGE_LIMITS.maxInflatedBytes) throw new ImageError('too-large', 'The image would need more memory to decode than NMSh allows.');

  let raw: Uint8Array;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat), {maxOutputLength: expected});
  } catch {
    throw malformed('bad or oversized pixel data');
  }
  if (raw.length !== expected) throw malformed('pixel data has the wrong length');

  const out = new Uint8ClampedArray(width * height * 4);
  const maxValue = (1 << Math.min(depth, 8)) - 1;
  const read: (row: Uint8Array, i: number) => number =
    depth === 8 ? (row, i) => row[i]!
    : depth === 16 ? (row, i) => (row[2 * i]! << 8) | row[2 * i + 1]!
    : (row, i) => {
      const bit = i * depth;
      return (row[bit >> 3]! >> (8 - depth - (bit & 7))) & maxValue;
    };
  const to8 = depth === 16 ? (value: number) => value >> 8 : depth < 8 ? (value: number) => Math.round((value * 255) / maxValue) : (value: number) => value;

  // tRNS: per-palette-entry alpha, or a colour key compared against the raw (unscaled) samples.
  const key = transparency && colorType === 0 && transparency.length >= 2 ? [(transparency[0]! << 8) | transparency[1]!]
    : transparency && colorType === 2 && transparency.length >= 6
      ? [(transparency[0]! << 8) | transparency[1]!, (transparency[2]! << 8) | transparency[3]!, (transparency[4]! << 8) | transparency[5]!]
      : undefined;
  const paletteEntries = palette ? palette.length / 3 : 0;

  let pos = 0;
  for (const pass of passes) {
    const [x0, y0, dx, dy] = pass;
    const size = passSize(header, pass);
    if (size.width <= 0 || size.height <= 0) continue;
    const stride = strideOf(size.width, bitsPerPixel);
    let previous = new Uint8Array(stride);
    let row = new Uint8Array(stride);
    for (let y = 0; y < size.height; y++) {
      const filter = raw[pos++]!;
      row.set(raw.subarray(pos, pos + stride));
      pos += stride;
      unfilter(filter, row, previous, unit);
      const base = (y0 + y * dy) * width;
      for (let x = 0; x < size.width; x++) {
        const at = (base + x0 + x * dx) * 4;
        const i = x * channels;
        let r: number, g: number, b: number, a = 255;
        if (colorType === 3) {
          const entry = read(row, i);
          if (entry >= paletteEntries) throw malformed('palette index out of range');
          r = palette![entry * 3]!; g = palette![entry * 3 + 1]!; b = palette![entry * 3 + 2]!;
          if (transparency && entry < transparency.length) a = transparency[entry]!;
        } else if (colorType === 0 || colorType === 4) {
          const value = read(row, i);
          r = g = b = to8(value);
          if (colorType === 4) a = to8(read(row, i + 1));
          else if (key && value === key[0]) a = 0;
        } else {
          const rv = read(row, i), gv = read(row, i + 1), bv = read(row, i + 2);
          r = to8(rv); g = to8(gv); b = to8(bv);
          if (colorType === 6) a = to8(read(row, i + 3));
          else if (key && rv === key[0] && gv === key[1] && bv === key[2]) a = 0;
        }
        out[at] = r; out[at + 1] = g; out[at + 2] = b; out[at + 3] = a;
      }
      [previous, row] = [row, previous];
    }
  }
  return {width, height, data: out};
}
