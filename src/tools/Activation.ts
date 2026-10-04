import type {ShellId} from '../shell/adapters/ShellAdapter.js';

/**
 * Whether an integration is active in the running shell, from the one shared
 * source every shell adapter already provides: the per-prompt snapshot of
 * alias/function names. Nothing is sourced, parsed or evaluated, and rc files
 * are never read. "Installed", "selected in NMSh" and "active in this shell"
 * are separate facts; this module only answers the last.
 */
export type ActivationState = 'active' | 'not-detected' | 'unknown';
export interface ActivationFacts {
  state: ActivationState;
  /** Plain sentence about what was (or was not) observed. */
  detail: string;
}

/**
 * Functions each tool's own shell init defines. Any one present counts. A tool
 * with no entry for a shell reports 'unknown' rather than guessing.
 */
const MARKERS: Record<string, Partial<Record<ShellId, readonly string[]>>> = {
  zoxide: {zsh: ['__zoxide_z', '__zoxide_hook'], bash: ['__zoxide_z', '__zoxide_hook'], fish: ['__zoxide_z']},
  atuin: {zsh: ['_atuin_preexec', '_atuin_search'], bash: ['__atuin_history'], fish: ['_atuin_preexec', '_atuin_search']},
  fzf: {zsh: ['fzf-file-widget', 'fzf-history-widget'], bash: ['__fzf_history__', '__fzf_select__']},
};

export function activationTools(): string[] { return Object.keys(MARKERS); }

/**
 * `names`: function/alias names from the last shell snapshot; undefined when
 * no snapshot has arrived. `complete`: the snapshot was not truncated, so a
 * missing name means "not there" rather than "maybe cut off".
 */
export function integrationActivation(toolId: string, shell: ShellId, names: ReadonlySet<string> | undefined, complete: boolean): ActivationFacts | undefined {
  const markers = MARKERS[toolId]?.[shell];
  if (!MARKERS[toolId]) return undefined;
  if (!markers) return {state: 'unknown', detail: `NMSh has no activation check for ${toolId} in ${shell}.`};
  if (!names) return {state: 'unknown', detail: 'No shell snapshot yet; run a command and reopen.'};
  const seen = markers.find(name => names.has(name));
  if (seen) return {state: 'active', detail: `${seen} is defined in this ${shell} session.`};
  return complete
    ? {state: 'not-detected', detail: `None of ${markers.join(', ')} is defined in this ${shell} session.`}
    : {state: 'unknown', detail: 'The shell name snapshot was truncated, so absence cannot be confirmed.'};
}

export const ACTIVATION_LABELS: Record<ActivationState, string> = {active: 'Active in this shell', 'not-detected': 'Not detected in this shell', unknown: 'Unknown'};
