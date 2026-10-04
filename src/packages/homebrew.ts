import {environmentFor, resolveCommand, runExternal} from '../providers/providers.js';
import {parseBrewOutdated} from '../tools/ToolUpdates.js';

/**
 * Homebrew as NMSh's first package manager, behind a small adapter that the
 * rest of NMSh (tools, providers, Ask) can share. Facts come from Homebrew's
 * machine-readable output (`--json=v2`, one-name-per-line lists), validated
 * and bounded; malformed output is treated as "no facts", never guessed.
 * Mutations are typed (install/upgrade/uninstall of a validated name) and
 * never assembled from free text.
 */

export const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9@._+/-]{0,127}$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+:,-]{0,63}$/u;

export interface PackageInfo {
  name: string;
  kind: 'formula' | 'cask';
  description?: string;
  homepage?: string;
  /** The version Homebrew would install now. */
  current?: string;
  /** Installed versions (empty when not installed). */
  installed: string[];
  dependencies: string[];
  outdated: boolean;
}

export interface PackageManagerAdapter {
  id: 'homebrew';
  label: string;
  /** The brew executable, when installed. */
  executable(): string | undefined;
  info(name: string): Promise<PackageInfo[]>;
  installed(): Promise<{formulae: string[]; casks: string[]}>;
  leaves(): Promise<string[]>;
  search(query: string): Promise<{formulae: string[]; casks: string[]}>;
  outdated(): Promise<Array<{name: string; installed: string; current: string; kind: 'formula' | 'cask'}>>;
  uses(name: string): Promise<string[]>;
  prefix(name: string): Promise<string | undefined>;
}

const list = (text: string, limit = 4096) => text.split('\n').map(line => line.trim()).filter(line => PACKAGE_NAME.test(line)).slice(0, limit);

/** `brew info --json=v2 <name>`: formulae and casks, validated. */
export function parseBrewInfo(json: string): PackageInfo[] {
  let value: {formulae?: unknown; casks?: unknown};
  try { value = JSON.parse(json) as typeof value; } catch { return []; }
  const out: PackageInfo[] = [];
  for (const formula of Array.isArray(value?.formulae) ? value.formulae.slice(0, 32) : []) {
    const record = formula as {name?: unknown; desc?: unknown; homepage?: unknown; versions?: {stable?: unknown}; installed?: unknown; dependencies?: unknown; outdated?: unknown};
    if (typeof record.name !== 'string' || !PACKAGE_NAME.test(record.name)) continue;
    const installed = Array.isArray(record.installed) ? record.installed.map(item => (item as {version?: unknown}).version).filter((version): version is string => typeof version === 'string' && VERSION.test(version)) : [];
    out.push({name: record.name, kind: 'formula', ...(typeof record.desc === 'string' ? {description: record.desc.slice(0, 200)} : {}),
      ...(typeof record.homepage === 'string' && /^https:\/\//u.test(record.homepage) ? {homepage: record.homepage} : {}),
      ...(typeof record.versions?.stable === 'string' && VERSION.test(record.versions.stable) ? {current: record.versions.stable} : {}),
      installed, dependencies: Array.isArray(record.dependencies) ? record.dependencies.filter((name): name is string => typeof name === 'string' && PACKAGE_NAME.test(name)).slice(0, 64) : [],
      outdated: record.outdated === true});
  }
  for (const cask of Array.isArray(value?.casks) ? value.casks.slice(0, 32) : []) {
    const record = cask as {token?: unknown; desc?: unknown; homepage?: unknown; version?: unknown; installed?: unknown; outdated?: unknown};
    if (typeof record.token !== 'string' || !PACKAGE_NAME.test(record.token)) continue;
    out.push({name: record.token, kind: 'cask', ...(typeof record.desc === 'string' ? {description: record.desc.slice(0, 200)} : {}),
      ...(typeof record.homepage === 'string' && /^https:\/\//u.test(record.homepage) ? {homepage: record.homepage} : {}),
      ...(typeof record.version === 'string' && VERSION.test(record.version) ? {current: record.version} : {}),
      installed: typeof record.installed === 'string' && VERSION.test(record.installed) ? [record.installed] : [], dependencies: [], outdated: record.outdated === true});
  }
  return out;
}

/** `brew outdated --json=v2`: formulae (shared parser) and casks. */
export function parseOutdatedAll(json: string): Array<{name: string; installed: string; current: string; kind: 'formula' | 'cask'}> {
  const formulae = Object.entries(parseBrewOutdated(json)).map(([name, entry]) => ({name, ...entry, kind: 'formula' as const}));
  let casks: unknown;
  try { casks = (JSON.parse(json) as {casks?: unknown}).casks; } catch { return formulae; }
  const caskList = (Array.isArray(casks) ? casks : []).slice(0, 2048).flatMap(cask => {
    const record = cask as {name?: unknown; installed_versions?: unknown; current_version?: unknown};
    const installed = Array.isArray(record.installed_versions) ? record.installed_versions.at(-1) : undefined;
    return typeof record.name === 'string' && PACKAGE_NAME.test(record.name) && typeof installed === 'string' && VERSION.test(installed)
      && typeof record.current_version === 'string' && VERSION.test(record.current_version) ? [{name: record.name, installed, current: record.current_version, kind: 'cask' as const}] : [];
  });
  return [...formulae, ...caskList];
}

/** Read-only Homebrew queries: never auto-update taps, no analytics, bounded time and output. */
export function homebrewAdapter(brew: string | undefined = resolveCommand('brew')): PackageManagerAdapter {
  const query = async (args: string[], timeoutMs = 15_000) => {
    if (!brew) return '';
    const result = await runExternal(brew, args, {timeoutMs, maxBytes: 4 * 1024 * 1024,
      env: {...environmentFor(brew), HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_NO_ENV_HINTS: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1'}});
    return result.stdout;
  };
  const named = (name: string) => PACKAGE_NAME.test(name) ? name : undefined;
  return {
    id: 'homebrew', label: 'Homebrew', executable: () => brew,
    info: async name => named(name) ? parseBrewInfo(await query(['info', '--json=v2', name])) : [],
    installed: async () => ({formulae: list(await query(['list', '--formula', '-1'])), casks: list(await query(['list', '--cask', '-1']))}),
    leaves: async () => list(await query(['leaves'])),
    search: async term => {
      if (!/^[\w@.+-]{2,64}$/u.test(term)) return {formulae: [], casks: []};
      const [formulae, casks] = await Promise.all([query(['search', '--formula', term], 20_000), query(['search', '--cask', term], 20_000)]);
      return {formulae: list(formulae, 20), casks: list(casks, 20)};
    },
    outdated: async () => parseOutdatedAll(await query(['outdated', '--json=v2'], 30_000)),
    uses: async name => named(name) ? list(await query(['uses', '--installed', name]), 64) : [],
    prefix: async name => {
      if (!named(name)) return undefined;
      const path = (await query(['--prefix', name])).trim();
      return path.startsWith('/') && !path.includes('\n') ? path : undefined;
    },
  };
}

/** The mutations Ask may run, as exact argv shapes; anything else is never run. */
export function brewMutationAllowed(argv: readonly string[]): boolean {
  if (argv[0] !== 'brew' || !['install', 'upgrade', 'uninstall'].includes(argv[1] ?? '')) return false;
  const rest = argv.slice(2);
  const name = rest.at(-1);
  if (!name || !PACKAGE_NAME.test(name) || name.startsWith('-')) return false;
  return rest.length === 1 || (rest.length === 2 && rest[0] === '--cask');
}
