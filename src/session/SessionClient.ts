import type {EventEmitter} from 'node:events';
import type {ShellMarker} from '../shell/ShellProtocol.js';

export interface SessionClientEvents {
  /** PTY output with NMSh protocol markers already removed. */
  data: [string];
  /** A command boundary: the prompt is ready, with the last exit code and cwd. */
  prompt: [ShellMarker];
  /** The managed shell ended. */
  exit: [{exitCode: number; signal?: number}];
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
}

/** State of a live session this frontend attached to rather than created. */
export interface AttachedSession {
  sessionId: string;
  pid: number;
  cwd: string;
  /** Nonzero while the foreground app holds the alternate screen. */
  fullscreen: number;
  running?: string;
  runningSince?: number;
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
  /** Set when the service was unavailable and the shell runs in-process. */
  notice?: string;
}
