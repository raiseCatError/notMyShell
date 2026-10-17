import {accessSync, constants, existsSync, readdirSync, readFileSync, readlinkSync} from 'node:fs';
import {resolveCommand} from '../../providers/providers.js';
import {hyprlandHost} from './hyprland.js';
import {kittyHost} from './kitty.js';
import {terminalAppHost} from './terminalApp.js';
import {refuse, type Refused, type WindowHost} from './types.js';

/** Read-only filesystem access (Linux /proc, executable checks); tests substitute a fake. */
export interface WindowFiles {
  readText(path: string): string | undefined;
  readLink(path: string): string | undefined;
  list(path: string): string[] | undefined;
  executable(path: string): boolean;
  exists(path: string): boolean;
}

export interface WindowContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** This frontend: the process attached to the terminal window. */
  pid: number;
  /** stdin and stdout are this frontend's terminal; otherwise nothing is ever probed. */
  interactive: boolean;
  files: WindowFiles;
  /** PATH lookup for a host tool (an absolute path, or undefined). */
  resolve(name: string): string | undefined;
}

const attempt = <T>(read: () => T): T | undefined => { try { return read(); } catch { return undefined; } };

export const systemFiles: WindowFiles = {
  readText: path => attempt(() => readFileSync(path, 'utf8').slice(0, 64 * 1024)),
  readLink: path => attempt(() => readlinkSync(path)),
  list: path => attempt(() => readdirSync(path)),
  executable: path => attempt(() => { accessSync(path, constants.X_OK); return true; }) ?? false,
  exists: path => attempt(() => existsSync(path)) ?? false,
};

export function systemWindowContext(): WindowContext {
  return {platform: process.platform, env: process.env, pid: process.pid, interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    files: systemFiles, resolve: name => resolveCommand(name)};
}

/**
 * Which host may be asked about the window, before any command runs. A host
 * name or a compositor variable alone never proves ownership: each adapter
 * proves the exact window itself, and everything else is unsupported, quietly.
 * Linux: Hyprland only (X11 offers no dependency-free way to read a window's
 * state, and other Wayland compositors keep window control from clients'
 * children). Windows and WSL: never.
 */
export function windowHost(context: WindowContext): WindowHost | Refused {
  const env = context.env;
  if (!context.interactive) return refuse('unsupported', 'NMSh is not attached to a terminal window');
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return refuse('unsupported', 'over SSH the window belongs to the computer you connected from');
  if (env.TMUX || env.STY || env.ZELLIJ !== undefined || /^(?:screen|tmux)/u.test(env.TERM ?? '')) {
    return refuse('unsupported', 'inside a terminal multiplexer NMSh cannot tell which window shows it');
  }
  if (env.TERM_PROGRAM === 'vscode' || env.TERM_PROGRAM === 'zed' || env.ZED_TERM || env.TERMINAL_EMULATOR?.startsWith('JetBrains') || env.INSIDE_EMACS || env.NVIM || env.VIM_TERMINAL) {
    return refuse('unsupported', 'an editor\'s integrated terminal belongs to the editor\'s window');
  }
  if (context.platform === 'win32' || env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.WT_SESSION) return refuse('unsupported', 'NMSh does not manage windows on Windows or WSL');
  if (context.platform === 'darwin') {
    const program = env.TERM_PROGRAM ?? '';
    if (program === 'Apple_Terminal') return terminalAppHost(context);
    if (program === 'ghostty' || env.GHOSTTY_RESOURCES_DIR) return refuse('unsupported', 'Ghostty on macOS offers no window zoom NMSh can ask for');
    if (!program && env.KITTY_WINDOW_ID) return kittyHost(context);
    return refuse('unsupported', `${program || 'this terminal'} offers no window zoom NMSh can ask for`);
  }
  if (context.platform === 'linux') {
    if (env.HYPRLAND_INSTANCE_SIGNATURE) return hyprlandHost(context);
    if (env.WAYLAND_DISPLAY) return refuse('unsupported', 'on this Wayland desktop a program in a terminal cannot ask for the terminal\'s window');
    if (env.DISPLAY) return refuse('unsupported', 'on X11 NMSh has no dependency-free way to read this window\'s state');
    return refuse('unsupported', 'there is no graphical session');
  }
  return refuse('unsupported', `${context.platform} is not a platform NMSh manages windows on`);
}
