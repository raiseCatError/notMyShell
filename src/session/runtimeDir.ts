import {lstatSync, mkdirSync, readdirSync} from 'node:fs';
import {PROTOCOL_VERSION} from './SessionProtocol.js';
import {tmpdir} from 'node:os';
import {isAbsolute, join} from 'node:path';

export const RUNTIME_DIR_ENV = 'NMSH_RUNTIME_DIR';

function uid(): number {
  return process.getuid?.() ?? -1;
}

/** Per-user runtime directory. macOS TMPDIR is already per-user; the uid suffix covers a shared /tmp. */
export function defaultRuntimeDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env[RUNTIME_DIR_ENV]) return env[RUNTIME_DIR_ENV];
  const xdg = env.XDG_RUNTIME_DIR;
  if (platform === 'linux' && xdg && isAbsolute(xdg)) {
    const directory = join(xdg, 'nmsh');
    try {
      const stat = lstatSync(xdg);
      // XDG runtime roots must already be private, owned directories. Do not repair them.
      if (stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === uid()
        && (stat.mode & 0o077) === 0 && Buffer.byteLength(socketPathFor(directory)) <= 100) return directory;
    } catch { /* A missing/unsafe root uses the existing private temporary fallback. */ }
  }
  return join(tmpdir(), `nmsh-${uid()}`);
}

/**
 * Each protocol version has its own service socket. After an update the old
 * service keeps serving the sessions it owns until they end, while new
 * frontends start (and only ever attach through) a service they speak to.
 */
export function socketPathFor(runtimeDir: string, version = PROTOCOL_VERSION): string {
  return join(runtimeDir, version === 1 ? 'nmshd.sock' : `nmshd-v${version}.sock`);
}

/** Socket paths of services speaking other protocol versions (v1 used the unversioned name). */
export function otherServiceSockets(runtimeDir: string): string[] {
  let names: string[];
  try { names = readdirSync(runtimeDir); } catch { return []; }
  const current = socketPathFor(runtimeDir);
  return names.filter(name => /^nmshd(?:-v\d+)?\.sock$/u.test(name)).map(name => join(runtimeDir, name)).filter(path => path !== current);
}

/** Where the service spools a session's stream events its journal does not have yet. */
export function spoolPathFor(runtimeDir: string, sessionId: string): string {
  return join(runtimeDir, 'spool', `${sessionId}.jsonl`);
}

/**
 * Create (if needed) and verify the runtime directory: a real directory, not a
 * symlink, owned by this user, with no group/other permissions. Anything else
 * may be attacker-controlled, so it is refused rather than repaired.
 */
export function ensurePrivateRuntimeDir(runtimeDir: string): void {
  mkdirSync(runtimeDir, {recursive: true, mode: 0o700});
  const stat = lstatSync(runtimeDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('runtime path is not a directory');
  if (stat.uid !== uid()) throw new Error('runtime directory is owned by another user');
  if ((stat.mode & 0o077) !== 0) throw new Error('runtime directory permissions are not private');
}
