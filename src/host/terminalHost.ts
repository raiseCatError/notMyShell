import {spawn} from 'node:child_process';

/**
 * The terminal NMSh runs in, and whether NMSh can ask it to open another
 * independent window running a command. NMSh never manages windows itself;
 * hosts without a supported way to do this simply report `newWindow: undefined`.
 */
export interface TerminalHost {
  /** Human-readable name for messages. */
  name: string;
  /** How to open a new window running `argv`, if this host supports it. */
  newWindow?: (argv: readonly string[]) => {command: string; args: string[]};
}

/** Quote one argument for a POSIX shell. */
export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/u.test(value) ? value : `'${value.replace(/'/gu, `'\\''`)}'`;
}

const appleScriptString = (value: string) => `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;

export function detectTerminalHost(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): TerminalHost {
  const program = env.TERM_PROGRAM ?? '';
  if (program === 'ghostty' || env.GHOSTTY_RESOURCES_DIR) {
    return {name: 'Ghostty', newWindow: argv => platform === 'darwin'
      // No scripting API opens a window in the running instance; this starts a new Ghostty instance.
      ? {command: 'open', args: ['-na', 'Ghostty.app', '--args', '-e', ...argv]}
      : {command: 'ghostty', args: ['-e', ...argv]}};
  }
  if (program === 'Apple_Terminal' && platform === 'darwin') {
    return {name: 'Terminal', newWindow: argv => ({command: 'osascript', args: ['-e',
      `tell application "Terminal" to do script ${appleScriptString(argv.map(shellQuote).join(' '))}`]})};
  }
  if (env.KITTY_WINDOW_ID) {
    // Needs kitty remote control (allow_remote_control); failure falls back like any unsupported host.
    return {name: 'kitty', newWindow: argv => ({command: 'kitten', args: ['@', 'launch', '--type=os-window', ...argv]})};
  }
  if (program === 'vscode') return {name: 'VS Code'};
  if (program === 'zed' || env.ZED_TERM) return {name: 'Zed'};
  return {name: program || 'this terminal'};
}

export type Spawner = (command: string, args: string[]) => Promise<boolean>;

/** Run the launcher detached; resolves whether it started and exited cleanly. */
export const spawnLauncher: Spawner = (command, args) => new Promise(resolve => {
  try {
    const child = spawn(command, args, {stdio: 'ignore', detached: true});
    child.once('error', () => resolve(false));
    child.once('exit', code => resolve(code === 0));
    child.unref();
  } catch { resolve(false); }
});

/**
 * Open one new host window per command line. Returns the ones that could not
 * be opened (host unsupported or launcher failed), so the caller can tell the
 * user how to open them manually instead of silently dropping them.
 */
export async function openWindows(host: TerminalHost, commands: readonly (readonly string[])[], spawner: Spawner = spawnLauncher):
Promise<(readonly string[])[]> {
  const failed: (readonly string[])[] = [];
  for (const argv of commands) {
    const launch = host.newWindow?.(argv);
    if (!launch || !(await spawner(launch.command, launch.args))) failed.push(argv);
  }
  return failed;
}
