import {lstatSync, readFileSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {detectPowerlevel10k, powerlevel10kThemeCandidates} from '../prompt/powerlevel10k.js';

/**
 * Filesystem detection for curated tools that are not executables: Zsh
 * frameworks and prompt themes. Each detector is registered explicitly and
 * looks only at documented locations for a recognizable structure (a
 * directory merely named like the framework is not enough). Nothing is
 * sourced, executed or written; a detection grants no install, uninstall,
 * configuration or provider authority by itself.
 */

export interface FilesystemFact {
  /** Framework root or theme file that proved the installation. */
  path: string;
  /** How it was found, in plain words, only when known (e.g. "$ZSH", "via Oh My Zsh"). */
  source?: string;
}

const isDirectory = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };

/** A trustworthy absolute directory path from the environment, or undefined. */
function envDirectory(value: string | undefined, home: string): string | undefined {
  const trimmed = value?.trim().replace(/^~(?=\/|$)/u, home);
  return trimmed && isAbsolute(trimmed) && !/[\u0000-\u001f\u007f]/u.test(trimmed) ? resolve(trimmed) : undefined;
}

/** Oh My Zsh's canonical layout: the loader plus its lib and themes directories. */
export function isOhMyZshRoot(path: string): boolean {
  return isFile(join(path, 'oh-my-zsh.sh')) && isDirectory(join(path, 'lib')) && isDirectory(join(path, 'themes'));
}

export function detectOhMyZsh(env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): FilesystemFact | undefined {
  const configured = envDirectory(env.ZSH, home);
  if (configured && isOhMyZshRoot(configured)) return {path: configured, source: '$ZSH'};
  const fallback = join(home, '.oh-my-zsh');
  return isOhMyZshRoot(fallback) ? {path: fallback} : undefined;
}

/** Prezto: documented clone location ${ZDOTDIR:-$HOME}/.zprezto with its init.zsh and modules. */
export function detectPrezto(env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): FilesystemFact | undefined {
  const root = join(envDirectory(env.ZDOTDIR, home) ?? home, '.zprezto');
  return isFile(join(root, 'init.zsh')) && isDirectory(join(root, 'modules')) ? {path: root} : undefined;
}

/** Zim: ${ZIM_HOME:-${ZDOTDIR:-$HOME}/.zim} holding the zimfw.zsh manager. */
export function detectZim(env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): FilesystemFact | undefined {
  const configured = envDirectory(env.ZIM_HOME, home);
  const root = configured ?? join(envDirectory(env.ZDOTDIR, home) ?? home, '.zim');
  return isFile(join(root, 'zimfw.zsh')) ? {path: root, ...(configured ? {source: '$ZIM_HOME'} : {})} : undefined;
}

/** zinit: documented ${XDG_DATA_HOME:-$HOME/.local/share}/zinit/zinit.git/zinit.zsh, or $ZINIT_HOME. */
export function detectZinit(env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): FilesystemFact | undefined {
  const configured = envDirectory(env.ZINIT_HOME, home);
  const root = configured ?? join(envDirectory(env.XDG_DATA_HOME, home) ?? join(home, '.local', 'share'), 'zinit', 'zinit.git');
  return isFile(join(root, 'zinit.zsh')) ? {path: root, ...(configured ? {source: '$ZINIT_HOME'} : {})} : undefined;
}

/** Antidote: documented clone ${ZDOTDIR:-$HOME}/.antidote, or the Homebrew formula's share directory. */
export function detectAntidote(env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): FilesystemFact | undefined {
  const clone = join(envDirectory(env.ZDOTDIR, home) ?? home, '.antidote');
  if (isFile(join(clone, 'antidote.zsh'))) return {path: clone};
  for (const prefix of [envDirectory(env.HOMEBREW_PREFIX, home), '/opt/homebrew', '/usr/local'].filter((value): value is string => Boolean(value))) {
    const shared = join(prefix, 'share', 'antidote');
    if (isFile(join(shared, 'antidote.zsh'))) return {path: shared, source: 'Homebrew'};
  }
  return undefined;
}

/** Powerlevel10k through its one existing detector; the source is named only when the found path says it. */
export function detectPowerlevel10kTool(env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): FilesystemFact | undefined {
  const status = detectPowerlevel10k(env, home, powerlevel10kThemeCandidates(env, home));
  if (!status.installed || !status.themePath) return undefined;
  const path = status.themePath;
  const source = /\/custom\/themes\/powerlevel10k\//u.test(path) ? 'via Oh My Zsh'
    : /\/share\/powerlevel10k\//u.test(path) && /^(?:\/opt\/homebrew|\/usr\/local)\//u.test(path) ? 'Homebrew'
      : /zinit\/plugins\//u.test(path) ? 'via zinit'
        : path === join(home, 'powerlevel10k', 'powerlevel10k.zsh-theme') ? 'standalone clone'
          : path.startsWith('/usr/share/') ? 'system package' : undefined;
  return {path, ...(source ? {source} : {})};
}

// ---- Oh My Zsh: guided install and previous-zshrc recovery --------------------------

/**
 * Curated metadata for a tool whose upstream installer has config side
 * effects. NMSh does not run such installers (it never runs install
 * scripts); it explains, snapshots, hands the terminal to the person, and
 * verifies afterwards. First-party only.
 */
export interface InstallAdapter {
  id: string;
  /** Exact official source shown to the person. */
  source: string;
  prerequisites: readonly string[];
  /** Files the upstream installer may replace or rename by default. */
  filesAtRisk: (env: NodeJS.ProcessEnv) => string[];
  /** Files fingerprinted (and backed up) before the handoff. */
  snapshotTargets: (env: NodeJS.ProcessEnv) => string[];
  /** Fixed, documented settings that disable the side effects; shown verbatim. */
  safeEnvironment: Readonly<Record<string, string>>;
  safeArgs: readonly string[];
  /** The person runs it in a terminal; NMSh never executes it. */
  handoff: 'manual-terminal';
  steps: (env: NodeJS.ProcessEnv) => string[];
  verify: (env: NodeJS.ProcessEnv) => FilesystemFact | undefined;
  recoveryHints: readonly string[];
}

export const zdotdir = (env: NodeJS.ProcessEnv = process.env) => envDirectory(env.ZDOTDIR, env.HOME || homedir()) ?? (env.HOME || homedir());

export const OH_MY_ZSH_INSTALLER_URL = 'https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh';

const quote = (value: string) => `'${value.replace(/'/gu, `'\\''`)}'`;

/** Checked against the current official tools/install.sh (KEEP_ZSHRC, CHSH, RUNZSH, REPO/REMOTE/BRANCH, --unattended, --keep-zshrc). */
export const OH_MY_ZSH_INSTALL: InstallAdapter = {
  id: 'oh-my-zsh',
  source: OH_MY_ZSH_INSTALLER_URL,
  prerequisites: ['zsh', 'git', 'curl or wget'],
  filesAtRisk: env => [join(zdotdir(env), '.zshrc'), join(zdotdir(env), '.zshrc.pre-oh-my-zsh'), join(zdotdir(env), '.shell.pre-oh-my-zsh')],
  snapshotTargets: env => [join(zdotdir(env), '.zshrc')],
  safeEnvironment: {KEEP_ZSHRC: 'yes', CHSH: 'no', RUNZSH: 'no', REPO: 'ohmyzsh/ohmyzsh', REMOTE: 'https://github.com/ohmyzsh/ohmyzsh.git', BRANCH: 'master'},
  safeArgs: ['--unattended', '--keep-zshrc'],
  handoff: 'manual-terminal',
  steps: env => {
    // A file in your own home, not a predictable name in a shared temp directory that another user could replace between download and run.
    const file = join(env.HOME && isAbsolute(env.HOME) ? env.HOME : homedir(), 'ohmyzsh-install.sh');
    const settings = Object.entries(OH_MY_ZSH_INSTALL.safeEnvironment).map(([name, value]) => `${name}=${value}`).join(' ');
    return [`curl -fsSL -o ${quote(file)} ${OH_MY_ZSH_INSTALLER_URL}`, `less ${quote(file)}`, `shasum -a 256 ${quote(file)}`,
      `${settings} sh ${quote(file)} ${OH_MY_ZSH_INSTALL.safeArgs.join(' ')}`];
  },
  verify: env => detectOhMyZsh(env),
  recoveryHints: ['KEEP_ZSHRC=yes leaves your .zshrc in place, so Oh My Zsh is not loaded until you add its lines yourself (see its templates/zshrc.zsh-template).',
    'If .zshrc changed anyway, NMSh shows the change and keeps the backup it made; it never restores silently.'],
};

export interface FileFacts {path: string; exists: boolean; bytes?: number; modified?: Date; sha256?: string; symlink?: boolean}

export function fileFacts(path: string, hash: (content: Buffer) => string): FileFacts {
  try {
    const link = lstatSync(path);
    const info = statSync(path);
    if (!info.isFile()) return {path, exists: false};
    return {path, exists: true, bytes: info.size, modified: info.mtime, sha256: hash(readFileSync(path)), symlink: link.isSymbolicLink()};
  } catch { return {path, exists: false}; }
}

/** The current .zshrc and the installer's .zshrc.pre-oh-my-zsh, when the latter exists. */
export function previousZshrc(env: NodeJS.ProcessEnv = process.env): {current: string; previous: string} | undefined {
  const dir = zdotdir(env);
  const previous = join(dir, '.zshrc.pre-oh-my-zsh');
  return isFile(previous) ? {current: join(dir, '.zshrc'), previous} : undefined;
}
