import {spawn} from 'node:child_process';
import {devNull, homedir} from 'node:os';
import {trustedGit} from '../context/trustedServices.js';

/**
 * The worktree manager's only way to run Git: the trusted binary, a typed argv,
 * a minimal environment and hard time/output bounds. Nothing is interpolated
 * into a shell. Every invocation neutralizes the repository execution paths Git
 * would otherwise honour merely because NMSh looked at a checkout:
 *
 * - `core.fsmonitor=false`: no fsmonitor hook/daemon (a configured executable).
 * - `core.hooksPath=/dev/null`: no hooks (post-checkout runs on `worktree add`).
 * - `protocol.allow=never` + `GIT_NO_LAZY_FETCH`: no transport, so no network or
 *   credential helpers, including promisor lazy fetches.
 * - `GIT_TERMINAL_PROMPT=0`, no inherited `GIT_*` (e.g. `GIT_DIR`, `GIT_EXEC_PATH`).
 *
 * Command-line `-c` values outrank repository config (including includes) and
 * reach Git's own child processes through `GIT_CONFIG_PARAMETERS`. Content
 * filters cannot be disabled generically, so callers check {@link executableRepositoryConfig}
 * and fail closed before any operation that would run them (status, checkout).
 */
export interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  /** Stdout reached the byte bound; the process was stopped and stdout is a prefix. */
  readonly truncated: boolean;
  readonly timedOut: boolean;
}

export interface GitRunOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  /** Read operations must not take optional index locks; mutations may. */
  readonly readOnly?: boolean;
}

export type GitRunner = (cwd: string, args: readonly string[], options?: GitRunOptions) => Promise<GitResult>;

export const DEFAULT_GIT_TIMEOUT_MS = 5000;
export const DEFAULT_GIT_MAX_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;

export const SAFE_GIT_CONFIG: readonly string[] = [
  '-c', 'core.fsmonitor=false',
  '-c', `core.hooksPath=${devNull}`,
  '-c', 'protocol.allow=never',
  '-c', 'credential.helper=',
  '-c', 'core.quotePath=false',
];

export function safeGitEnvironment(readOnly: boolean): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin:/bin', HOME: homedir(), LANG: 'C', LC_ALL: 'C',
    ...(process.env.TMPDIR ? {TMPDIR: process.env.TMPDIR} : {}),
    GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_ASKPASS: '/usr/bin/false', SSH_ASKPASS: '/usr/bin/false',
    GIT_PAGER: 'cat', PAGER: 'cat', GIT_EDITOR: '/usr/bin/false',
    ...(readOnly ? {GIT_OPTIONAL_LOCKS: '0'} : {}),
  };
}

/** Build a runner. Tests pass `executable` to substitute a fixture (slow/huge/failing) Git. */
export function createGitRunner(executable?: string): GitRunner {
  return async (cwd, args, options = {}) => {
    const binary = executable ?? await trustedGit();
    const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? DEFAULT_GIT_MAX_BYTES;
    return new Promise<GitResult>(resolve => {
      let child;
      try {
        child = spawn(binary, [...SAFE_GIT_CONFIG, '-C', cwd, ...args], {
          env: safeGitEnvironment(options.readOnly !== false), stdio: ['ignore', 'pipe', 'pipe'], shell: false,
        });
      } catch (error) {
        resolve({stdout: '', stderr: String(error), code: null, truncated: false, timedOut: false});
        return;
      }
      const out: Buffer[] = [], err: Buffer[] = [];
      let outBytes = 0, errBytes = 0, truncated = false, timedOut = false, settled = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        if (truncated) return;
        const room = maxBytes - outBytes;
        if (chunk.length >= room) {
          out.push(chunk.subarray(0, room)); outBytes = maxBytes; truncated = true; child.kill('SIGKILL');
        } else { out.push(chunk); outBytes += chunk.length; }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (errBytes >= MAX_STDERR_BYTES) return;
        err.push(chunk.subarray(0, MAX_STDERR_BYTES - errBytes)); errBytes += chunk.length;
      });
      const finish = (code: number | null, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({stdout: Buffer.concat(out).toString('utf8'), stderr: error ? String(error.message) : Buffer.concat(err).toString('utf8'),
          code, truncated, timedOut});
      };
      child.once('error', error => finish(null, error));
      child.once('close', code => finish(code));
    });
  };
}

/** A completed, untruncated, successful run. */
export function succeeded(result: GitResult): boolean {
  return result.code === 0 && !result.truncated && !result.timedOut;
}

export function failureText(result: GitResult): string {
  if (result.timedOut) return 'Git timed out';
  if (result.truncated) return 'Git output exceeded the safety bound';
  const line = result.stderr.split('\n').map(text => text.trim()).find(text => text.length > 0);
  return line ? line.replace(/^(?:fatal|error): /u, '') : `Git exited with status ${result.code ?? 'unknown'}`;
}

/**
 * Repository-local configuration that would make status/checkout execute a
 * program (content filters), read further config files, or fetch objects. A
 * non-empty result means "do not run status/checkout here"; names only, never
 * values. Returns undefined when the check itself could not complete.
 */
export async function executableRepositoryConfig(git: GitRunner, cwd: string): Promise<string[] | undefined> {
  const result = await git(cwd, ['config', '--local', '--no-includes', '--name-only', '--get-regexp',
    '^(filter\\.|include\\.|includeif\\.|extensions\\.(worktreeconfig|partialclone)$|remote\\..*\\.promisor$|core\\.worktree$)'],
  {timeoutMs: 2000, maxBytes: 64 * 1024});
  // Git exits 1 when nothing matches.
  if (result.code === 1 && !result.timedOut) return [];
  if (!succeeded(result)) return undefined;
  return result.stdout.split('\n').map(name => name.trim()).filter(Boolean);
}
