import {execFile, spawn} from 'node:child_process';
import {accessSync, constants} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, resolve} from 'node:path';
import {promisify} from 'node:util';
import {resolveCommand} from '../providers/providers.js';
import type {PromptContext} from '../shell/ShellContext.js';
import {parseStarshipPrompt, type StarshipPromptResult} from './starship.js';

const execFileAsync = promisify(execFile);

/**
 * Oh My Posh as an external prompt provider. NMSh runs the executable
 * directly (`oh-my-posh print primary`), never `oh-my-posh init` and never
 * through a shell or the user's rc files: argv only, the cwd and last exit
 * status passed as documented flags, no controlling TTY, bounded output, a
 * timeout that kills the whole process group, and cancellation. Its ANSI
 * output crosses the same safe span parser as Starship and Powerlevel10k.
 *
 * Config: the path chosen in NMSh, else POSH_CONFIG (documented by Oh My
 * Posh), else Oh My Posh's own built-in default. No rc file is parsed.
 */

export interface OhMyPoshStatus {
  installed: boolean;
  binary?: string;
  version?: string;
  /** undefined: Oh My Posh's built-in default configuration. */
  configPath?: string;
  configSource: 'nmsh' | 'POSH_CONFIG' | 'default';
  configExists: boolean;
}

export const OH_MY_POSH_OUTPUT_LIMIT = 256 * 1024;

function readable(path: string): boolean {
  try { accessSync(path, constants.R_OK); return true; } catch { return false; }
}

/** Absolute, readable-or-not local path; remote (URL) configs are never fetched by NMSh's choice. */
export function normalizeOhMyPoshConfigPath(value: string | undefined, home = homedir()): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) || /[\u0000-\u001f\u007f]/u.test(trimmed)) return undefined;
  const expanded = trimmed.replace(/^~(?=\/|$)/u, home);
  return isAbsolute(expanded) ? resolve(expanded) : undefined;
}

export function ohMyPoshConfig(configured: string | undefined, env: NodeJS.ProcessEnv = process.env, home = homedir()): Pick<OhMyPoshStatus, 'configPath' | 'configSource' | 'configExists'> {
  const chosen = normalizeOhMyPoshConfigPath(configured, home);
  if (chosen) return {configPath: chosen, configSource: 'nmsh', configExists: readable(chosen)};
  const fromEnv = normalizeOhMyPoshConfigPath(env.POSH_CONFIG, home);
  if (fromEnv) return {configPath: fromEnv, configSource: 'POSH_CONFIG', configExists: readable(fromEnv)};
  return {configSource: 'default', configExists: false};
}

export async function detectOhMyPosh(configured?: string, env: NodeJS.ProcessEnv = process.env,
  binary = resolveCommand('oh-my-posh', env.PATH ?? '')): Promise<OhMyPoshStatus> {
  const config = ohMyPoshConfig(configured, env, env.HOME || homedir());
  if (!binary) return {installed: false, ...config};
  let version: string | undefined;
  try {
    const result = await execFileAsync(binary, ['version'], {timeout: 3000, maxBuffer: 4096, env: ohMyPoshEnvironment(env)});
    version = result.stdout.trim().split('\n')[0] || undefined;
  } catch { /* Found; a failing version command does not hide that. */ }
  return {installed: true, binary, ...(version ? {version} : {}), ...config};
}

/** The documented `print primary` argv. Every value is its own argv element; nothing is shell text. */
export function ohMyPoshArgs(context: Pick<PromptContext, 'cwd' | 'exitStatus'>, status: Pick<OhMyPoshStatus, 'configPath'>, width = 200): string[] {
  const exit = context.exitStatus;
  return ['print', 'primary', `--pwd=${context.cwd}`, ...(exit === undefined ? ['--no-status'] : [`--status=${exit}`]),
    `--terminal-width=${width}`, '--escape=false', ...(status.configPath ? [`--config=${status.configPath}`] : [])];
}

/** The environment is inherited minus POSH_CONFIG (the config is explicit argv) and anything that could hand it a TTY. */
function ohMyPoshEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const {POSH_CONFIG: _config, ...rest} = env;
  return {...rest, TERM: env.TERM || 'xterm-256color', NO_COLOR: undefined};
}

export function renderOhMyPoshPrompt(context: PromptContext, status: OhMyPoshStatus, env: NodeJS.ProcessEnv = process.env,
  options: {timeoutMs?: number; signal?: AbortSignal; width?: number} = {}): Promise<StarshipPromptResult> {
  if (!status.installed || !status.binary) return Promise.reject(new Error('Oh My Posh is not installed or not available on PATH.'));
  if (status.configPath && !status.configExists) return Promise.reject(new Error(`Oh My Posh config not found: ${status.configPath}`));
  const cwd = isAbsolute(context.cwd) ? context.cwd : process.cwd();
  return new Promise((resolvePrompt, reject) => {
    const child = spawn(status.binary!, ohMyPoshArgs({...context, cwd}, status, options.width), {
      cwd, env: ohMyPoshEnvironment(env), stdio: ['ignore', 'pipe', 'ignore'], detached: true,
    });
    let stdout = '';
    let settled = false;
    const kill = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolvePrompt(parseStarshipPrompt(stdout));
    };
    const abort = () => { kill(); finish(new Error('Oh My Posh prompt was cancelled.')); };
    const timer = setTimeout(() => { kill(); finish(new Error('Oh My Posh prompt timed out.')); }, options.timeoutMs ?? 3000);
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener('abort', abort, {once: true});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > OH_MY_POSH_OUTPUT_LIMIT) { kill(); finish(new Error('Oh My Posh prompt output exceeded its limit.')); }
    });
    child.on('error', error => finish(error));
    child.on('close', code => finish(code === 0 ? undefined : new Error(`Oh My Posh exited with ${code}.`)));
  });
}
