/**
 * GIF decoder: the first frame only, composited onto a transparent canvas the size of the logical screen.
 * LZW is strict: code widths 1..12, no code beyond the next free slot, and exactly the pixels the frame rectangle needs.
 */
import {checkDimensions, type Raster} from './raster.js';
import {guard, malformed, u16le, u8} from './formats.js';

export const INTERLACE_PASSES: readonly (readonly [number, number])[] = [[0, 8], [4, 8], [2, 4], [1, 2]];

export function decodeGif(bytes: Uint8Array): Raster {
  return guard(() => decode(bytes));
}

/** Concatenate a run of data sub-blocks starting at `index`; returns the data and the index after the terminator. */
export function readSubBlocks(bytes: Uint8Array, start: number, check: () => void = () => {}): {data: Uint8Array; next: number} {
  const parts: Uint8Array[] = [];
  let total = 0;
  let index = start;
  for (;;) {
    check();
    const size = u8(bytes, index);
    index++;
    if (size === 0) break;
    if (index + size > bytes.length) throw malformed('truncated');
    parts.push(bytes.subarray(index, index + size));
    total += size;
    index += size;
  }
  const data = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    data.set(part, at);
    at += part.length;
  }
  return {data, next: index};
}

/** @internal Shared strict LZW engine; animation supplies bounded cancellation checks. */
export function lzw(data: Uint8Array, minCodeSize: number, count: number, check: () => void = () => {}): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  const out = new Uint8Array(count);
  let produced = 0;
  let size = minCodeSize + 1;
  let next = clear + 2;
  let previous = -1;
  let first = 0;
  let bits = 0;
  let acc = 0;
  let pos = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  for (;;) {
    check();
    while (bits < size) {
      if (pos >= data.length) throw malformed('image data ended early');
      acc |= data[pos++]! << bits;
      bits += 8;
    }
    const code = acc & ((1 << size) - 1);
    acc >>>= size;
    bits -= size;
    if (code === clear) {
      size = minCodeSize + 1;
      next = clear + 2;
      previous = -1;
      continue;
    }
    if (code === end) break;
    if (previous === -1) {
      if (code >= clear) throw malformed('bad first code');
      if (produced >= count) throw malformed('too much image data');
      out[produced++] = code;
      previous = code;
      first = code;
      continue;
    }
    if (code > next || (code === next && next >= 4096)) throw malformed('code out of range');
    let top = 0;
    let walk = code;
    if (code === next) {
      stack[top++] = first;
      walk = previous;
    }
    while (walk >= clear) {
      stack[top++] = suffix[walk]!;
      walk = prefix[walk]!;
    }
    first = walk;
    stack[top++] = walk;
    if (produced + top > count) throw malformed('too much image data');
    while (top > 0) out[produced++] = stack[--top]!;
    if (next < 4096) {
      prefix[next] = previous;
      suffix[next] = first;
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    previous = code;
  }
  if (produced !== count) throw malformed('image data ended early');
  return out;
}

function decode(bytes: Uint8Array): Raster {
  if (bytes.length < 13 || String.fromCharCode(...bytes.subarray(0, 3)) !== 'GIF') throw malformed('not a GIF');
  const width = u16le(bytes, 6);
  const height = u16le(bytes, 8);
  checkDimensions(width, height);
  const flags = u8(bytes, 10);
  let index = 13;
  let globalTable: Uint8Array | undefined;
  if (flags & 0x80) {
    const length = 3 * (1 << ((flags & 7) + 1));
    if (index + length > bytes.length) throw malformed('truncated');
    globalTable = bytes.subarray(index, index + length);
    index += length;
  }
  let transparent = -1;
  for (;;) {
    const block = u8(bytes, index);
    index++;
    if (block === 0x21) {
      const label = u8(bytes, index);
      const body = readSubBlocks(bytes, index + 1);
      if (label === 0xf9 && body.data.length >= 4 && (body.data[0]! & 1)) transparent = body.data[3]!;
      index = body.next;
    } else if (block === 0x2c) {
      break;
    } else {
      throw malformed(block === 0x3b ? 'no image' : 'unknown block');
    }
  }
  const left = u16le(bytes, index);
  const top = u16le(bytes, index + 2);
  const frameWidth = u16le(bytes, index + 4);
  const frameHeight = u16le(bytes, index + 6);
  const frameFlags = u8(bytes, index + 8);
  index += 9;
  if (frameWidth < 1 || frameHeight < 1 || left + frameWidth > width || top + frameHeight > height) throw malformed('frame outside the screen');
  let table = globalTable;
  if (frameFlags & 0x80) {
    const length = 3 * (1 << ((frameFlags & 7) + 1));
    if (index + length > bytes.length) throw malformed('truncated');
    table = bytes.subarray(index, index + length);
    index += length;
  }
  if (!table) throw malformed('no colour table');
  const minCodeSize = u8(bytes, index);
  index++;
  if (minCodeSize < 1 || minCodeSize > 8) throw malformed('bad code size');
  const indices = lzw(readSubBlocks(bytes, index).data, minCodeSize, frameWidth * frameHeight);

  const out = new Uint8ClampedArray(width * height * 4);
  const rows: number[] = [];
  if (frameFlags & 0x40) for (const [start, step] of INTERLACE_PASSES) for (let y = start; y < frameHeight; y += step) rows.push(y);
  for (let line = 0; line < frameHeight; line++) {
    const y = frameFlags & 0x40 ? rows[line]! : line;
    for (let x = 0; x < frameWidth; x++) {
      const value = indices[line * frameWidth + x]!;
      if (value === transparent) continue;
      if (value * 3 + 2 >= table.length) throw malformed('colour index out of range');
      const at = ((top + y) * width + left + x) * 4;
      out[at] = table[value * 3]!;
      out[at + 1] = table[value * 3 + 1]!;
      out[at + 2] = table[value * 3 + 2]!;
      out[at + 3] = 255;
    }
  }
  return {width, height, data: out};
}
