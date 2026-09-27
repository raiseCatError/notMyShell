import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {findExecutable, runExternal} from '../providers/providers.js';
import type {CommandEntry} from '../suggestions/types.js';

const ATUIN_FORMAT = '{time}\t{exit}\t{directory}\t{command}';

/**
 * Local shell history, loaded once in the background so startup and
 * keystrokes never wait for it. Atuin (with cwd, exit and time) when
 * installed, otherwise $HISTFILE.
 */
export class HistoryService {
  private entries: CommandEntry[] = [];

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  /** Loads (or reloads) history; callers start it once the app is running. */
  async reload(): Promise<void> {
    const atuin = findExecutable('atuin', this.env.PATH ?? '');
    if (atuin) {
      const result = await runExternal(atuin, ['history', 'list', '--format', ATUIN_FORMAT, '--print0', '--timezone', '+0'],
        {timeoutMs: 15000, maxBytes: 128 * 1024 * 1024, env: this.env});
      if (result.ok) {
        this.entries = parseAtuinHistory(result.stdout);
        return;
      }
    }
    try {
      const path = this.env.HISTFILE || join(homedir(), '.zsh_history');
      this.entries = parseZshHistory(await readFile(path));
    } catch {
      this.entries = [];
    }
  }

  /** Commands, oldest first. */
  getAll(): string[] {
    return this.entries.map(entry => entry.command);
  }

  /** Commands with whatever metadata the source had, oldest first. */
  getEntries(): readonly CommandEntry[] {
    return this.entries;
  }
}

export function parseAtuinHistory(output: string): CommandEntry[] {
  const entries: CommandEntry[] = [];
  for (const record of output.split('\0')) {
    const [time, exit, directory, ...command] = record.split('\t');
    const text = command.join('\t').replace(/\n+$/u, '');
    if (!text.trim() || time === undefined) continue;
    const at = Date.parse(`${time.trim().replace(' ', 'T')}Z`);
    const exitCode = Number.parseInt(exit ?? '', 10);
    entries.push({command: text, ...(Number.isFinite(at) ? {at} : {}),
      ...(Number.isFinite(exitCode) && exitCode !== -1 ? {exitCode} : {}),
      ...(directory && directory !== 'unknown' ? {cwd: directory} : {})});
  }
  return entries.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

/** zsh stores non-ASCII bytes "metafied": 0x83 followed by the byte XOR 0x20. */
export function unmetafy(bytes: Uint8Array): Buffer {
  const out = Buffer.alloc(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    out[length++] = byte === 0x83 && index + 1 < bytes.length ? bytes[++index]! ^ 0x20 : byte;
  }
  return out.subarray(0, length);
}

/** Plain or EXTENDED_HISTORY (`: start:elapsed;command`), with `\` continuation lines. */
export function parseZshHistory(content: Uint8Array | string): CommandEntry[] {
  const text = typeof content === 'string' ? content : unmetafy(content).toString('utf8');
  const entries: CommandEntry[] = [];
  let current: CommandEntry | undefined;
  for (const line of text.split('\n')) {
    if (current && current.command.endsWith('\\')) {
      current.command = `${current.command.slice(0, -1)}\n${line}`;
      continue;
    }
    const match = /^: *(\d+):\d+;(.*)$/u.exec(line);
    current = match ? {command: match[2]!, at: Number(match[1]) * 1000} : line.trim() ? {command: line} : undefined;
    if (current) entries.push(current);
  }
  for (const entry of entries) if (entry.command.endsWith('\\')) entry.command = entry.command.slice(0, -1);
  return entries.filter(entry => entry.command.trim());
}
