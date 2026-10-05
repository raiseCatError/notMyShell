import {execFile} from 'node:child_process';
import {constants} from 'node:fs';
import {open, realpath} from 'node:fs/promises';
import {homedir, devNull} from 'node:os';
import {promisify} from 'node:util';

const exec = promisify(execFile);
let gitExecutable: Promise<string> | undefined;
function trustedGit(): Promise<string> {
  return gitExecutable ??= (async () => {
    if (process.platform === 'darwin') {
      // Apple's /usr/bin/git is an xcrun shim. Prefer a known local installation,
      // validating its resolved prefix; never use workspace/PATH candidates.
      for (const prefix of ['/opt/homebrew', '/usr/local']) try {
        const path = await realpath(`${prefix}/bin/git`);
        if (path.startsWith(`${prefix}/Cellar/git/`)) return path;
      } catch { /* OS Git is the fallback. */ }
    }
    return '/usr/bin/git';
  })();
}
const MAX_METADATA_BYTES = 256 * 1024;

/** Core-only bounded local data access. Symlinks/special files are not contextual metadata. */
export async function readContextMetadata(path: string): Promise<string | undefined> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) return undefined;
    const buffer = Buffer.alloc(MAX_METADATA_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const {bytesRead} = await file.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    return used <= MAX_METADATA_BYTES ? buffer.subarray(0, used).toString('utf8') : undefined;
  } catch { return undefined; }
  finally { await file?.close(); }
}

/** Trusted OS Git only; PATH inventory is never an execution authority. */
export async function runContextGit(cwd: string, args: string[]): Promise<string> {
  const allowed = [
    ['rev-parse', '--absolute-git-dir'], ['rev-parse', '--show-toplevel'], ['rev-parse', '--short', 'HEAD'],
    ['symbolic-ref', '--quiet', '--short', 'HEAD'], ['status', '--porcelain=v1', '--branch', '--untracked-files=normal'],
  ];
  if (!allowed.some(operation => operation.length === args.length && operation.every((arg, i) => arg === args[i]))) {
    throw new Error('Unsupported contextual Git operation');
  }
  const executable = await trustedGit();
  const options = {encoding: 'utf8' as const, timeout: 2000, maxBuffer: 1024 * 1024,
    env: {PATH: '/usr/bin:/bin', HOME: homedir(), LANG: 'C',
      ...(process.env.TMPDIR ? {TMPDIR: process.env.TMPDIR} : {}), GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: devNull, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1'}};
  const base = ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${devNull}`, '-C', cwd];
  if (args[0] === 'status') {
    // Status can invoke filters or lazy-fetch missing objects. Fail closed on filters, includes, partial clones or
    // extra worktree config; branch/root still work. Submodules are not inspected. No project config values are logged.
    try {
      const {stdout} = await exec(executable, [...base, 'config', '--local', '--no-includes', '--name-only',
        '--get-regexp', '^(filter\\.|include\\.|includeif\\.|extensions\\.(worktreeconfig|partialclone)$|remote\\..*\\.promisor$)'], options);
      if (stdout.trim()) throw new Error('Repository configuration requires a future safe status capability');
    } catch (error) {
      // Git exits 1 when no matching config exists; every other failure is unknown.
      if ((error as {code?: number}).code !== 1) throw error;
    }
  }
  const {stdout} = await exec(executable, [...base, ...args, ...(args[0] === 'status' ? ['--ignore-submodules=all'] : [])], options);
  return stdout.trim();
}
