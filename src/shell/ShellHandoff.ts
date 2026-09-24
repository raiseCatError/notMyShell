import {statSync} from 'node:fs';

export const NMSH_ACTIVE_ENV = 'NMSH_ACTIVE';
export const NESTED_NMSH_MESSAGE = 'NMSh is already running in this shell. Use /zsh to return to a normal zsh session.';

export function isManagedNmshEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[NMSH_ACTIVE_ENV] === '1';
}

export function createOrdinaryZshEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const ordinaryEnv = {...env};
  delete ordinaryEnv[NMSH_ACTIVE_ENV];
  return ordinaryEnv;
}

export type ShellHandoffDecision =
  | {kind: 'busy'}
  | {kind: 'handoff'; cwd?: string};

export function chooseShellHandoff(
  foregroundCommandActive: boolean,
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
  if (foregroundCommandActive) return {kind: 'busy'};
  if (isDirectory(shellCwd)) return {kind: 'handoff', cwd: shellCwd};
  if (isDirectory(initialCwd)) return {kind: 'handoff', cwd: initialCwd};
  return {kind: 'handoff'};
}
