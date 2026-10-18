import {execFile} from 'node:child_process';
import {closeSync, constants, fstatSync, openSync, readdirSync, readSync, realpathSync, statSync} from 'node:fs';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {basename, isAbsolute, join, resolve, sep} from 'node:path';
import {detectTerminalHost} from '../../host/terminalHost.js';
import {normalizeOhMyPoshConfigPath} from '../../prompt/ohMyPosh.js';
import {normalizePowerlevel10kConfigPath, powerlevel10kThemeCandidates} from '../../prompt/powerlevel10k.js';
import {detectStarship, normalizeStarshipConfigPath} from '../../prompt/starship.js';
import {resolveCommand, STANDARD_TOOL_DIRECTORIES} from '../../providers/providers.js';
import {isShellId, type ShellId} from '../../shell/adapters/ShellAdapter.js';

const execFileAsync = promisify(execFile);

/**
 * Keep Existing's read-only look at the person's environment. Startup files
 * are read as text (bounded), following plain `source`/`.` lines one level and
 * only inside $HOME; nothing is executed except `--version` of tools found on
 * PATH, nothing is downloaded, and nothing is written. Results are evidence
 * for one review, never saved.
 */

/** active: started by a startup file and runnable · broken: started, not runnable · configured: a config, not started · installed: only the binary or theme. */
export type IntegrationState = 'active' | 'configured' | 'installed' | 'broken';

export interface ProviderEvidence {
  id: 'starship' | 'powerlevel10k' | 'ohMyPosh';
  label: string;
  state: IntegrationState;
  started: boolean;
  runnable: boolean;
  /** The executable found on PATH (or the package-manager prefixes). */
  binary?: string;
  version?: string;
  /** The config file NMSh's adapter would read (absolute), when there is one. */
  configPath?: string;
  configExists: boolean;
  /** Powerlevel10k's theme file. */
  themePath?: string;
  /** The startup file that starts it, as shown (`~/.zshrc`). */
  startedBy?: string;
}

/** A prompt NMSh cannot draw yet. */
export interface CustomPromptEvidence {
  kind: 'assignment' | 'theme' | 'fishPrompt' | 'tide';
  label: string;
  where: string;
}

export interface ToolEvidence {
  id: 'zoxide' | 'atuin';
  label: string;
  role: 'Navigation' | 'History';
  state: IntegrationState;
  startedBy?: string;
}

export interface EnvironmentEvidence {
  /** The home directory the evidence was read from (paths are shown relative to it). */
  home?: string;
  /** `$SHELL` against the shell adapters; `id` only when NMSh can run it. */
  shell: {id?: ShellId; path?: string; label: string};
  host?: string;
  /** Startup files actually read, as shown. */
  files: readonly string[];
  prompts: readonly ProviderEvidence[];
  custom: readonly CustomPromptEvidence[];
  tools: readonly ToolEvidence[];
  /** What the bounded reading skipped or cut, said plainly. */
  notes: readonly string[];
}

export const STARTUP_READ_CAP = 512 * 1024;
export const STARTUP_FILE_LIMIT = 16;

export type StartupHitKind = 'starship' | 'ohMyPosh' | 'powerlevel10k' | 'zshTheme' | 'promptAssignment' | 'promptTheme' | 'zoxide' | 'atuin' | 'fishPrompt' | 'tide';
export interface StartupHit {kind: StartupHitKind; file: string; detail?: string}
export interface StartupScan {files: string[]; hits: StartupHit[]; notes: string[]; ohMyZsh: boolean}

/** What a scan may touch: text reads (already bounded), and optionally real paths, existence and directory listings. */
export interface StartupFileSystem {
  read(path: string): string | undefined;
  realpath?(path: string): string | undefined;
  exists?(path: string): boolean;
  list?(directory: string): string[];
}

/** Shown paths: the home directory as `~`. */
export function displayPath(path: string, home: string): string {
  const base = home.replace(/\/+$/u, '');
  return path === base ? '~' : path.startsWith(`${base}/`) ? `~${path.slice(base.length)}` : path;
}

const inside = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

function startupFiles(shell: ShellId | undefined, home: string, env: NodeJS.ProcessEnv): string[] {
  const config = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
  if (shell === 'fish') return [join(config, 'fish', 'config.fish')];
  if (shell === 'bash') return ['.bash_profile', '.bash_login', '.profile', '.bashrc'].map(name => join(home, name));
  const zdot = env.ZDOTDIR && isAbsolute(env.ZDOTDIR) ? env.ZDOTDIR : home;
  return ['.zshenv', '.zprofile', '.zshrc', '.zlogin'].map(name => join(zdot, name));
}

/** A `source`/`.` target with only `~`, $HOME, ${HOME}, $ZDOTDIR and $XDG_CONFIG_HOME expanded; anything else is not followed. */
function sourceTarget(raw: string, home: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = raw.replace(/^(["'])(.*)\1$/u, '$2');
  if (!value || /[*?[\]`]|\$\(/u.test(value)) return undefined;
  const config = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
  const zdot = env.ZDOTDIR && isAbsolute(env.ZDOTDIR) ? env.ZDOTDIR : home;
  // Whole names only: $HOMEBREW_PREFIX is not $HOME followed by BREW_PREFIX.
  const variable = (name: string) => new RegExp(`\\$\\{${name}\\}|\\$${name}(?![A-Za-z0-9_])`, 'gu');
  const expanded = value.replace(/^~(?=\/|$)/u, () => home).replace(variable('HOME'), () => home).replace(variable('ZDOTDIR'), () => zdot)
    .replace(variable('XDG_CONFIG_HOME'), () => config);
  if (expanded.includes('$')) return undefined;
  return resolve(home, expanded);
}

const COMMENT = /^\s*#/u;
const SOURCE = /^\s*(?:source|\.)\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:#.*)?$/u;

function scanText(text: string, file: string, hits: StartupHit[]): {sources: string[]; ohMyZsh: boolean} {
  const sources: string[] = [];
  let ohMyZsh = false;
  for (const raw of text.split(/\r?\n/u)) {
    if (COMMENT.test(raw) || !raw.trim()) continue;
    const line = raw.trim();
    const source = SOURCE.exec(line);
    if (source) sources.push(source[1]!);
    if (/oh-my-zsh\.sh/u.test(line)) ohMyZsh = true;
    if (/\bstarship\s+init\b/u.test(line)) hits.push({kind: 'starship', file});
    if (/\boh-my-posh\b.*\binit\b/u.test(line)) {
      const config = /--config(?:=|\s+)(["']?)([^"'\s)]+)\1/u.exec(line)?.[2];
      hits.push({kind: 'ohMyPosh', file, ...(config ? {detail: config} : {})});
    }
    const theme = /^(?:source|\.)\s+(["']?)([^"'\s]*powerlevel10k\.zsh-theme)\1/u.exec(line);
    if (theme) hits.push({kind: 'powerlevel10k', file, detail: theme[2]!});
    else if (/romkatv\/powerlevel10k/u.test(line) && !/ZSH_THEME/u.test(line)) hits.push({kind: 'powerlevel10k', file});
    const zshTheme = /^(?:export\s+)?ZSH_THEME\s*=\s*(["']?)([^"'\s]*)\1/u.exec(line);
    if (zshTheme) hits.push({kind: 'zshTheme', file, detail: zshTheme[2]!});
    const assignment = /^(?:export\s+|typeset\s+(?:-g\s+)?|declare\s+(?:-x\s+)?)?(PROMPT|PS1)=/u.exec(line);
    if (assignment) hits.push({kind: 'promptAssignment', file, detail: assignment[1]!});
    const promptTheme = /^prompt\s+([A-Za-z][\w-]*)\s*$/u.exec(line);
    if (promptTheme && !['off', 'restore', '-l', '-c', '-p', '-h'].includes(promptTheme[1]!)) hits.push({kind: 'promptTheme', file, detail: promptTheme[1]!});
    else if (/sindresorhus\/pure\b/u.test(line)) hits.push({kind: 'promptTheme', file, detail: 'pure'});
    else if (/spaceship-prompt|spaceship\.zsh/u.test(line)) hits.push({kind: 'promptTheme', file, detail: 'spaceship'});
    if (/^function\s+fish_prompt\b/u.test(line)) hits.push({kind: 'fishPrompt', file});
    if (/\bzoxide\s+init\b/u.test(line)) hits.push({kind: 'zoxide', file});
    if (/\batuin\s+init\b/u.test(line)) hits.push({kind: 'atuin', file});
  }
  return {sources, ohMyZsh};
}

/**
 * Reads a shell's startup files and what they source (one level, inside
 * $HOME, each file once, at most 16) and finds prompt and tool evidence.
 * Comments are ignored; nothing is executed. Pure over the given reader.
 */
export function scanStartupFiles(shell: ShellId | undefined, home: string, env: NodeJS.ProcessEnv,
  files: StartupFileSystem | ((path: string) => string | undefined)): StartupScan {
  const fs: StartupFileSystem = typeof files === 'function' ? {read: files} : files;
  const realpath = (path: string) => fs.realpath ? fs.realpath(path) : path;
  const root = realpath(home) ?? home;
  const read: string[] = [], hits: StartupHit[] = [], notes: string[] = [];
  const seen = new Set<string>();
  let ohMyZsh = false, limited = false;
  const visit = (path: string, follow: boolean, sourced: boolean): void => {
    const real = realpath(path);
    if (real === undefined) { if (sourced) notes.push(`Skipped ${displayPath(path, home)}: not found or unreadable.`); return; }
    if (seen.has(real)) return;
    if (sourced && (!inside(path, home) || !inside(real, root))) { notes.push(`Skipped ${displayPath(path, home)}: outside your home folder.`); return; }
    if (read.length >= STARTUP_FILE_LIMIT) { limited = true; return; }
    const text = fs.read(path);
    if (text === undefined) { if (sourced) notes.push(`Skipped ${displayPath(path, home)}: not readable as text.`); return; }
    seen.add(real);
    read.push(path);
    if (text.length >= STARTUP_READ_CAP) notes.push(`Read only the first 512 KiB of ${displayPath(path, home)}.`);
    const found = scanText(text.slice(0, STARTUP_READ_CAP), displayPath(path, home), hits);
    ohMyZsh ||= found.ohMyZsh;
    if (!follow) return;
    for (const target of found.sources) {
      const resolved = sourceTarget(target, home, env);
      if (resolved) visit(resolved, false, true);
    }
  };
  for (const path of startupFiles(shell, home, env)) visit(path, true, false);
  if (shell === 'fish') {
    const config = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
    const fish = join(config, 'fish');
    const confd = (fs.list?.(join(fish, 'conf.d')) ?? []).filter(name => name.endsWith('.fish')).sort();
    const tide = confd.includes('_tide_init.fish') || (fs.list?.(join(fish, 'functions')) ?? []).some(name => /^_tide_.*\.fish$/u.test(name));
    for (const name of confd) if (name !== '_tide_init.fish') visit(join(fish, 'conf.d', name), false, false);
    const prompt = join(fish, 'functions', 'fish_prompt.fish');
    if (tide) hits.push({kind: 'tide', file: displayPath(join(fish, 'conf.d', '_tide_init.fish'), home)});
    else if (fs.exists?.(prompt)) hits.push({kind: 'fishPrompt', file: displayPath(prompt, home)});
  }
  if (limited) notes.push(`Read the first ${STARTUP_FILE_LIMIT} startup files only.`);
  return {files: read, hits, notes, ohMyZsh};
}

/** A regular file's text, at most STARTUP_READ_CAP bytes; never blocks on a pipe or device. */
function readBounded(path: string): string | undefined {
  let fd: number | undefined;
  try {
    if (!statSync(path).isFile()) return undefined;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    if (!fstatSync(fd).isFile()) return undefined;
    const buffer = Buffer.alloc(Math.min(STARTUP_READ_CAP, fstatSync(fd).size));
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, length).toString('utf8');
  } catch { return undefined; } finally { if (fd !== undefined) closeSync(fd); }
}

const realpathOrUndefined = (path: string) => { try { return realpathSync(path); } catch { return undefined; } };
const listOrEmpty = (directory: string) => { try { return readdirSync(directory); } catch { return []; } };
const readable = (path: string | undefined) => { try { return Boolean(path) && statSync(path!).isFile(); } catch { return false; } };

export interface ProviderProbe {
  /** Extra directories to look for tools in after PATH (package-manager prefixes). */
  fallbacks: readonly string[];
  /** Where an installed Powerlevel10k theme can be (Homebrew, clones, plugin managers). */
  powerlevel10kCandidates: readonly string[];
  shellVersion(executable: string): string | undefined | Promise<string | undefined>;
}

/** `$SHELL --version` with only PATH: no startup file is read and nothing is written. */
async function shellVersionOf(executable: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  try { return (await execFileAsync(executable, ['--version'], {timeout: 2000, maxBuffer: 4096, env: {PATH: env.PATH ?? ''}})).stdout.split('\n')[0]; }
  catch { return undefined; }
}

/** Starship creates ~/.cache/starship even for `--version`; an uncreatable cache path keeps detection from writing. */
const NO_CACHE = '/dev/null/nmsh-read-only';

function state(started: boolean, runnable: boolean, configured: boolean): IntegrationState | undefined {
  if (started) return runnable ? 'active' : 'broken';
  if (configured) return 'configured';
  return runnable ? 'installed' : undefined;
}

/** The read-only evidence Keep Existing reviews. */
export async function detectEnvironment(options: {env?: NodeJS.ProcessEnv; home?: string; probe?: Partial<ProviderProbe>} = {}): Promise<EnvironmentEvidence> {
  const env = options.env ?? process.env;
  const home = resolve(options.home ?? env.HOME ?? homedir());
  const fallbacks = options.probe?.fallbacks ?? STANDARD_TOOL_DIRECTORIES;
  const shellPath = env.SHELL?.trim();
  const name = shellPath ? basename(shellPath) : undefined;
  const id = isShellId(name) ? name : undefined;
  const versionText = id && shellPath ? await (options.probe?.shellVersion ?? (path => shellVersionOf(path, env)))(shellPath) : undefined;
  const version = /(\d+(?:\.\d+)+)/u.exec(versionText ?? '')?.[1];
  const scan = scanStartupFiles(id ?? 'zsh', home, env, {read: readBounded, realpath: realpathOrUndefined, exists: readable, list: listOrEmpty});
  const startedBy = (kind: StartupHitKind) => scan.hits.find(hit => hit.kind === kind)?.file;
  const shown = (path: string) => displayPath(path, home);

  const prompts: ProviderEvidence[] = [];
  // Starship: PATH plus `--version` only; the config path follows STARSHIP_CONFIG and XDG like Starship itself.
  const starshipBinary = resolveCommand('starship', env.PATH ?? '', fallbacks);
  const starship = starshipBinary ? await detectStarship(env, starshipBinary, {PATH: env.PATH ?? '', HOME: home, STARSHIP_CACHE: NO_CACHE}) : undefined;
  const starshipConfig = normalizeStarshipConfigPath(env, home);
  const starshipConfigured = readable(starshipConfig);
  const starshipState = state(Boolean(startedBy('starship')), Boolean(starship?.installed), starshipConfigured);
  if (starshipState) prompts.push({id: 'starship', label: 'Starship', state: starshipState, started: Boolean(startedBy('starship')), runnable: Boolean(starship?.installed),
    ...(starshipBinary ? {binary: starshipBinary} : {}),
    ...(starship?.version ? {version: starship.version} : {}), ...(starshipConfigured ? {configPath: starshipConfig} : {}), configExists: starshipConfigured,
    ...(startedBy('starship') ? {startedBy: startedBy('starship')} : {})});

  // Powerlevel10k: a theme line starts it; the theme file must exist to run.
  const p10kHit = scan.hits.find(hit => hit.kind === 'powerlevel10k')
    ?? (scan.ohMyZsh ? scan.hits.find(hit => hit.kind === 'zshTheme' && /^powerlevel10k\b/u.test(hit.detail ?? '')) : undefined);
  const explicitTheme = p10kHit?.kind === 'powerlevel10k' && p10kHit.detail ? sourceTarget(p10kHit.detail, home, env) : undefined;
  const candidates = options.probe?.powerlevel10kCandidates ?? powerlevel10kThemeCandidates(env, home);
  const themePath = [explicitTheme, ...(p10kHit?.kind === 'zshTheme' ? [join(env.ZSH_CUSTOM || join(env.ZSH || join(home, '.oh-my-zsh'), 'custom'), 'themes/powerlevel10k/powerlevel10k.zsh-theme')] : []), ...candidates]
    .find(path => path && readable(path));
  const p10kConfig = normalizePowerlevel10kConfigPath(env, home);
  const p10kConfigured = readable(p10kConfig);
  const p10kState = state(Boolean(p10kHit), Boolean(themePath), p10kConfigured);
  if (p10kState) prompts.push({id: 'powerlevel10k', label: 'Powerlevel10k', state: p10kState, started: Boolean(p10kHit), runnable: Boolean(themePath),
    ...(themePath ? {themePath} : {}), configPath: p10kConfig, configExists: p10kConfigured, ...(p10kHit ? {startedBy: p10kHit.file} : {})});

  // Oh My Posh: the --config of its init line, or POSH_CONFIG; a remote (URL) config is never fetched or treated as a file.
  const poshHit = scan.hits.find(hit => hit.kind === 'ohMyPosh');
  const poshConfig = normalizeOhMyPoshConfigPath(poshHit?.detail ?? env.POSH_CONFIG, home);
  // Presence only: `oh-my-posh version` is not run, so its cache can never be created by detection.
  const poshBinary = resolveCommand('oh-my-posh', env.PATH ?? '', fallbacks);
  const posh = poshBinary ? {installed: true, version: undefined as string | undefined} : undefined;
  const poshConfigured = readable(poshConfig);
  const poshState = state(Boolean(poshHit), Boolean(posh?.installed), poshConfigured);
  if (poshState) prompts.push({id: 'ohMyPosh', label: 'Oh My Posh', state: poshState, started: Boolean(poshHit), runnable: Boolean(posh?.installed),
    ...(poshBinary ? {binary: poshBinary} : {}),
    ...(posh?.version ? {version: posh.version} : {}), ...(poshConfigured ? {configPath: poshConfig} : {}), configExists: poshConfigured,
    ...(poshHit ? {startedBy: poshHit.file} : {})});

  const custom: CustomPromptEvidence[] = [];
  const shellName = id ?? 'zsh';
  for (const hit of scan.hits) {
    if (hit.kind === 'promptAssignment') custom.push({kind: 'assignment', label: `A custom ${shellName} ${hit.detail}`, where: hit.file});
    else if (hit.kind === 'promptTheme') custom.push({kind: 'theme', label: `The ${hit.detail} prompt`, where: hit.file});
    else if (hit.kind === 'zshTheme' && scan.ohMyZsh && hit.detail && !/^powerlevel10k\b/u.test(hit.detail)) custom.push({kind: 'theme', label: `Oh My Zsh theme ${hit.detail}`, where: hit.file});
    else if (hit.kind === 'fishPrompt') custom.push({kind: 'fishPrompt', label: 'A custom fish_prompt', where: hit.file});
    else if (hit.kind === 'tide') custom.push({kind: 'tide', label: 'Tide', where: hit.file});
  }
  const unique = custom.filter((item, index) => custom.findIndex(other => other.label === item.label && other.where === item.where) === index);

  const tools: ToolEvidence[] = [];
  for (const [toolId, label, role] of [['zoxide', 'zoxide', 'Navigation'], ['atuin', 'Atuin', 'History']] as const) {
    const started = startedBy(toolId);
    const toolState = state(Boolean(started), Boolean(resolveCommand(toolId, env.PATH ?? '', fallbacks)), false);
    if (toolState) tools.push({id: toolId, label, role, state: toolState, ...(started ? {startedBy: started} : {})});
  }
  const host = detectTerminalHost(env).name;
  return {
    home,
    shell: {...(id ? {id} : {}), ...(shellPath ? {path: shellPath} : {}), label: id ? `${id}${version ? ` ${version}` : ''}` : name ?? 'unknown shell'},
    ...(host && host !== 'this terminal' ? {host} : {}),
    files: scan.files.map(shown), prompts, custom: unique, tools, notes: scan.notes,
  };
}
