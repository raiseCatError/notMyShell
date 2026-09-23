import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {accessSync, constants} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter, isAbsolute, join, resolve} from 'node:path';
import type {PromptContext} from '../shell/ShellContext.js';
import type {PromptSegmentSnapshot} from './snapshot.js';
import type {RgbColor} from '../ui/palette.js';

const execFileAsync = promisify(execFile);
const SGR = /\u001B\[([0-9;]*)m/gu;

export interface StarshipStatus {
  installed: boolean;
  binary?: string;
  version?: string;
  configPath: string;
  configExists: boolean;
}

export interface StarshipPromptResult {
  text: string;
  ansi: string;
  segments: PromptSegmentSnapshot[];
  normalizedMultiline: boolean;
}

export function normalizeStarshipConfigPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const configured = env.STARSHIP_CONFIG?.trim();
  const expanded = configured?.replace(/^~(?=\/|$)/u, home);
  return resolve(expanded || join(env.XDG_CONFIG_HOME || join(home, '.config'), 'starship.toml'));
}

export function findStarshipBinary(pathValue = process.env.PATH ?? ''): string | undefined {
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, process.platform === 'win32' ? 'starship.exe' : 'starship');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH.
    }
  }
  return undefined;
}

export async function detectStarship(env: NodeJS.ProcessEnv = process.env, binary = findStarshipBinary(env.PATH)): Promise<StarshipStatus> {
  const configPath = normalizeStarshipConfigPath(env);
  if (!binary) return {installed: false, configPath, configExists: false};
  let version: string | undefined;
  try {
    const result = await execFileAsync(binary, ['--version'], {timeout: 3000, maxBuffer: 4096});
    version = result.stdout.trim() || result.stderr.trim() || undefined;
  } catch {
    // The binary was found; a version command failure does not hide that fact.
  }
  let configExists = false;
  try { accessSync(configPath, constants.R_OK); configExists = true; } catch { /* Default configuration is valid. */ }
  return {installed: true, binary, ...(version ? {version} : {}), configPath, configExists};
}

function xtermColor(index: number): RgbColor {
  const basic = [
    [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
    [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
  ];
  if (index < 16) { const [red, green, blue] = basic[index]!; return {red: red!, green: green!, blue: blue!}; }
  if (index >= 232) { const v = 8 + (index - 232) * 10; return {red: v, green: v, blue: v}; }
  const value = index - 16;
  const levels = [0, 95, 135, 175, 215, 255];
  return {red: levels[Math.floor(value / 36)]!, green: levels[Math.floor((value % 36) / 6)]!, blue: levels[value % 6]!};
}

export function parseStarshipPrompt(output: string): StarshipPromptResult {
  const withoutOsc = output.replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/gu, '');
  const safeEscapes = withoutOsc.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu,
    sequence => /^\u001B\[[0-9;]*m$/u.test(sequence) ? sequence : '');
  const normalizedMultiline = /[\r\n]/u.test(safeEscapes.trimEnd());
  const ansi = safeEscapes.replace(/[\r\n]+/gu, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/gu, '').trimEnd();
  let foreground: RgbColor | undefined;
  let background: RgbColor | undefined;
  let bold = false;
  const segments: PromptSegmentSnapshot[] = [];
  let plain = '';
  let cursor = 0;
  const push = () => {
    if (!plain) return;
    segments.push({text: plain, ...(foreground ? {foreground: {...foreground}} : {}), ...(background ? {background: {...background}} : {}), geometry: 'plain'});
    plain = '';
  };
  for (const match of ansi.matchAll(SGR)) {
    const index = match.index ?? 0;
    plain += ansi.slice(cursor, index);
    push();
    const values = (match[1] || '0').split(';').map(value => Number(value || 0));
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i]!;
      if (value === 0) { foreground = undefined; background = undefined; bold = false; }
      else if (value === 1) bold = true;
      else if (value === 2 || value === 22) bold = false;
      else if (value === 39) foreground = undefined;
      else if (value === 49) background = undefined;
      else if (value >= 30 && value <= 37) foreground = xtermColor(value - 30 + (bold ? 8 : 0));
      else if (value >= 90 && value <= 97) foreground = xtermColor(value - 90 + 8);
      else if (value >= 40 && value <= 47) background = xtermColor(value - 40);
      else if (value >= 100 && value <= 107) background = xtermColor(value - 100 + 8);
      else if ((value === 38 || value === 48) && values[i + 1] === 2 && values.length >= i + 5) {
        const color = {red: values[i + 2]!, green: values[i + 3]!, blue: values[i + 4]!};
        if (value === 38) foreground = color; else background = color;
        i += 4;
      } else if ((value === 38 || value === 48) && values[i + 1] === 5 && values.length > i + 2) {
        const color = xtermColor(values[i + 2]!);
        if (value === 38) foreground = color; else background = color;
        i += 2;
      }
    }
    cursor = index + match[0].length;
  }
  plain += ansi.slice(cursor);
  push();
  return {text: ansi.replace(SGR, ''), ansi, segments, normalizedMultiline};
}

export async function renderStarshipPrompt(
  context: PromptContext,
  status: StarshipStatus,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StarshipPromptResult> {
  if (!status.installed || !status.binary) throw new Error('Starship is not installed or not available on PATH.');
  const childEnv: NodeJS.ProcessEnv = {...env, PWD: context.cwd};
  if (status.configPath) childEnv.STARSHIP_CONFIG = status.configPath;
  const result = await execFileAsync(status.binary, ['prompt', `--status=${context.exitStatus ?? 0}`, '--jobs=0'], {
    cwd: isAbsolute(context.cwd) ? context.cwd : process.cwd(), env: childEnv, timeout: 1500, maxBuffer: 256 * 1024,
  });
  return parseStarshipPrompt(result.stdout);
}
