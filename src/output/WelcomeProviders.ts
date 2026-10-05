import stringWidth from 'string-width';
import type {WelcomeProviderId} from '../prompt/configuration.js';
import {detectProvider, findExecutable, runExternal, type ProviderDescriptor} from '../providers/providers.js';

/** Welcome providers on the shared descriptor (#134). Vespyr is the native cat. */
export const WELCOME_PROVIDERS: readonly ProviderDescriptor<WelcomeProviderId>[] = [
  {id: 'vespyr', family: 'welcome', label: 'Vespyr', kind: 'native', description: 'the NMSh cat with build and directory'},
  {id: 'fastfetch', family: 'welcome', label: 'Fastfetch', kind: 'external', executable: 'fastfetch', versionArgs: ['--version'],
    description: 'your installed fastfetch and its configuration', recipe: {brew: 'fastfetch'}, source: 'https://github.com/fastfetch-cli/fastfetch'},
  {id: 'neofetch', family: 'welcome', label: 'Neofetch', kind: 'external', executable: 'neofetch', versionArgs: ['--version'], legacy: true,
    successor: 'Fastfetch', description: 'archived upstream; used only if already installed'},
  {id: 'macchina', family: 'welcome', label: 'Macchina', kind: 'external', executable: 'macchina', versionArgs: ['--version'], lifecycle: 'maintenance',
    description: 'system information fetcher in maintenance mode', recipe: {brew: 'macchina'}, source: 'https://github.com/Macchina-CLI/macchina'},
  {id: 'zigfetch', family: 'welcome', label: 'Zigfetch', kind: 'external', executable: 'zigfetch',
    description: 'minimal system information fetcher; uses your installed configuration'},
  {id: 'none', family: 'welcome', label: 'None', kind: 'none', description: 'no startup welcome'},
];

export function welcomeProvider(id: WelcomeProviderId): ProviderDescriptor<WelcomeProviderId> {
  return WELCOME_PROVIDERS.find(provider => provider.id === id) ?? WELCOME_PROVIDERS[0]!;
}

/** Fetch tools use their own configuration; `--pipe false` keeps colors without a TTY. */
const CAPTURE_ARGS: Partial<Record<WelcomeProviderId, readonly string[]>> = {fastfetch: ['--pipe', 'false']};
export const WELCOME_CAPTURE_TIMEOUT_MS = 2500;
const MAX_CAPTURE_BYTES = 128 * 1024;
const MAX_ROWS = 40;
const MAX_COLUMNS = 240;

export type WelcomeCapture = {ok: true; lines: string[]} | {ok: false; reason: string};

/**
 * Runs the user's installed fetch tool once (argv, no stdin, timeout,
 * bounded output) and flattens what it printed into SGR-only rows.
 */
export async function captureWelcome(id: Exclude<WelcomeProviderId, 'vespyr' | 'none'>, cwd: string,
  env: NodeJS.ProcessEnv = process.env): Promise<WelcomeCapture> {
  const descriptor = welcomeProvider(id);
  const status = await detectProvider(descriptor, env.PATH ?? '');
  if (status.state !== 'installed' || !status.binary) return {ok: false, reason: 'not installed'};
  // Run under plain zsh so fetch tools report NMSh's shell rather than node.
  // The script is fixed and only forwards positional argv; provider data is never interpolated.
  const zsh = findExecutable('zsh', env.PATH ?? '');
  const [binary, args] = zsh
    ? [zsh, ['-f', '-c', '"$0" "$@"; exit $?', status.binary, ...(CAPTURE_ARGS[id] ?? [])]]
    : [status.binary, CAPTURE_ARGS[id] ?? []];
  const result = await runExternal(binary, args, {timeoutMs: WELCOME_CAPTURE_TIMEOUT_MS, maxBytes: MAX_CAPTURE_BYTES,
    cwd, env: {...env, TERM: env.TERM ?? 'xterm-256color'}});
  if (!result.ok) return {ok: false, reason: result.error ?? 'failed'};
  const lines = flattenTerminalOutput(result.stdout);
  return lines.length > 0 ? {ok: true, lines} : {ok: false, reason: 'no output'};
}

interface Cell {
  text: string;
  style: string;
}

/**
 * A tiny screen model for fetch-tool output: keeps text and SGR color,
 * honors the cursor movement fetch tools use to place info beside a logo,
 * and drops every other control, OSC, DCS and image-protocol sequence.
 */
export function flattenTerminalOutput(output: string): string[] {
  const grid: Array<Array<Cell | null>> = [];
  let row = 0;
  let column = 0;
  let style = '';
  const clampRow = (value: number) => Math.max(0, Math.min(MAX_ROWS * 2, value));
  const clampColumn = (value: number) => Math.max(0, Math.min(MAX_COLUMNS, value));
  const put = (text: string) => {
    const width = stringWidth(text);
    if (width === 0 || column + width > MAX_COLUMNS) return;
    const line = grid[row] ??= [];
    line[column] = {text, style};
    for (let extra = 1; extra < width; extra += 1) line[column + extra] = null;
    column += width;
  };
  const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
  let index = 0;
  while (index < output.length) {
    const character = output[index]!;
    if (character === '\u001B') {
      const next = output[index + 1];
      if (next === '[') {
        const match = /^\u001B\[([0-9;?:<=>]*)[ -/]*([@-~])/u.exec(output.slice(index, index + 64));
        if (!match) { index += 2; continue; }
        index += match[0].length;
        const params = match[1] ?? '';
        const count = Math.max(1, Number.parseInt(params, 10) || 1);
        switch (match[2]) {
          case 'm':
            if (params.startsWith('?')) break;
            style = params === '' || params === '0' ? '' : `${style}\u001B[${params}m`;
            break;
          case 'A': row = clampRow(row - count); break;
          case 'B': case 'E': row = clampRow(row + count); if (match[2] === 'E') column = 0; break;
          case 'C': column = clampColumn(column + count); break;
          case 'D': column = clampColumn(column - count); break;
          case 'G': column = clampColumn(count - 1); break;
          case 'H': case 'f': {
            const [r, c] = params.split(';');
            row = clampRow((Number.parseInt(r ?? '', 10) || 1) - 1);
            column = clampColumn((Number.parseInt(c ?? '', 10) || 1) - 1);
            break;
          }
          case 'K': if (grid[row]) grid[row]!.length = Math.min(grid[row]!.length, column); break;
          default: break;
        }
        continue;
      }
      if (next === ']' || next === 'P' || next === '_' || next === '^' || next === 'X') {
        // String sequences (OSC, DCS, APC incl. image protocols) end at BEL or ST.
        const bel = output.indexOf('\u0007', index + 2);
        const st = output.indexOf('\u001B\\', index + 2);
        const ends = [bel === -1 ? Infinity : bel + 1, st === -1 ? Infinity : st + 2];
        index = Math.min(...ends);
        if (!Number.isFinite(index)) index = output.length;
        continue;
      }
      index += 2;
      continue;
    }
    if (character === '\n') { row = clampRow(row + 1); column = 0; index += 1; continue; }
    if (character === '\r') { column = 0; index += 1; continue; }
    if (character === '\t') { column = clampColumn((Math.floor(column / 8) + 1) * 8); index += 1; continue; }
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(character)) { index += 1; continue; }
    let end = index;
    while (end < output.length && !/[\u0000-\u001f\u007f-\u009f]/u.test(output[end]!)) end += 1;
    for (const {segment} of segmenter.segment(output.slice(index, end))) put(segment);
    index = end;
  }
  const lines = Array.from(grid.slice(0, MAX_ROWS), line => {
    let ansi = '';
    let current = '';
    for (let cell = 0; cell < (line?.length ?? 0); cell += 1) {
      const value = line![cell];
      if (value === null) continue;
      const next = value ?? {text: ' ', style: ''};
      if (next.style !== current) { ansi += `\u001B[0m${next.style}`; current = next.style; }
      ansi += next.text;
    }
    return current ? `${ansi}\u001B[0m` : ansi;
  });
  while (lines.length > 0 && lines.at(-1)!.replace(/\u001B\[[0-9;]*m/gu, '').trim() === '') lines.pop();
  while (lines.length > 0 && lines[0]!.replace(/\u001B\[[0-9;]*m/gu, '').trim() === '') lines.shift();
  return lines;
}
