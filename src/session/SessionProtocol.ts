/**
 * Versioned wire protocol between an NMSh frontend and whatever owns the
 * PTY + managed zsh (in-process today, a local session service later).
 *
 * Framing is newline-delimited JSON: JSON string escaping turns every control
 * byte (including `\n` and ESC) into an escape sequence, so a raw newline can
 * only ever be a frame separator. Decoding never hydrates arbitrary objects:
 * each message type is validated field by field and anything unexpected is
 * rejected instead of partially applied.
 */

// v2: a frontend going away detaches its session instead of ending it.
export const PROTOCOL_VERSION = 2;
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type ClientMessage =
  | {type: 'hello'; version: number; client: string}
  | {type: 'create'; cwd: string; env: Record<string, string>; columns: number; rows: number}
  | {type: 'attach'; sessionId: string; columns: number; rows: number}
  | {type: 'detach'}
  | {type: 'list'}
  | {type: 'input'; data: string}
  | {type: 'resize'; columns: number; rows: number}
  | {type: 'terminate'};

export type ServerMessage =
  | {type: 'welcome'; version: number; service: string}
  | {type: 'error'; code: string; message: string}
  | {type: 'created'; sessionId: string; pid: number}
  | {type: 'attached'; sessionId: string; pid: number; cwd: string; fullscreen: number; running?: string; runningSince?: number}
  | {type: 'detached'; sessionId: string}
  | {type: 'sessions'; sessions: SessionInfo[]}
  | {type: 'output'; data: string}
  | {type: 'prompt'; exitCode: number; cwd: string}
  | {type: 'exit'; exitCode: number; signal?: number};

/** Lifecycle of a live session. Ended sessions leave the registry entirely. */
export type SessionState = 'attached' | 'detached';

/** What the service reports about a live session; never its environment. */
export interface SessionInfo {
  id: string;
  pid: number;
  state: SessionState;
  cwd: string;
  createdAt: number;
  /** Foreground command line reported by zsh preexec, while one runs. */
  running?: string;
  runningSince?: number;
}

export type ProtocolMessage = ClientMessage | ServerMessage;

export type DecodeResult =
  | {ok: true; message: ProtocolMessage}
  | {ok: false; error: string};

export function encodeMessage(message: ProtocolMessage): string {
  return `${JSON.stringify({v: PROTOCOL_VERSION, ...message})}\n`;
}

type Kind = 'string' | 'int' | 'env' | 'int?' | 'string?' | 'sessions';
type Shape = Record<string, Kind>;

const SHAPES: Record<string, Shape> = {
  hello: {version: 'int', client: 'string'},
  create: {cwd: 'string', env: 'env', columns: 'int', rows: 'int'},
  attach: {sessionId: 'string', columns: 'int', rows: 'int'},
  detach: {},
  list: {},
  input: {data: 'string'},
  resize: {columns: 'int', rows: 'int'},
  terminate: {},
  welcome: {version: 'int', service: 'string'},
  error: {code: 'string', message: 'string'},
  created: {sessionId: 'string', pid: 'int'},
  attached: {sessionId: 'string', pid: 'int', cwd: 'string', fullscreen: 'int', running: 'string?', runningSince: 'int?'},
  detached: {sessionId: 'string'},
  sessions: {sessions: 'sessions'},
  output: {data: 'string'},
  prompt: {exitCode: 'int', cwd: 'string'},
  exit: {exitCode: 'int', signal: 'int?'},
};

function isEnv(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(entry => typeof entry === 'string');
}

const INFO_SHAPE: Shape = {id: 'string', pid: 'int', state: 'string', cwd: 'string', createdAt: 'int',
  running: 'string?', runningSince: 'int?'};

function validField(kind: Kind, value: unknown): boolean {
  switch (kind) {
    case 'string': return typeof value === 'string';
    case 'env': return isEnv(value);
    case 'sessions': return Array.isArray(value) && value.every(entry => decodeShape(INFO_SHAPE, entry) !== undefined
      && ((entry as SessionInfo).state === 'attached' || (entry as SessionInfo).state === 'detached'));
    default: return Number.isSafeInteger(value);
  }
}

function decodeShape(shape: Shape, raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const decoded: Record<string, unknown> = {};
  for (const [field, kind] of Object.entries(shape)) {
    const value = record[field];
    if ((kind === 'int?' || kind === 'string?') && value === undefined) continue;
    if (!validField(kind === 'string?' ? 'string' : kind, value)) return undefined;
    decoded[field] = kind === 'env' ? {...(value as Record<string, string>)}
      : kind === 'sessions' ? (value as unknown[]).map(entry => decodeShape(INFO_SHAPE, entry)) : value;
  }
  return decoded;
}

/** Decode one frame (without its trailing newline). */
export function decodeMessage(frame: string): DecodeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(frame);
  } catch {
    return {ok: false, error: 'malformed frame'};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {ok: false, error: 'frame is not an object'};
  const record = raw as Record<string, unknown>;
  if (record.v !== PROTOCOL_VERSION) return {ok: false, error: `unsupported protocol version ${String(record.v)}`};
  const type = record.type;
  if (typeof type !== 'string' || !Object.hasOwn(SHAPES, type)) return {ok: false, error: `unknown message type ${String(type)}`};
  const fields = decodeShape(SHAPES[type]!, record);
  if (!fields) return {ok: false, error: `invalid fields for ${type}`};
  return {ok: true, message: {type, ...fields} as ProtocolMessage};
}

/**
 * Reassembles frames from an arbitrary chunking of the byte stream: one read
 * may carry a fragment, a whole frame, or several frames.
 */
export class FrameDecoder {
  private buffered = '';

  push(chunk: string): DecodeResult[] {
    this.buffered += chunk;
    const results: DecodeResult[] = [];
    let newline: number;
    while ((newline = this.buffered.indexOf('\n')) !== -1) {
      const frame = this.buffered.slice(0, newline);
      this.buffered = this.buffered.slice(newline + 1);
      if (frame.length > 0) results.push(decodeMessage(frame));
    }
    if (this.buffered.length > MAX_FRAME_BYTES) {
      this.buffered = '';
      results.push({ok: false, error: 'frame too large'});
    }
    return results;
  }
}
