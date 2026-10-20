/**
 * Header-only image identification, plus the bounds-checked byte readers every decoder shares.
 * `identify` never decodes pixels and never reads outside the buffer: a short or inconsistent header is an `ImageError`.
 */
import {IMAGE_LIMITS, ImageError, checkDimensions, type ImageInfo} from './raster.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function malformed(what: string): ImageError {
  return new ImageError('malformed', `The image is damaged (${what}).`);
}

function need(bytes: Uint8Array, offset: number, length: number, what = 'truncated'): void {
  if (!Number.isInteger(offset) || offset < 0 || length < 0 || offset + length > bytes.length) throw malformed(what);
}

export function u8(bytes: Uint8Array, offset: number): number {
  need(bytes, offset, 1);
  return bytes[offset]!;
}

export function u16be(bytes: Uint8Array, offset: number): number {
  need(bytes, offset, 2);
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

export function u16le(bytes: Uint8Array, offset: number): number {
  need(bytes, offset, 2);
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

export function u32be(bytes: Uint8Array, offset: number): number {
  need(bytes, offset, 4);
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

export function u32le(bytes: Uint8Array, offset: number): number {
  need(bytes, offset, 4);
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

/** Four ASCII bytes as a string, for comparing chunk tags only (never shown to the person). */
export function tag(bytes: Uint8Array, offset: number): string {
  need(bytes, offset, 4);
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

/** Run a decoder body so that nothing but an `ImageError` ever escapes (a stray RangeError or TypeError becomes `malformed`). */
export function guard<T>(body: () => T): T {
  try {
    return body();
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw malformed('unreadable data');
  }
}

export async function guardAsync<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw malformed('unreadable data');
  }
}

/** The first start-of-frame marker of a JPEG: which coding process it uses and the size it declares. */
export function scanJpegFrame(bytes: Uint8Array): {marker: number; width: number; height: number} {
  let index = 2;
  for (let steps = 0; steps < IMAGE_LIMITS.maxChunkScan; steps++) {
    while (index < bytes.length && bytes[index] !== 0xff) index++;
    while (index < bytes.length && bytes[index] === 0xff) index++;
    const marker = u8(bytes, index);
    index++;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (marker === 0xd9 || marker === 0xda) throw malformed('no frame header');
    const length = u16be(bytes, index);
    if (length < 2) throw malformed('bad segment length');
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (length < 8) throw malformed('short frame header');
      return {marker, height: u16be(bytes, index + 3), width: u16be(bytes, index + 5)};
    }
    index += length;
  }
  throw malformed('too many segments');
}

function identifyPng(bytes: Uint8Array): ImageInfo {
  if (u32be(bytes, 8) !== 13 || tag(bytes, 12) !== 'IHDR') throw malformed('missing header');
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  checkDimensions(width, height);
  const colorType = u8(bytes, 25);
  let animated = false;
  let alpha = colorType === 4 || colorType === 6;
  let index = 8;
  for (let steps = 0; steps < IMAGE_LIMITS.maxChunkScan && index + 8 <= bytes.length; steps++) {
    const length = u32be(bytes, index);
    const kind = tag(bytes, index + 4);
    if (kind === 'IDAT' || kind === 'IEND') break;
    if (kind === 'acTL') animated = true;
    if (kind === 'tRNS') alpha = true;
    index += 12 + length;
  }
  return {format: 'png', width, height, animated, alpha, bytes: bytes.length};
}

function identifyJpeg(bytes: Uint8Array): ImageInfo {
  const {width, height} = scanJpegFrame(bytes);
  checkDimensions(width, height);
  return {format: 'jpeg', width, height, animated: false, alpha: false, bytes: bytes.length};
}

function identifyGif(bytes: Uint8Array): ImageInfo {
  const width = u16le(bytes, 6);
  const height = u16le(bytes, 8);
  checkDimensions(width, height);
  const flags = u8(bytes, 10);
  let index = 13 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);
  let images = 0;
  let alpha = false;
  const skipSubBlocks = (): void => {
    while (index < bytes.length) {
      const size = bytes[index]!;
      index += 1 + size;
      if (size === 0) return;
    }
  };
  for (let steps = 0; steps < IMAGE_LIMITS.maxChunkScan && index < bytes.length && images < 2; steps++) {
    const block = bytes[index]!;
    if (block === 0x21) {
      if (bytes[index + 1] === 0xf9 && index + 3 < bytes.length && (bytes[index + 3]! & 1)) alpha = true;
      index += 2;
      skipSubBlocks();
    } else if (block === 0x2c) {
      images++;
      if (index + 10 > bytes.length) break;
      const local = bytes[index + 9]!;
      index += 10 + (local & 0x80 ? 3 * (1 << ((local & 7) + 1)) : 0) + 1;
      skipSubBlocks();
    } else break;
  }
  return {format: 'gif', width, height, animated: images > 1, alpha, bytes: bytes.length};
}

function identifyWebp(bytes: Uint8Array): ImageInfo {
  const end = u32le(bytes, 4) + 8;
  if (end > bytes.length || end < 20) throw malformed('size mismatch');
  let width = 0;
  let height = 0;
  let alpha = false;
  let animated = false;
  let found = false;
  let index = 12;
  for (let steps = 0; steps < IMAGE_LIMITS.maxChunkScan && index + 8 <= end; steps++) {
    const kind = tag(bytes, index);
    const size = u32le(bytes, index + 4);
    const data = index + 8;
    if (data + size > end) throw malformed('chunk overruns file');
    if (kind === 'VP8X') {
      if (size < 10) throw malformed('short header');
      const flags = u8(bytes, data);
      alpha = (flags & 0x10) !== 0;
      animated = (flags & 0x02) !== 0;
      width = (bytes[data + 4]! | (bytes[data + 5]! << 8) | (bytes[data + 6]! << 16)) + 1;
      height = (bytes[data + 7]! | (bytes[data + 8]! << 8) | (bytes[data + 9]! << 16)) + 1;
      found = true;
    } else if (kind === 'VP8 ' && !found) {
      if (size < 10 || u8(bytes, data + 3) !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) throw malformed('bad lossy header');
      width = u16le(bytes, data + 6) & 0x3fff;
      height = u16le(bytes, data + 8) & 0x3fff;
      found = true;
    } else if (kind === 'VP8L' && !found) {
      if (size < 5 || u8(bytes, data) !== 0x2f) throw malformed('bad lossless header');
      const bits = u32le(bytes, data + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      alpha = ((bits >>> 28) & 1) === 1;
      found = true;
    } else if (kind === 'ANIM' || kind === 'ANMF') animated = true;
    else if (kind === 'ALPH') alpha = true;
    index = data + size + (size & 1);
  }
  if (!found) throw malformed('no image data');
  checkDimensions(width, height);
  return {format: 'webp', width, height, animated, alpha, bytes: bytes.length};
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  let text = '';
  const head = bytes.subarray(0, 4096);
  for (const byte of head) text += String.fromCharCode(byte);
  text = text.replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart().toLowerCase();
  if (text.startsWith('<svg')) return true;
  return (text.startsWith('<?xml') || text.startsWith('<!doctype svg') || text.startsWith('<!--')) && text.includes('<svg');
}

/** Say what a file is and how big it declares itself, from its header alone. */
export function identify(bytes: Uint8Array): ImageInfo {
  return guard(() => {
    if (hasPrefix(bytes, PNG_SIGNATURE)) return identifyPng(bytes);
    if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return identifyJpeg(bytes);
    if (hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return identifyGif(bytes);
    if (bytes.length >= 12 && tag(bytes, 0) === 'RIFF' && tag(bytes, 8) === 'WEBP') return identifyWebp(bytes);
    if (looksLikeSvg(bytes)) return {format: 'svg', width: 0, height: 0, animated: false, alpha: true, bytes: bytes.length};
    return {format: 'unknown', width: 0, height: 0, animated: false, alpha: false, bytes: bytes.length};
  });
}
