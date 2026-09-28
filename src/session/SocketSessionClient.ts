import {EventEmitter} from 'node:events';
import {connect, type Socket} from 'node:net';
import {FrameDecoder, PROTOCOL_VERSION, encodeMessage, type ClientMessage, type ServerMessage} from './SessionProtocol.js';
import type {SessionClient, SessionClientEvents, SessionOptions} from './SessionClient.js';

export interface SocketConnectOptions extends SessionOptions {
  socketPath: string;
  env: Record<string, string>;
  timeoutMs?: number;
}

export class SessionConnectError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

/** SessionClient speaking the session protocol to the local service over a Unix socket. */
export class SocketSessionClient extends EventEmitter<SessionClientEvents> implements SessionClient {
  private exited = false;

  private constructor(private readonly socket: Socket, readonly sessionId: string, readonly pid: number) {
    super();
  }

  /**
   * Handshake, create a session, and resolve only once the service confirms
   * it. Any failure before that tears the socket down, which makes the service
   * end whatever it may have started, so a caller can safely fall back.
   */
  static connect(options: SocketConnectOptions): Promise<SocketSessionClient> {
    return new Promise((resolve, reject) => {
      const socket = connect(options.socketPath);
      socket.setEncoding('utf8');
      const decoder = new FrameDecoder();
      let client: SocketSessionClient | undefined;
      let settled = false;
      const fail = (message: string, code: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(new SessionConnectError(message, code));
      };
      const timer = setTimeout(() => fail('session service did not respond', 'timeout'), options.timeoutMs ?? 5000);
      const send = (message: ClientMessage) => socket.write(encodeMessage(message));

      socket.once('connect', () => send({type: 'hello', version: PROTOCOL_VERSION, client: 'nmsh'}));
      socket.on('error', error => {
        if (client) client.finish(1);
        else fail(`session service unreachable (${(error as NodeJS.ErrnoException).code ?? 'error'})`, (error as NodeJS.ErrnoException).code ?? 'error');
      });
      socket.on('close', () => {
        if (client) client.finish(1);
        else fail('session service closed the connection', 'closed');
      });
      socket.on('data', chunk => {
        for (const result of decoder.push(chunk as unknown as string)) {
          if (!result.ok) {
            if (!client) fail(`session service sent an invalid frame: ${result.error}`, 'protocol');
            continue; // contain malformed frames on a live session
          }
          const message = result.message as ServerMessage;
          if (client) { client.receive(message); continue; }
          if (message.type === 'error') { fail(`session service refused: ${message.message}`, message.code); return; }
          if (message.type === 'welcome') {
            if (message.version !== PROTOCOL_VERSION) { fail(`protocol mismatch: service ${message.version}, client ${PROTOCOL_VERSION}`, 'version'); return; }
            send({type: 'create', cwd: options.cwd, env: options.env, columns: options.columns, rows: options.rows});
          } else if (message.type === 'created') {
            settled = true;
            clearTimeout(timer);
            client = new SocketSessionClient(socket, message.sessionId, message.pid);
            resolve(client);
          }
        }
      });
    });
  }

  private receive(message: ServerMessage): void {
    if (message.type === 'output') this.emit('data', message.data);
    else if (message.type === 'prompt') this.emit('prompt', {exitCode: message.exitCode, cwd: message.cwd});
    else if (message.type === 'exit') {
      this.finish(message.exitCode, message.signal);
      this.socket.end();
    }
  }

  private finish(exitCode: number, signal?: number): void {
    if (this.exited) return;
    this.exited = true;
    this.emit('exit', signal === undefined ? {exitCode} : {exitCode, signal});
  }

  private send(message: ClientMessage): void {
    if (!this.socket.destroyed && this.socket.writable) this.socket.write(encodeMessage(message));
  }

  submit(command: string): void { this.send({type: 'input', data: `${command}\r`}); }
  write(data: string): void { this.send({type: 'input', data}); }
  interrupt(): void { this.send({type: 'input', data: '\u0003'}); }
  endInput(): void { this.send({type: 'input', data: '\u0004'}); }
  resize(columns: number, rows: number): void { this.send({type: 'resize', columns: Math.max(2, columns), rows: Math.max(2, rows)}); }
  kill(): void {
    this.send({type: 'terminate'});
    this.socket.end();
  }
}
