/** A tiny PNG encoder for building decoder test inputs: every colour type, depth, interlace and filter. */
import zlib from 'node:zlib';
import {crc32} from '../../src/graphics/png.js';

export interface PngSpec {
  width: number;
  height: number;
  colorType: 0 | 2 | 3 | 4 | 6;
  bitDepth: 1 | 2 | 4 | 8 | 16;
  /** One value per sample, row-major: `(y * width + x) * channels + c`, each in 0..2^bitDepth-1. */
  samples: number[];
  palette?: number[][];
  trns?: number[];
  interlace?: boolean;
  /** A filter type 0..4, or 'cycle' to use a different one on each row. */
  filter?: number | 'cycle';
  /** Chunks inserted before IDAT. */
  extraChunks?: {type: string; data: Uint8Array}[];
}

export const CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4} as const;
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;

export function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

export function ihdr(width: number, height: number, bitDepth: number, colorType: number, interlace = 0): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = bitDepth;
  data[9] = colorType;
  data[12] = interlace;
  return data;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function filterRow(type: number, row: Uint8Array, previous: Uint8Array, unit: number): Uint8Array {
  const out = new Uint8Array(row.length + 1);
  out[0] = type;
  for (let i = 0; i < row.length; i++) {
    const left = i >= unit ? row[i - unit]! : 0;
    const up = previous[i]!;
    const upLeft = i >= unit ? previous[i - unit]! : 0;
    const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][type]!;
    out[i + 1] = (row[i]! - predictor) & 0xff;
  }
  return out;
}

function pack(values: number[], depth: number): Uint8Array {
  const out = new Uint8Array(Math.ceil((values.length * depth) / 8));
  values.forEach((value, i) => {
    if (depth === 16) {
      out[2 * i] = value >> 8;
      out[2 * i + 1] = value & 0xff;
    } else if (depth === 8) out[i] = value;
    else {
      const bit = i * depth;
      out[bit >> 3]! |= value << (8 - depth - (bit & 7));
    }
  });
  return out;
}

/** The scanlines (filter byte included) for the whole image, in transmission order. */
export function rawScanlines(spec: PngSpec): Uint8Array {
  const channels = CHANNELS[spec.colorType];
  const unit = Math.max(1, (channels * spec.bitDepth) >> 3);
  const passes = spec.interlace ? ADAM7 : ([[0, 0, 1, 1]] as const);
  const rows: Uint8Array[] = [];
  let counter = 0;
  for (const [x0, y0, dx, dy] of passes) {
    let previous: Uint8Array | undefined;
    for (let y = y0; y < spec.height; y += dy) {
      const values: number[] = [];
      for (let x = x0; x < spec.width; x += dx) for (let c = 0; c < channels; c++) values.push(spec.samples[(y * spec.width + x) * channels + c]!);
      if (values.length === 0) break;
      const row = pack(values, spec.bitDepth);
      previous ??= new Uint8Array(row.length);
      const type = spec.filter === 'cycle' ? counter++ % 5 : spec.filter ?? 0;
      rows.push(filterRow(type, row, previous, unit));
      previous = row;
    }
  }
  return concat(rows);
}

export function encodePng(spec: PngSpec): Uint8Array {
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr(spec.width, spec.height, spec.bitDepth, spec.colorType, spec.interlace ? 1 : 0))];
  if (spec.palette) parts.push(chunk('PLTE', Uint8Array.from(spec.palette.flat())));
  if (spec.trns) parts.push(chunk('tRNS', Uint8Array.from(spec.trns)));
  for (const extra of spec.extraChunks ?? []) parts.push(chunk(extra.type, extra.data));
  parts.push(chunk('IDAT', zlib.deflateSync(rawScanlines(spec))), chunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

/** A simple deterministic 8-bit RGBA image for round-trip tests. */
export function gradientRgba(width: number, height: number): number[] {
  const samples: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) samples.push((x * 37) & 255, (y * 59) & 255, (x * 11 + y * 7) & 255, 255 - ((x + y) & 63));
  return samples;
}
