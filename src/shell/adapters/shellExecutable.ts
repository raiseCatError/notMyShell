import {accessSync, constants, statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {delimiter, isAbsolute, join} from 'node:path';

/** Executable regular files named `name` in the given directories, in order. Never a relative PATH entry. */
export function findShellExecutables(name: string, env: NodeJS.ProcessEnv, extra: readonly string[] = []): string[] {
  const candidates = [...(env.PATH ?? '').split(delimiter).filter(isAbsolute).map(directory => join(directory, name)), ...extra];
  const found: string[] = [];
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      if (!found.includes(candidate)) found.push(candidate);
    } catch { /* not here */ }
  }
  return found;
}

const versions = new Map<string, string | undefined>();

/** `<shell> --version` first line, cached per path; bounded and never interactive. */
export function shellVersion(executable: string, args: readonly string[] = ['--version']): string | undefined {
  const key = `${executable}\0${args.join('\0')}`;
  if (versions.has(key)) return versions.get(key);
  let version: string | undefined;
  try {
    const result = spawnSync(executable, [...args], {encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'], env: {PATH: process.env.PATH ?? ''}});
    version = result.status === 0 ? result.stdout.split('\n')[0]?.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 120) || undefined : undefined;
  } catch { version = undefined; }
  versions.set(key, version);
  return version;
}
