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

/** Best-effort delivery; implementations never throw and never write to the terminal. */
export interface NotificationService {
  readonly supported: boolean;
  notify(notification: CommandNotification): void;
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

export class MacNotificationService implements NotificationService {
  readonly supported = true;

  constructor(private readonly spawnProcess: SpawnFunction = spawn) {}

  notify(notification: CommandNotification): void {
    try {
      const child = this.spawnProcess(OSASCRIPT_PATH, osascriptArguments(notification),
        {shell: false, stdio: 'ignore', timeout: 10_000});
      child.on('error', () => { /* Missing osascript or denied permission: delivery is best-effort. */ });
      child.unref();
    } catch {
      // Spawn failures never reach the command lifecycle.
    }
  }
}

export class UnsupportedNotificationService implements NotificationService {
  readonly supported = false;
  notify(): void { /* Native notifications are only implemented for macOS. */ }
}

export function createNotificationService(platform: NodeJS.Platform = process.platform, spawnProcess?: SpawnFunction): NotificationService {
  return platform === 'darwin' ? new MacNotificationService(spawnProcess) : new UnsupportedNotificationService();
}
