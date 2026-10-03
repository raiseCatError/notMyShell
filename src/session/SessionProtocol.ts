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

import {NOTICE_KINDS, type SessionNotice} from './SessionNotices.js';

// v2: a frontend going away detaches its session instead of ending it.
export const PROTOCOL_VERSION = 2;
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type ClientMessage =
  | {type: 'hello'; version: number; client: string}
  /** shell: backend id (zsh, fish, bash); absent means zsh (older frontends). */
  | {type: 'create'; cwd: string; env: Record<string, string>; columns: number; rows: number; shell?: string}
  | {type: 'attach'; sessionId: string; columns: number; rows: number}
  | {type: 'detach'}
  | {type: 'list'}
  /** submission=1 identifies a composer submission for rejection recovery; absent for raw input. */
  | {type: 'input'; data: string; submission?: number}
  | {type: 'resize'; columns: number; rows: number}
  /** Everything up to seq is durable in the frontend journal journalId. */
  | {type: 'ack'; seq: number; journalId: string}
  /** End a detached session this connection does not control (Kill Session). */
  | {type: 'kill'; sessionId: string}
  /** Clear a session's cross-session notice everywhere (it was opened/focused). */
  | {type: 'dismiss'; sessionId: string}
  /** Replace this session's shell backend in place, starting it in cwd. Refused while anything would be lost. */
  | {type: 'switch-shell'; shell: string; cwd: string}
  | {type: 'terminate'};

export type ServerMessage =
  /** startupSafety=1 promises pre-ready input isolation, bounded rejection and startup state reporting. */
  | {type: 'welcome'; version: number; service: string; startupSafety?: number}
  | {type: 'error'; code: string; message: string}
  /** shell: the backend actually started (absent from older services: zsh). */
  | {type: 'created'; sessionId: string; pid: number; shell?: string}
  | {type: 'shell-switched'; shell: string; pid: number}
  | {type: 'attached'; sessionId: string; pid: number; cwd: string; fullscreen: number; modes?: string; running?: string; runningSince?: number;
    journalId?: string; ackedSeq: number; knowledge?: string; shell?: string;
    /** Present only while the shell has not reached its first prompt: the sanitized, bounded tail of its startup output. */
    startup?: string}
  /** Startup output of a shell still blocked or slow before its first prompt (bounded, sanitized, coalesced). */
  | {type: 'startup'; output: string}
  | {type: 'input-rejected'; data: string; submission?: number}
  | {type: 'detached'; sessionId: string}
  /** ended: notices for sessions that ended recently (absent from older services). */
  | {type: 'sessions'; sessions: SessionInfo[]; ended?: SessionNotice[]}
  | {type: 'dismissed'; sessionId: string}
  /**
   * Shell stream events carry a per-session sequence number and the time the
   * service observed them, so a reattaching frontend can replay what it
   * missed exactly once with the original timing.
   */
  | {type: 'output'; data: string; seq?: number; at?: number}
  | {type: 'exec'; command: string; seq: number; at: number; historyAllowed?: number}
  | {type: 'prompt'; exitCode: number; cwd: string; knowledge?: string; seq?: number; at?: number}
  /** End of the backlog sent after attach. */
  | {type: 'replayed'; truncatedBytes: number}
  | {type: 'killed'; sessionId: string}
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
  /** When the shell last became idle at its prompt; absent while a command runs. */
  idleSince?: number;
  /** Journal of the session's most recent frontend, as it last acknowledged. */
  journalId?: string;
  // Evidence for /resume status (#174); absent from older services, and unknown stays absent.
  /** Foreground process name while a command runs, when the platform can tell. */
  process?: string;
  /** 1 while the running program holds the alternate screen. */
  fullscreen?: number;
  /** When the session last produced output. */
  lastOutputAt?: number;
  /** Title the running program set for its window (OSC 0/2). */
  title?: string;
  /** When the running program asked for attention (terminal notification or bell) and nobody has typed since. */
  attentionSince?: number;
  /** Exit code of the last finished command, while idle. */
  lastExit?: number;
  /** Shell backend id; absent from older services (zsh). */
  shell?: string;
  /** The session's current cross-session notice, until it is focused (#v0.16; absent from older services). */
  notice?: SessionNotice;
}

export type ProtocolMessage = ClientMessage | ServerMessage;

export type DecodeResult =
  | {ok: true; message: ProtocolMessage}
  | {ok: false; error: string};

export function encodeMessage(message: ProtocolMessage): string {
  return `${JSON.stringify({v: PROTOCOL_VERSION, ...message})}\n`;
}

type Kind = 'string' | 'int' | 'env' | 'int?' | 'string?' | 'sessions' | 'notice?' | 'notices?';
type Shape = Record<string, Kind>;

const SHAPES: Record<string, Shape> = {
  hello: {version: 'int', client: 'string'},
  create: {cwd: 'string', env: 'env', columns: 'int', rows: 'int', shell: 'string?'},
  'switch-shell': {shell: 'string', cwd: 'string'},
  'shell-switched': {shell: 'string', pid: 'int'},
  attach: {sessionId: 'string', columns: 'int', rows: 'int'},
  detach: {},
  list: {},
  input: {data: 'string', submission: 'int?'},
  resize: {columns: 'int', rows: 'int'},
  ack: {seq: 'int', journalId: 'string'},
  kill: {sessionId: 'string'},
  dismiss: {sessionId: 'string'},
  terminate: {},
  welcome: {version: 'int', service: 'string', startupSafety: 'int?'},
  error: {code: 'string', message: 'string'},
  created: {sessionId: 'string', pid: 'int', shell: 'string?'},
  attached: {sessionId: 'string', pid: 'int', cwd: 'string', fullscreen: 'int', modes: 'string?', running: 'string?', runningSince: 'int?',
    journalId: 'string?', ackedSeq: 'int', knowledge: 'string?', startup: 'string?', shell: 'string?'},
  startup: {output: 'string'},
  'input-rejected': {data: 'string', submission: 'int?'},
  detached: {sessionId: 'string'},
  sessions: {sessions: 'sessions', ended: 'notices?'},
  dismissed: {sessionId: 'string'},
  output: {data: 'string', seq: 'int?', at: 'int?'},
  exec: {command: 'string', seq: 'int', at: 'int', historyAllowed: 'int?'},
  prompt: {exitCode: 'int', cwd: 'string', knowledge: 'string?', seq: 'int?', at: 'int?'},
  replayed: {truncatedBytes: 'int'},
  killed: {sessionId: 'string'},
  exit: {exitCode: 'int', signal: 'int?'},
};

function isEnv(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(entry => typeof entry === 'string');
}

const INFO_SHAPE: Shape = {id: 'string', pid: 'int', state: 'string', cwd: 'string', createdAt: 'int',
  running: 'string?', runningSince: 'int?', idleSince: 'int?', journalId: 'string?',
  process: 'string?', fullscreen: 'int?', lastOutputAt: 'int?', title: 'string?', attentionSince: 'int?', lastExit: 'int?', notice: 'notice?', shell: 'string?'};

const NOTICE_SHAPE: Shape = {sessionId: 'string', kind: 'string', at: 'int', program: 'string?', agent: 'string?', exitCode: 'int?',
  durationMs: 'int?', cwd: 'string?'};

function decodeNotice(raw: unknown): SessionNotice | undefined {
  const decoded = decodeShape(NOTICE_SHAPE, raw) as SessionNotice | undefined;
  return decoded && (NOTICE_KINDS as readonly string[]).includes(decoded.kind) ? decoded : undefined;
}

function validField(kind: Kind, value: unknown): boolean {
  switch (kind) {
    case 'string': return typeof value === 'string';
    case 'env': return isEnv(value);
    case 'sessions': return Array.isArray(value) && value.every(entry => decodeShape(INFO_SHAPE, entry) !== undefined
      && ((entry as SessionInfo).state === 'attached' || (entry as SessionInfo).state === 'detached'));
    case 'notice?': return decodeNotice(value) !== undefined;
    case 'notices?': return Array.isArray(value) && value.length <= 64 && value.every(entry => decodeNotice(entry) !== undefined);
    default: return Number.isSafeInteger(value);
  }
}

function decodeShape(shape: Shape, raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const decoded: Record<string, unknown> = {};
  for (const [field, kind] of Object.entries(shape)) {
    const value = record[field];
    if ((kind === 'int?' || kind === 'string?' || kind === 'notice?' || kind === 'notices?') && value === undefined) continue;
    if (!validField(kind === 'string?' ? 'string' : kind, value)) return undefined;
    decoded[field] = kind === 'env' ? {...(value as Record<string, string>)}
      : kind === 'sessions' ? (value as unknown[]).map(entry => decodeShape(INFO_SHAPE, entry))
        : kind === 'notice?' ? decodeNotice(value) : kind === 'notices?' ? (value as unknown[]).map(decodeNotice) : value;
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
