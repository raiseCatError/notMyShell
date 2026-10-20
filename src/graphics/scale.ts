import {IMAGE_LIMITS, ImageError, type Raster, type Rgb8} from './raster.js';

/** Throw `malformed` unless `raster` is a real image whose buffer holds all its pixels, and `too-large` beyond the shared limits. */
export function assertRaster(raster: Raster): void {
  const {width, height, data} = raster;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new ImageError('malformed', 'The image has an invalid size.');
  if (width > IMAGE_LIMITS.maxDimension || height > IMAGE_LIMITS.maxDimension || width * height > IMAGE_LIMITS.maxPixels) {
    throw new ImageError('too-large', 'The image is larger than NMSh will process.');
  }
  if (!data || data.length < width * height * 4) throw new ImageError('malformed', 'The image data is shorter than its size says.');
}

function assertTarget(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new ImageError('malformed', 'The target size is invalid.');
  if (width > IMAGE_LIMITS.maxDimension || height > IMAGE_LIMITS.maxDimension || width * height > IMAGE_LIMITS.maxPixels) {
    throw new ImageError('too-large', 'The target size is larger than NMSh will produce.');
  }
}

/**
 * Resample to `width` x `height` with an area-average (box) filter in premultiplied alpha, so a transparent pixel never
 * tints its neighbours. Every target pixel is the exact area-weighted mean of the source it covers: integer ratios are
 * plain averages, and the weights are integers (no float drift at pixel edges). Upscaling is nearest-neighbour (each
 * target pixel lies inside one source pixel, except where it straddles a boundary, where it is the area blend), which
 * keeps pixel art crisp. Memory: the result plus one row of accumulators; never more than the target size.
 */
export function scaleBox(src: Raster, width: number, height: number): Raster {
  assertRaster(src);
  assertTarget(width, height);
  const sw = src.width;
  const sh = src.height;
  const data = new Uint8ClampedArray(width * height * 4);
  if (sw === width && sh === height) {
    data.set(src.data.subarray(0, data.length));
    return {width, height, data};
  }
  const input = src.data;
  const acc = new Float64Array(width * 4);
  // Target pixel x covers [x*sw, (x+1)*sw] and source pixel i covers [i*width, (i+1)*width] on a common integer axis.
  const total = sw * sh;
  for (let dy = 0; dy < height; dy += 1) {
    acc.fill(0);
    const y0 = dy * sh;
    const y1 = y0 + sh;
    const firstRow = Math.floor(y0 / height);
    const lastRow = Math.ceil(y1 / height) - 1;
    for (let row = firstRow; row <= lastRow; row += 1) {
      const wy = Math.min(y1, (row + 1) * height) - Math.max(y0, row * height);
      const base = row * sw * 4;
      for (let dx = 0; dx < width; dx += 1) {
        const x0 = dx * sw;
        const x1 = x0 + sw;
        const firstCol = Math.floor(x0 / width);
        const lastCol = Math.ceil(x1 / width) - 1;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let col = firstCol; col <= lastCol; col += 1) {
          const wx = Math.min(x1, (col + 1) * width) - Math.max(x0, col * width);
          const at = base + col * 4;
          const alpha = input[at + 3]! * wx;
          r += input[at]! * alpha;
          g += input[at + 1]! * alpha;
          b += input[at + 2]! * alpha;
          a += alpha;
        }
        const k = dx * 4;
        acc[k] = acc[k]! + r * wy;
        acc[k + 1] = acc[k + 1]! + g * wy;
        acc[k + 2] = acc[k + 2]! + b * wy;
        acc[k + 3] = acc[k + 3]! + a * wy;
      }
    }
    let out = dy * width * 4;
    for (let dx = 0; dx < width; dx += 1) {
      const k = dx * 4;
      const alphaSum = acc[k + 3]!;
      if (alphaSum > 0) {
        data[out] = Math.round(acc[k]! / alphaSum);
        data[out + 1] = Math.round(acc[k + 1]! / alphaSum);
        data[out + 2] = Math.round(acc[k + 2]! / alphaSum);
        data[out + 3] = Math.round(alphaSum / total);
      }
      out += 4;
    }
  }
  return {width, height, data};
}

/** Composite over an opaque color: the result has alpha 255 everywhere. */
export function flatten(src: Raster, bg: Rgb8): Raster {
  assertRaster(src);
  const count = src.width * src.height;
  const data = new Uint8ClampedArray(count * 4);
  const input = src.data;
  const {red, green, blue} = bg;
  for (let i = 0, at = 0; i < count; i += 1, at += 4) {
    const a = input[at + 3]!;
    if (a === 255) {
      data[at] = input[at]!;
      data[at + 1] = input[at + 1]!;
      data[at + 2] = input[at + 2]!;
    } else {
      const inverse = 255 - a;
      data[at] = Math.round((input[at]! * a + red * inverse) / 255);
      data[at + 1] = Math.round((input[at + 1]! * a + green * inverse) / 255);
      data[at + 2] = Math.round((input[at + 2]! * a + blue * inverse) / 255);
    }
    data[at + 3] = 255;
  }
  return {width: src.width, height: src.height, data};
}

export interface CellSize { width: number; height: number }

/**
 * The size in terminal cells an image occupies inside `maxColumns` x `maxRows`, keeping its aspect ratio using the real
 * cell pixel size. At least 1 x 1, never above the maximum. Unless `allowUpscale`, an image never grows past its natural
 * size (one pixel per cell pixel).
 */
export function fitCells(
  imageWidth: number,
  imageHeight: number,
  maxColumns: number,
  maxRows: number,
  cell: CellSize = {width: 8, height: 16},
  allowUpscale = false,
): {columns: number; rows: number} {
  if (!(imageWidth > 0) || !(imageHeight > 0) || !Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) {
    throw new ImageError('malformed', 'The image has an invalid size.');
  }
  const limit = (value: number) => (Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1);
  const columnsMax = limit(maxColumns);
  const rowsMax = limit(maxRows);
  const cw = cell.width > 0 && Number.isFinite(cell.width) ? cell.width : 8;
  const ch = cell.height > 0 && Number.isFinite(cell.height) ? cell.height : 16;
  let scale = Math.min((columnsMax * cw) / imageWidth, (rowsMax * ch) / imageHeight);
  if (!allowUpscale) scale = Math.min(scale, 1);
  const columns = Math.min(columnsMax, Math.max(1, Math.round((imageWidth * scale) / cw)));
  const rows = Math.min(rowsMax, Math.max(1, Math.round((imageHeight * scale) / ch)));
  return {columns, rows};
}
