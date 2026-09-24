import {spawn, type ChildProcess, type SpawnOptions} from 'node:child_process';
import {PRODUCT_NAME} from '../config.js';
import type {NotificationSettings} from '../prompt/configuration.js';
import {formatDuration} from '../status/commandTiming.js';
import {stripAnsi} from '../util/text.js';

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
export function shouldNotify(completed: CompletedCommand, settings: NotificationSettings, focus: TerminalFocus): boolean {
  if (!settings.enabled) return false;
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

export const COMMAND_SUMMARY_MAX = 80;

/** One bounded line of the submitted command: no ANSI, controls, or newlines, never output. */
export function summarizeCommand(command: string, maxLength = COMMAND_SUMMARY_MAX): string {
  const flat = stripAnsi(command).replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  const characters = Array.from(flat);
  return characters.length <= maxLength ? flat : `${characters.slice(0, maxLength - 1).join('').trimEnd()}…`;
}

export function formatCommandNotification(completed: CompletedCommand): CommandNotification {
  const duration = formatDuration(completed.elapsedMs);
  const subtitle = commandSucceeded(completed) ? `Command finished · ${duration}`
    : completed.interrupted ? `Command interrupted · ${duration}`
      : `Command failed · ${duration} · exit ${completed.exitCode}`;
  return {title: PRODUCT_NAME, subtitle, body: summarizeCommand(completed.command)};
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

  constructor(private readonly spawnProcess: SpawnFunction = spawn) {}

  notify(notification: CommandNotification): Promise<NotificationDelivery> {
    return new Promise(resolve => {
      let child: ChildProcess;
      try {
        child = this.spawnProcess(OSASCRIPT_PATH, osascriptArguments(notification),
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

export class UnsupportedNotificationService implements NotificationService {
  readonly supported = false;
  notify(): Promise<NotificationDelivery> {
    return Promise.resolve({ok: false, reason: 'unsupported'});
  }
}

export function createNotificationService(platform: NodeJS.Platform = process.platform, spawnProcess?: SpawnFunction): NotificationService {
  return platform === 'darwin' ? new MacNotificationService(spawnProcess) : new UnsupportedNotificationService();
}
