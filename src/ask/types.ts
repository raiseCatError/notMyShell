import type {ParsedSlashCommand} from '../commands/slashCommands.js';
import type {ShellId} from '../shell/adapters/ShellAdapter.js';
import type {GitFacts} from './git.js';

/**
 * Ask: plain-English requests resolved to NMSh's own typed capabilities.
 * Nothing here executes text: every executable outcome is an AskAction whose
 * handler is an existing NMSh implementation, and read-only commands are
 * built from fixed argv by NMSh, never taken from the request or a model.
 */

/** How much authority a capability needs; it decides confirmation and whether Ask may act at all. */
export type SafetyClass = 'answer' | 'navigate' | 'read' | 'mutate' | 'install' | 'refused';

export type CapabilityId =
  | 'shell.current' | 'shell.switch' | 'shell.leave' | 'shell.default' | 'shell.install'
  | 'session.list' | 'session.resume' | 'transcript.find' | 'transcript.filter'
  | 'file.open' | 'editor.status'
  | 'git.status' | 'git.diff' | 'git.branch' | 'git.log' | 'git.worktrees'
  | 'settings.open' | 'theme.open' | 'prompt.open' | 'tools.open' | 'screensaver.open' | 'providers.open'
  | 'provider.status' | 'provider.switch' | 'understanding.set'
  | 'help.capabilities' | 'help.command' | 'help.feature' | 'feature.open';

/** Fixed read-only commands. The argv is built by NMSh; the request contributes at most a factual path. */
export type ReadCommand =
  | {id: 'git.status'; cwd?: string}
  | {id: 'git.diff'; cwd?: string; staged?: boolean}
  | {id: 'git.log'; cwd?: string};

export type AskAction =
  | {kind: 'slash'; slash: ParsedSlashCommand; label: string}
  | {kind: 'switchShell'; shell: ShellId}
  | {kind: 'installShell'; shell: ShellId}
  | {kind: 'openFile'; path: string}
  | {kind: 'read'; command: ReadCommand}
  | {kind: 'resumeTranscript'; id: string}
  | {kind: 'attachSession'; id: string}
  /** A Git command NMSh built from facts (never request or model text); the allowlist and risk are checked again before it runs. */
  | {kind: 'git'; argv: string[]; risk: 'read' | 'mutate'}
  /** A curated tool install (the /tools recipe, shown exactly before the Yes); never a guessed package. */
  | {kind: 'installTool'; tool: string; label: string}
  | {kind: 'setting'; setting: 'suggestions' | 'history' | 'welcome' | 'picker' | 'navigation' | 'prompt' | 'localUnderstanding' | 'shellBackend'; value: string; label: string};

/**
 * How much an action changes, which decides what Ask may do with it:
 * informational and read run when asked; navigate (what NMSh shows) runs when
 * asked; configure, mutate and install always need the one final Yes/No for
 * the exact action shown; destructive is never run by Ask (Copy/Insert only).
 * There is no lasting approval of any kind.
 */
export type ActionRisk = 'informational' | 'read' | 'navigate' | 'configure' | 'mutate' | 'destructive' | 'install';

/**
 * A command Ask shows, held as structured argv and rendered with the active
 * shell's quoting. Values come from facts (current branch, real remotes,
 * listed files) or are explicit placeholders like <remote>; nothing is free
 * text from the request or a model. Copy and Insert never execute; Run exists
 * only when `run` is a typed NMSh action Ask's policy allows.
 */
export interface CommandBlock {
  argv: string[];
  /** Indices of argv that are placeholders, never filled by guessing. */
  placeholders?: number[];
  provenance: 'reference' | 'context';
  risk: ActionRisk;
  /** One line under the command: what it does here. */
  note?: string;
  /** The facts used to fill it, shown compactly so stale assumptions are visible. */
  facts?: Array<[string, string]>;
  run?: AskAction;
  /** Text the person themselves ran, shown verbatim: Copy/Insert only, never Run. */
  literal?: string;
}

/**
 * What this Ask conversation is currently about, so "them", "that command"
 * and "this branch" keep their meaning between turns. Bounded, per
 * interaction, never persisted, and never model reasoning.
 */
export interface AskReferents {
  concept?: string;
  /** The command path the conversation is about, e.g. ['git', 'push']. */
  command?: string[];
  files?: {paths: string[]; kind: 'untracked' | 'modified' | 'staged' | 'conflicted' | 'mentioned'};
  branch?: string;
  remote?: string;
  /** The command block most recently shown. */
  block?: CommandBlock;
}

export interface AskOption {
  label: string;
  detail?: string;
  /** A stable key, so a rejected interpretation is not offered again in this interaction. */
  key: string;
  /** What choosing this option means: a ready outcome, or text that refines the request. */
  outcome?: AskOutcome;
  refine?: string;
}

/**
 * Structured results. Uncertain is not unsupported: each case is its own kind.
 * - proposal: understood and supported; may need confirmation.
 * - answer: understood; nothing to execute.
 * - choose: several plausible interpretations (ambiguous) or a missing argument (missing).
 * - unsupported: understood, but NMSh has no such capability.
 * - unsafe: understood, but Ask's safety policy refuses it.
 * - unclear: not enough to go on; ask for more, with factual categories.
 */
export type AskOutcome =
  | {kind: 'proposal'; capability: CapabilityId; safety: SafetyClass; text: string; action: AskAction; command?: string; confidence: number}
  | {kind: 'answer'; capability: CapabilityId; text: string; follow?: AskOption; block?: CommandBlock; next?: AskOption[]; referents?: AskReferents}
  | {kind: 'choose'; reason: 'ambiguous' | 'missing'; capability?: CapabilityId; question: string; options: AskOption[]}
  | {kind: 'unsupported'; text: string; alternative?: AskOption}
  | {kind: 'unsafe'; text: string; alternative?: AskOption; referents?: AskReferents}
  | {kind: 'unclear'; text: string; categories: AskOption[]};

export interface RecentCommand {
  command: string;
  cwd?: string;
  branch?: string;
  exitCode: number;
  durationMs?: number;
  /** Output line count (the output itself is never given to Ask). */
  lines: number;
}

export interface AskSession {id: string; state: 'attached' | 'detached'; current: boolean; cwd: string; shell?: string; running?: string; createdAt: number}
export interface AskTranscript {id: string; createdAt: string; startCwd: string; finalCwd: string; project: string; commandCount: number; live?: boolean}
export interface AskWorktree {path: string; branch?: string; current: boolean}
export interface AskProvider {family: string; id: string; label: string; active: boolean; available: boolean}

/**
 * Bounded facts Ask may use. Built from existing NMSh services; no
 * environment, file contents or command output beyond these facts.
 */
export interface AskContext {
  cwd: string;
  home: string;
  repoRoot?: string;
  branch?: string;
  dirty?: boolean;
  worktrees: AskWorktree[];
  shell: ShellId;
  defaultShell: ShellId;
  shells: Array<{id: ShellId; label: string; installed: boolean; installable: boolean}>;
  sessions: AskSession[];
  transcripts: AskTranscript[];
  /** File references NMSh already extracted from recent output, newest first. */
  recentFiles: string[];
  /** Recent submitted commands (program word and short text only). */
  recentCommands: string[];
  editor: {label: string; available: boolean; reason?: string};
  providers: AskProvider[];
  sessionMode: 'service' | 'in-process';
  now: number;
  /** Bounded project file list (relative paths), filled lazily by the file resolver. */
  files?: readonly string[];
  /** What this conversation is about so far (see AskReferents). */
  referents?: AskReferents;
  /** Local Git facts, gathered only for requests that need them. */
  git?: GitFacts;
  /** Recent completed shell commands, newest first: factual metadata, never their output. */
  recent?: RecentCommand[];
}
