import {statSync} from 'node:fs';

export const NMSH_ACTIVE_ENV = 'NMSH_ACTIVE';
export const NESTED_NMSH_MESSAGE = [
  'NMSh is already active in this managed shell.',
  'If you started a nested shell, run `exit` to return to NMSh.',
  'From the NMSh composer, /zsh, /fish, /bash or /exit leave NMSh for an ordinary shell.',
].join('\n');

export function isManagedNmshEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[NMSH_ACTIVE_ENV] === '1';
}

/**
 * The handoff-return contract. A deliberate /zsh, /fish, /bash or /exit from a
 * service session detaches it and starts an ordinary shell carrying these two
 * private markers; they live only in that shell and its descendants.
 * RETURN_SESSION: the exact detached session `nmsh` there reattaches.
 * HANDOFF_SHELL: which ordinary shell is waiting, so leaving to it again
 * returns to that shell instead of nesting another one.
 */
export const RETURN_SESSION_ENV = 'NMSH_RETURN_SESSION';
export const HANDOFF_SHELL_ENV = 'NMSH_HANDOFF_SHELL';
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/u;

export interface HandoffReturn {sessionId: string; shell: string}

/** The environment for an ordinary shell after leaving NMSh: no NMSh-managed markers, so `nmsh` can start again. */
export function createOrdinaryShellEnvironment(env: NodeJS.ProcessEnv = process.env, handoff?: HandoffReturn): NodeJS.ProcessEnv {
  const ordinaryEnv = {...env};
  delete ordinaryEnv[NMSH_ACTIVE_ENV];
  delete ordinaryEnv.NMSH_SESSION_MODE;
  delete ordinaryEnv.NMSH_SESSION_ID;
  delete ordinaryEnv[RETURN_SESSION_ENV];
  delete ordinaryEnv[HANDOFF_SHELL_ENV];
  if (handoff && SESSION_ID.test(handoff.sessionId)) {
    ordinaryEnv[RETURN_SESSION_ENV] = handoff.sessionId;
    ordinaryEnv[HANDOFF_SHELL_ENV] = handoff.shell;
  }
  return ordinaryEnv;
}

/** The session a launch should return to, unless explicit intent (--new, --attach, --preset) says otherwise. */
export function handoffReturnSession(env: NodeJS.ProcessEnv, args: readonly string[]): string | undefined {
  if (args.includes('--new') || args.includes('--attach') || args.includes('--preset')) return undefined;
  const id = env[RETURN_SESSION_ENV];
  return id && SESSION_ID.test(id) ? id : undefined;
}

export type ReturnDecision =
  | {kind: 'attach'; sessionId: string}
  | {kind: 'unavailable'; notice: string};

/** Only the exact session, only while it is detached; never a substitute. */
export function decideHandoffReturn(sessionId: string, live: ReadonlyArray<{id: string; state: string}>): ReturnDecision {
  const session = live.find(item => item.id === sessionId);
  if (!session) return {kind: 'unavailable', notice: `The session you left (${sessionId.slice(0, 8)}) has ended; its transcript is in /resume.`};
  if (session.state !== 'detached') return {kind: 'unavailable', notice: `The session you left (${sessionId.slice(0, 8)}) is attached in another NMSh window; it was not taken over.`};
  return {kind: 'attach', sessionId};
}

/**
 * Leaving again to the ordinary shell that is already waiting for this NMSh
 * (same shell, same session) returns to it instead of starting another one.
 */
export function returnsToWaitingShell(env: NodeJS.ProcessEnv, shell: string, sessionId: string | undefined): boolean {
  return Boolean(sessionId) && env[HANDOFF_SHELL_ENV] === shell && env[RETURN_SESSION_ENV] === sessionId;
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
