/**
 * The shared vocabulary of NMSh's graphics service: what a decoded image is, what may be read, and how a failure is named.
 * Decoders produce a `Raster`; encoders and renderers consume one. Nothing in this file touches the filesystem or the terminal.
 */

/** Straight-alpha RGBA, row-major, `width * height * 4` bytes. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'unknown';

/** What a file header says, read without decoding any pixels. */
export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
  /** More than one frame (GIF, animated WebP): only the first frame is ever decoded. */
  animated: boolean;
  /** The format can carry transparency (and this file declares it where the header says so). */
  alpha: boolean;
  bytes: number;
}

/** Hard resource limits. Every decoder enforces them before allocating, and a hostile file only ever gets an `ImageError`. */
export const IMAGE_LIMITS = {
  /** The most bytes read from one file. */
  maxFileBytes: 32 * 1024 * 1024,
  /** The most pixels one image may declare (24 MP: 96 MB as RGBA). */
  maxPixels: 24_000_000,
  /** The longest side one image may declare. */
  maxDimension: 16_384,
  /** The most data a decompressor may produce (PNG IDAT), beyond the size the header implies. */
  maxInflatedBytes: 160 * 1024 * 1024,
  /** GIF/WebP chunks scanned while counting frames. */
  maxChunkScan: 100_000,
} as const;

export type ImageErrorCode = 'too-large' | 'malformed' | 'unsupported' | 'unavailable' | 'unsafe';

/** Anything wrong with an image: never an uncaught exception from a decoder. `message` is safe to show to the person. */
export class ImageError extends Error {
  constructor(readonly code: ImageErrorCode, message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

/** Throw `too-large` unless `width` x `height` is a real, bounded image size. */
export function checkDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new ImageError('malformed', 'The image declares an invalid size.');
  if (width > IMAGE_LIMITS.maxDimension || height > IMAGE_LIMITS.maxDimension || width * height > IMAGE_LIMITS.maxPixels) {
    throw new ImageError('too-large', `The image is larger than NMSh will decode (${width} × ${height}; at most ${IMAGE_LIMITS.maxPixels / 1_000_000} megapixels).`);
  }
}

export interface Rgb8 { red: number; green: number; blue: number }
