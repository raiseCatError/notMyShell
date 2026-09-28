import {EventEmitter} from 'node:events';
import {ShellSession} from '../shell/ShellSession.js';
import type {SessionClient, SessionClientEvents, SessionOptions} from './SessionClient.js';

type ShellLike = Pick<ShellSession, 'submit' | 'write' | 'interrupt' | 'endInput' | 'resize' | 'kill' | 'on'>;

/** SessionClient backed by a ShellSession living in this process. */
export class InProcessSessionClient extends EventEmitter<SessionClientEvents> implements SessionClient {
  private readonly shell: ShellLike;

  constructor(options: SessionOptions, factory: (options: SessionOptions) => ShellLike = defaultShell) {
    super();
    this.shell = factory(options);
    this.shell.on('data', data => this.emit('data', data));
    this.shell.on('prompt', marker => this.emit('prompt', marker));
    this.shell.on('exit', event => this.emit('exit', event));
  }

  submit(command: string): void { this.shell.submit(command); }
  write(data: string): void { this.shell.write(data); }
  interrupt(): void { this.shell.interrupt(); }
  endInput(): void { this.shell.endInput(); }
  resize(columns: number, rows: number): void { this.shell.resize(columns, rows); }
  kill(): void { this.shell.kill(); }
}

function defaultShell(options: SessionOptions): ShellSession {
  return new ShellSession(options.cwd, options.columns, options.rows);
}
