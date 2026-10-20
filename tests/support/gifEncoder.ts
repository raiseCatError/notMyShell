/** A tiny GIF encoder (with a real LZW compressor) for building decoder test inputs. */
import {concat} from './pngEncoder.js';

export interface GifFrame {
  left?: number;
  top?: number;
  width: number;
  height: number;
  /** Colour indices, row-major in display order (interlacing is applied by the encoder). */
  indices: number[];
  interlaced?: boolean;
  localPalette?: number[][];
  transparent?: number;
  minCodeSize?: number;
}

export interface GifSpec {
  width: number;
  height: number;
  palette?: number[][];
  frames: GifFrame[];
}

function tableBytes(palette: number[][]): { bytes: Uint8Array; sizeField: number } {
  let sizeField = 0;
  while (1 << (sizeField + 1) < palette.length) sizeField++;
  const bytes = new Uint8Array(3 * (1 << (sizeField + 1)));
  palette.forEach((color, i) => bytes.set(color, i * 3));
  return {bytes, sizeField};
}

export function lzwEncode(indices: number[], minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const out: number[] = [];
  let acc = 0, bits = 0, size = minCodeSize + 1;
  const emit = (code: number): void => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; }
  };
  let dict = new Map<string, number>();
  let next = clear + 2;
  emit(clear);
  let current = '';
  const key = (prefix: string, value: number): string => `${prefix},${value}`;
  let currentCode = -1;
  for (const value of indices) {
    if (currentCode === -1) { currentCode = value; current = String(value); continue; }
    const candidate = key(current, value);
    const found = dict.get(candidate);
    if (found !== undefined) { currentCode = found; current = candidate; continue; }
    emit(currentCode);
    dict.set(candidate, next++);
    if (next - 1 === (1 << size) && size < 12) size++;
    if (next >= 4096) {
      emit(clear);
      dict = new Map();
      next = clear + 2;
      size = minCodeSize + 1;
    }
    currentCode = value;
    current = String(value);
  }
  if (currentCode !== -1) emit(currentCode);
  emit(clear + 1);
  if (bits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}

export function subBlocks(data: Uint8Array): Uint8Array {
  const parts: number[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const slice = data.subarray(i, i + 255);
    parts.push(slice.length, ...slice);
  }
  parts.push(0);
  return Uint8Array.from(parts);
}

export function interlaceOrder(height: number): number[] {
  const rows: number[] = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) for (let y = start; y < height; y += step) rows.push(y);
  return rows;
}

export function encodeGif(spec: GifSpec, tweak: {minCodeSizeByte?: number; rawLzw?: Uint8Array} = {}): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0)))];
  const global = spec.palette ? tableBytes(spec.palette) : undefined;
  parts.push(Uint8Array.from([spec.width & 255, spec.width >> 8, spec.height & 255, spec.height >> 8, global ? 0x80 | global.sizeField : 0, 0, 0]));
  if (global) parts.push(global.bytes);
  for (const frame of spec.frames) {
    if (frame.transparent !== undefined) parts.push(Uint8Array.from([0x21, 0xf9, 4, 1, 0, 0, frame.transparent, 0]));
    else parts.push(Uint8Array.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0]));
    const local = frame.localPalette ? tableBytes(frame.localPalette) : undefined;
    const left = frame.left ?? 0, top = frame.top ?? 0;
    parts.push(Uint8Array.from([0x2c, left & 255, left >> 8, top & 255, top >> 8, frame.width & 255, frame.width >> 8, frame.height & 255, frame.height >> 8,
      (local ? 0x80 | local.sizeField : 0) | (frame.interlaced ? 0x40 : 0)]));
    if (local) parts.push(local.bytes);
    const colors = (frame.localPalette ?? spec.palette ?? []).length;
    let minCodeSize = frame.minCodeSize ?? Math.max(2, Math.ceil(Math.log2(Math.max(colors, 2))));
    let stored = frame.indices;
    if (frame.interlaced) {
      stored = [];
      for (const y of interlaceOrder(frame.height)) stored.push(...frame.indices.slice(y * frame.width, (y + 1) * frame.width));
    }
    parts.push(Uint8Array.from([tweak.minCodeSizeByte ?? minCodeSize]), subBlocks(tweak.rawLzw ?? lzwEncode(stored, minCodeSize)));
    minCodeSize = 0;
  }
  parts.push(Uint8Array.from([0x3b]));
  return concat(parts);
}
