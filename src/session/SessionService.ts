import {randomUUID} from 'node:crypto';
import {chmodSync, lstatSync, unlinkSync} from 'node:fs';
import {connect, createServer, type Server, type Socket} from 'node:net';
import {ShellSession} from '../shell/ShellSession.js';
import {FrameDecoder, PROTOCOL_VERSION, encodeMessage, type ServerMessage} from './SessionProtocol.js';
import {SESSION_MODE_ENV} from './SessionClient.js';
import {ensurePrivateRuntimeDir, socketPathFor} from './runtimeDir.js';

export const SERVICE_NAME = 'nmshd';

export interface SessionRecord {
  id: string;
  pid: number;
  cwd: string;
  createdAt: string;
  attached: boolean;
  protocolVersion: number;
}

interface ManagedSession {
  record: SessionRecord;
  shell: ShellSession;
}

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
 * Local per-user service owning PTY + managed zsh sessions. Until detach and
 * reattach exist, a session lives exactly as long as the frontend connection
 * that created it, and the service exits once it has no sessions or clients.
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
            if (owned) { send({type: 'error', code: 'state', message: 'session already created'}); break; }
            try {
              owned = this.create(message.cwd, message.env, message.columns, message.rows, send);
              send({type: 'created', sessionId: owned.record.id, pid: owned.record.pid});
            } catch (error) {
              send({type: 'error', code: 'spawn', message: error instanceof Error ? error.message : String(error)});
            }
            break;
          case 'input': owned?.shell.write(message.data); break;
          case 'resize': owned?.shell.resize(message.columns, message.rows); break;
          case 'terminate': owned?.shell.kill(); break;
          default: send({type: 'error', code: 'unsupported', message: `unsupported message ${message.type}`});
        }
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      this.connections.delete(socket);
      // No detach yet: a frontend going away ends its shell, as it always has.
      if (owned && this.sessions.has(owned.record.id)) owned.shell.kill();
      this.maybeShutdown();
    });
  }

  private create(cwd: string, env: Record<string, string>, columns: number, rows: number,
    send: (message: ServerMessage) => void): ManagedSession {
    // The shell gets the launching frontend's environment and cwd, never the
    // service's own startup state. The env is opaque: it is not stored or logged.
    const shell = new ShellSession(cwd, columns, rows, env.HOME || '', {...env, [SESSION_MODE_ENV]: 'service'});
    const record: SessionRecord = {id: randomUUID(), pid: shell.pid, cwd, createdAt: new Date().toISOString(),
      attached: true, protocolVersion: PROTOCOL_VERSION};
    const session = {record, shell};
    this.sessions.set(record.id, session);
    shell.on('data', data => send({type: 'output', data}));
    shell.on('prompt', marker => { record.cwd = marker.cwd; send({type: 'prompt', exitCode: marker.exitCode, cwd: marker.cwd}); });
    shell.on('exit', event => {
      this.sessions.delete(record.id);
      send({type: 'exit', exitCode: event.exitCode, ...(event.signal ? {signal: event.signal} : {})});
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
