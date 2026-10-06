import {constants} from 'node:fs';
import {lstat, open, readdir, realpath, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, delimiter, dirname, isAbsolute, join, normalize, sep} from 'node:path';
import {parse as parseToml} from 'smol-toml';

/**
 * Trusted core services shared by every capability resolver. They are the
 * only place context collection touches the filesystem or a process:
 *
 * - reads are bounded, refuse symlinks and special files, and never follow
 *   includes; parsers run with alias/entity expansion disabled or bounded;
 * - upward searches stop at the repository root (or the working directory
 *   outside a repository) instead of wandering through unrelated parents;
 * - executable identity is resolved from the live shell's PATH but refuses
 *   anything inside the workspace, world-writable, foreign-owned or a version
 *   manager shim; and context collection never executes what it resolves.
 *   Versions come only from install layouts and the runtime's own metadata
 *   files (a directory outside the lexical workspace can still be project-
 *   controlled, so running a discovered binary is not made "safe" by checks).
 *
 * Resolvers receive these functions, not `fs`/`child_process`/`process.env`.
 */

export const SMALL_METADATA_BYTES = 64 * 1024;
export const LARGE_METADATA_BYTES = 256 * 1024;

/** A bounded regular-file read; symlinks, directories, FIFOs and oversized files are not metadata. */
export async function readMetadataText(path: string, limit = SMALL_METADATA_BYTES): Promise<string | undefined> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) return undefined;
    const buffer = Buffer.alloc(Math.min(limit, info.size) + 1);
    let used = 0;
    while (used < buffer.length) {
      const {bytesRead} = await file.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > limit) return undefined;
    return buffer.subarray(0, used).toString('utf8').replace(/^﻿/u, '');
  } catch { return undefined; }
  finally { await file?.close().catch(() => {}); }
}

export function parseJsonData(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

/** JSON with comments and trailing commas (deno.jsonc): comments are stripped outside strings only. */
export function parseJsoncData(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"') {
      const end = /"(?:[^"\\]|\\.)*"/uy;
      end.lastIndex = index;
      const match = end.exec(text);
      if (!match) return undefined;
      out += match[0];
      index += match[0].length - 1;
    } else if (char === '/' && text[index + 1] === '/') {
      const newline = text.indexOf('\n', index);
      index = newline === -1 ? text.length : newline - 1;
    } else if (char === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2);
      if (close === -1) return undefined;
      index = close + 1;
    } else out += char;
  }
  return parseJsonData(out.replace(/,(\s*[}\]])/gu, '$1'));
}

export function parseTomlData(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try { return parseToml(text) as Record<string, unknown>; } catch { return undefined; }
}

/**
 * YAML as data: failsafe schema (every scalar stays a literal string: `1.10` is not a number), no tags, alias expansion tightly bounded.
 * The parser loads on first use, so prompts that never meet YAML never pay for it.
 */
export async function parseYamlData(text: string | undefined): Promise<unknown> {
  if (text === undefined) return undefined;
  const {parse} = await import('yaml');
  try { return parse(text, {schema: 'failsafe', maxAliasCount: 16, prettyErrors: false, uniqueKeys: false}) as unknown; }
  catch { return undefined; }
}

/** XML without DOCTYPE internal subsets or entities (never expanded); loaded on first use. */
export async function parseXmlData(text: string | undefined): Promise<unknown> {
  if (text === undefined || /<!ENTITY/iu.test(text) || /<!DOCTYPE[^>]*\[/iu.test(text)) return undefined;
  const {XMLParser} = await import('fast-xml-parser');
  try {
    return new XMLParser({processEntities: false, htmlEntities: false, ignoreDeclaration: true, ignorePiTags: true, ignoreAttributes: true,
      parseTagValue: false, trimValues: true}).parse(text) as unknown;
  } catch { return undefined; }
}

/** INI (AWS, gcloud): `[section]` headers and `key = value` lines; bounded, comments ignored. */
export function parseIniData(text: string | undefined): Map<string, Map<string, string>> | undefined {
  if (text === undefined) return undefined;
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const raw of text.split(/\r?\n/u).slice(0, 8192)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[([^\]]{1,256})\]$/u.exec(line);
    if (header) {
      if (sections.size >= 512) break;
      current = sections.get(header[1]!.trim()) ?? new Map();
      sections.set(header[1]!.trim(), current);
      continue;
    }
    const pair = /^([^=:\s][^=:]{0,127}?)\s*[=:]\s*(.{0,1024})$/u.exec(line);
    if (pair && current && current.size < 256) current.set(pair[1]!.trim().toLowerCase(), pair[2]!.trim());
  }
  return sections;
}

export const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const text = (value: unknown, limit = 256): string | undefined =>
  typeof value === 'string' && value.trim() && value.length <= limit ? value.trim() : undefined;

/** Whether `child` is `parent` or below it (lexical, after normalization). */
export function within(child: string, parent: string): boolean {
  const a = normalize(child), b = normalize(parent);
  return a === b || a.startsWith(b.endsWith(sep) ? b : `${b}${sep}`);
}

/**
 * The directories whose executables count as workspace-controlled: the cwd and
 * repository root, except a directory that is the filesystem root or contains
 * the home directory. Those hold the user's own tools (~/.cargo/bin,
 * ~/.local/bin, /usr/bin), not a project's.
 */
export function workspaceRoots(cwd: string, root: string | undefined, home: string): string[] {
  return [...new Set([cwd, ...(root ? [root] : [])].map(directory => normalize(directory)))]
    .filter(directory => isAbsolute(directory) && dirname(directory) !== directory && !(home && within(home, directory)));
}

export interface SearchBoundary {
  cwd: string;
  /** Repository top level: the search climbs to it and no further. Outside a repository only `cwd` is searched. */
  root?: string;
}

/** Directories from cwd up to the boundary, nearest first, at most 32. */
export function searchDirectories({cwd, root}: SearchBoundary): string[] {
  const start = normalize(cwd);
  if (!root || !within(start, root)) return [start];
  const directories: string[] = [];
  for (let directory = start; directories.length < 32; directory = dirname(directory)) {
    directories.push(directory);
    if (directory === normalize(root) || dirname(directory) === directory) break;
  }
  return directories;
}

/** The nearest directory holding one of `names` as a regular file (or directory when allowed); never follows symlinks. */
export async function findNearest(boundary: SearchBoundary, names: readonly string[], options: {directories?: boolean; signal?: AbortSignal} = {}):
  Promise<{directory: string; name: string; path: string} | undefined> {
  for (const directory of searchDirectories(boundary)) {
    for (const name of names) {
      if (options.signal?.aborted) return undefined;
      const path = join(directory, name);
      try {
        const info = await lstat(path);
        if (info.isFile() || (options.directories && info.isDirectory())) return {directory, name, path};
      } catch { /* absent */ }
    }
  }
  return undefined;
}

/** Bounded directory listing (names only). */
export async function listNames(directory: string, limit = 512): Promise<string[]> {
  try { return (await readdir(directory)).slice(0, limit); } catch { return []; }
}

export async function isDirectory(path: string): Promise<boolean> {
  try { return (await lstat(path)).isDirectory(); } catch { return false; }
}

export async function isRegularFile(path: string): Promise<boolean> {
  try { return (await lstat(path)).isFile(); } catch { return false; }
}

/** First line of a small version file (.nvmrc, .python-version, rust-toolchain): a bounded literal, never evaluated. */
export async function readVersionFile(path: string): Promise<string | undefined> {
  const content = await readMetadataText(path, 4096);
  const line = content?.split(/\r?\n/u).map(item => item.replace(/#.*$/u, '').trim()).find(Boolean);
  return line && /^[A-Za-z0-9][A-Za-z0-9._+\-/:@ ]{0,63}$/u.test(line) ? line : undefined;
}

/** `.tool-versions` (asdf, mise): `tool version [fallback...]` lines. */
export function parseToolVersions(content: string | undefined): Array<{name: string; version: string}> {
  const tools: Array<{name: string; version: string}> = [];
  for (const raw of (content ?? '').split(/\r?\n/u).slice(0, 256)) {
    const line = raw.replace(/#.*$/u, '').trim();
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]{0,63})\s+([A-Za-z0-9][A-Za-z0-9._+\-:/]{0,63})/u.exec(line);
    if (match && tools.length < 32) tools.push({name: match[1]!, version: match[2]!});
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Trusted executable identity
// ---------------------------------------------------------------------------

export interface ExecutableIdentity {
  name: string;
  /** The PATH entry the shell would run. */
  path: string;
  realpath: string;
  /** Identity for caches: a replaced binary is a different executable. */
  key: string;
  /** Version manager shims and rustup proxies select versions by running their own logic; reported as the manager. */
  shim?: string;
}

export type ExecutableRefusal = 'not-found' | 'workspace' | 'unsafe-permissions' | 'foreign-owner';

const SHIM_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/[/\\]mise[/\\]shims[/\\]/u, 'mise'], [/[/\\]\.asdf[/\\]shims[/\\]/u, 'asdf'], [/[/\\]\.pyenv[/\\]shims[/\\]/u, 'pyenv'],
  [/[/\\]\.rbenv[/\\]shims[/\\]/u, 'rbenv'], [/[/\\]\.nodenv[/\\]shims[/\\]/u, 'nodenv'], [/[/\\]\.goenv[/\\]shims[/\\]/u, 'goenv'],
  [/[/\\]\.proto[/\\]shims[/\\]/u, 'proto'], [/[/\\]\.volta[/\\]bin[/\\]/u, 'volta'], [/volta-shim$/u, 'volta'],
  [/[/\\]rustup(?:-init)?$/u, 'rustup'],
  // rustup installs its proxies (rustc, cargo, ...) as hard links in Cargo's bin directory.
  [/[/\\]\.cargo[/\\]bin[/\\](?:rustc|cargo|rustdoc|rustfmt|rust-[^/\\]+|cargo-[^/\\]+)$/u, 'rustup'],
];

const resolutionCache = new Map<string, {at: number; result: ExecutableIdentity | ExecutableRefusal}>();

/**
 * The executable the live shell would run for `name`, if NMSh may trust it.
 * The first PATH match decides (as the shell's lookup would): when that match
 * lives inside the workspace, or is world-writable or owned by another user,
 * the answer is a refusal rather than a quieter fallback to a later entry.
 */
export async function resolveTrustedExecutable(name: string, pathValue: string | undefined, untrustedRoots: readonly string[],
  now = Date.now()): Promise<ExecutableIdentity | ExecutableRefusal> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u.test(name)) return 'not-found';
  const cacheKey = `${name}\u0000${pathValue ?? ''}\u0000${untrustedRoots.join('\u0001')}`;
  const cached = resolutionCache.get(cacheKey);
  if (cached && now - cached.at < 30_000) return cached.result;
  const result = await resolveUncached(name, pathValue, untrustedRoots);
  if (resolutionCache.size >= 128) resolutionCache.delete(resolutionCache.keys().next().value!);
  resolutionCache.set(cacheKey, {at: now, result});
  return result;
}

async function resolveUncached(name: string, pathValue: string | undefined, untrustedRoots: readonly string[]): Promise<ExecutableIdentity | ExecutableRefusal> {
  const uid = process.getuid?.();
  for (const entry of (pathValue ?? '').split(delimiter).slice(0, 256)) {
    if (!entry || !isAbsolute(entry)) continue; // relative PATH entries (".", "bin") resolve against the workspace
    const directory = normalize(entry);
    const candidate = join(directory, name);
    let info;
    try { info = await stat(candidate); } catch { continue; }
    if (!info.isFile() || (info.mode & 0o111) === 0) continue;
    if (untrustedRoots.some(root => within(directory, root))) return 'workspace';
    let real: string;
    try { real = await realpath(candidate); } catch { continue; }
    if (untrustedRoots.some(root => within(real, root))) return 'workspace';
    if ((info.mode & 0o002) !== 0) return 'unsafe-permissions';
    if (uid !== undefined && info.uid !== 0 && info.uid !== uid) return 'foreign-owner';
    try {
      const parent = await stat(dirname(real));
      if ((parent.mode & 0o002) !== 0 && (parent.mode & 0o1000) === 0) return 'unsafe-permissions';
    } catch { return 'unsafe-permissions'; }
    const shim = SHIM_PATTERNS.find(([pattern]) => pattern.test(candidate) || pattern.test(real))?.[1];
    return {name, path: candidate, realpath: real, key: `${real}\u0000${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`, ...(shim ? {shim} : {})};
  }
  return 'not-found';
}

/** A version read from where the executable is installed, without running it. */
export function versionFromInstallPath(realpathValue: string): {version: string; manager: string} | undefined {
  const path = realpathValue.replace(/\\/gu, '/');
  const patterns: ReadonlyArray<[RegExp, string]> = [
    [/\/Cellar\/[^/]+\/(\d[^/_]*)(?:_\d+)?\//u, 'Homebrew'],
    [/\/mise\/installs\/[^/]+\/v?(\d[^/]*)\//u, 'mise'],
    [/\/\.asdf\/installs\/[^/]+\/v?(\d[^/]*)\//u, 'asdf'],
    [/\/\.nvm\/versions\/node\/v(\d[^/]*)\//u, 'nvm'],
    [/\/fnm\/node-versions\/v(\d[^/]*)\//u, 'fnm'],
    [/\/\.volta\/tools\/image\/[^/]+\/(\d[^/]*)\//u, 'Volta'],
    [/\/n\/versions\/node\/(\d[^/]*)\//u, 'n'],
    [/\/\.nodenv\/versions\/(\d[^/]*)\//u, 'nodenv'],
    [/\/\.pyenv\/versions\/(\d[^/]*)\//u, 'pyenv'],
    [/\/uv\/python\/c?python-(\d[^/-]*)-/u, 'uv'],
    [/\/\.rbenv\/versions\/(\d[^/]*)\//u, 'rbenv'],
    [/\/\.goenv\/versions\/(\d[^/]*)\//u, 'goenv'],
    [/\/\.sdkman\/candidates\/[^/]+\/(\d[^/]*)\//u, 'SDKMAN!'],
    [/\/Python\.framework\/Versions\/(\d[^/]*)\//u, 'python.org'],
    [/\/\.rustup\/toolchains\/([^/]+)\//u, 'rustup'],
  ];
  for (const [pattern, manager] of patterns) {
    const match = pattern.exec(path);
    if (match?.[1] && match[1].length <= 64) return {version: match[1], manager};
  }
  return undefined;
}

/** Reset caches (tests and explicit refresh). */
export function resetServiceCaches(): void {
  resolutionCache.clear();
}

export const leaf = (path: string): string => basename(path.replace(/[/\\]+$/u, '')) || path;
