/**
 * Ask the terminal NMSh runs in to reload its configuration after NMSh rewrote one of its own files, so a change applies
 * without the person pressing the reload shortcut. Only a verified parent process is signalled, and only with the signal that
 * terminal documents or was observed to handle; anything uncertain falls back to a plain instruction.
 */
import {parseGhosttyVersion} from './ghosttyShaderCatalog.js';
import {readProcessTable, type ProcessRow} from './ghosttyShaders.js';
import {reloadKitty} from './kittyShaders.js';
import {terminalProfile} from '../host/capabilities.js';

export type ReloadHost = 'kitty' | 'ghostty';
export interface HostReloadDeps {rows?: () => readonly ProcessRow[] | undefined; selfPid?: number; signal?: (pid: number) => void}
export type HostReloadResult = {reloaded: boolean; message: string};

/** Ghostty's macOS app logs "reloading configuration in response to SIGUSR2"; verified on 1.3.1. Older builds may not handle it. */
export const GHOSTTY_SIGUSR2_SINCE = [1, 3, 0] as const;
const ghosttyReloadKeys = (platform: NodeJS.Platform) => platform === 'darwin' ? '⌘⇧,' : 'Ctrl+Shift+,';
const atLeast = (version: readonly number[], floor: readonly number[]) => {
  for (let index = 0; index < floor.length; index++) if ((version[index] ?? 0) !== floor[index]) return (version[index] ?? 0) > floor[index]!;
  return true;
};

/** The Ghostty process among NMSh's parents, or undefined (tmux, ssh, a session service or another terminal in between). */
export function ghosttyReloadTarget(rows: readonly ProcessRow[] | undefined, selfPid: number): number | undefined {
  if (!rows) return undefined;
  const byPid = new Map(rows.map(row => [row.pid, row]));
  let current = byPid.get(selfPid);
  for (let depth = 0; current && depth < 32; depth++) {
    if (/(^|\/)ghostty$/u.test(current.command.split(/\s+/u)[0] ?? '')) return current.pid;
    current = current.ppid > 1 ? byPid.get(current.ppid) : undefined;
  }
  return undefined;
}

/** Under the test runner nothing is signalled unless a test injects its own signal: a developer's real terminal is never touched. */
const realSignal = (name: NodeJS.Signals) => process.env.NODE_TEST_CONTEXT ? undefined : (pid: number) => process.kill(pid, name);

export function reloadGhostty(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, deps: HostReloadDeps = {}): HostReloadResult {
  const manual = (why: string) => ({reloaded: false, message: `Reload Ghostty to load it (${ghosttyReloadKeys(platform)}): ${why}`});
  const version = terminalProfile(env) === 'ghostty' ? parseGhosttyVersion(env.TERM_PROGRAM_VERSION) : undefined;
  if (!version) return manual('NMSh could not confirm the Ghostty version it runs in.');
  if (!atLeast(version, GHOSTTY_SIGUSR2_SINCE)) return manual(`automatic reload needs Ghostty ${GHOSTTY_SIGUSR2_SINCE.join('.')} or newer.`);
  const target = ghosttyReloadTarget((deps.rows ?? readProcessTable)(), deps.selfPid ?? process.pid);
  if (target === undefined) return manual('NMSh could not confirm which Ghostty it runs in.');
  const signal = deps.signal ?? realSignal('SIGUSR2');
  if (!signal) return manual('signals are disabled here.');
  try { signal(target); } catch { return manual('asking Ghostty to reload failed.'); }
  return {reloaded: true, message: 'Ghostty was asked to reload its configuration, so the change is loaded now.'};
}

/** The running host's reload, or an instruction. Kitty: its documented SIGUSR1 to the verified KITTY_PID parent. */
export function reloadHost(host: ReloadHost, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, deps: HostReloadDeps = {}): HostReloadResult {
  return host === 'ghostty' ? reloadGhostty(env, platform, deps) : reloadKitty(env, platform, deps);
}
