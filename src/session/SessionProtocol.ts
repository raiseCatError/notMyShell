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

export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type ClientMessage =
  | {type: 'hello'; version: number; client: string}
  | {type: 'create'; cwd: string; env: Record<string, string>; columns: number; rows: number}
  | {type: 'attach'; sessionId: string}
  | {type: 'detach'; sessionId: string}
  | {type: 'input'; data: string}
  | {type: 'resize'; columns: number; rows: number}
  | {type: 'terminate'};

export type ServerMessage =
  | {type: 'welcome'; version: number; service: string}
  | {type: 'error'; code: string; message: string}
  | {type: 'created'; sessionId: string; pid: number}
  | {type: 'attached'; sessionId: string}
  | {type: 'detached'; sessionId: string}
  | {type: 'output'; data: string}
  | {type: 'prompt'; exitCode: number; cwd: string}
  | {type: 'exit'; exitCode: number; signal?: number};

export type ProtocolMessage = ClientMessage | ServerMessage;

export type DecodeResult =
  | {ok: true; message: ProtocolMessage}
  | {ok: false; error: string};

export function encodeMessage(message: ProtocolMessage): string {
  return `${JSON.stringify({v: PROTOCOL_VERSION, ...message})}\n`;
}

type Shape = Record<string, 'string' | 'int' | 'env' | 'int?'>;

const SHAPES: Record<string, Shape> = {
  hello: {version: 'int', client: 'string'},
  create: {cwd: 'string', env: 'env', columns: 'int', rows: 'int'},
  attach: {sessionId: 'string'},
  detach: {sessionId: 'string'},
  input: {data: 'string'},
  resize: {columns: 'int', rows: 'int'},
  terminate: {},
  welcome: {version: 'int', service: 'string'},
  error: {code: 'string', message: 'string'},
  created: {sessionId: 'string', pid: 'int'},
  attached: {sessionId: 'string'},
  detached: {sessionId: 'string'},
  output: {data: 'string'},
  prompt: {exitCode: 'int', cwd: 'string'},
  exit: {exitCode: 'int', signal: 'int?'},
};

function isEnv(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(entry => typeof entry === 'string');
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
  const shape = SHAPES[type]!;
  const message: Record<string, unknown> = {type};
  for (const [field, kind] of Object.entries(shape)) {
    const value = record[field];
    if (kind === 'int?' && value === undefined) continue;
    const valid = kind === 'string' ? typeof value === 'string'
      : kind === 'env' ? isEnv(value)
      : Number.isSafeInteger(value);
    if (!valid) return {ok: false, error: `invalid field ${field} for ${type}`};
    message[field] = kind === 'env' ? {...(value as Record<string, string>)} : value;
  }
  return {ok: true, message: message as ProtocolMessage};
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
