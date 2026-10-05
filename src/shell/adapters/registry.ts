import {bashAdapter} from './BashAdapter.js';
import {fishAdapter} from './FishAdapter.js';
import {SHELL_IDS, type ShellAdapter, type ShellId} from './ShellAdapter.js';
import {shellVersion} from './shellExecutable.js';
import {zshAdapter} from './ZshAdapter.js';

const ADAPTERS: Record<ShellId, ShellAdapter> = {zsh: zshAdapter, fish: fishAdapter, bash: bashAdapter};

export function shellAdapter(id: ShellId): ShellAdapter {
  return ADAPTERS[id];
}

export interface ShellAvailability {
  adapter: ShellAdapter;
  /** Present when the shell can be used here. */
  executable?: string;
  version?: string;
  /** Why it cannot, when it cannot. */
  reason?: string;
}

/** Every supported backend with what this machine offers; nothing is installed. */
export function shellAvailability(env: NodeJS.ProcessEnv = process.env, withVersions = false): ShellAvailability[] {
  return SHELL_IDS.map(id => {
    const adapter = ADAPTERS[id];
    const executable = adapter.resolveExecutable(env);
    if (!executable) return {adapter, reason: adapter.unavailableReason(env) ?? `${adapter.label} is not available.`};
    return {adapter, executable, ...(withVersions ? {version: shellVersion(executable)} : {})};
  });
}

export type ShellInstall =
  | {kind: 'recipe'; command: string; args: string[]; label: string}
  | {kind: 'guidance'; text: string};

/**
 * How a missing (or too old) shell can be installed. Only Homebrew formulas
 * NMSh already relies on elsewhere, run as argv: never sudo, curl | sh, taps,
 * chsh or dotfile changes. Otherwise plain guidance; nothing is guessed.
 */
export function shellInstall(id: ShellId, brew: string | undefined, platform: NodeJS.Platform = process.platform): ShellInstall {
  const label = ADAPTERS[id].label;
  if (brew && (platform === 'darwin' || platform === 'linux')) return {kind: 'recipe', command: brew, args: ['install', id], label: `brew install ${id}`};
  if (platform === 'linux') return {kind: 'guidance', text: `Install ${label} with your distribution's package manager, then reopen /shell. NMSh does not guess package names or use sudo.`};
  return {kind: 'guidance', text: `Install ${label} from its official source (or install Homebrew and use brew install ${id}), then reopen /shell.`};
}
