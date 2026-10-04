import {existsSync, readdirSync, statSync} from 'node:fs';
import {isAbsolute, join, relative, resolve} from 'node:path';

/** Never descended into unless the request names them explicitly. */
export const NOISY_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', 'target', 'vendor', '.next', '.cache',
  '.turbo', '.venv', 'venv', '__pycache__', '.idea', '.vscode', 'bower_components', '.gradle', 'Pods', '.terraform']);
const MAX_ENTRIES = 6000;
const MAX_DEPTH = 7;

/**
 * Files under one project root, breadth-first and bounded: never the whole
 * home directory, never noisy trees. Names only; no file is read.
 */
export function listProjectFiles(root: string, limit = MAX_ENTRIES): string[] {
  const files: string[] = [];
  const queue: Array<[string, number]> = [[root, 0]];
  let seen = 0;
  while (queue.length && seen < limit) {
    const [directory, depth] = queue.shift()!;
    let entries: import('node:fs').Dirent[];
    try { entries = readdirSync(directory, {withFileTypes: true}); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++seen > limit) break;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!NOISY_DIRECTORIES.has(entry.name) && depth < MAX_DEPTH) queue.push([path, depth + 1]);
      } else if (entry.isFile()) files.push(relative(root, path));
    }
  }
  return files;
}

export type FileMatch = {path: string; score: number; reason: 'exact' | 'basename' | 'case' | 'fuzzy'};
/** A fuzzy match this far ahead of the next one is a clear winner. */
export const CLEAR_LEAD = 0.08;

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);

/**
 * Rank files for a spoken or typed name: exact path, exact file name,
 * case-insensitive name, then strong fuzzy matches (every word of the query
 * appears in the path, in order). Only files that exist are ever returned.
 */
export function matchFiles(query: string, files: readonly string[], cwd: string, root: string): FileMatch[] {
  const trimmed = query.trim().replace(/^["']|["']$/gu, '');
  if (!trimmed) return [];
  const direct = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  try { if (existsSync(direct) && statSync(direct).isFile()) return [{path: direct, score: 1, reason: 'exact'}]; } catch { /* fall through */ }
  const queryWords = words(trimmed);
  const joined = queryWords.join('');
  const matches: FileMatch[] = [];
  for (const file of files) {
    const base = file.slice(file.lastIndexOf('/') + 1);
    const absolute = join(root, file);
    if (base === trimmed || file === trimmed) { matches.push({path: absolute, score: 0.95, reason: 'basename'}); continue; }
    if (base.toLowerCase() === trimmed.toLowerCase()) { matches.push({path: absolute, score: 0.9, reason: 'case'}); continue; }
    // "package json" names package.json: the words of the base name, joined, equal the query's.
    if (words(base).join('') === joined) { matches.push({path: absolute, score: 0.88, reason: 'case'}); continue; }
    const pathWords = words(file);
    let position = 0;
    let ok = queryWords.length > 0;
    for (const word of queryWords) {
      const found = pathWords.findIndex((candidate, index) => index >= position && candidate.startsWith(word));
      if (found === -1) { ok = false; break; }
      position = found + 1;
    }
    if (ok) {
      // Whole-word matches, matches in the file name and shorter paths rank higher.
      const inBase = queryWords.some(word => words(base).some(candidate => candidate.startsWith(word)));
      const whole = queryWords.filter(word => pathWords.includes(word)).length / queryWords.length;
      matches.push({path: absolute, score: 0.5 + (inBase ? 0.15 : 0) + whole * 0.2 - Math.min(0.2, pathWords.length * 0.01), reason: 'fuzzy'});
    }
  }
  return matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, 8);
}

export interface DirectoryEntry {name: string; directory: boolean}

/** One directory's entries (names and kinds only), directories first, hidden entries only when asked. Bounded. */
export function listDirectory(path: string, options: {hidden?: boolean; limit?: number} = {}): DirectoryEntry[] | undefined {
  let entries: import('node:fs').Dirent[];
  try { entries = readdirSync(path, {withFileTypes: true}); } catch { return undefined; }
  return entries
    .filter(entry => options.hidden || !entry.name.startsWith('.'))
    .map(entry => {
      let directory = entry.isDirectory();
      if (entry.isSymbolicLink()) { try { directory = statSync(join(path, entry.name)).isDirectory(); } catch { /* dangling link: a file */ } }
      return {name: entry.name, directory};
    })
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
    .slice(0, options.limit ?? 500);
}

export interface PathCompletion {
  /** The text with the completed word (unique match or longest common prefix). */
  text: string;
  caret: number;
  /** Every candidate when more than one remains (relative to the typed directory). */
  candidates: Array<{value: string; directory: boolean}>;
}

/**
 * Complete the path word before the caret from real directory entries, the
 * same facts the shell composer's file completion lists. Only names are read;
 * nothing is opened or run.
 */
export function completePath(text: string, caret: number, cwd: string, home: string): PathCompletion | undefined {
  const chars = [...text];
  const before = chars.slice(0, caret).join('');
  const word = /(\S*)$/u.exec(before)?.[1] ?? '';
  const expanded = word.startsWith('~/') ? join(home, word.slice(2)) : word;
  const slash = expanded.lastIndexOf('/');
  const directoryPart = slash >= 0 ? expanded.slice(0, slash + 1) : '';
  const prefix = slash >= 0 ? expanded.slice(slash + 1) : expanded;
  const directory = isAbsolute(directoryPart) ? directoryPart || '/' : resolve(cwd, directoryPart || '.');
  const entries = listDirectory(directory, {hidden: prefix.startsWith('.')});
  if (!entries) return undefined;
  const matches = entries.filter(entry => entry.name.startsWith(prefix));
  const loose = matches.length ? matches : entries.filter(entry => entry.name.toLowerCase().startsWith(prefix.toLowerCase()));
  if (!loose.length) return undefined;
  const typedDirectory = slash >= 0 ? word.slice(0, word.length - prefix.length) : '';
  let completion: string;
  if (loose.length === 1) completion = loose[0]!.name + (loose[0]!.directory ? '/' : ' ');
  else {
    completion = loose[0]!.name;
    for (const entry of loose) while (!entry.name.startsWith(completion)) completion = completion.slice(0, -1);
    if (completion.length < prefix.length) completion = prefix;
  }
  const replaced = before.slice(0, before.length - word.length) + typedDirectory + completion;
  const after = chars.slice(caret).join('');
  return {text: replaced + (loose.length === 1 && completion.endsWith(' ') && after.startsWith(' ') ? after.slice(1) : after), caret: [...replaced].length,
    candidates: loose.length > 1 ? loose.slice(0, 40).map(entry => ({value: typedDirectory + entry.name + (entry.directory ? '/' : ''), directory: entry.directory})) : []};
}
