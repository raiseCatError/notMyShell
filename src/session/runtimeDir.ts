import {lstatSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const RUNTIME_DIR_ENV = 'NMSH_RUNTIME_DIR';

function uid(): number {
  return process.getuid?.() ?? -1;
}

/** Per-user runtime directory. macOS TMPDIR is already per-user; the uid suffix covers a shared /tmp. */
export function defaultRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env[RUNTIME_DIR_ENV] || join(tmpdir(), `nmsh-${uid()}`);
}

export function socketPathFor(runtimeDir: string): string {
  return join(runtimeDir, 'nmshd.sock');
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
