import {existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {TOOL_CONFIG_REGISTRY, configLocations, type ToolConfigEntry} from '../tools/config/registry.js';

/**
 * Dotfiles discovery: a repository is untrusted data. The scan only lists
 * and reads bounded regular files; it never runs install scripts, Make
 * targets, chezmoi scripts or templates, Git hooks, Stow or any shell, Lua or
 * Vimscript. Recognized files are routed to the first-party tool registry.
 */

export type SourceType = 'plain' | 'git' | 'stow' | 'chezmoi';
export const SOURCE_LABELS: Record<SourceType, string> = {plain: 'Plain directory', git: 'Git checkout', stow: 'GNU Stow-style repository', chezmoi: 'chezmoi source state'};

export interface FoundFile {
  /** Path inside the repository. */
  repoPath: string;
  /** The home-relative path it represents (Stow package and chezmoi prefixes removed). */
  target: string;
  tool: ToolConfigEntry;
  /** Stow package, when the source is Stow-style. */
  package?: string;
  /** chezmoi template: not literal config; reviewed with chezmoi, never rendered here. */
  templated?: boolean;
  symlink?: boolean;
  size: number;
}

export interface ScanResult {
  root: string;
  type: SourceType;
  packages: string[];
  found: FoundFile[];
  /** Scripts and generators that exist but are never run. */
  scripts: string[];
  truncated: boolean;
}

const SKIP = new Set(['.git', 'node_modules', '.cache', '.venv', 'vendor', '__pycache__']);
const MAX_ENTRIES = 5000;
const MAX_DEPTH = 7;
export const MAX_FILE = 512 * 1024;
const SCRIPT = /(?:^|\/)(?:install|bootstrap|setup)(?:\.[a-z]+)?$|(?:^|\/)Makefile$|(?:^|\/)run_(?:once_|onchange_)?(?:before_|after_)?[^/]+$|\.(?:sh|bash|zsh|py|rb|pl|js|mjs)$/u;

export function expandSource(input: string, cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const text = input.trim();
  const home = env.HOME || homedir();
  if (text === '~' || text.startsWith('~/')) return join(home, text.slice(1));
  return isAbsolute(text) ? text : resolve(cwd, text);
}

export const isRemoteSource = (input: string): boolean => /^(?:https:\/\/|git@|ssh:\/\/)[^\s'"]+$/u.test(input.trim());

/** chezmoi source names → target names (dot_, private_, executable_, readonly_ and .tmpl). */
export function chezmoiTarget(path: string): {target: string; templated: boolean} {
  let templated = false;
  const segments = path.split('/').map(segment => {
    let name = segment;
    if (name.endsWith('.tmpl')) { templated = true; name = name.slice(0, -5); }
    for (;;) {
      const next = name.replace(/^(?:private_|executable_|readonly_|empty_|exact_|create_|modify_|encrypted_|symlink_)/u, '');
      if (next === name) break;
      name = next;
    }
    return name.startsWith('dot_') ? `.${name.slice(4)}` : name;
  });
  return {target: segments.join('/'), templated};
}

function detectType(root: string, top: string[]): {type: SourceType; packages: string[]} {
  if (top.includes('.chezmoiroot') || top.some(name => /^\.chezmoi/u.test(name)) || top.some(name => /^dot_/u.test(name))) return {type: 'chezmoi', packages: []};
  // Stow: top-level package directories whose contents are home-relative (dotfiles or .config).
  const packages = top.filter(name => !name.startsWith('.') && !SKIP.has(name)).filter(name => {
    try {
      const full = join(root, name);
      return lstatSync(full).isDirectory() && readdirSync(full).some(entry => entry.startsWith('.'));
    } catch { return false; }
  });
  if (packages.length >= 1 && packages.length >= top.filter(name => !name.startsWith('.')).length / 2) return {type: 'stow', packages};
  return {type: top.includes('.git') ? 'git' : 'plain', packages: []};
}

/** Bounded listing and recognition. Nothing found is executed or followed outside the root. */
export function scanDotfiles(root: string): ScanResult | {error: string} {
  let real: string;
  try { real = realpathSync(root); } catch { return {error: `${root} does not exist.`}; }
  if (!statSync(real).isDirectory()) return {error: `${root} is not a directory.`};
  const top = readdirSync(real);
  const {type, packages} = detectType(real, top);
  const found: FoundFile[] = [];
  const scripts: string[] = [];
  let entries = 0;
  let truncated = false;
  const walk = (directory: string, depth: number) => {
    if (depth > MAX_DEPTH || truncated) return;
    let names: string[];
    try { names = readdirSync(directory); } catch { return; }
    for (const name of names) {
      if (++entries > MAX_ENTRIES) { truncated = true; return; }
      if (SKIP.has(name)) continue;
      const full = join(directory, name);
      const repoPath = relative(real, full);
      let info;
      try { info = lstatSync(full); } catch { continue; }
      if (info.isDirectory()) { walk(full, depth + 1); continue; }
      const symlink = info.isSymbolicLink();
      if (!info.isFile() && !symlink) continue;
      if (SCRIPT.test(repoPath)) { scripts.push(repoPath); }
      let target = repoPath;
      let templated = false;
      let pkg: string | undefined;
      if (type === 'stow') { const [first, ...rest] = repoPath.split('/'); if (packages.includes(first!)) { pkg = first; target = rest.join('/'); } }
      if (type === 'chezmoi') ({target, templated} = chezmoiTarget(repoPath));
      const tool = TOOL_CONFIG_REGISTRY.find(entry => entry.dotfiles.test(target) || entry.dotfiles.test(repoPath));
      if (!tool) continue;
      found.push({repoPath, target, tool, size: symlink ? 0 : info.size, ...(pkg ? {package: pkg} : {}), ...(templated ? {templated} : {}), ...(symlink ? {symlink} : {})});
    }
  };
  walk(real, 0);
  return {root: real, type, packages, found, scripts: scripts.slice(0, 50), truncated};
}

/** Reads one found file as text, bounded; symlinks are not dereferenced (they are shown, not trusted). */
export function readFound(scan: ScanResult, file: FoundFile): string | {error: string} {
  if (file.symlink) return {error: 'Symlink inside the repository; not followed. Review it yourself.'};
  if (file.size > MAX_FILE) return {error: 'Larger than 512 KiB; skipped.'};
  try {
    const text = readFileSync(join(scan.root, file.repoPath), 'utf8');
    return text.includes('\u0000') ? {error: 'Binary file; skipped.'} : text;
  } catch { return {error: 'Could not be read.'}; }
}

/** The destination this machine uses for a tool (its first existing config location, else the first). */
export function destinationFor(tool: ToolConfigEntry, env: NodeJS.ProcessEnv = process.env): string {
  const locations = configLocations(tool, env);
  return locations.find(path => existsSync(path)) ?? locations[0]!;
}
