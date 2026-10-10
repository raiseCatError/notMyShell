import type {EventEmitter} from 'node:events';
import type {ShellMarker} from '../shell/ShellProtocol.js';
import type {TranscriptSession} from '../sessions/TranscriptStore.js';
import type {ShellId} from '../shell/adapters/ShellAdapter.js';
import type {ServiceFeature} from './SessionProtocol.js';
import type {InputState} from './inputState.js';

/** Position of an event in a service session's stream, when it has one. */
export interface StreamStamp {
  /** Explicit zsh history eligibility; absent from older services. */
  historyAllowed?: number;
  seq?: number;
  /** When the service observed the event (epoch ms). */
  at?: number;
}

export interface SessionClientEvents {
  /** PTY output with NMSh protocol markers already removed. */
  data: [string, StreamStamp];
  /** A command boundary: the prompt is ready, with the last exit code and cwd. */
  prompt: [ShellMarker, StreamStamp];
  /** zsh is about to run a command line (preexec). */
  exec: [string, StreamStamp];
  /** Bounded, sanitized startup output while the shell has not yet reached its first prompt. */
  startup: [string];
  /** Input was not queued or written; the caller can restore it. */
  inputRejected: [data: string, submission: boolean];
  /** The running command's input state changed (see InputWatch); the one source for every input surface. */
  inputState: [InputState];
  /** The backlog sent after a reattach has been delivered. */
  replayed: [{truncatedBytes: number}];
  /** The managed shell ended. */
  /** lost: the connection to the service dropped without the shell's exit being reported. */
  exit: [{exitCode: number; signal?: number; lost?: boolean}];
}

/**
 * Everything TerminalApp does with the shell. Implementations own the PTY and
 * managed zsh (in-process or behind a local service); TerminalApp only sees
 * this boundary.
 */
export interface SessionClient extends EventEmitter<SessionClientEvents> {
  /** Begin delivering events; call once listeners are subscribed. */
  start(): void;
  submit(command: string): void;
  write(data: string): void;
  interrupt(): void;
  endInput(): void;
  resize(columns: number, rows: number): void;
  /** End the managed shell. */
  kill(): void;
  /**
   * The frontend is going away but the shell should not end. A service-backed
   * session keeps running detached; an in-process shell cannot outlive its
   * frontend, so it ends.
   */
  detach(): void;
  /** Stream events up to seq are durable in journalId; the service may drop them. */
  ack(seq: number, journalId: string): void;
  /**
   * Replace the shell backend of this same session, started in cwd. Resolves
   * once the new shell is spawned (its readiness arrives as a normal prompt
   * event); rejects with a factual reason when switching would lose anything.
   */
  switchShell(shell: ShellId, cwd: string): Promise<{shell: ShellId; pid: number}>;
  /** Optional capabilities of whatever owns the shell (the service's welcome, or this build in-process). */
  readonly features: ReadonlySet<ServiceFeature>;
  /** Build of the session service, when it reported one. */
  readonly serviceBuild?: string;
}

/** State of a live session this frontend attached to rather than created. */
export interface AttachedSession {
  sessionId: string;
  pid: number;
  cwd: string;
  /** Nonzero while the foreground app owns the terminal: the alternate screen, or an interactive UI (input modes on). */
  fullscreen: number;
  /** Terminal input modes the fullscreen app set (mouse, bracketed paste, ...), to restore on reattach. */
  modes?: string;
  running?: string;
  runningSince?: number;
  /** Journal the previous frontend kept for this session, and how far it got. */
  journalId?: string;
  ackedSeq: number;
  /** Latest bounded name snapshot, independent of journal acknowledgements. */
  knowledge?: string;
  /** Set only while the shell has not reached its first prompt: its startup output so far. */
  startup?: string;
  /** Backend of the session; absent from older services (zsh). */
  shell?: string;
}

export interface SessionOptions {
  cwd: string;
  columns: number;
  rows: number;
  /** Shell backend for a new session; zsh when absent. */
  shell?: ShellId;
  /** NMSH_SESSION_ID for an in-process shell (service sessions use their session id). */
  contextId?: string;
}

/** Exported into the managed shell so users can see which mode owns it. */
export const SESSION_MODE_ENV = 'NMSH_SESSION_MODE';
/**
 * Exported into the managed shell: which NMSh session a program runs in, so
 * NMSh-owned helpers (the agent status bridge) can report to the right
 * session. A non-secret identifier, never a credential.
 */
export const SESSION_ID_ENV = 'NMSH_SESSION_ID';

export interface SessionConnection {
  client: SessionClient;
  mode: 'service' | 'in-process';
  sessionId?: string;
  /** Present when this connection reattached an existing live session. */
  attached?: AttachedSession;
  /** The previous frontend's journal for the reattached session, when readable. */
  journal?: TranscriptSession;
  /** Set when the service was unavailable and the shell runs in-process. */
  notice?: string;
  /** Backend actually running (an older service may only run zsh). */
  shell?: ShellId;
}
