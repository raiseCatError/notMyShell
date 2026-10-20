import {CHANNELS, concat, type PngSpec} from './pngEncoder.js';

export const LOSSY_WEBP = 'UklGRmYAAABXRUJQVlA4IFoAAACwAgCdASoIAAgAAMASJbACdHIAq//cAN4AA/P3/oAA/v58L7yT2/8MSpz/9/v6n+xRs2P8+xRv+xkjr/40Sj85j/hZmWOCH//vhR/+FU3BD//2oj5vzOrzuAA=';
export const LOSSLESS_WEBP = 'UklGRjoAAABXRUJQVlA4TC0AAAAvB8ABAB8gEEjCGXtsIQFhhDH+J7NGa/4jN4OAgrZtmJIsyZJ8G4iI/of8iQ8A';
export const webp = (base64: string): Uint8Array => Uint8Array.from(Buffer.from(base64, 'base64'));

/** Reference RGBA for a PngSpec, computed straight from the definition of each colour type. */
export function expectedRgba(spec: PngSpec): number[] {
  const channels = CHANNELS[spec.colorType];
  const max = (1 << spec.bitDepth) - 1;
  const to8 = (v: number): number => (spec.bitDepth === 16 ? v >> 8 : Math.round((v * 255) / max));
  const out: number[] = [];
  for (let p = 0; p < spec.width * spec.height; p++) {
    const s = spec.samples.slice(p * channels, p * channels + channels);
    if (spec.colorType === 0) out.push(to8(s[0]!), to8(s[0]!), to8(s[0]!), 255);
    else if (spec.colorType === 2) out.push(to8(s[0]!), to8(s[1]!), to8(s[2]!), 255);
    else if (spec.colorType === 3) out.push(...spec.palette![s[0]!]!, spec.trns?.[s[0]!] ?? 255);
    else if (spec.colorType === 4) out.push(to8(s[0]!), to8(s[0]!), to8(s[0]!), to8(s[1]!));
    else out.push(to8(s[0]!), to8(s[1]!), to8(s[2]!), to8(s[3]!));
  }
  return out;
}

export function sampleSpec(colorType: PngSpec['colorType'], bitDepth: PngSpec['bitDepth'], width: number, height: number, extra: Partial<PngSpec> = {}): PngSpec {
  const channels = CHANNELS[colorType];
  const max = (1 << bitDepth) - 1;
  const palette = colorType === 3 ? Array.from({length: Math.min(max + 1, 256)}, (_, i) => [(i * 40) & 255, (i * 70 + 9) & 255, (255 - i * 13) & 255]) : undefined;
  const samples: number[] = [];
  for (let i = 0; i < width * height * channels; i++) samples.push(colorType === 3 ? (i * 5 + 1) % palette!.length : (i * 2654435761 >>> 7) % (max + 1));
  return {width, height, colorType, bitDepth, samples, palette, ...extra};
}

/** Insert an EXIF APP1 segment carrying one orientation tag right after SOI. */
export function withOrientation(file: Uint8Array, orientation: number, little = true): Uint8Array {
  const tiff = Buffer.alloc(26);
  tiff.write(little ? 'II' : 'MM', 0, 'latin1');
  const w16 = (v: number, at: number): void => void (little ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at));
  const w32 = (v: number, at: number): void => void (little ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at));
  w16(42, 2); w32(8, 4); w16(1, 8); w16(0x0112, 10); w16(3, 12); w32(1, 14); w16(orientation, 18);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const header = Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]);
  return concat([file.subarray(0, 2), header, body, file.subarray(2)]);
}

