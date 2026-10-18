import {access, readdir, realpath, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {delimiter, isAbsolute, join, resolve} from 'node:path';

export type LocalDiscoveryFamily = 'path' | 'git-plugin' | 'kubectl-plugin' | 'docker-plugin' | 'gh-extension';
export interface LocalExecutable {
  id: string;
  name: string;
  path: string;
  family: LocalDiscoveryFamily;
  evidence: string;
}
export interface LocalDiscoverySnapshot {
  pathKey: string;
  executables: readonly LocalExecutable[];
  discoveredAt: number;
  measurements: {directoriesRead: number; entriesInspected: number; executableChecks: number};
}

const MAX_PATH_DIRECTORIES = 256;
const MAX_ENTRIES_PER_DIRECTORY = 8192;
const MAX_AGE_MS = 30_000;
const MAX_CACHE_ENTRIES = 8;
const cache = new Map<string, {snapshot: LocalDiscoverySnapshot; at: number}>();
const inFlight = new Map<string, Promise<LocalDiscoverySnapshot>>();

function normalizedPath(pathValue: string): string {
  return [...new Set(pathValue.split(delimiter).filter(isAbsolute).map(part => resolve(part)))].slice(0, MAX_PATH_DIRECTORIES).join(delimiter);
}

type ScanMeasurements = LocalDiscoverySnapshot['measurements'];

async function executableFile(path: string, measurements: ScanMeasurements): Promise<boolean> {
  measurements.executableChecks += 1;
  try {
    const [metadata] = await Promise.all([stat(path), access(path, constants.X_OK)]);
    return metadata.isFile();
  } catch { return false; }
}

async function addExecutable(rows: Map<string, LocalExecutable>, name: string, path: string, family: LocalDiscoveryFamily, evidence: string,
  measurements: ScanMeasurements): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.+-]*$/u.test(name) || !await executableFile(path, measurements)) return;
  let resolved = resolve(path);
  try { resolved = await realpath(path); } catch { /* retain the absolute PATH entry as evidence */ }
  const id = family === 'path' ? `executable:${name}` : `${family}:${name}`;
  const existing = rows.get(id);
  if (!existing || resolved.localeCompare(existing.path) < 0) rows.set(id, {id, name, path: resolved, family, evidence});
}

async function scanDirectory(rows: Map<string, LocalExecutable>, directory: string, predicate: (name: string) => boolean,
  family: LocalDiscoveryFamily, evidence: string, measurements: ScanMeasurements): Promise<void> {
  try {
    const names = await readdir(directory);
    measurements.directoriesRead += 1;
    measurements.entriesInspected += Math.min(names.length, MAX_ENTRIES_PER_DIRECTORY);
    for (const name of names.slice(0, MAX_ENTRIES_PER_DIRECTORY).filter(predicate).sort()) {
      await addExecutable(rows, name, join(directory, name), family, evidence, measurements);
    }
  } catch { /* missing, unreadable and malformed directories contribute no facts */ }
}

async function scanPathDirectory(rows: Map<string, LocalExecutable>, directory: string, measurements: ScanMeasurements): Promise<void> {
  try {
    const names = await readdir(directory);
    measurements.directoriesRead += 1;
    measurements.entriesInspected += Math.min(names.length, MAX_ENTRIES_PER_DIRECTORY);
    for (const name of names.slice(0, MAX_ENTRIES_PER_DIRECTORY).sort()) {
      const family = name.startsWith('git-') && name.length > 4 ? 'git-plugin'
        : name.startsWith('kubectl-') && name.length > 8 ? 'kubectl-plugin' : 'path';
      const evidence = family === 'git-plugin' ? `git-* executable in PATH directory ${directory}`
        : family === 'kubectl-plugin' ? `kubectl-* executable in PATH directory ${directory}` : `PATH directory ${directory}`;
      await addExecutable(rows, name, join(directory, name), family, evidence, measurements);
    }
  } catch { /* missing, unreadable and malformed directories contribute no facts */ }
}

export async function discoverLocalExecutables(pathValue = process.env.PATH ?? '', home = process.env.HOME ?? ''): Promise<LocalDiscoverySnapshot> {
  const pathKey = normalizedPath(pathValue);
  const key = `${pathKey}\u0000${resolve(home || '.')}`;
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < MAX_AGE_MS) return cached.snapshot;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const task = (async () => {
    const rows = new Map<string, LocalExecutable>();
    const measurements: ScanMeasurements = {directoriesRead: 0, entriesInspected: 0, executableChecks: 0};
    const directories = pathKey ? pathKey.split(delimiter) : [];
    for (const directory of directories) await scanPathDirectory(rows, directory, measurements);
    if (home && isAbsolute(home)) {
      const dockerDirs = [join(home, '.docker', 'cli-plugins'), '/usr/local/lib/docker/cli-plugins', '/usr/lib/docker/cli-plugins'];
      for (const directory of dockerDirs) await scanDirectory(rows, directory,
        name => name.startsWith('docker-') && name.length > 7, 'docker-plugin', `known Docker CLI plugin directory ${directory}`, measurements);
      const ghDirs = [join(home, '.local', 'share', 'gh', 'extensions')];
      for (const directory of ghDirs) {
        try {
          const entries = await readdir(directory, {withFileTypes: true});
          measurements.directoriesRead += 1;
          measurements.entriesInspected += Math.min(entries.length, MAX_ENTRIES_PER_DIRECTORY);
          for (const entry of entries.slice(0, MAX_ENTRIES_PER_DIRECTORY).sort((a, b) => a.name.localeCompare(b.name))) {
            if (!entry.isDirectory() || !/^gh-[A-Za-z0-9][A-Za-z0-9_.+-]*$/u.test(entry.name)) continue;
            const candidates = [join(directory, entry.name, entry.name), join(directory, entry.name, 'bin', entry.name)];
            for (const candidate of candidates) if (await executableFile(candidate, measurements)) {
              await addExecutable(rows, entry.name, candidate, 'gh-extension', `GitHub CLI extension directory ${join(directory, entry.name)}`, measurements);
              break;
            }
          }
        } catch { /* absent or unreadable extension directory */ }
      }
    }
    const snapshot: LocalDiscoverySnapshot = {pathKey, executables: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)), discoveredAt: Date.now(), measurements};
    if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, {snapshot, at: Date.now()});
    return snapshot;
  })();
  inFlight.set(key, task);
  try { return await task; } finally { if (inFlight.get(key) === task) inFlight.delete(key); }
}

export function invalidateLocalDiscovery(pathValue?: string): void {
  if (pathValue === undefined) cache.clear();
  else for (const key of cache.keys()) if (key.startsWith(`${normalizedPath(pathValue)}\u0000`)) cache.delete(key);
}

export function localExecutableId(name: string): string { return `executable:${name}`; }
