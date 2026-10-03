import {accessSync, constants, statSync} from 'node:fs';
import {delimiter, isAbsolute, join} from 'node:path';

/** Preserve the system zsh preference; support installations in an absolute PATH directory. */
export function resolveZsh(env: NodeJS.ProcessEnv = process.env, systemPaths: readonly string[] = ['/bin/zsh', '/usr/bin/zsh']): string {
  const candidates = [...systemPaths, ...(env.PATH ?? '').split(delimiter).filter(isAbsolute).map(directory => join(directory, 'zsh'))];
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* Try the next executable location. */ }
  }
  throw new Error('NMSh requires executable zsh; install zsh and make it available on PATH.');
}
