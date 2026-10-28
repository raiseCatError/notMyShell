import {homedir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';

export type AppearanceHost = 'ghostty' | 'kitty';
export interface AppearanceContext {env: NodeJS.ProcessEnv; platform: NodeJS.Platform}
export const appearanceContext = (): AppearanceContext => ({env: process.env, platform: process.platform});
export function appearancePaths(host: AppearanceHost, context: AppearanceContext) {
  const {env, platform} = context;
  const home = env.HOME && isAbsolute(env.HOME) ? resolve(env.HOME) : homedir();
  const xdg = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
  // Kitty loads only the FIRST directory whose kitty.conf exists (XDG, then Library/Preferences on macOS),
  // falling back to XDG; Ghostty loads every existing root (see readHostConfiguration).
  const kittyDirectories = env.KITTY_CONFIG_DIRECTORY ? [env.KITTY_CONFIG_DIRECTORY]
    : [join(xdg, 'kitty'), ...(platform === 'darwin' ? [join(home, 'Library/Preferences/kitty')] : [])];
  const candidates = host === 'kitty' ? kittyDirectories.map(directory => join(directory, 'kitty.conf'))
    : [join(xdg, 'ghostty', 'config'), join(xdg, 'ghostty', 'config.ghostty'), ...(platform === 'darwin'
      ? [join(home, 'Library/Application Support/com.mitchellh.ghostty/config'), join(home, 'Library/Application Support/com.mitchellh.ghostty/config.ghostty')] : [])];
  const directory = join(nmshConfigDirectory(env, platform), 'host-appearance');
  return {home, candidates, directory, fragment: join(directory, `${host}.conf`), ledger: join(directory, `${host}.json`), fallback: host === 'kitty' ? candidates[0]! : candidates[1]!};
}
