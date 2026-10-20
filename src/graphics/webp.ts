/**
 * WebP has no decoder in NMSh: the file is converted to PNG by a tool the machine already has (never a shell, never a
 * network call), in a private directory inside the caller's scratch directory, then decoded with `decodePng`.
 */
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {IMAGE_LIMITS, ImageError, type Raster} from './raster.js';
import {guardAsync, identify, malformed} from './formats.js';
import {decodePng} from './png.js';

interface Converter {
  name: string;
  probe: {file: string; args: string[]} | 'file-exists';
  file: string;
  /** Arguments given relative file names `in.webp` and `out.png` (the working directory is the private temp dir). */
  args: string[];
}

const CONVERTERS: Converter[] = [
  ...(process.platform === 'darwin' ? [{name: 'sips', probe: 'file-exists' as const, file: '/usr/bin/sips', args: ['-s', 'format', 'png', 'in.webp', '--out', 'out.png']}] : []),
  {name: 'dwebp', probe: {file: 'dwebp', args: ['-version']}, file: 'dwebp', args: ['in.webp', '-o', 'out.png']},
  {name: 'magick', probe: {file: 'magick', args: ['-version']}, file: 'magick', args: ['in.webp', 'png:out.png']},
  {name: 'convert', probe: {file: 'convert', args: ['-version']}, file: 'convert', args: ['in.webp', 'png:out.png']},
  {name: 'ffmpeg', probe: {file: 'ffmpeg', args: ['-version']}, file: 'ffmpeg', args: ['-nostdin', '-v', 'error', '-i', 'in.webp', '-frames:v', '1', '-y', 'out.png']},
];

const TIMEOUT_MS = 8000;
let probed: Promise<Converter[]> | undefined;

function toolEnv(): NodeJS.ProcessEnv {
  return {PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', LANG: 'C', LC_ALL: 'C'};
}

function run(file: string, args: string[], options: {cwd?: string; signal?: AbortSignal}): Promise<{ok: boolean; timedOut: boolean; stdout: string}> {
  return new Promise((resolve) => {
    execFile(file, args, {cwd: options.cwd, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024, env: toolEnv(), signal: options.signal, windowsHide: true}, (error, stdout) => {
      resolve({ok: !error, timedOut: Boolean(error && (error as {killed?: boolean}).killed), stdout: String(stdout)});
    });
  });
}

async function available(): Promise<Converter[]> {
  probed ??= (async () => {
    const found: Converter[] = [];
    for (const converter of CONVERTERS) {
      if (converter.probe === 'file-exists') {
        if (await fs.access(converter.file).then(() => true, () => false)) found.push(converter);
        continue;
      }
      const result = await run(converter.probe.file, converter.probe.args, {});
      // `convert` is only trusted when it is ImageMagick (other systems ship unrelated tools by that name).
      if (result.ok && (converter.name !== 'convert' || /imagemagick/i.test(result.stdout))) found.push(converter);
    }
    return found;
  })();
  return probed;
}

export async function webpDecoderAvailable(): Promise<{available: boolean; tool?: string}> {
  const [first] = await available();
  return first ? {available: true, tool: first.name} : {available: false};
}

export function decodeWebp(bytes: Uint8Array, options: {scratchDir: string; signal?: AbortSignal}): Promise<Raster> {
  return guardAsync(async () => {
    const info = identify(bytes);
    if (info.format !== 'webp') throw malformed('not a WebP');
    const converters = await available();
    if (converters.length === 0) {
      throw new ImageError('unavailable', process.platform === 'darwin'
        ? 'WebP images need a converter: sips ships with macOS, so it should be present; otherwise install libwebp (brew install webp) or ImageMagick.'
        : 'WebP images need a converter: install dwebp (libwebp) or ImageMagick.');
    }
    await fs.mkdir(options.scratchDir, {recursive: true, mode: 0o700});
    const dir = await fs.mkdtemp(path.join(options.scratchDir, 'webp-'));
    try {
      await fs.chmod(dir, 0o700);
      await fs.writeFile(path.join(dir, 'in.webp'), bytes, {mode: 0o600, flag: 'wx'});
      for (const converter of converters) {
        if (options.signal?.aborted) throw new ImageError('unavailable', 'Decoding was cancelled.');
        const result = await run(converter.file, converter.args, {cwd: dir, signal: options.signal});
        if (result.timedOut) throw new ImageError('malformed', 'Converting the WebP took too long.');
        if (!result.ok) continue;
        const png = await readBounded(path.join(dir, 'out.png'));
        if (png) return decodePng(png);
      }
      throw malformed('no converter could read the WebP');
    } finally {
      await fs.rm(dir, {recursive: true, force: true}).catch(() => undefined);
    }
  });
}

async function readBounded(file: string): Promise<Uint8Array | undefined> {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) return undefined;
    if (stat.size > IMAGE_LIMITS.maxFileBytes * 4) throw new ImageError('too-large', 'The converted image is larger than NMSh will decode.');
    const buffer = new Uint8Array(stat.size);
    let read = 0;
    while (read < buffer.length) {
      const {bytesRead} = await handle.read(buffer, read, buffer.length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return buffer.subarray(0, read);
  } catch (error) {
    if (error instanceof ImageError) throw error;
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
