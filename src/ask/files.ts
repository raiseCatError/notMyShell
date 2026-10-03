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
