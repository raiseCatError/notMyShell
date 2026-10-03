import {hostIntegration, keyboardGuidance, type HostIntegration} from './integration.js';
import {spawn} from 'node:child_process';
import {resolveHostCapabilities, type TerminalCapabilities} from './capabilities.js';

/**
 * The terminal NMSh runs in, and whether NMSh can ask it to open another
 * independent window running a command. NMSh never manages windows itself;
 * hosts without a supported way to do this simply report `newWindow: undefined`.
 */
export interface TerminalHost {
  /** Human-readable name for messages. */
  name: string;
  /** Current frontend attachment, never persistent shell state. */
  capabilities: Readonly<TerminalCapabilities>;
  integration?: HostIntegration;
  keyboardGuidance?: string;
  /** How to open a new window running `argv`, if this host supports it. */
  newWindow?: (argv: readonly string[]) => {command: string; args: string[]};
}

/** Quote one argument for a POSIX shell. */
export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/u.test(value) ? value : `'${value.replace(/'/gu, `'\\''`)}'`;
}

const appleScriptString = (value: string) => `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;

/**
 * Fixed script for Ghostty on macOS: builds a shell command from its argv with
 * `quoted form of` (POSIX quoting) and opens a window running it in the
 * running Ghostty instance. Fails (non-zero exit) if AppleScript is disabled,
 * Automation permission is denied, or Ghostty rejects the request.
 */
export const GHOSTTY_NEW_WINDOW_SCRIPT = [
  'on run argv',
  'set commandLine to ""',
  'repeat with word_ in argv',
  'set commandLine to commandLine & quoted form of (word_ as text) & " "',
  'end repeat',
  'tell application "Ghostty"',
  'set cfg to new surface configuration',
  'set command of cfg to commandLine',
  'new window with configuration cfg',
  'end tell',
  'end run',
] as const;

export function detectTerminalHost(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): TerminalHost {
  const program = env.TERM_PROGRAM ?? '';
  const capabilities = resolveHostCapabilities(env);
  const integration = hostIntegration(env);
  const guidance = keyboardGuidance(env);
  if (program === 'ghostty' || env.GHOSTTY_RESOURCES_DIR) {
    return {capabilities, integration, keyboardGuidance: guidance, name: 'Ghostty', newWindow: argv => platform === 'darwin'
      // Ghostty's AppleScript API opens a normal window in the running app. The
      // command words arrive as osascript argv, never inside the script text.
      ? {command: 'osascript', args: [...GHOSTTY_NEW_WINDOW_SCRIPT.flatMap(line => ['-e', line]), ...argv]}
      : {command: 'ghostty', args: ['-e', ...argv]}};
  }
  if (program === 'Apple_Terminal' && platform === 'darwin') {
    return {capabilities, integration, keyboardGuidance: guidance, name: 'Terminal', newWindow: argv => ({command: 'osascript', args: ['-e',
      `tell application "Terminal" to do script ${appleScriptString(argv.map(shellQuote).join(' '))}`]})};
  }
  if (env.KITTY_WINDOW_ID) {
    // Needs kitty remote control (allow_remote_control); failure falls back like any unsupported host.
    return {capabilities, integration, keyboardGuidance: guidance, name: 'kitty', newWindow: argv => ({command: 'kitten', args: ['@', 'launch', '--type=os-window', ...argv]})};
  }
  if (program === 'vscode') return {capabilities, integration, keyboardGuidance: guidance, name: 'VS Code'};
  if (program === 'zed' || env.ZED_TERM) return {capabilities, integration, keyboardGuidance: guidance, name: 'Zed'};
  return {capabilities, integration, keyboardGuidance: guidance, name: program || 'this terminal'};
}

export type Spawner = (command: string, args: string[], timeoutMs?: number) => Promise<boolean>;

/** How long a window launcher may take before its window is treated as not opened. */
export const LAUNCH_TIMEOUT_MS = 15_000;

/**
 * Run the launcher and resolve whether it exited cleanly. The child stays
 * referenced while it is awaited: an unref'd child does not keep the event
 * loop alive, so startup, which is waiting on it with stdin paused, would end
 * the process with its top-level await unsettled. A launcher that hangs (for
 * example on a macOS Automation prompt) counts as failed after the timeout,
 * so startup continues and names the session's attach command instead.
 */
export const spawnLauncher: Spawner = (command, args, timeoutMs = LAUNCH_TIMEOUT_MS) => new Promise(resolve => {
  let settled = false;
  const finish = (ok: boolean) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(ok);
  };
  const timer = setTimeout(() => {
    finish(false);
    // Leave a slow launcher running on its own; it no longer holds up NMSh.
    child?.unref();
  }, timeoutMs);
  let child: ReturnType<typeof spawn> | undefined;
  try {
    child = spawn(command, args, {stdio: 'ignore', detached: true});
    child.once('error', () => finish(false));
    child.once('exit', code => finish(code === 0));
  } catch {
    finish(false);
  }
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
