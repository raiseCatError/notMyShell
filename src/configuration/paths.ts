import {join} from 'node:path';

export function nmshConfigDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const home = env.HOME || env.USERPROFILE || '';
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, 'nmsh');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'notMyShell');
  return join(home, '.config', 'nmsh');
}

export function promptConfigurationPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(nmshConfigDirectory(env), 'config.json');
}
