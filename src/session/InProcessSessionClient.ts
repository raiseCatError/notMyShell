import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {ShellSession} from '../shell/ShellSession.js';
import {knowledgeJobCount, type ShellId} from '../shell/adapters/ShellAdapter.js';
import {shellAdapter} from '../shell/adapters/registry.js';
import {SERVICE_FEATURES, type ServiceFeature} from './SessionProtocol.js';
import {QueueDispatcher, type QueueShell} from './QueueDispatcher.js';
import type {QueueOp} from './CommandQueue.js';
import {SessionTasks} from '../backgroundTasks/sessionTasks.js';
import type {TaskOp} from '../backgroundTasks/protocol.js';
import {SESSION_ID_ENV, SESSION_MODE_ENV, type SessionClient, type SessionClientEvents, type SessionOptions} from './SessionClient.js';

type ShellLike = Pick<ShellSession, 'submit' | 'write' | 'interrupt' | 'endInput' | 'resize' | 'kill' | 'on'>
  & Partial<Pick<ShellSession, 'removeAllListeners' | 'isReady' | 'pid' | 'inputWatch'>>;
const NO_STAMP = {};

/** SessionClient backed by a ShellSession living in this process. */
export class InProcessSessionClient extends EventEmitter<SessionClientEvents> implements SessionClient {
  private shell: ShellLike;
  shellId: ShellId;
  /** In-process means this very build: every feature is available. */
  readonly features: ReadonlySet<ServiceFeature> = new Set(SERVICE_FEATURES);
  private size: {columns: number; rows: number};
  private running = false;
  private knowledge?: string;
  /** The session's command queue, run in this process exactly as the service runs it. */
  private readonly dispatcher: QueueDispatcher;
  /** This in-process session's NMSH_SESSION_ID (there is no service session id). */
  readonly contextId = `local-${randomUUID()}`;
  /** Background tasks of this window's session; an in-process shell cannot outlive its window, and neither can they. */
  private readonly tasks = new SessionTasks({shell: () => shellAdapter(this.shellId).resolveExecutable(process.env),
    env: () => Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))});

  constructor(options: SessionOptions, private readonly factory: (options: SessionOptions) => ShellLike = defaultShell) {
    super();
    this.shellId = options.shell ?? 'zsh';
    this.size = {columns: options.columns, rows: options.rows};
    this.shell = factory({...options, contextId: this.contextId});
    this.dispatcher = new QueueDispatcher(this.queueShell());
    this.dispatcher.on('state', (state, event) => this.emit('queueState', state, {
      ...(event.dispatched ? {dispatched: event.dispatched.id} : {}), ...(event.refused ? {refused: event.refused} : {}),
      ...(event.dropped?.length ? {dropped: event.dropped.length} : {})}));
    this.wire(this.shell);
  }

  private wire(shell: ShellLike): void {
    shell.on('data', data => this.emit('data', data, NO_STAMP));
    shell.on('prompt', marker => {
      this.running = false;
      this.knowledge = marker.knowledge;
      this.emit('prompt', marker, NO_STAMP);
      this.dispatcher.onPrompt(marker.exitCode, Date.now(), marker);
    });
    shell.on('exec', (command, historyAllowed) => {
      this.running = true;
      const queued = this.dispatcher.onExec(command, undefined, historyAllowed)?.text;
      this.emit('exec', command, historyAllowed === undefined && queued === undefined ? NO_STAMP
        : {...(historyAllowed === undefined ? {} : {historyAllowed}), ...(queued === undefined ? {} : {queued})});
    });
    shell.on('startup', tail => this.emit('startup', tail));
    shell.on('inputRejected', (data, submission) => this.emit('inputRejected', data, submission));
    shell.on('inputState', state => this.emit('inputState', state));
    shell.on('exit', event => { this.dispatcher.onShellExit(); void this.tasks.shutdown(); this.emit('exit', event); });
  }

  start(): void {
    this.tasks.attach({tasks: records => this.emit('tasks', records), output: (id, update) => this.emit('taskOutput', id, update)});
  }
  task(change: TaskOp): void {
    const refused = this.tasks.request(change);
    if (refused) this.emit('taskRefused', refused);
  }
  submit(command: string): void { this.dispatcher.onSubmission(); this.shell.submit(command); }
  write(data: string): void {
    if (data.includes('\u0003')) this.dispatcher.onInterrupt();
    if (/[\r\n]/u.test(data)) this.dispatcher.onSubmission();
    this.shell.write(data);
  }
  interrupt(): void { this.dispatcher.onInterrupt(); this.shell.interrupt(); }
  queue(change: QueueOp): void { this.dispatcher.request(change); }
  async lookInput(): Promise<boolean> {
    const watch = this.shell.inputWatch;
    if (!watch) return false;
    await watch.lookNow();
    return true;
  }

  private queueShell(): QueueShell {
    const client = this;
    return {submit: command => client.shell.submit(command), get isReady() { return client.shell.isReady ?? true; },
      get adapter() { return {id: client.shellId}; }};
  }
  endInput(): void { this.shell.endInput(); }
  resize(columns: number, rows: number): void { this.size = {columns, rows}; this.shell.resize(columns, rows); }
  kill(): void { void this.tasks.shutdown(); this.shell.kill(); }
  detach(): void { void this.tasks.shutdown(); this.shell.kill(); }
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
    const next = this.factory({cwd, ...this.size, shell, contextId: this.contextId});
    const previous = this.shell;
    previous.removeAllListeners?.();
    previous.kill();
    this.shell = next;
    this.shellId = shell;
    this.knowledge = undefined;
    this.dispatcher.onShellSwitched(this.queueShell());
    this.wire(next);
    return {shell, pid: next.pid ?? 0};
  }
}

function defaultShell(options: SessionOptions): ShellSession {
  return new ShellSession(options.cwd, options.columns, options.rows, process.env.HOME || '',
    {...process.env, [SESSION_MODE_ENV]: 'in-process', ...(options.contextId ? {[SESSION_ID_ENV]: options.contextId} : {})}, options.shell ?? 'zsh');
}
