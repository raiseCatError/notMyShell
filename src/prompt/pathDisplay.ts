import {readdir} from 'node:fs/promises';
import {dirname, normalize, sep} from 'node:path';
import {graphemes} from '../input/inputLayout.js';

/**
 * The one path-display policy for prompt modules. Display only: the real cwd
 * is never changed, and callers pass absolute paths.
 */
export interface PathDisplayInput {
  cwd: string;
  home: string;
  /** Repository root when cwd is inside one; its name is never shortened. */
  root?: string;
  /** Shortest unambiguous prefix for an absolute directory path, keyed by that path. */
  abbreviations?: Readonly<Record<string, string>>;
}

/**
 * Shortening levels, tried in order until the prompt fits:
 * 0 full; 1 abbreviate parents above the repository (or above the final
 * directory outside one); 2 also abbreviate directories inside the
 * repository; 3 collapse abbreviated runs to `…`; 4 only the final
 * directory (the project module already names the repository).
 */
export const PATH_DISPLAY_LEVELS = 5;

interface Component {
  name: string;
  path: string;
  /** Repository root or final directory: always shown in full. */
  anchor: 'root' | 'final' | undefined;
  /** Above the repository root (or any non-final component outside one). */
  outer: boolean;
}

function trimSlash(value: string): string {
  const normalized = normalize(value);
  return normalized.length > 1 && normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized;
}

function abbreviate(component: Component, abbreviations: PathDisplayInput['abbreviations']): string {
  const known = abbreviations?.[component.path];
  if (known) return known;
  const glyphs = graphemes(component.name);
  // Hidden directories keep their dot so `.config` never reads as `c`.
  return glyphs[0] === '.' ? glyphs.slice(0, 2).join('') : glyphs[0] ?? component.name;
}

export function displayPath(input: PathDisplayInput, level = 0): string {
  const cwd = trimSlash(input.cwd);
  const home = trimSlash(input.home);
  const root = input.root ? trimSlash(input.root) : undefined;
  if (cwd === home) return '~';
  const underHome = home !== sep && cwd.startsWith(`${home}${sep}`);
  const base = underHome ? home : '';
  const lead = underHome ? '~' : '';
  const names = cwd.slice(base.length).split(sep).filter(Boolean);
  if (names.length === 0) return sep;

  const rootInside = root && (root === cwd || cwd.startsWith(`${root}${sep}`)) && root.length > base.length ? root : undefined;
  let path = base;
  const components: Component[] = names.map((name, index) => {
    path = `${path}${sep}${name}`;
    const isRoot = rootInside === path;
    const isFinal = index === names.length - 1;
    return {name, path, anchor: isRoot ? 'root' : isFinal ? 'final' : undefined, outer: rootInside ? path.length < rootInside.length : !isFinal};
  });

  if (level >= 4 && names.length > 1) return `…${sep}${names.at(-1)}`;
  const shorten = (component: Component) => component.anchor === undefined
    && (component.outer ? level >= 1 : level >= 2);
  const parts: string[] = [];
  for (const component of components) {
    if (level >= 3 && shorten(component)) {
      if (parts.at(-1) !== '…') parts.push('…');
      continue;
    }
    parts.push(shorten(component) ? abbreviate(component, input.abbreviations) : component.name);
  }
  // `~/…/x` says no more than `…/x` once collapsed.
  if (level >= 3 && parts[0] === '…') return parts.join(sep);
  return lead ? [lead, ...parts].join(sep) : `${sep}${parts.join(sep)}`;
}

/** Directory names inside `parent`; unreadable directories contribute none. */
async function directoryNames(parent: string): Promise<string[]> {
  try {
    return (await readdir(parent, {withFileTypes: true})).filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => entry.name);
  } catch {
    return [];
  }
}

/** Shortest prefix of `name` no sibling shares, compared case-insensitively for macOS volumes. */
export function uniquePrefix(name: string, siblings: readonly string[]): string {
  const glyphs = graphemes(name);
  const others = siblings.filter(sibling => sibling !== name).map(sibling => sibling.toLowerCase());
  const minimum = glyphs[0] === '.' ? 2 : 1;
  for (let length = minimum; length < glyphs.length; length += 1) {
    const prefix = glyphs.slice(0, length).join('').toLowerCase();
    if (!others.some(other => other.startsWith(prefix))) return glyphs.slice(0, length).join('');
  }
  return name;
}

/** Bounded, async: resolves unambiguous abbreviations for every ancestor below HOME (or /). */
export async function resolvePathAbbreviations(cwd: string, home: string, maxComponents = 16): Promise<Record<string, string>> {
  const target = trimSlash(cwd);
  const homePath = trimSlash(home);
  const base = homePath !== sep && target.startsWith(`${homePath}${sep}`) ? homePath : '';
  const ancestors: string[] = [];
  for (let path = dirname(target); path.length > base.length && path !== sep; path = dirname(path)) ancestors.unshift(path);
  const entries = await Promise.all(ancestors.slice(-maxComponents).map(async path => {
    const name = path.slice(dirname(path).length).replace(/^\//u, '');
    return [path, uniquePrefix(name, await directoryNames(dirname(path)))] as const;
  }));
  return Object.fromEntries(entries);
}
