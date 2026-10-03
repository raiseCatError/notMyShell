import {EventEmitter} from 'node:events';
import {connect, type Socket} from 'node:net';
import {FrameDecoder, PROTOCOL_VERSION, encodeMessage, parseFeatures, type ClientMessage, type ServiceFeature, type ServerMessage} from './SessionProtocol.js';
import type {SessionInfo} from './SessionProtocol.js';
import type {SessionNotice} from './SessionNotices.js';
import {isShellId, type ShellId} from '../shell/adapters/ShellAdapter.js';
import type {AttachedSession, SessionClient, SessionClientEvents, SessionOptions} from './SessionClient.js';

export interface SocketConnectOptions extends SessionOptions {
  socketPath: string;
  env: Record<string, string>;
  timeoutMs?: number;
  /** Reattach this live session instead of creating one. */
  attach?: string;
}

/**
 * Open a handshaken connection and run one request/response exchange. Used
 * for everything except the long-lived session stream.
 */
type Decoded = ReturnType<FrameDecoder['push']>;

interface Established<T> {
  value: T;
  /** The service's welcome: its advertised features and build. */
  welcome?: Extract<ServerMessage, {type: 'welcome'}>;
  socket: Socket;
  decoder: FrameDecoder;
  /** Frames that arrived in the same read as the reply; they belong to the caller. */
  rest: Decoded;
}

function request<T>(socketPath: string, timeoutMs: number, first: ClientMessage | undefined,
  onMessage: (message: ServerMessage) => T | undefined): Promise<Established<T>> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.setEncoding('utf8');
    const decoder = new FrameDecoder();
    let settled = false;
    let welcome: Extract<ServerMessage, {type: 'welcome'}> | undefined;
    const fail = (message: string, code: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(new SessionConnectError(message, code));
    };
    const timer = setTimeout(() => fail('session service did not respond', 'timeout'), timeoutMs);
    const send = (message: ClientMessage) => socket.write(encodeMessage(message));
    const onData = (chunk: string | Buffer) => {
      const results = decoder.push(String(chunk));
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index]!;
        if (!result.ok) { fail(`session service sent an invalid frame: ${result.error}`, 'protocol'); return; }
        const message = result.message as ServerMessage;
        if (message.type === 'error') { fail(`session service refused: ${message.message}`, message.code); return; }
        if (message.type === 'welcome') {
          welcome = message;
          if (message.version !== PROTOCOL_VERSION) { fail(`protocol mismatch: service ${message.version}, client ${PROTOCOL_VERSION}`, 'version'); return; }
          if ((first?.type === 'create' || first?.type === 'attach') && message.startupSafety !== 1) {
            fail('service does not advertise startup safety; end its sessions and restart the service before attaching', 'startup-safety');
            return;
          }
          if (first) send(first);
          continue;
        }
        const value = onMessage(message);
        if (value !== undefined) {
          settled = true;
          clearTimeout(timer);
          socket.off('data', onData);
          socket.off('error', onError);
          socket.off('close', onClose);
          resolve({value, socket, decoder, rest: results.slice(index + 1), ...(welcome ? {welcome} : {})});
          return;
        }
      }
    };
    const onError = (error: NodeJS.ErrnoException) => fail(`session service unreachable (${error.code ?? 'error'})`, error.code ?? 'error');
    const onClose = () => fail('session service closed the connection', 'closed');
    socket.once('connect', () => send({type: 'hello', version: PROTOCOL_VERSION, client: 'nmsh'}));
    socket.on('error', onError);
    socket.on('close', onClose);
    socket.on('data', onData);
  });
}

/** End a detached session; resolves once the shell has exited and its spool is final. */
export async function killSession(socketPath: string, sessionId: string, timeoutMs = 5000): Promise<void> {
  const {socket} = await request(socketPath, timeoutMs, {type: 'kill', sessionId},
    message => (message.type === 'killed' ? true : undefined));
  socket.end();
}

/** Live sessions the service at socketPath currently owns. */
export async function listSessions(socketPath: string, timeoutMs = 3000): Promise<SessionInfo[]> {
  const {value, socket} = await request(socketPath, timeoutMs, {type: 'list'},
    message => (message.type === 'sessions' ? message.sessions : undefined));
  socket.end();
  return value;
}

/** Live sessions plus notices for recently ended ones (older services report none). */
export async function listSessionsWithNotices(socketPath: string, timeoutMs = 3000): Promise<{sessions: SessionInfo[]; ended: SessionNotice[]}> {
  const {value, socket} = await request(socketPath, timeoutMs, {type: 'list'},
    message => (message.type === 'sessions' ? {sessions: message.sessions, ended: message.ended ?? []} : undefined));
  socket.end();
  return value;
}

/** Clear a session's notice in every attached frontend. */
export async function dismissNotice(socketPath: string, sessionId: string, timeoutMs = 3000): Promise<void> {
  const {socket} = await request(socketPath, timeoutMs, {type: 'dismiss', sessionId},
    message => (message.type === 'dismissed' ? true : undefined));
  socket.end();
}

export const OLDER_SERVICE_SWITCH = 'The session service running this session is an older NMSh build without shell switching. '
  + 'Its live sessions keep running; once they end, the next nmsh launch starts the current service.';

export class SessionConnectError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

/** SessionClient speaking the session protocol to the local service over a Unix socket. */
export class SocketSessionClient extends EventEmitter<SessionClientEvents> implements SessionClient {
  private exited = false;

  private constructor(private readonly socket: Socket, readonly sessionId: string, readonly pid: number) {
    super();
  }

  /** Set when this client reattached a live session instead of creating one. */
  attachedSession?: AttachedSession;
  private detaching = false;

  /**
   * Handshake, then create (or attach to) a session, resolving only once the
   * service confirms it. Any failure before that tears the socket down; for a
   * create, that makes the service end whatever it may have started, so a
   * caller can safely fall back.
   */
  static async connect(options: SocketConnectOptions): Promise<SocketSessionClient> {
    const first: ClientMessage = options.attach
      ? {type: 'attach', sessionId: options.attach, columns: options.columns, rows: options.rows}
      : {type: 'create', cwd: options.cwd, env: options.env, columns: options.columns, rows: options.rows, ...(options.shell ? {shell: options.shell} : {})};
    const {value, socket, decoder, rest, welcome} = await request<AttachedSession>(options.socketPath, options.timeoutMs ?? 5000, first, message => {
      // An older service ignores the shell request and reports none: that is zsh.
      if (message.type === 'created') return {sessionId: message.sessionId, pid: message.pid, cwd: options.cwd, fullscreen: 0, ackedSeq: 0, shell: message.shell ?? 'zsh'};
      if (message.type === 'attached') {
        const {type: _type, ...attached} = message;
        return attached;
      }
      return undefined;
    });
    const client = new SocketSessionClient(socket, value.sessionId, value.pid);
    client.shell = isShellId(value.shell) ? value.shell : 'zsh';
    // Known at connect time: an older service advertises no features.
    client.features = parseFeatures(welcome?.features);
    client.serviceBuild = welcome?.build;
    if (options.attach) client.attachedSession = value;
    client.listen(decoder, rest);
    return client;
  }

  private listen(decoder: FrameDecoder, pending: Decoded): void {
    const deliver = (results: Decoded) => {
      // Malformed frames on a live session are contained, not fatal.
      for (const result of results) if (result.ok) this.receive(result.message as ServerMessage);
    };
    // Hold the stream until the frontend has subscribed (start()).
    this.socket.pause();
    this.pending = () => deliver(pending);
    this.socket.on('data', chunk => deliver(decoder.push(String(chunk))));
    this.socket.on('error', () => {});
    this.socket.on('close', () => { if (!this.detaching) this.finish(1, undefined, true); });
  }

  private pending?: () => void;

  start(): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.();
    this.socket.resume();
  }

  /** Backend currently running in this session. */
  shell: ShellId = 'zsh';
  /** Optional capabilities the connected service advertised. */
  features: ReadonlySet<ServiceFeature> = new Set();
  serviceBuild?: string;
  private pendingSwitch?: {resolve: (value: {shell: ShellId; pid: number}) => void; reject: (error: Error) => void};

  switchShell(shell: ShellId, cwd: string): Promise<{shell: ShellId; pid: number}> {
    // Never send a message the service did not advertise.
    if (!this.features.has('shell-switch')) return Promise.reject(new SessionConnectError(OLDER_SERVICE_SWITCH, 'unsupported'));
    if (this.pendingSwitch) return Promise.reject(new Error('A shell switch is already in progress.'));
    return new Promise((resolve, reject) => {
      this.pendingSwitch = {resolve, reject};
      this.send({type: 'switch-shell', shell, cwd});
    });
  }

  private receive(message: ServerMessage): void {
    if (message.type === 'shell-switched' || (message.type === 'error' && this.pendingSwitch)) {
      const pending = this.pendingSwitch;
      this.pendingSwitch = undefined;
      if (message.type === 'shell-switched' && isShellId(message.shell)) { this.shell = message.shell; pending?.resolve({shell: message.shell, pid: message.pid}); }
      else pending?.reject(new SessionConnectError(message.type === 'error' ? message.message : 'unexpected shell reply', message.type === 'error' ? message.code : 'protocol'));
      return;
    }
    if (message.type === 'output') this.emit('data', message.data, {seq: message.seq, at: message.at});
    else if (message.type === 'prompt') this.emit('prompt', {exitCode: message.exitCode, cwd: message.cwd,
      ...(message.knowledge === undefined ? {} : {knowledge: message.knowledge})}, {seq: message.seq, at: message.at});
    else if (message.type === 'exec') this.emit('exec', message.command, {seq: message.seq, at: message.at, historyAllowed: message.historyAllowed});
    else if (message.type === 'input-rejected') this.emit('inputRejected', message.data, message.submission === 1);
    else if (message.type === 'startup') this.emit('startup', message.output);
    else if (message.type === 'replayed') this.emit('replayed', {truncatedBytes: message.truncatedBytes});
    else if (message.type === 'exit') {
      this.finish(message.exitCode, message.signal);
      this.socket.end();
    }
  }

  private finish(exitCode: number, signal?: number, lost = false): void {
    if (this.exited) return;
    this.exited = true;
    this.pendingSwitch?.reject(new Error('The session ended.'));
    this.pendingSwitch = undefined;
    this.emit('exit', {exitCode, ...(signal === undefined ? {} : {signal}), ...(lost ? {lost} : {})});
  }


  private send(message: ClientMessage): void {
    if (!this.socket.destroyed && this.socket.writable) this.socket.write(encodeMessage(message));
  }

  submit(command: string): void { this.send({type: 'input', data: `${command}\r`, submission: 1}); }
  write(data: string): void { this.send({type: 'input', data}); }
  interrupt(): void { this.send({type: 'input', data: '\u0003'}); }
  endInput(): void { this.send({type: 'input', data: '\u0004'}); }
  resize(columns: number, rows: number): void { this.send({type: 'resize', columns: Math.max(2, columns), rows: Math.max(2, rows)}); }
  kill(): void {
    this.send({type: 'terminate'});
    this.socket.end();
  }
  ack(seq: number, journalId: string): void { this.send({type: 'ack', seq, journalId}); }
  detach(): void {
    this.detaching = true;
    this.send({type: 'detach'});
    this.socket.end();
  }
}
