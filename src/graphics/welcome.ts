/** Welcome asset admission lives with the shared bounded decoders. Originals are read only. */
import {readImageFile, decodeImage} from './decode.js';
import {identify} from './formats.js';
import {decodeAnimation, type DecodedAnimation} from './animation.js';
import {ImageError} from './raster.js';
import type {LoadedImage} from './service.js';
export const WELCOME_ASSET_BYTES = 8 * 1024 * 1024;
export const WELCOME_ASSET_PIXELS = 2_000_000;
export async function loadWelcomeImage(file: string, scratchDir: string): Promise<{image: LoadedImage; animation?: DecodedAnimation}> {
  const {bytes} = await readImageFile(file, {maxBytes: WELCOME_ASSET_BYTES});
  const info = identify(bytes);
  if (info.width * info.height > WELCOME_ASSET_PIXELS) throw new ImageError('too-large', 'Welcome images are limited to 2 megapixels.');
  if (!['png', 'jpeg', 'webp', 'gif'].includes(info.format)) throw new ImageError('unsupported', 'Choose PNG, JPEG, WebP, GIF or APNG.');
  // GIF/APNG admission uses the existing aggregate frame, byte and duration budgets.
  const animation = info.format === 'gif' || info.format === 'png' ? decodeAnimation(bytes) : undefined;
  const raster = animation?.frames[0]?.raster ?? (await decodeImage(bytes, {scratchDir})).raster;
  const {createHash} = await import('node:crypto');
  const key = `welcome:${createHash('sha256').update(bytes).digest('hex')}`;
  return {image: {key, name: 'Welcome image', path: file, info, raster, fileBytes: bytes.length}, ...(animation ? {animation} : {})};
}
