import type {CompletionSource} from '../completion.js';
import type {CommandEntry} from '../../suggestions/types.js';

/**
 * The boundary between NMSh and one concrete interactive shell.
 *
 * Derived from what zsh, Fish and Bash actually need, not from a theoretical
 * superset. Every adapter runs a real, persistent interactive shell in a PTY
 * and reports its lifecycle with the same authenticated marker grammar:
 *
 *   OSC 777 ; nmsh ; <token> ; <status> ; <cwd> BEL          command finished / ready
 *   OSC 777 ; nmsh ; <token> ; exec2 ; <0|1> ; <command> BEL a command line is about to run
 *
 * How each shell produces those markers is its own business (zsh hooks, Fish
 * events, Bash PROMPT_COMMAND/PS0). Nothing above this layer knows which shell
 * it is talking to except for labels and declared capabilities.
 */

export type ShellId = 'zsh' | 'fish' | 'bash';
export const SHELL_IDS: readonly ShellId[] = ['zsh', 'fish', 'bash'];

export function isShellId(value: unknown): value is ShellId {
  return typeof value === 'string' && (SHELL_IDS as readonly string[]).includes(value);
}

export interface LaunchContext {
  /** The user's home, whose startup files the shell should load. */
  home: string;
  env: NodeJS.ProcessEnv;
  /** Per-session secret authenticating lifecycle markers. */
  token: string;
  /** Private per-session directory for bootstrap files; removed when the shell ends. */
  stateDir: string;
  /** Where the shell writes its bounded name snapshot each cycle. */
  knowledgePath: string;
  /** NMSh Theme Bridge environment file for this shell syntax, applied from the prompt hook when present. */
  bridgeEnvPath?: string;
}

export interface ShellLaunch {
  executable: string;
  args: string[];
  /** Added to the session environment (never logged). */
  env: Record<string, string>;
}

/** What a backend can honestly provide. The frontend degrades on absent capabilities instead of faking them. */
export interface ShellCapabilities {
  /** completion: rich (descriptions, configured definitions), basic (names only), none. */
  completion: 'rich' | 'basic' | 'none';
  completionDescriptions: boolean;
  /** Alias/function/builtin names from the live session. */
  liveNames: boolean;
  /** The shell's own history file can be imported read-only. */
  historyImport: boolean;
  /** How "don't record this command" works in this shell, in plain words. */
  privateHistory: string;
  /** Background/stopped job count is reported, so destructive switches can be refused. */
  jobCount: boolean;
}

export interface ShellAdapter {
  readonly id: ShellId;
  readonly label: string;
  readonly capabilities: ShellCapabilities;
  /** Absolute path of a usable executable, or undefined. Never installs anything. */
  resolveExecutable(env: NodeJS.ProcessEnv): string | undefined;
  /** Why this shell cannot be used here, factually (missing, too old). */
  unavailableReason(env: NodeJS.ProcessEnv): string | undefined;
  /** Write bootstrap files into ctx.stateDir and describe the process to spawn. */
  launch(context: LaunchContext): ShellLaunch;
  /**
   * `prompt-to-exec`: the shell's own line editor redraws the command line
   * between its ready marker and the next exec marker (Fish). Those bytes are
   * editor chrome NMSh replaces, not output, and are dropped.
   * `none`: everything after readiness is output (zsh without ZLE, Bash --noediting).
   */
  readonly editorChrome: 'none' | 'prompt-to-exec';
  /**
   * Replies to terminal queries the shell's own editor sends while idle and
   * may wait for (Fish 4 waits for a primary device attributes reply). NMSh is
   * that shell's terminal, so it answers minimally. Undefined: never answer.
   */
  answerQueries?(chrome: string): string;
  /**
   * The queries the shell's own editor sends (global pattern). The editor also runs while the shell itself owns the
   * terminal for a command (Fish's `read` builtin); NMSh answers those there too and they never reach the host, so
   * the editor sees the same terminal at its prompt and in `read`.
   */
  readonly editorQueries?: RegExp;
  /** The mark the shell's editor writes once it has drawn its prompt (see QueryOrder): input waits for it after NMSh answers the editor. */
  readonly editorSettled?: RegExp;
  /**
   * Terminal-mode bytes the shell's own editor emits as it hands the terminal
   * to a command (Fish turns bracketed paste off). They are editor chrome and
   * must not reach the host terminal during passthrough; removed from the start
   * of command output only.
   */
  scrubCommandStart?(data: string): string;
  /** Names the shell treats as builtins, for classification without a helper. */
  readonly builtins: ReadonlySet<string>;
  /** Default history file this shell writes, if any. */
  historyFile(env: NodeJS.ProcessEnv, home: string): string | undefined;
  parseHistory(content: Uint8Array): Promise<CommandEntry[]>;
  /** The completion knowledge source for this shell (runs isolated helpers, never the live session). */
  completionSource(): CompletionSource;
}

/** POSIX single-quote for bootstrap scripts (zsh, Bash). */
export function posixQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

/** Fish single-quote: backslash and quote are the only escapes inside single quotes. */
export function fishQuote(value: string): string {
  return `'${value.replace(/[\\']/gu, match => `\\${match}`)}'`;
}

/** Count of background/stopped jobs from a knowledge snapshot ("jobs N"), when reported. */
export function knowledgeJobCount(knowledge: string | undefined): number | undefined {
  const match = /^jobs (\d{1,6})$/mu.exec(knowledge ?? '');
  return match ? Number(match[1]) : undefined;
}
