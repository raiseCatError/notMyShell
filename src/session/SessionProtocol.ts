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
import {INPUT_CONFIDENCES, INPUT_MODES, type InputState} from './inputState.js';

// v2: a frontend going away detaches its session instead of ending it.
export const PROTOCOL_VERSION = 2;
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/**
 * Optional capabilities negotiated in the welcome. A frontend sends a feature's
 * messages only when the connected service advertised it, so a newer frontend
 * talking to an older service (same protocol version, still running its live
 * sessions) degrades factually instead of failing later.
 */
export const SERVICE_FEATURES = ['shell-switch', 'shell-backends', 'notices', 'input-state'] as const;
export type ServiceFeature = typeof SERVICE_FEATURES[number];

/**
 * What a frontend understands beyond the base protocol, sent in its hello. A service sends a feature's messages or
 * values (the input-state message, the "input" notice kind) only to a frontend that listed it, so an older frontend
 * attached to a newer service never receives a frame it would reject.
 */
export const CLIENT_FEATURES = ['input-state'] as const;
export type ClientFeature = typeof CLIENT_FEATURES[number];

export function parseClientFeatures(text: string | undefined): Set<ClientFeature> {
  return new Set((text ?? '').split(',').map(item => item.trim()).filter((item): item is ClientFeature => (CLIENT_FEATURES as readonly string[]).includes(item)));
}

export function parseFeatures(text: string | undefined): Set<ServiceFeature> {
  return new Set((text ?? '').split(',').map(item => item.trim()).filter((item): item is ServiceFeature => (SERVICE_FEATURES as readonly string[]).includes(item)));
}

export type ClientMessage =
  /** features: comma-separated CLIENT_FEATURES this frontend understands; absent from older frontends. */
  | {type: 'hello'; version: number; client: string; features?: string}
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
  /** Rename a live session (display only; its id never changes). An empty name returns to its signature. */
  | {type: 'rename'; sessionId: string; name: string}
  | {type: 'terminate'};

export type ServerMessage =
  /** startupSafety=1 promises pre-ready input isolation, bounded rejection and startup state reporting. */
  /**
   * features: comma-separated capabilities this service implements beyond the
   * base protocol (see SERVICE_FEATURES); absent from older services, which
   * therefore have none. build: the service's build identity, informational.
   */
  | {type: 'welcome'; version: number; service: string; startupSafety?: number; features?: string; build?: string}
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
  | {type: 'prompt'; exitCode: number; cwd: string; knowledge?: string; seq?: number; at?: number; inputWaitMs?: number; inputWaits?: number}
  /**
   * The running command's input state (see InputWatch), sent on every change to frontends that support it: a
   * request (since/confidence/mode, with the open prompt and program when known) or none, plus waiting time so far.
   */
  | {type: 'input-state'; since?: number; confidence?: string; mode?: string; prompt?: string; program?: string; waitedMs: number; waits: number}
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
  /** Familiar signature name, assigned once by the service (absent from older services). */
  signature?: string;
  /** The person's own name for the session, when renamed. */
  name?: string;
  /** The session's current cross-session notice, until it is focused (#v0.16; absent from older services). */
  notice?: SessionNotice;
  /** While the running command credibly waits for input: since when, how sure, how it reads, and the prompt shown. */
  inputSince?: number;
  inputConfidence?: string;
  inputMode?: string;
  inputPrompt?: string;
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
  hello: {version: 'int', client: 'string', features: 'string?'},
  create: {cwd: 'string', env: 'env', columns: 'int', rows: 'int', shell: 'string?'},
  'switch-shell': {shell: 'string', cwd: 'string'},
  rename: {sessionId: 'string', name: 'string'},
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
  welcome: {version: 'int', service: 'string', startupSafety: 'int?', features: 'string?', build: 'string?'},
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
  prompt: {exitCode: 'int', cwd: 'string', knowledge: 'string?', seq: 'int?', at: 'int?', inputWaitMs: 'int?', inputWaits: 'int?'},
  'input-state': {since: 'int?', confidence: 'string?', mode: 'string?', prompt: 'string?', program: 'string?', waitedMs: 'int', waits: 'int'},
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
  process: 'string?', fullscreen: 'int?', lastOutputAt: 'int?', title: 'string?', attentionSince: 'int?', lastExit: 'int?', notice: 'notice?', shell: 'string?', signature: 'string?', name: 'string?',
  inputSince: 'int?', inputConfidence: 'string?', inputMode: 'string?', inputPrompt: 'string?'};

const NOTICE_SHAPE: Shape = {sessionId: 'string', kind: 'string', at: 'int', program: 'string?', agent: 'string?', exitCode: 'int?',
  durationMs: 'int?', cwd: 'string?', confidence: 'string?'};

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

/** The input-state message for a state; bounded prompt text. */
export function inputStateMessage(state: InputState): Extract<ServerMessage, {type: 'input-state'}> {
  const request = state.request;
  return {type: 'input-state', waitedMs: Math.round(state.timing.waitedMs), waits: state.timing.waits,
    ...(request ? {since: request.since, confidence: request.confidence, mode: request.mode,
      ...(request.prompt ? {prompt: request.prompt.slice(0, 200)} : {}), ...(request.program ? {program: request.program.slice(0, 64)} : {})} : {})};
}

/** The state an input-state message describes; an unknown confidence or mode is dropped, never guessed. */
export function inputStateFrom(message: Extract<ServerMessage, {type: 'input-state'}>): InputState {
  const confidence = INPUT_CONFIDENCES.find(item => item === message.confidence);
  const mode = INPUT_MODES.find(item => item === message.mode);
  const timing = {waitedMs: message.waitedMs, waits: message.waits};
  if (message.since === undefined || !confidence || !mode) return {timing};
  return {request: {since: message.since, confidence, mode, ...(message.prompt ? {prompt: message.prompt} : {}), ...(message.program ? {program: message.program} : {})}, timing};
}
