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
