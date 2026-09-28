import type {EventEmitter} from 'node:events';
import type {ShellMarker} from '../shell/ShellProtocol.js';
import type {TranscriptSession} from '../sessions/TranscriptStore.js';

/** Position of an event in a service session's stream, when it has one. */
export interface StreamStamp {
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
}

/** State of a live session this frontend attached to rather than created. */
export interface AttachedSession {
  sessionId: string;
  pid: number;
  cwd: string;
  /** Nonzero while the foreground app holds the alternate screen. */
  fullscreen: number;
  /** Terminal input modes the fullscreen app set (mouse, bracketed paste, ...), to restore on reattach. */
  modes?: string;
  running?: string;
  runningSince?: number;
  /** Journal the previous frontend kept for this session, and how far it got. */
  journalId?: string;
  ackedSeq: number;
}

export interface SessionOptions {
  cwd: string;
  columns: number;
  rows: number;
}

/** Exported into the managed shell so users can see which mode owns it. */
export const SESSION_MODE_ENV = 'NMSH_SESSION_MODE';

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
}
