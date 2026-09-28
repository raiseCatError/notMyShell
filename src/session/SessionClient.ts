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
  submit(command: string): void;
  write(data: string): void;
  interrupt(): void;
  endInput(): void;
  resize(columns: number, rows: number): void;
  /** End the managed shell. */
  kill(): void;
}

export interface SessionOptions {
  cwd: string;
  columns: number;
  rows: number;
}
