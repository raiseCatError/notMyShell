import {homedir} from 'node:os';
import {isAbsolute, join} from 'node:path';

export function nmshConfigDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const home = [env.HOME, env.USERPROFILE].find(value => value && isAbsolute(value)) || homedir();
  if (env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)) return join(env.XDG_CONFIG_HOME, 'nmsh');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'notMyShell');
  return join(home, '.config', 'nmsh');
}

export function promptConfigurationPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(nmshConfigDirectory(env), 'config.json');
}

/**
 * Where NMSh keeps disposable caches (the real browser's throwaway profile). A launcher that isolates its configuration with
 * `XDG_CONFIG_HOME` gets its own cache beside it, so QA sessions never share a profile with real use.
 */
export function nmshCacheDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const home = [env.HOME, env.USERPROFILE].find(value => value && isAbsolute(value)) || homedir();
  if (env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME)) return join(env.XDG_CACHE_HOME, 'nmsh');
  if (env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)) return join(env.XDG_CONFIG_HOME, 'nmsh', 'cache');
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'notMyShell');
  return join(home, '.cache', 'nmsh');
}
