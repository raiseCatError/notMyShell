import {spawn} from 'node:child_process';
import {resolveCommand} from '../providers/providers.js';

export interface CopyStats {
  characters: number;
  lines: number;
}

export function copyStats(text: string): CopyStats {
  const characters = Array.from(text).length;
  if (characters === 0) return {characters: 0, lines: 0};
  const withoutOneTrailingNewline = text.replace(/\r?\n$/u, '');
  return {
    characters,
    lines: withoutOneTrailingNewline.split(/\r?\n/u).length,
  };
}

export function copyFeedback(stats: CopyStats, index = 1): string {
  const characterWord = stats.characters === 1 ? 'character' : 'characters';
  const lineWord = stats.lines === 1 ? 'line' : 'lines';
  const target = index === 1 ? 'Copied to clipboard' : `Copied response ${index} to clipboard`;
  return `${target} · ${stats.characters.toLocaleString()} ${characterWord} · ${stats.lines.toLocaleString()} ${lineWord}`;
}

export const CLIPBOARD_MAX_BYTES = 1024 * 1024;
export const CLIPBOARD_TIMEOUT_MS = 3000;

/** No usable clipboard tool for this platform/session; commands are unaffected. */
export class ClipboardUnavailableError extends Error {
  constructor(detail: string) { super(`Clipboard unavailable: ${detail}`); this.name = 'ClipboardUnavailableError'; }
}

export interface ClipboardBackend {command: string; args: string[]}
export interface ClipboardEnvironment {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Resolve an executable name to a path, or undefined when not installed. */
  resolve?: (name: string) => string | undefined;
  timeoutMs?: number;
}

/** Pick a conventional desktop clipboard tool: pbcopy on macOS; wl-copy under Wayland; xclip/xsel under X11. Nothing is installed. */
export function selectClipboardBackend(options: ClipboardEnvironment = {}): ClipboardBackend | undefined {
  const {platform = process.platform, env = process.env, resolve = (name: string) => resolveCommand(name)} = options;
  if (platform === 'darwin') return {command: 'pbcopy', args: []};
  if (platform !== 'linux') return undefined;
  const candidates: [string, string[]][] = [];
  if (env.WAYLAND_DISPLAY) candidates.push(['wl-copy', []]);
  if (env.DISPLAY) candidates.push(['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]);
  for (const [name, args] of candidates) {
    const command = resolve(name);
    if (command) return {command, args};
  }
  return undefined;
}

export async function writeClipboard(text: string, options: ClipboardEnvironment = {}): Promise<void> {
  if (Buffer.byteLength(text, 'utf8') > CLIPBOARD_MAX_BYTES) throw new ClipboardUnavailableError(`text exceeds the ${CLIPBOARD_MAX_BYTES / 1024 / 1024} MiB copy limit`);
  const backend = selectClipboardBackend(options);
  if (!backend) {
    const platform = options.platform ?? process.platform;
    throw new ClipboardUnavailableError(platform === 'linux' ? 'install wl-copy (Wayland) or xclip/xsel (X11)' : `unsupported platform ${platform}`);
  }
  const timeoutMs = options.timeoutMs ?? CLIPBOARD_TIMEOUT_MS;
  await new Promise<void>((resolve, reject) => {
    // Clipboard tools may fork a background selection owner that keeps inherited pipes open,
    // so only the tool's own exit is awaited and its output is not captured.
    const child = spawn(backend.command, backend.args, {detached: process.platform !== 'win32', stdio: ['pipe', 'ignore', 'ignore']});
    let settled = false;
    let inputDone = false;
    let exitedSuccessfully = false;
    const killTree = () => {
      if (child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already ended */ }
      } else child.kill('SIGKILL');
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { killTree(); reject(error); } else resolve();
    };
    const timer = setTimeout(() => { finish(new Error(`${backend.command} timed out`)); }, timeoutMs);
    child.once('error', finish);
    child.stdin.once('error', error => finish(new Error(`${backend.command} stdin failed: ${error.message}`)));
    child.once('exit', code => {
      if (code !== 0) finish(new Error(`${backend.command} exited with code ${code}`));
      else { exitedSuccessfully = true; if (inputDone) finish(); }
    });
    // Writable 'finish' means all input was written successfully; end callbacks
    // also run on write errors, potentially before the stream's error event.
    child.stdin.once('finish', () => { inputDone = true; if (exitedSuccessfully) finish(); });
    child.stdin.end(text);
  });
}
