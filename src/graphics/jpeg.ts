/**
 * JPEG decoder: `jpeg-js` (baseline and progressive, pure JavaScript) behind our own size checks, plus EXIF orientation
 * so phone photos come out upright.
 */
import jpeg from 'jpeg-js';
import {IMAGE_LIMITS, ImageError, type Raster} from './raster.js';
import {guard, identify, malformed, scanJpegFrame, tag, u16be, u16le, u32be, u32le} from './formats.js';

/** The EXIF orientation tag (1..8) of a JPEG, or 1 when absent or unreadable. Reads only the APP1 segment, bounds-checked. */
export function readExifOrientation(bytes: Uint8Array): number {
  try {
    let index = 2;
    for (let steps = 0; steps < IMAGE_LIMITS.maxChunkScan; steps++) {
      while (index < bytes.length && bytes[index] !== 0xff) index++;
      while (index < bytes.length && bytes[index] === 0xff) index++;
      const marker = bytes[index++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) return 1;
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      const length = u16be(bytes, index);
      if (length < 2 || index + length > bytes.length) return 1;
      if (marker === 0xe1 && length >= 16 && tag(bytes, index + 2) === 'Exif') return orientationOf(bytes.subarray(index + 2 + 6, index + length));
      index += length;
    }
  } catch {
    // an unreadable EXIF block means "upright"
  }
  return 1;
}

function orientationOf(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const u16 = (at: number): number => (little ? u16le(tiff, at) : u16be(tiff, at));
  const u32 = (at: number): number => (little ? u32le(tiff, at) : u32be(tiff, at));
  if (u16(2) !== 42) return 1;
  const ifd = u32(4);
  const count = Math.min(u16(ifd), 512);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (u16(entry) === 0x0112) {
      if (u16(entry + 2) !== 3 || u32(entry + 4) < 1) return 1;
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Rotate/flip a raster the way EXIF orientation `orientation` (1..8) says, so it displays upright. */
export function applyOrientation(raster: Raster, orientation: number): Raster {
  if (orientation < 2 || orientation > 8) return raster;
  const {width, height, data} = raster;
  const swap = orientation >= 5;
  const outWidth = swap ? height : width;
  const outHeight = swap ? width : height;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let dx: number, dy: number;
      switch (orientation) {
        case 2: dx = width - 1 - x; dy = y; break;
        case 3: dx = width - 1 - x; dy = height - 1 - y; break;
        case 4: dx = x; dy = height - 1 - y; break;
        case 5: dx = y; dy = x; break;
        case 6: dx = height - 1 - y; dy = x; break;
        case 7: dx = height - 1 - y; dy = width - 1 - x; break;
        default: dx = y; dy = width - 1 - x; break;
      }
      const from = (y * width + x) * 4;
      const to = (dy * outWidth + dx) * 4;
      out[to] = data[from]!; out[to + 1] = data[from + 1]!; out[to + 2] = data[from + 2]!; out[to + 3] = data[from + 3]!;
    }
  }
  return {width: outWidth, height: outHeight, data: out};
}

export function decodeJpeg(bytes: Uint8Array): Raster {
  return guard(() => {
    const info = identify(bytes);
    if (info.format !== 'jpeg') throw malformed('not a JPEG');
    const {marker} = scanJpegFrame(bytes);
    if (marker > 0xc2) throw new ImageError('unsupported', 'This kind of JPEG (lossless, arithmetic or hierarchical coding) is not supported.');
    let decoded;
    try {
      decoded = jpeg.decode(bytes, {useTArray: true, formatAsRGBA: true, maxResolutionInMP: 24, maxMemoryUsageInMB: 256});
    } catch {
      throw malformed('undecodable JPEG data');
    }
    if (decoded.width !== info.width || decoded.height !== info.height || decoded.data.length !== info.width * info.height * 4) throw malformed('size mismatch');
    const raster: Raster = {width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length)};
    return applyOrientation(raster, readExifOrientation(bytes));
  });
}
