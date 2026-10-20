import {deflateSync} from 'node:zlib';
import {checkDimensions, type Raster} from './raster.js';
import {assertRaster} from './scale.js';

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const BPP = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = ~seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Filter one row with PNG filter `type` (0 none, 1 sub, 2 up, 3 average, 4 paeth) into `out` (after its type byte). */
function filterRow(type: number, row: Uint8ClampedArray, offset: number, prior: number, rowBytes: number, out: Uint8Array, at: number): number {
  let cost = 0;
  for (let i = 0; i < rowBytes; i += 1) {
    const x = row[offset + i]!;
    const a = i >= BPP ? row[offset + i - BPP]! : 0;
    const b = prior >= 0 ? row[prior + i]! : 0;
    const c = prior >= 0 && i >= BPP ? row[prior + i - BPP]! : 0;
    const predicted = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : paeth(a, b, c);
    const value = (x - predicted) & 255;
    out[at + i] = value;
    cost += value < 128 ? value : 256 - value;
  }
  return cost;
}

export interface PngOptions {
  /** zlib level 0-9 (default 6). */
  level?: number;
  /** Force one PNG filter type for every row; the default picks the cheapest per row by sum of absolute differences. */
  filter?: 'auto' | 0 | 1 | 2 | 3 | 4;
}

/** A valid 8-bit RGBA PNG. Pixels are written as given (straight alpha), so decoding gives the raster back exactly. */
export function encodePng(raster: Raster, options: PngOptions = {}): Uint8Array {
  assertRaster(raster);
  checkDimensions(raster.width, raster.height);
  const {width, height} = raster;
  const rowBytes = width * BPP;
  const level = Number.isInteger(options.level) ? Math.max(0, Math.min(9, options.level!)) : 6;
  const forced = options.filter ?? 'auto';
  const raw = new Uint8Array(height * (rowBytes + 1));
  const scratch = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const offset = y * rowBytes;
    const prior = y > 0 ? offset - rowBytes : -1;
    const at = y * (rowBytes + 1);
    let best: number = forced === 'auto' ? 0 : forced;
    if (forced === 'auto') {
      let bestCost = Infinity;
      for (let type = 0; type < 5; type += 1) {
        const cost = filterRow(type, raster.data, offset, prior, rowBytes, scratch, 0);
        if (cost < bestCost) { bestCost = cost; best = type; }
      }
    }
    raw[at] = best;
    filterRow(best, raster.data, offset, prior, rowBytes, raw, at + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const parts = [SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, {level})), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) { out.set(part, cursor); cursor += part.length; }
  return out;
}

/** Raw RGBA bytes for Kitty `f=32`, optionally zlib-compressed for `o=z`. Uncompressed, the payload views the raster's own buffer. */
export function kittyRgba(raster: Raster, options: {compress?: boolean} = {}): {payload: Uint8Array; format: 'RGBA'; compressed: boolean} {
  assertRaster(raster);
  const bytes = new Uint8Array(raster.data.buffer, raster.data.byteOffset, raster.width * raster.height * BPP);
  if (options.compress) return {payload: new Uint8Array(deflateSync(bytes)), format: 'RGBA', compressed: true};
  return {payload: bytes, format: 'RGBA', compressed: false};
}
