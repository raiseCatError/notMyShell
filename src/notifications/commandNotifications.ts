import {spawn, type ChildProcess, type SpawnOptions} from 'node:child_process';
import {accessSync, constants} from 'node:fs';
import {PRODUCT_NAME} from '../config.js';
import type {NotificationSettings} from '../prompt/configuration.js';
import {parseSlashCommand} from '../commands/slashCommands.js';
import {formatDuration} from '../status/commandTiming.js';

/** Terminal focus as learned from focus reports; unknown until the terminal sends one. */
export type TerminalFocus = 'focused' | 'blurred' | 'unknown';

/** A live, real shell command that just finished. Slash commands and restored history never produce one. */
export interface CompletedCommand {
  command: string;
  elapsedMs: number;
  exitCode: number;
  interrupted: boolean;
}

export function commandSucceeded(completed: CompletedCommand): boolean {
  return completed.exitCode === 0 && !completed.interrupted;
}

/** The master filter: settings are the current ones, read when the command completes. */
/** Only a recognized NMSh slash command is internal; an absolute-path shell command is a real command. */
function isInternalCommand(command: string): boolean {
  const parsed = parseSlashCommand(command.trim());
  return parsed !== undefined && parsed.kind !== 'unknown';
}

export function shouldNotify(completed: CompletedCommand, settings: NotificationSettings, focus: TerminalFocus): boolean {
  if (!settings.enabled || isInternalCommand(completed.command) || !Number.isFinite(completed.elapsedMs)) return false;
  if (completed.elapsedMs < settings.thresholdSeconds * 1000) return false;
  const success = commandSucceeded(completed);
  if (success && !settings.onSuccess) return false;
  if (!success && !settings.onFailure) return false;
  // Unknown is not definitely focused: terminals without focus reports still notify.
  if (focus === 'focused' && settings.whenFocused === 'suppress') return false;
  return true;
}

export interface CommandNotification {
  title: string;
  subtitle: string;
  body: string;
}

/** Generic body deliberately excludes command text and shell output. */
export function formatCommandNotification(completed: CompletedCommand): CommandNotification {
  const duration = formatDuration(completed.elapsedMs);
  const subtitle = commandSucceeded(completed) ? `Command finished · ${duration}`
    : completed.interrupted ? `Command interrupted · ${duration}`
      : `Command failed · ${duration} · exit ${completed.exitCode}`;
  return {title: PRODUCT_NAME, subtitle, body: 'Your shell command has completed.'};
}

/** What happened to one delivery attempt; for tests and the opt-in debug log, never shell output. */
export type NotificationDelivery =
  | {ok: true}
  | {ok: false; reason: 'unsupported' | 'spawn' | 'exit' | 'timeout'; exitCode?: number | null; message?: string};

/** Best-effort delivery; implementations never throw, never block, and never write to the terminal. */
export interface NotificationService {
  readonly supported: boolean;
  notify(notification: CommandNotification): Promise<NotificationDelivery>;
}

export type SpawnFunction = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export const OSASCRIPT_PATH = '/usr/bin/osascript';

/**
 * Strings arrive only as argv, never inside the script source. The title comes
 * first so osascript stops option parsing before any command text that begins
 * with a dash.
 */
const NOTIFICATION_SCRIPT = [
  'on run argv',
  'display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)',
  'end run',
];

export function osascriptArguments(notification: CommandNotification): string[] {
  return [...NOTIFICATION_SCRIPT.flatMap(line => ['-e', line]), notification.title, notification.subtitle, notification.body];
}

const STDERR_LIMIT = 2048;
export const OSASCRIPT_TIMEOUT_MS = 10_000;

/**
 * An ordinary attached child: osascript lives for well under a second, so it
 * is neither detached nor unref'd, and its exit status and stderr are kept.
 */
export class MacNotificationService implements NotificationService {
  readonly supported = true;

  constructor(protected readonly spawnProcess: SpawnFunction = spawn) {}

  protected command(notification: CommandNotification): [string, string[]] {
    return [OSASCRIPT_PATH, osascriptArguments(notification)];
  }

  notify(notification: CommandNotification): Promise<NotificationDelivery> {
    return new Promise(resolve => {
      let child: ChildProcess;
      try {
        const [command, args] = this.command(notification);
        child = this.spawnProcess(command, args,
          {shell: false, stdio: ['ignore', 'ignore', 'pipe'], timeout: OSASCRIPT_TIMEOUT_MS});
      } catch (error) {
        resolve({ok: false, reason: 'spawn', message: String(error)});
        return;
      }
      let stderr = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => { if (stderr.length < STDERR_LIMIT) stderr += chunk; });
      child.once('error', error => resolve({ok: false, reason: 'spawn', message: error.message}));
      child.once('close', (code, signal) => {
        if (code === 0) resolve({ok: true});
        else resolve({ok: false, reason: signal === 'SIGTERM' ? 'timeout' : 'exit', exitCode: code,
          message: stderr.trim().slice(0, STDERR_LIMIT) || signal || undefined});
      });
    });
  }
}

/** Freedesktop notifications through notify-send (libnotify); argv only, `--` ends option parsing. */
export function notifySendArguments(notification: CommandNotification): string[] {
  return ['--app-name=NMSh', '--', `${notification.title}: ${notification.subtitle}`, notification.body];
}

export class LinuxNotificationService extends MacNotificationService {
  constructor(private readonly notifySend: string, spawnProcess: SpawnFunction = spawn) { super(spawnProcess); }
  protected override command(notification: CommandNotification): [string, string[]] {
    return [this.notifySend, notifySendArguments(notification)];
  }
}

export class UnsupportedNotificationService implements NotificationService {
  readonly supported = false;
  notify(): Promise<NotificationDelivery> {
    return Promise.resolve({ok: false, reason: 'unsupported'});
  }
}

/**
 * macOS: osascript. Linux (including WSL 2 with WSLg): notify-send when it is
 * installed and a desktop session is reachable; otherwise unsupported. Nothing
 * is installed.
 */
export function createNotificationService(platform: NodeJS.Platform = process.platform, spawnProcess?: SpawnFunction,
  env: NodeJS.ProcessEnv = process.env): NotificationService {
  if (platform === 'darwin') return new MacNotificationService(spawnProcess);
  if (platform === 'linux' && (env.DBUS_SESSION_BUS_ADDRESS || env.WAYLAND_DISPLAY || env.DISPLAY)) {
    const notifySend = (env.PATH ?? '').split(':').filter(dir => dir.startsWith('/')).map(dir => `${dir}/notify-send`).find(path => {
      try { accessSync(path, constants.X_OK); return true; } catch { return false; }
    });
    if (notifySend) return new LinuxNotificationService(notifySend, spawnProcess);
  }
  return new UnsupportedNotificationService();
}
