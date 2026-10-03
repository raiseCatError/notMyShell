import type {TerminalCapabilities} from '../host/capabilities.js';

/**
 * NMSh's raster image surface.
 *
 * The terminal host owns image support; NMSh can only use a protocol the host
 * implements. Selection order:
 *   1. Kitty graphics protocol, when a probe reply proved it (or the host is kitty itself)
 *   2. iTerm2 inline images (OSC 1337), from the known-host record (iTerm2, WezTerm)
 *   3. none: the caller's terminal-native fallback rows
 * Core UI never depends on images, and NMSh never suggests switching hosts.
 *
 * Every image escape is built here, so nothing else ever writes raw image bytes,
 * and nothing is written at all when the protocol is `none`.
 */

export type ImageProtocol = 'kitty' | 'iterm2' | 'none';

export interface ImageEnvironment {
  capabilities: Readonly<TerminalCapabilities>;
  env: NodeJS.ProcessEnv;
}

/** Which protocol to use right now. Multiplexers hide the outer host, so they get none. */
export function selectImageProtocol({capabilities, env}: ImageEnvironment): ImageProtocol {
  if (env.NMSH_IMAGES === '0' || env.TERM === 'dumb') return 'none';
  if (env.TMUX || env.STY || env.ZELLIJ || /^(?:tmux|screen)/u.test(env.TERM ?? '')) return 'none';
  if (capabilities.graphicsProtocol === 'kitty') return 'kitty';
  if (capabilities.graphicsProtocol === 'iterm2') return 'iterm2';
  return 'none';
}

/** Max bytes of base64 per Kitty APC chunk (the protocol's limit). */
export const KITTY_CHUNK = 4096;
const ESC = '\u001b';
const ST = `${ESC}\\`;

export interface ImageSize { columns: number; rows: number }

/**
 * Transmit a PNG once under `id` without displaying it (a=t), quietly (q=2:
 * no replies reach stdin), chunked as the protocol requires.
 */
export function kittyTransmit(png: Uint8Array, id: number): string {
  const data = Buffer.from(png).toString('base64');
  if (!Number.isInteger(id) || id < 1 || id > 0xffffffff) throw new RangeError('kitty image id out of range');
  let output = '';
  for (let offset = 0; offset < data.length || offset === 0; offset += KITTY_CHUNK) {
    const chunk = data.slice(offset, offset + KITTY_CHUNK);
    const more = offset + KITTY_CHUNK < data.length ? 1 : 0;
    output += offset === 0 ? `${ESC}_Ga=t,f=100,t=d,i=${id},q=2,m=${more};${chunk}${ST}` : `${ESC}_Gm=${more};${chunk}${ST}`;
    if (!data.length) break;
  }
  return output;
}

/** Display a transmitted image at the cursor, scaled into a cell box, without moving the cursor (C=1). */
export function kittyPlace(id: number, size: ImageSize, placement = 1): string {
  return `${ESC}_Ga=p,i=${id},p=${placement},c=${Math.max(1, size.columns)},r=${Math.max(1, size.rows)},C=1,q=2${ST}`;
}

/** Delete an image's placements and its data (uppercase I frees the stored image). */
export function kittyDelete(id: number): string {
  return `${ESC}_Ga=d,d=I,i=${id},q=2${ST}`;
}

/** iTerm2 inline image (OSC 1337 File=) in a cell box, aspect preserved. */
export function iterm2Image(png: Uint8Array, size: ImageSize, name = 'nmsh.png'): string {
  const bytes = Buffer.from(png);
  return `${ESC}]1337;File=name=${Buffer.from(name).toString('base64')};size=${bytes.length};width=${Math.max(1, size.columns)};height=${Math.max(1, size.rows)};preserveAspectRatio=1;inline=1:${bytes.toString('base64')}\u0007`;
}

/** Cell box for an image of pixel size w×h fitting in maxColumns×maxRows (cells are ~1:2). */
export function fitCells(width: number, height: number, maxColumns: number, maxRows: number): ImageSize {
  const aspect = width / Math.max(1, height);
  let rows = Math.max(1, maxRows);
  let columns = Math.round(rows * aspect * 2);
  if (columns > maxColumns) { columns = Math.max(1, maxColumns); rows = Math.max(1, Math.round(columns / (aspect * 2))); }
  return {columns, rows};
}

/** PNG pixel size from its IHDR chunk; undefined if this is not a PNG. */
export function pngSize(png: Uint8Array): {width: number; height: number} | undefined {
  const bytes = Buffer.from(png);
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString('ascii', 12, 16) !== 'IHDR') return undefined;
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

/**
 * One overlay the renderer owns: transmitted once, (re)placed whenever its
 * rows are repainted, and removed on close, passthrough, and exit.
 */
export interface ImageOverlay {
  /** Identity: a different key replaces the overlay. */
  key: string;
  /** Zero-based screen row and column of the box's top-left cell. */
  row: number;
  column: number;
  size: ImageSize;
  /** Sent once before the first placement (Kitty data upload); empty for iTerm2. */
  transmit: string;
  /** Sent at the box position each time the box's rows are repainted. */
  place: string;
  /** Sent when the overlay goes away. Empty for iTerm2: repainting the rows removes it. */
  cleanup: string;
}

let nextKittyId = 0x4e4d0000; // "NM" prefix keeps NMSh ids distinct from programs' own.

export function createImageOverlay(protocol: ImageProtocol, png: Uint8Array, key: string, row: number, column: number, size: ImageSize): ImageOverlay | undefined {
  if (protocol === 'none' || !pngSize(png)) return undefined;
  if (protocol === 'kitty') {
    const id = ++nextKittyId;
    return {key, row, column, size, transmit: kittyTransmit(png, id), place: kittyPlace(id, size), cleanup: kittyDelete(id)};
  }
  return {key, row, column, size, transmit: '', place: iterm2Image(png, size), cleanup: ''};
}

/** True when the string contains any image protocol bytes; used to prove fallbacks emit none. */
export function containsImageBytes(text: string): boolean {
  return text.includes(`${ESC}_G`) || text.includes(`${ESC}]1337;File=`);
}
