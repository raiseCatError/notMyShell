import {mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {IPty} from 'node-pty';
import type {PtySpawner, StopLevel} from './supervisor.js';

/**
 * A live group member is the only signalling authority. Numeric PID probes cannot make a later kill(-pid) safe:
 * the last member can exit between the probe and kill. The guard signals group 0 from INSIDE its own PTY group.
 * A private, bounded control file also retains an immediate stop while forkpty is still establishing the group.
 * Command output is never interpreted as control, and command text still reaches the shell as one argv element.
 */
export class TaskGroup {
  readonly directory = mkdtempSync(join(tmpdir(), 'nmsh-task-'));
  readonly pty: IPty;
  alive = true;

  constructor(spawn: PtySpawner, shell: string, command: string, options: Parameters<PtySpawner>[2]) {
    try {
      const source = import.meta.url.endsWith('.ts');
      const guard = fileURLToPath(new URL(source ? './taskGroupGuard.ts' : './taskGroupGuard.js', import.meta.url));
      // Guard startup must not execute the command's NODE_OPTIONS hooks, start a debugger, or write its caches.
      // Restore only in the command child's environment. Values travel in the spawn environment, never on disk/argv.
      const env = {...options.env};
      const restore: Record<string, string | null> = {};
      for (const key of Object.keys(env)) if (/^(?:NODE_|TSX_)/u.test(key)) { restore[key] = env[key]!; delete env[key]; }
      restore.TSX_DISABLE_CACHE ??= options.env.TSX_DISABLE_CACHE ?? null;
      env.TSX_DISABLE_CACHE = '1';
      let key: string;
      do { key = `NMSH_TASK_ENV_${randomUUID().replaceAll('-', '')}`; } while (key in env);
      env[key] = JSON.stringify(restore);
      this.pty = spawn(process.execPath, [...(source ? ['--import', import.meta.resolve('tsx')] : []), guard, this.directory, shell, command, String(process.pid), key], {...options, env});
    } catch (error) { rmSync(this.directory, {recursive: true, force: true}); throw error; }
  }

  signal(level: StopLevel): boolean {
    if (!this.alive) return false;
    try {
      // Rename avoids a partial request. Only three levels are admitted; no unbounded request log or command data.
      writeFileSync(join(this.directory, 'next'), level, {mode: 0o600});
      renameSync(join(this.directory, 'next'), join(this.directory, 'signal'));
      return true;
    } catch { return false; }
  }

  leaderExit(): {exitCode: number; signal?: number} | undefined {
    try {
      const value = JSON.parse(readFileSync(join(this.directory, 'exit'), 'utf8'));
      if (Number.isInteger(value.exitCode) && (value.signal === undefined || Number.isInteger(value.signal))) return value;
    } catch { /* Not observed yet. */ }
    return undefined;
  }

  /** The guard found members of the group still running after the command's leader exited. */
  leftBehind(): boolean {
    try { return readFileSync(join(this.directory, 'left'), 'utf8') === '1'; } catch { return false; }
  }

  close(): void {
    this.alive = false;
    rmSync(this.directory, {recursive: true, force: true});
  }
}
