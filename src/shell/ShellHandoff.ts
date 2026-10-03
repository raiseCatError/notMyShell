import {statSync} from 'node:fs';

export const NMSH_ACTIVE_ENV = 'NMSH_ACTIVE';
export const NESTED_NMSH_MESSAGE = 'NMSh is already running in this shell. Use /exit (or /zsh, /fish, /bash) to leave NMSh for an ordinary shell.';

export function isManagedNmshEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[NMSH_ACTIVE_ENV] === '1';
}

/** The environment for an ordinary shell after leaving NMSh: no NMSh-managed markers, so `nmsh` can start again. */
export function createOrdinaryShellEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const ordinaryEnv = {...env};
  delete ordinaryEnv[NMSH_ACTIVE_ENV];
  delete ordinaryEnv.NMSH_SESSION_MODE;
  return ordinaryEnv;
}

/** Kept for existing callers; the handoff is shell-independent. */
export const createOrdinaryZshEnvironment = createOrdinaryShellEnvironment;

export type ShellHandoffDecision =
  | {kind: 'busy'; reason?: string}
  | {kind: 'handoff'; cwd?: string};

/**
 * One decision path for /zsh, /fish, /bash and /exit. `foregroundCommandActive`
 * may be a factual reason string (startup, full-screen program, running command).
 */
export function chooseShellHandoff(
  foregroundCommandActive: boolean | string,
  shellCwd: string,
  initialCwd: string,
  isDirectory: (path: string) => boolean = path => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
): ShellHandoffDecision {
  if (foregroundCommandActive) return typeof foregroundCommandActive === 'string' ? {kind: 'busy', reason: foregroundCommandActive} : {kind: 'busy'};
  if (isDirectory(shellCwd)) return {kind: 'handoff', cwd: shellCwd};
  if (isDirectory(initialCwd)) return {kind: 'handoff', cwd: initialCwd};
  return {kind: 'handoff'};
}
