import {mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import {environmentFor, resolveCommand, runExternal, type ProviderInstall} from '../providers/providers.js';
import {isCheckDue, type UpdateCheckFrequency} from '../update/update.js';
import type {Tool} from './catalog.js';

/**
 * Optional update checks for external tools NMSh knows about. Separate from
 * NMSh's own /update. Checks are batched into one package-manager call, run
 * only at startup when due or on explicit request, and never upgrade
 * anything: an upgrade is a previewed command the user confirms.
 */

/** Who installed a tool, as far as NMSh can tell without guessing. */
export type ToolOwner = 'homebrew' | 'unknown';

export interface OutdatedPackage {installed: string; current: string}

export interface ToolUpdateState {
  lastCheck?: number;
  /** Homebrew formula name to versions, from the last successful check. */
  outdated: Record<string, OutdatedPackage>;
  /** Set when the last check could not complete; shown factually, never retried on render. */
  error?: string;
}

export function toolUpdateStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(nmshConfigDirectory(env), 'tool-update-state.json');
}

const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9@._+/-]{0,127}$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+:,-]{0,63}$/u;

export function loadToolUpdateState(path = toolUpdateStatePath()): ToolUpdateState {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const outdated: Record<string, OutdatedPackage> = {};
    if (value.outdated && typeof value.outdated === 'object' && !Array.isArray(value.outdated)) {
      for (const [name, entry] of Object.entries(value.outdated as Record<string, unknown>)) {
        const record = entry as Record<string, unknown> | null;
        if (PACKAGE_NAME.test(name) && record && typeof record.installed === 'string' && typeof record.current === 'string'
          && VERSION.test(record.installed) && VERSION.test(record.current)) outdated[name] = {installed: record.installed, current: record.current};
      }
    }
    return {...(typeof value.lastCheck === 'number' ? {lastCheck: value.lastCheck} : {}), outdated,
      ...(typeof value.error === 'string' ? {error: value.error.slice(0, 200)} : {})};
  } catch {
    return {outdated: {}};
  }
}

export function saveToolUpdateState(state: ToolUpdateState, path = toolUpdateStatePath()): void {
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, {encoding: 'utf8', mode: 0o600});
  renameSync(temporary, path);
}

/** `brew outdated --json=v2` formulae, validated; anything malformed is ignored rather than trusted. */
export function parseBrewOutdated(json: string): Record<string, OutdatedPackage> {
  const result: Record<string, OutdatedPackage> = {};
  let value: unknown;
  try { value = JSON.parse(json); } catch { return result; }
  const formulae = (value as {formulae?: unknown})?.formulae;
  if (!Array.isArray(formulae)) return result;
  for (const formula of formulae.slice(0, 2048)) {
    const record = formula as {name?: unknown; installed_versions?: unknown; current_version?: unknown};
    const installed = Array.isArray(record.installed_versions) ? record.installed_versions[record.installed_versions.length - 1] : undefined;
    if (typeof record.name !== 'string' || !PACKAGE_NAME.test(record.name)) continue;
    if (typeof installed !== 'string' || !VERSION.test(installed)) continue;
    if (typeof record.current_version !== 'string' || !VERSION.test(record.current_version)) continue;
    result[record.name] = {installed, current: record.current_version};
  }
  return result;
}

/** The Homebrew prefixes NMSh recognizes; a tool is Homebrew-owned only if it resolves into a Cellar under one. */
const HOMEBREW_PREFIXES = ['/opt/homebrew/', '/usr/local/', '/home/linuxbrew/.linuxbrew/'];

/**
 * Who owns an installed binary. Homebrew only when the executable really
 * resolves into a Homebrew Cellar; everything else is unknown, and NMSh never
 * claims it or guesses another package manager.
 */
export function toolOwner(binary: string | undefined, realpath: (path: string) => string = realpathSync): ToolOwner {
  if (!binary) return 'unknown';
  let resolved: string;
  try { resolved = realpath(binary); } catch { return 'unknown'; }
  return HOMEBREW_PREFIXES.some(prefix => resolved.startsWith(prefix)) && resolved.includes('/Cellar/') ? 'homebrew' : 'unknown';
}

export const UNKNOWN_OWNER_UPDATE = 'Update using the package manager that installed this tool.';

/** A previewed upgrade for a Homebrew-owned, outdated tool; never for anything else. */
export function toolUpgrade(tool: Tool, owner: ToolOwner, state: ToolUpdateState): ProviderInstall | undefined {
  if (owner !== 'homebrew' || !tool.package || !state.outdated[tool.package]) return undefined;
  return {label: `brew upgrade ${tool.package}`, command: 'brew', args: ['upgrade', tool.package]};
}

export type ToolUpdateCheck = {ok: true; outdated: Record<string, OutdatedPackage>} | {ok: false; reason: string};

/**
 * One batched check. Homebrew is asked not to auto-update its taps, so this
 * reports what Homebrew already knows locally; nothing is installed or upgraded.
 */
export async function checkToolUpdates(options: {brew?: string; timeoutMs?: number; signal?: AbortSignal} = {}): Promise<ToolUpdateCheck> {
  const brew = options.brew ?? resolveCommand('brew');
  if (!brew) return {ok: false, reason: 'Homebrew is not installed; NMSh does not guess other package managers.'};
  const result = await runExternal(brew, ['outdated', '--json=v2', '--formula'], {timeoutMs: options.timeoutMs ?? 20_000,
    maxBytes: 4 * 1024 * 1024, signal: options.signal,
    env: {...environmentFor(brew), HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_NO_ENV_HINTS: '1'}});
  // `brew outdated` exits non-zero when something is outdated on some versions; the JSON is what counts.
  const outdated = parseBrewOutdated(result.stdout);
  if (!result.stdout.trim().startsWith('{')) return {ok: false, reason: `Homebrew check ${result.error ?? 'failed'}.`};
  return {ok: true, outdated};
}

/** Whether a background check should run now; Off never does. */
export function toolUpdateCheckDue(frequency: UpdateCheckFrequency, state: ToolUpdateState, now = Date.now()): boolean {
  return isCheckDue(frequency, {...(state.lastCheck !== undefined ? {lastCheck: state.lastCheck} : {})}, now);
}

/** Runs one check and records it; failures are stored as a reason, never thrown. */
export async function runToolUpdateCheck(options: {now?: number; path?: string; check?: () => Promise<ToolUpdateCheck>} = {}): Promise<ToolUpdateState> {
  const now = options.now ?? Date.now();
  const previous = loadToolUpdateState(options.path);
  const result = await (options.check ?? (() => checkToolUpdates()))().catch((error: unknown) => ({ok: false as const, reason: error instanceof Error ? error.message : String(error)}));
  const next: ToolUpdateState = result.ok ? {lastCheck: now, outdated: result.outdated} : {lastCheck: now, outdated: previous.outdated, error: result.reason};
  try { saveToolUpdateState(next, options.path); } catch { /* Best effort bookkeeping. */ }
  return next;
}
