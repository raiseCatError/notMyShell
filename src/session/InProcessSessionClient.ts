import {EventEmitter} from 'node:events';
import {ShellSession} from '../shell/ShellSession.js';
import {SESSION_MODE_ENV, type SessionClient, type SessionClientEvents, type SessionOptions} from './SessionClient.js';

type ShellLike = Pick<ShellSession, 'submit' | 'write' | 'interrupt' | 'endInput' | 'resize' | 'kill' | 'on'>;
const NO_STAMP = {};

/** SessionClient backed by a ShellSession living in this process. */
export class InProcessSessionClient extends EventEmitter<SessionClientEvents> implements SessionClient {
  private readonly shell: ShellLike;

  constructor(options: SessionOptions, factory: (options: SessionOptions) => ShellLike = defaultShell) {
    super();
    this.shell = factory(options);
    this.shell.on('data', data => this.emit('data', data, NO_STAMP));
    this.shell.on('prompt', marker => this.emit('prompt', marker, NO_STAMP));
    this.shell.on('exec', command => this.emit('exec', command, NO_STAMP));
    this.shell.on('exit', event => this.emit('exit', event));
  }

  start(): void {}
  submit(command: string): void { this.shell.submit(command); }
  write(data: string): void { this.shell.write(data); }
  interrupt(): void { this.shell.interrupt(); }
  endInput(): void { this.shell.endInput(); }
  resize(columns: number, rows: number): void { this.shell.resize(columns, rows); }
  kill(): void { this.shell.kill(); }
  detach(): void { this.shell.kill(); }
  ack(): void {}
}

function defaultShell(options: SessionOptions): ShellSession {
  return new ShellSession(options.cwd, options.columns, options.rows, process.env.HOME || '',
    {...process.env, [SESSION_MODE_ENV]: 'in-process'});
}
