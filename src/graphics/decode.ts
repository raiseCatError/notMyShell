/** The graphics service's front door: read one image file safely, then identify and decode its bytes. */
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {IMAGE_LIMITS, ImageError, type ImageInfo, type Raster} from './raster.js';
import {guardAsync, identify} from './formats.js';
import {decodePng} from './png.js';
import {decodeGif} from './gif.js';
import {decodeJpeg} from './jpeg.js';
import {decodeWebp} from './webp.js';

/**
 * Read a regular file of at most `maxBytes` (never more than `IMAGE_LIMITS.maxFileBytes`). The type and size are checked on the
 * descriptor that is then read, so the path cannot be swapped in between; a FIFO or device is refused without blocking.
 */
export async function readImageFile(filePath: string, options: {maxBytes?: number} = {}): Promise<{bytes: Uint8Array}> {
  const limit = Math.min(options.maxBytes ?? IMAGE_LIMITS.maxFileBytes, IMAGE_LIMITS.maxFileBytes);
  let handle;
  try {
    handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    throw new ImageError('unavailable', `The file could not be opened (${(error as NodeJS.ErrnoException).code ?? 'error'}).`);
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new ImageError('unsafe', 'Only regular files can be shown as images.');
    if (stat.size > limit) throw new ImageError('too-large', `The file is larger than NMSh will read (${Math.floor(limit / (1024 * 1024))} MB).`);
    const buffer = new Uint8Array(stat.size);
    let read = 0;
    while (read < buffer.length) {
      const {bytesRead} = await handle.read(buffer, read, buffer.length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return {bytes: buffer.subarray(0, read)};
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError('unavailable', `The file could not be read (${(error as NodeJS.ErrnoException).code ?? 'error'}).`);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export function decodeImage(bytes: Uint8Array, options: {scratchDir?: string; signal?: AbortSignal} = {}): Promise<{info: ImageInfo; raster: Raster}> {
  return guardAsync(async () => {
    const info = identify(bytes);
    switch (info.format) {
      case 'png': return {info, raster: decodePng(bytes)};
      case 'gif': return {info, raster: decodeGif(bytes)};
      case 'jpeg': return {info, raster: decodeJpeg(bytes)};
      case 'webp':
        if (!options.scratchDir) throw new ImageError('unavailable', 'WebP images need a scratch directory to be converted in.');
        return {info, raster: await decodeWebp(bytes, {scratchDir: options.scratchDir, signal: options.signal})};
      case 'svg': throw new ImageError('unsupported', 'SVG is not rendered: it can contain scripts and external references, so NMSh only shows PNG, JPEG, GIF and WebP.');
      default: throw new ImageError('unsupported', 'This is not an image format NMSh can show (PNG, JPEG, GIF and WebP are supported).');
    }
  });
}
