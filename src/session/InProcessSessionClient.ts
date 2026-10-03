import {EventEmitter} from 'node:events';
import {ShellSession} from '../shell/ShellSession.js';
import {knowledgeJobCount, type ShellId} from '../shell/adapters/ShellAdapter.js';
import {shellAdapter} from '../shell/adapters/registry.js';
import {SESSION_MODE_ENV, type SessionClient, type SessionClientEvents, type SessionOptions} from './SessionClient.js';

type ShellLike = Pick<ShellSession, 'submit' | 'write' | 'interrupt' | 'endInput' | 'resize' | 'kill' | 'on'>
  & Partial<Pick<ShellSession, 'removeAllListeners' | 'isReady' | 'pid'>>;
const NO_STAMP = {};

/** SessionClient backed by a ShellSession living in this process. */
export class InProcessSessionClient extends EventEmitter<SessionClientEvents> implements SessionClient {
  private shell: ShellLike;
  shellId: ShellId;
  private size: {columns: number; rows: number};
  private running = false;
  private knowledge?: string;

  constructor(options: SessionOptions, private readonly factory: (options: SessionOptions) => ShellLike = defaultShell) {
    super();
    this.shellId = options.shell ?? 'zsh';
    this.size = {columns: options.columns, rows: options.rows};
    this.shell = factory(options);
    this.wire(this.shell);
  }

  private wire(shell: ShellLike): void {
    shell.on('data', data => this.emit('data', data, NO_STAMP));
    shell.on('prompt', marker => { this.running = false; this.knowledge = marker.knowledge; this.emit('prompt', marker, NO_STAMP); });
    shell.on('exec', (command, historyAllowed) => { this.running = true; this.emit('exec', command, historyAllowed === undefined ? NO_STAMP : {historyAllowed}); });
    shell.on('startup', tail => this.emit('startup', tail));
    shell.on('inputRejected', (data, submission) => this.emit('inputRejected', data, submission));
    shell.on('exit', event => this.emit('exit', event));
  }

  start(): void {}
  submit(command: string): void { this.shell.submit(command); }
  write(data: string): void { this.shell.write(data); }
  interrupt(): void { this.shell.interrupt(); }
  endInput(): void { this.shell.endInput(); }
  resize(columns: number, rows: number): void { this.size = {columns, rows}; this.shell.resize(columns, rows); }
  kill(): void { this.shell.kill(); }
  detach(): void { this.shell.kill(); }
  ack(): void {}

  /** Same guards as the session service: never end a running command, a starting shell or jobs. */
  async switchShell(shell: ShellId, cwd: string): Promise<{shell: ShellId; pid: number}> {
    if (shell === this.shellId) throw new Error(`This session already runs ${shellAdapter(shell).label}.`);
    const unavailable = shellAdapter(shell).unavailableReason(process.env);
    if (unavailable) throw new Error(unavailable);
    if (this.shell.isReady === false) throw new Error('The current shell is still starting; switch once it is ready.');
    if (this.running) throw new Error('A command is still running; switching would end it.');
    const jobs = knowledgeJobCount(this.knowledge);
    if (jobs) throw new Error(`${jobs} background or stopped job${jobs === 1 ? '' : 's'} would end with the current shell. Finish them first.`);
    const next = this.factory({cwd, ...this.size, shell});
    const previous = this.shell;
    previous.removeAllListeners?.();
    previous.kill();
    this.shell = next;
    this.shellId = shell;
    this.knowledge = undefined;
    this.wire(next);
    return {shell, pid: next.pid ?? 0};
  }
}

function defaultShell(options: SessionOptions): ShellSession {
  return new ShellSession(options.cwd, options.columns, options.rows, process.env.HOME || '',
    {...process.env, [SESSION_MODE_ENV]: 'in-process'}, options.shell ?? 'zsh');
}
