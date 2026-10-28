import fs from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {readImageFile} from '../graphics/decode.js';
import {loadWelcomeImage} from '../graphics/welcome.js';
import {ImageError} from '../graphics/raster.js';
import type {LoadedImage} from '../graphics/service.js';
import type {DecodedAnimation} from '../graphics/animation.js';
import {stripTerminalControls} from '../util/terminalControls.js';
import {stripAnsi, truncateAnsi, displayWidth} from '../util/text.js';

const EXTENSIONS = /\.(png|jpe?g|webp|gif|apng|ans|txt)$/iu;
export function resolveWelcomePath(input: string, cwd: string, home = homedir()): string {
  if (!input || input.includes('\0') || /^[a-z][a-z0-9+.-]*:/iu.test(input) || input.startsWith('//') || input.startsWith('\\')) throw new ImageError('unsafe', 'Choose a local file path.');
  return path.resolve(cwd, input.startsWith('~/') ? path.join(home, input.slice(2)) : input);
}
export interface AssetEntry {name: string; path: string; directory: boolean}
export async function listWelcomeAssets(directory: string): Promise<AssetEntry[]> {
  try {
    const dir = await fs.opendir(directory);
    const entries: AssetEntry[] = [];
    try {
      for await (const entry of dir) {
        if (entries.length >= 512) break;
        if (entry.isDirectory() || entry.isFile() && EXTENSIONS.test(entry.name)) entries.push({name: entry.name, path: path.join(directory, entry.name), directory: entry.isDirectory()});
      }
    } finally { await dir.close().catch(() => undefined); }
    entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    return [{name: '..', path: path.dirname(directory), directory: true}, ...entries];
  } catch { throw new ImageError('unavailable', 'This folder could not be read.'); }
}
export interface AssetMetadata {format: string; bytes: number; frames: number; width: number; height: number; note?: string}
export type WelcomeAsset = {kind: 'image'; image: LoadedImage; animation?: DecodedAnimation; metadata: AssetMetadata} | {kind: 'art'; rows: string[]; metadata: AssetMetadata};
/** Preserve only numeric SGR; strings are removed as whole sequences before recognizing SGR. */
export function safeWelcomeArt(text: string): string[] {
  const strings = /(?:\x1b[\]PX^_]|[\x90\x98\x9d\x9e\x9f])[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c|(?=\x1b)|$)/gu;
  const lines = text.replace(strings, '').split(/\r?\n/u).slice(0, 40);
  return lines.map(line => {
    const parts = line.split(/(\x1b\[[0-9;]{0,64}m)/u);
    return truncateAnsi(parts.map(part => /^\x1b\[[0-9;]*m$/u.test(part) ? part : stripTerminalControls(part, 4096)).join(''), 240);
  });
}
export async function loadWelcomeAsset(input: string, cwd: string, scratchDir: string): Promise<WelcomeAsset> {
  const file = resolveWelcomePath(input, cwd);
  if (!EXTENSIONS.test(file)) throw new ImageError('unsupported', 'Choose PNG/JPEG/WebP/GIF/APNG or .ans/.txt art.');
  if (/\.(ans|txt)$/iu.test(file)) {
    const {bytes} = await readImageFile(file, {maxBytes: 64 * 1024});
    const rows = safeWelcomeArt(Buffer.from(bytes).toString('utf8'));
    return {kind: 'art', rows, metadata: {format: 'ANSI/ASCII', bytes: bytes.length, frames: 1, width: Math.max(0, ...rows.map(r => displayWidth(stripAnsi(r)))), height: rows.length}};
  }
  const loaded = await loadWelcomeImage(file, scratchDir);
  const {info} = loaded.image;
  return {kind: 'image', ...loaded, metadata: {format: info.format, bytes: info.bytes, width: info.width, height: info.height,
    frames: loaded.animation?.frames.length ?? 1, ...(loaded.animation?.truncated ? {note: 'Animation prefix limited to 75 frames / 32 MiB / 5 s.'} : info.animated && info.format === 'webp' ? {note: 'Animated WebP uses its first frame.'} : {})}};
}
