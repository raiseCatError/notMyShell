import {resolveCommand} from '../providers/providers.js';

/**
 * The system "open this URL/file" helper. Optional everywhere: when none is
 * found the caller reports the target as text instead. Nothing is installed.
 * macOS: `open`. Linux: xdg-open, then wslview (WSL with wslu installed).
 */
export function selectOpener(platform: NodeJS.Platform = process.platform, resolve: (name: string) => string | undefined = name => resolveCommand(name)): string | undefined {
  if (platform === 'darwin') return '/usr/bin/open';
  if (platform !== 'linux') return undefined;
  return resolve('xdg-open') ?? resolve('wslview');
}
