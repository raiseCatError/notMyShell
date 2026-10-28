/** Bounded, synchronous GIF/APNG decoding in the shared graphics service. No I/O. */
import {checkDimensions, IMAGE_LIMITS, ImageError, type Raster} from './raster.js';
import {guard, identify, malformed, tag, u8, u16be, u16le, u32be} from './formats.js';
import {INTERLACE_PASSES, lzw, readSubBlocks} from './gif.js';
import {build, crc32, readHeader, type Header} from './png.js';

export interface AnimationFrame {raster: Raster; delayMs: number}
export interface DecodedAnimation {
  width: number;
  height: number;
  frames: AnimationFrame[];
  /** Total plays, 0 = forever. GIF without a loop extension plays once. */
  loopCount: number;
  truncated: boolean;
}
export interface AnimationBudget {maxFrames: number; maxDecodedBytes: number; maxTotalMs: number}
export const ANIMATION_LIMITS: AnimationBudget = Object.freeze({
  maxFrames: 75, maxDecodedBytes: 32 * 1024 * 1024, maxTotalMs: 5000,
});
interface Rect {left: number; top: number; width: number; height: number}
interface FrameControl extends Rect {delayMs: number; dispose: number; over: boolean}

function checkRect(rect: Rect, width: number, height: number): void {
  checkDimensions(rect.width, rect.height);
  if (rect.left + rect.width > width || rect.top + rect.height > height) throw malformed('frame outside the canvas');
}

/** Stored frames are independent canvases. Working canvas/sub-image/previous are bounded separately by IMAGE_LIMITS. */
class Compositor {
  readonly result: DecodedAnimation;
  private canvas?: Uint8ClampedArray;
  private totalMs = 0;
  constructor(private width: number, private height: number, private budget: AnimationBudget, private check: () => void) {
    checkDimensions(width, height);
    this.result = {width, height, frames: [], loopCount: 1, truncated: false};
  }
  add(control: FrameControl, decode: () => Raster): void {
    this.check();
    const count = this.result.frames.length + 1;
    // Admit the frame BEFORE allocating its canvas, snapshot, sub-image or inflated pixels.
    // Duration only truncates later frames: even a very slow still image must decode.
    if (this.result.truncated || count > this.budget.maxFrames ||
        this.width * this.height * 4 > Math.floor(this.budget.maxDecodedBytes / count) ||
        (count > 1 && this.totalMs + control.delayMs > this.budget.maxTotalMs)) {
      this.result.truncated = true;
      return;
    }
    this.canvas ??= new Uint8ClampedArray(this.width * this.height * 4);
    const canvas = this.canvas;
    const previous = control.dispose === 2 ? canvas.slice() : undefined;
    const raster = decode();
    for (let y = 0; y < control.height; y++) {
      this.check();
      for (let x = 0; x < control.width; x++) {
        const src = (y * control.width + x) * 4;
        const dst = ((control.top + y) * this.width + control.left + x) * 4;
        if (!control.over) canvas.set(raster.data.subarray(src, src + 4), dst);
        else {
          const a = raster.data[src + 3]! / 255;
          const b = canvas[dst + 3]! / 255 * (1 - a);
          const alpha = a + b;
          for (let c = 0; c < 3; c++) canvas[dst + c] = alpha === 0 ? 0 : Math.round((raster.data[src + c]! * a + canvas[dst + c]! * b) / alpha);
          canvas[dst + 3] = Math.round(alpha * 255);
        }
      }
    }
    this.result.frames.push({raster: {width: this.width, height: this.height, data: canvas.slice()}, delayMs: control.delayMs});
    this.totalMs += control.delayMs;
    if (previous) this.canvas = previous;
    else if (control.dispose === 1) {
      for (let y = 0; y < control.height; y++) {
        const at = ((control.top + y) * this.width + control.left) * 4;
        canvas.fill(0, at, at + control.width * 4);
      }
    }
  }
  finish(): DecodedAnimation {
    if (!this.result.frames.length) throw new ImageError('too-large', 'The animation budget cannot hold its first frame.');
    return this.result;
  }
}

/**
 * Decode a prefix within the retained-RGBA and playback-duration budgets. An unfit
 * first frame is too-large only for frame-count or byte limits. After truncation,
 * container structure is still checked,
 * but dropped compressed pixel streams are not inflated/LZW-decoded.
 * Cancellation is checked between chunks, GIF codes and pixel rows; synchronous
 * zlib inflation itself is bounded by the existing PNG inflated-size ceiling.
 */
export function decodeAnimation(bytes: Uint8Array, budget: Partial<AnimationBudget> = {}, signal?: AbortSignal): DecodedAnimation {
  return guard(() => {
    const check = (): void => {
      if (signal?.aborted) throw new ImageError('unavailable', 'Image decoding was aborted.');
    };
    check();
    const limits = {...ANIMATION_LIMITS, ...budget};
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isSafeInteger(value) || value < 0) throw new ImageError('unavailable', `Invalid animation budget ${name}: expected a nonnegative safe integer.`);
    }
    if (bytes.length > IMAGE_LIMITS.maxFileBytes) throw new ImageError('too-large', 'The image file is too large to decode.');
    const info = identify(bytes);
    check();
    if (info.format === 'gif') return gif(bytes, limits, check);
    if (info.format === 'png') return png(bytes, limits, check);
    if (info.format === 'webp') throw new ImageError('unsupported', 'Animated WebP decoding requires an external converter; decodeAnimation supports GIF and APNG only.');
    throw new ImageError('unsupported', 'Animation decoding supports GIF and APNG only.');
  });
}

function gif(bytes: Uint8Array, budget: AnimationBudget, check: () => void): DecodedAnimation {
  const width = u16le(bytes, 6), height = u16le(bytes, 8);
  const compositor = new Compositor(width, height, budget, check);
  let index = 13;
  const table = (flags: number): Uint8Array | undefined => {
    if (!(flags & 0x80)) return undefined;
    const size = 3 * (1 << ((flags & 7) + 1));
    if (index + size > bytes.length) throw malformed('truncated palette');
    const data = bytes.subarray(index, index + size);
    index += size;
    return data;
  };
  const global = table(u8(bytes, 10));
  let subBlocks = 0;
  const readBlocks = (start: number): {data: Uint8Array; next: number} => readSubBlocks(bytes, start, () => {
    check();
    // Every scan consumes at least one file byte (even a zero terminator).
    // A maxFileBytes scan cap admits all sub-block sizes in a legal 32 MiB
    // file, while bounding total bookkeeping independently of frame admission.
    if (++subBlocks > IMAGE_LIMITS.maxFileBytes) throw malformed('too many GIF sub-blocks');
  });
  let transparent = -1, dispose = 0, delayMs = 100, images = 0;
  for (let steps = 0; steps < IMAGE_LIMITS.maxChunkScan; steps++) {
    check();
    // Browsers accept missing trailers after complete images, never partial blocks.
    if (index === bytes.length && images) return compositor.finish();
    const block = u8(bytes, index++);
    if (block === 0x3b) {
      if (!images) throw malformed('no image');
      return compositor.finish();
    }
    if (block === 0x21) {
      const label = u8(bytes, index++);
      const start = index;
      const body = readBlocks(index);
      index = body.next;
      if (label === 0xf9) {
        if (u8(bytes, start) !== 4 || body.data.length !== 4) throw malformed('bad graphic control');
        const flags = body.data[0]!;
        const method = (flags >> 2) & 7;
        // Reserved bits are ignored; disposal 4–7 behaves as none, like browsers.
        dispose = method === 2 ? 1 : method === 3 ? 2 : 0;
        transparent = flags & 1 ? body.data[3]! : -1;
        const cs = u16le(body.data, 1);
        // Browser-compatible GIF timing: 0 and 1 centisecond become 100 ms.
        delayMs = cs <= 1 ? 100 : cs * 10;
      } else if (label === 0xff && u8(bytes, start) === 11 &&
          ['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(Buffer.from(body.data.subarray(0, 11)).toString('ascii'))) {
        // Only a three-byte id-1 sub-block is a loop control. Buffering (id 2)
        // and other sub-blocks are valid application data and may be skipped.
        for (let at = start + 12; bytes[at]; at += bytes[at]! + 1) {
          check();
          if (bytes[at] === 3 && bytes[at + 1] === 1) {
            const repeats = u16le(bytes, at + 2);
            compositor.result.loopCount = repeats === 0 ? 0 : repeats + 1;
          }
        }
      } else if (label === 0x01) {
        // Plain text is a graphic rendering block and consumes the pending GCE.
        transparent = -1; dispose = 0; delayMs = 100;
      }
      continue;
    }
    if (block !== 0x2c) throw malformed('unknown GIF block');
    const rect = {left: u16le(bytes, index), top: u16le(bytes, index + 2), width: u16le(bytes, index + 4), height: u16le(bytes, index + 6)};
    const flags = u8(bytes, index + 8);
    index += 9;
    checkRect(rect, width, height);
    const palette = table(flags) ?? global;
    if (!palette) throw malformed('no colour table');
    const codeSize = u8(bytes, index++);
    if (codeSize < 1 || codeSize > 8) throw malformed('bad code size');
    const body = readBlocks(index);
    index = body.next;
    images++;
    compositor.add({...rect, delayMs, dispose, over: true}, () => {
      const indices = lzw(body.data, codeSize, rect.width * rect.height, check);
      const data = new Uint8ClampedArray(rect.width * rect.height * 4);
      const rows: number[] = [];
      if (flags & 0x40) for (const [start, step] of INTERLACE_PASSES) for (let y = start; y < rect.height; y += step) rows.push(y);
      for (let y = 0; y < rect.height; y++) {
        check();
        for (let x = 0; x < rect.width; x++) {
          const value = indices[y * rect.width + x]!;
          if (value === transparent) continue;
          if (value * 3 + 2 >= palette.length) throw malformed('colour index out of range');
          const at = ((flags & 0x40 ? rows[y]! : y) * rect.width + x) * 4;
          data.set(palette.subarray(value * 3, value * 3 + 3), at);
          data[at + 3] = 255;
        }
      }
      return {width: rect.width, height: rect.height, data};
    });
    transparent = -1; dispose = 0; delayMs = 100;
  }
  throw malformed('too many GIF blocks');
}

/**
 * Stricter than decodePng: APNG control CRCs, ordering, sequences, rectangles,
 * operations and declared frame counts must agree so compositing is unambiguous.
 * Also require consecutive IDAT, metadata before pixels, an empty IEND and known
 * critical chunks; these prevent interpreting incompatible frame/palette data.
 * The chunk scan ceiling bounds hostile-container work, including dropped frames.
 * Ordinary ancillary CRC errors and bytes after IEND retain still-PNG tolerance.
 */
function png(bytes: Uint8Array, budget: AnimationBudget, check: () => void): DecodedAnimation {
  let header: Header | undefined, palette: Uint8Array | undefined, transparency: Uint8Array | undefined;
  let compositor: Compositor | undefined;
  let declared = 0, plays = 1, sequence = 0, count = 0;
  let sawIdat = false, idatEnded = false, ended = false;
  const defaultData: Uint8Array[] = [];
  let current: {control: FrameControl; parts: Uint8Array[]; idat: boolean} | undefined;
  const flush = (): void => {
    if (!current) return;
    if (!current.parts.length) throw malformed('frame has no data');
    const frame = current;
    compositor!.add(frame.control, () => build({...header!, width: frame.control.width, height: frame.control.height}, frame.parts, palette, transparency, check));
    count++;
    current = undefined;
  };
  const nextSequence = (at: number): void => {
    if (u32be(bytes, at) !== sequence++) throw malformed('bad APNG sequence');
  };
  let index = 8;
  for (let steps = 0; steps < IMAGE_LIMITS.maxChunkScan && index < bytes.length; steps++) {
    check();
    const length = u32be(bytes, index), kind = tag(bytes, index + 4), at = index + 8;
    if (length > 0x7fffffff || at + length + 4 > bytes.length) throw malformed('chunk overruns file');
    if (!/^[A-Za-z]{4}$/.test(kind)) throw malformed('bad chunk name');
    const strictCrc = !(bytes[index + 4]! & 0x20) || kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT';
    if (strictCrc && crc32(bytes, index + 4, at + length) !== u32be(bytes, at + length)) throw malformed('checksum mismatch');
    if (!header && kind !== 'IHDR') throw malformed('missing header');
    const data = bytes.subarray(at, at + length);
    if (sawIdat && kind !== 'IDAT') idatEnded = true;
    if (kind === 'IHDR') {
      if (header || length !== 13) throw malformed('bad header');
      header = readHeader(bytes, at);
      compositor = new Compositor(header.width, header.height, budget, check);
    } else if (kind === 'acTL') {
      if (declared || sawIdat || current || length !== 8) throw malformed('bad animation control');
      declared = u32be(bytes, at); plays = u32be(bytes, at + 4);
      if (!declared) throw malformed('zero animation frames');
    } else if (kind === 'fcTL') {
      if (!declared || length !== 26) throw malformed('bad frame control');
      nextSequence(at);
      flush();
      const control: FrameControl = {
        width: u32be(bytes, at + 4), height: u32be(bytes, at + 8), left: u32be(bytes, at + 12), top: u32be(bytes, at + 16),
        // Zero APNG delay uses 100 ms, matching normalized zero-delay GIFs.
        delayMs: u16be(bytes, at + 20) === 0 ? 100 : Math.round(u16be(bytes, at + 20) * 1000 / (u16be(bytes, at + 22) || 100)),
        dispose: u8(bytes, at + 24), over: u8(bytes, at + 25) === 1,
      };
      checkRect(control, header!.width, header!.height);
      if (control.dispose > 2 || u8(bytes, at + 25) > 1) throw malformed('bad frame operation');
      if (!sawIdat && (control.left || control.top || control.width !== header!.width || control.height !== header!.height)) throw malformed('default frame must fill the canvas');
      current = {control, parts: [], idat: !sawIdat};
    } else if (kind === 'IDAT') {
      if (idatEnded) throw malformed('nonconsecutive IDAT');
      sawIdat = true;
      if (current) {
        if (!current.idat) throw malformed('IDAT in nondefault frame');
        current.parts.push(data);
      } else defaultData.push(data);
    } else if (kind === 'fdAT') {
      if (!declared || !sawIdat || !current || current.idat || length < 4) throw malformed('unexpected frame data');
      nextSequence(at);
      current.parts.push(data.subarray(4));
    } else if (kind === 'PLTE') {
      if (sawIdat || !length || length % 3 || length > 768) throw malformed('bad palette');
      palette = data;
    } else if (kind === 'tRNS') {
      if (sawIdat) throw malformed('late transparency');
      transparency = data;
    } else if (kind === 'IEND') {
      if (length !== 0) throw malformed('bad end chunk');
      flush(); ended = true; index = at + length + 4; break;
    } else if (!(bytes[index + 4]! & 0x20)) throw malformed('unknown critical chunk');
    index = at + length + 4;
  }
  if (!ended || !sawIdat || !header) throw malformed('truncated PNG');
  if (declared) {
    if (count !== declared) throw malformed('animation frame count mismatch');
  } else {
    compositor!.add({left: 0, top: 0, width: header.width, height: header.height, delayMs: 0, dispose: 0, over: false}, () => build(header!, defaultData, palette, transparency, check));
  }
  compositor!.result.loopCount = plays;
  return compositor!.finish();
}
