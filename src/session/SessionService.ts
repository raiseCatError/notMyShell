import {randomUUID} from 'node:crypto';
import {chmodSync, lstatSync, unlinkSync} from 'node:fs';
import {connect, createServer, type Server, type Socket} from 'node:net';
import {ShellSession} from '../shell/ShellSession.js';
import {FrameDecoder, PROTOCOL_VERSION, encodeMessage, type ServerMessage, type SessionInfo, type SessionState} from './SessionProtocol.js';
import {SESSION_MODE_ENV} from './SessionClient.js';
import {ensurePrivateRuntimeDir, socketPathFor} from './runtimeDir.js';

export const SERVICE_NAME = 'nmshd';

export interface SessionRecord {
  id: string;
  pid: number;
  cwd: string;
  createdAt: string;
  state: SessionState;
  protocolVersion: number;
}

type Send = (message: ServerMessage) => void;

interface ManagedSession {
  record: SessionRecord;
  shell: ShellSession;
  /** The one writable frontend; undefined while detached. */
  controller?: Send;
  running?: {command: string; since: number};
  screen: AlternateScreenTracker;
  /** Bumped by every frontend resize so a pending redraw step never overrides a newer size. */
  resizes: number;
}

// DECSET/DECRST 1049, 1047 and 47: the alternate-screen switches.
const ALT_SCREEN = /\u001b\[\?(?:1049|1047|47)([hl])/g;

/** Follows whether the PTY's foreground app is on the alternate screen. */
export class AlternateScreenTracker {
  active = false;
  private carry = '';

  push(data: string): void {
    const text = this.carry + data;
    for (const match of text.matchAll(ALT_SCREEN)) this.active = match[1] === 'h';
    // Keep a tail so a sequence split across reads is still seen.
    const escape = text.lastIndexOf('\u001b');
    this.carry = escape !== -1 && text.length - escape < 8 ? text.slice(escape) : '';
  }

  reset(): void { this.active = false; this.carry = ''; }
}

/** Delay between the two resizes that force a fullscreen app to repaint on attach. */
const REDRAW_NUDGE_MS = 40;

export interface SessionServiceOptions {
  runtimeDir: string;
  /** Exit if no frontend connects within this window after startup. */
  startupIdleMs?: number;
}

export class ServiceAlreadyRunningError extends Error {}

function canConnect(path: string): Promise<boolean> {
  return new Promise(resolve => {
    const probe = connect(path);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => resolve(false));
  });
}

/**
 * Local per-user service owning PTY + managed zsh sessions. A session is
 * attached to at most one frontend connection; losing that connection for any
 * reason (window close, crash, SIGKILL) detaches it, and the shell keeps
 * running until zsh itself exits or a frontend terminates it. The service
 * exits once it has no sessions and no clients.
 */
export class SessionService {
  readonly socketPath: string;
  private server: Server | undefined;
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly connections = new Set<Socket>();
  private idleTimer: NodeJS.Timeout | undefined;
  private closed = false;
  readonly done: Promise<void>;
  private resolveDone!: () => void;

  constructor(private readonly options: SessionServiceOptions) {
    this.socketPath = socketPathFor(options.runtimeDir);
    this.done = new Promise(resolve => { this.resolveDone = resolve; });
  }

  get registry(): SessionRecord[] {
    return [...this.sessions.values()].map(session => ({...session.record}));
  }

  private info(session: ManagedSession): SessionInfo {
    const {record, running} = session;
    return {id: record.id, pid: record.pid, state: record.state, cwd: record.cwd, createdAt: Date.parse(record.createdAt),
      ...(running ? {running: running.command, runningSince: running.since} : {})};
  }

  async start(): Promise<void> {
    ensurePrivateRuntimeDir(this.options.runtimeDir);
    await this.clearStaleSocket();
    const server = createServer(socket => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath, () => { server.off('error', reject); resolve(); });
    });
    chmodSync(this.socketPath, 0o600);
    this.server = server;
    this.idleTimer = setTimeout(() => this.maybeShutdown(), this.options.startupIdleMs ?? 10_000);
  }

  private async clearStaleSocket(): Promise<void> {
    let stat;
    try { stat = lstatSync(this.socketPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (!stat.isSocket() || stat.uid !== process.getuid?.()) throw new Error('refusing unexpected file at socket path');
    if (await canConnect(this.socketPath)) throw new ServiceAlreadyRunningError('session service already running');
    unlinkSync(this.socketPath);
  }

  private accept(socket: Socket): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    this.connections.add(socket);
    socket.setEncoding('utf8');
    const decoder = new FrameDecoder();
    const send = (message: ServerMessage) => { if (!socket.destroyed) socket.write(encodeMessage(message)); };
    let greeted = false;
    let owned: ManagedSession | undefined;

    socket.on('data', chunk => {
      for (const result of decoder.push(chunk as unknown as string)) {
        if (!result.ok) {
          if (!greeted) { send({type: 'error', code: 'protocol', message: result.error}); socket.end(); return; }
          send({type: 'error', code: 'malformed', message: result.error});
          continue;
        }
        const message = result.message;
        if (!greeted) {
          if (message.type !== 'hello' || message.version !== PROTOCOL_VERSION) {
            send({type: 'error', code: 'version',
              message: `service speaks protocol ${PROTOCOL_VERSION}; client sent ${message.type === 'hello' ? message.version : 'no handshake'}`});
            socket.end();
            return;
          }
          greeted = true;
          send({type: 'welcome', version: PROTOCOL_VERSION, service: SERVICE_NAME});
          continue;
        }
        switch (message.type) {
          case 'create':
            if (owned) { send({type: 'error', code: 'state', message: 'connection already controls a session'}); break; }
            try {
              owned = this.create(message.cwd, message.env, message.columns, message.rows, send);
              send({type: 'created', sessionId: owned.record.id, pid: owned.record.pid});
            } catch (error) {
              send({type: 'error', code: 'spawn', message: error instanceof Error ? error.message : String(error)});
            }
            break;
          case 'attach': {
            if (owned) { send({type: 'error', code: 'state', message: 'connection already controls a session'}); break; }
            const session = this.sessions.get(message.sessionId);
            if (!session) { send({type: 'error', code: 'unknown', message: 'no live session with that id'}); break; }
            if (session.controller) { send({type: 'error', code: 'attached', message: 'session is attached to another frontend'}); break; }
            owned = session;
            this.bind(session, send);
            const info = this.info(session);
            send({type: 'attached', sessionId: info.id, pid: info.pid, cwd: info.cwd, fullscreen: session.screen.active ? 1 : 0,
              ...(info.running ? {running: info.running, runningSince: info.runningSince} : {})});
            this.redraw(session, message.columns, message.rows);
            break;
          }
          case 'detach':
            if (owned) {
              const id = owned.record.id;
              this.detach(owned, send);
              owned = undefined;
              send({type: 'detached', sessionId: id});
            }
            break;
          case 'list':
            send({type: 'sessions', sessions: [...this.sessions.values()].map(session => this.info(session))});
            break;
          case 'input': owned?.shell.write(message.data); break;
          case 'resize':
            if (owned) { owned.resizes += 1; owned.shell.resize(message.columns, message.rows); }
            break;
          case 'terminate': owned?.shell.kill(); break;
          default: send({type: 'error', code: 'unsupported', message: `unsupported message ${message.type}`});
        }
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      this.connections.delete(socket);
      // The frontend is gone however it left (even SIGKILL): detach, never kill.
      if (owned) this.detach(owned, send);
      this.maybeShutdown();
    });
  }

  private bind(session: ManagedSession, send: Send): void {
    session.controller = send;
    session.record.state = 'attached';
  }

  private detach(session: ManagedSession, send: Send): void {
    if (session.controller !== send) return;
    session.controller = undefined;
    session.record.state = 'detached';
  }

  /**
   * Adopt the attaching frontend's size. A fullscreen app only repaints on a
   * real size change, so step through a neighbouring size first: each step
   * delivers SIGWINCH and the final one lands on the new frontend's size.
   */
  private redraw(session: ManagedSession, columns: number, rows: number): void {
    session.shell.resize(columns, rows > 2 ? rows - 1 : rows + 1);
    const generation = session.resizes;
    setTimeout(() => {
      if (this.sessions.has(session.record.id) && session.resizes === generation) session.shell.resize(columns, rows);
    }, REDRAW_NUDGE_MS);
  }

  private create(cwd: string, env: Record<string, string>, columns: number, rows: number, send: Send): ManagedSession {
    // The shell gets the launching frontend's environment and cwd, never the
    // service's own startup state. The env is opaque: it is not stored or logged.
    const shell = new ShellSession(cwd, columns, rows, env.HOME || '', {...env, [SESSION_MODE_ENV]: 'service'});
    const record: SessionRecord = {id: randomUUID(), pid: shell.pid, cwd, createdAt: new Date().toISOString(),
      state: 'attached', protocolVersion: PROTOCOL_VERSION};
    const session: ManagedSession = {record, shell, controller: send, screen: new AlternateScreenTracker(), resizes: 0};
    this.sessions.set(record.id, session);
    shell.on('data', data => {
      session.screen.push(data);
      session.controller?.({type: 'output', data});
    });
    shell.on('exec', command => { session.running = {command, since: Date.now()}; });
    shell.on('prompt', marker => {
      record.cwd = marker.cwd;
      session.running = undefined;
      session.screen.reset();
      session.controller?.({type: 'prompt', exitCode: marker.exitCode, cwd: marker.cwd});
    });
    shell.on('exit', event => {
      this.sessions.delete(record.id);
      session.controller?.({type: 'exit', exitCode: event.exitCode, ...(event.signal ? {signal: event.signal} : {})});
      session.controller = undefined;
      this.maybeShutdown();
    });
    return session;
  }

  private maybeShutdown(): void {
    if (this.sessions.size === 0 && this.connections.size === 0) void this.close();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const session of this.sessions.values()) session.shell.kill();
    this.sessions.clear();
    for (const socket of this.connections) socket.destroy();
    // Closing the listening server unlinks its socket path.
    await new Promise<void>(resolve => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.resolveDone();
  }
}

export async function runSessionService(options: SessionServiceOptions): Promise<void> {
  const service = new SessionService(options);
  try {
    await service.start();
  } catch (error) {
    if (error instanceof ServiceAlreadyRunningError) return;
    throw error;
  }
  const stop = () => void service.close();
  process.once('SIGTERM', stop);
  process.once('SIGHUP', stop);
  process.once('SIGINT', stop);
  await service.done;
}
