import type {Reasoning} from './runtimes.js';
import {spawn} from 'node:child_process';
import {connect, type Socket} from 'node:net';
import {extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultRuntimeDir, ensurePrivateRuntimeDir, RUNTIME_DIR_ENV} from '../session/runtimeDir.js';
import type {LocalModelChoice, LocalUnderstandingMode} from '../prompt/configuration.js';
import {lineChannel, MODEL_PROTOCOL, modelSocketPath, type ClientMessage, type Priority, type ServiceMessage} from './ModelService.js';
import type {AnswerRequest, AnswerStats, CommandRequest, FoldRequest, IntentRequest} from './tasks.js';

export interface ModelStatus {state: string; model?: string; runtime?: string; clients: number; queued: number; error?: string}

/**
 * One NMSh window's connection to the user-global model service, started on
 * first use. Every failure resolves to "no answer" so callers fall back to
 * deterministic behavior; the model service can never break a window.
 */
export class ModelClient {
  private socket?: Socket;
  private send?: (message: unknown) => void;
  private connecting?: Promise<boolean>;
  private nextId = 1;
  private readonly pending = new Map<number, (message: ServiceMessage | undefined) => void>();
  /** Partial-text listeners for streamed answers, by request id. */
  private readonly partials = new Map<number, (text: string) => void>();
  /** Protocol of the connected service; a different one is never spoken to. */
  protocol?: number;
  /** What the connected service says it can do (an older service lacks newer tasks, such as 'command'). */
  features: ReadonlySet<string> = new Set();

  constructor(private readonly socketPath = modelSocketPath(defaultRuntimeDir()),
    private readonly start: () => void = startModelService) {}

  private open(): Promise<boolean> {
    return new Promise(resolve => {
      const socket = connect(this.socketPath);
      const fail = () => { socket.destroy(); resolve(false); };
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.off('error', fail);
        socket.on('error', () => {});
        this.socket = socket;
        this.send = lineChannel(socket, message => this.receive(message as ServiceMessage));
        socket.on('close', () => {
          this.socket = undefined; this.send = undefined; this.protocol = undefined; this.features = new Set();
          for (const resolveRequest of this.pending.values()) resolveRequest(undefined);
          this.pending.clear();
          this.partials.clear();
        });
        this.send({type: 'hello', protocol: MODEL_PROTOCOL} satisfies ClientMessage);
        resolve(true);
      });
    });
  }

  private receive(message: ServiceMessage): void {
    if (message.type === 'welcome') {
      this.protocol = message.protocol;
      this.features = new Set(message.features ?? []);
      for (const done of this.welcomeWaiters.splice(0)) done();
      return;
    }
    if (message.type === 'partial') { this.partials.get(message.id)?.(message.text); return; }
    const resolveRequest = this.pending.get(message.id);
    if (!resolveRequest) return;
    this.pending.delete(message.id);
    resolveRequest(message);
  }

  private welcomeWaiters: Array<() => void> = [];

  /** Whether the service's welcome has arrived, waiting at most timeoutMs for it. */
  private welcomed(timeoutMs: number): Promise<boolean> {
    if (this.protocol !== undefined) return Promise.resolve(true);
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.welcomeWaiters = this.welcomeWaiters.filter(item => item !== done); resolve(false); }, timeoutMs);
      timer.unref?.();
      const done = () => { clearTimeout(timer); resolve(true); };
      this.welcomeWaiters.push(done);
    });
  }

  /** Connect, starting the one service if none answers; concurrent windows race safely (one binds, the rest connect). */
  async ensure(): Promise<boolean> {
    if (this.socket) return true;
    this.connecting ??= (async () => {
      if (await this.open()) return true;
      this.start();
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
        if (await this.open()) return true;
      }
      return false;
    })().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private request(message: Omit<Extract<ClientMessage, {id: number}>, 'id'>, timeoutMs: number): Promise<ServiceMessage | undefined> {
    return new Promise(resolve => {
      if (!this.send) { resolve(undefined); return; }
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); resolve(undefined); }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, reply => { clearTimeout(timer); resolve(reply); });
      this.send({...message, id});
    });
  }

  async infer(task: 'intent', input: IntentRequest, options: {priority: Priority; mode: LocalUnderstandingMode; model: LocalModelChoice; timeoutMs: number; reasoning?: Reasoning}): Promise<unknown>;
  async infer(task: 'fold', input: FoldRequest, options: {priority: Priority; mode: LocalUnderstandingMode; model: LocalModelChoice; timeoutMs: number; reasoning?: Reasoning}): Promise<unknown>;
  async infer(task: 'command', input: CommandRequest, options: {priority: Priority; mode: LocalUnderstandingMode; model: LocalModelChoice; timeoutMs: number; reasoning?: Reasoning}): Promise<unknown>;
  async infer(task: 'intent' | 'fold' | 'command', input: IntentRequest | FoldRequest | CommandRequest, options: {priority: Priority; mode: LocalUnderstandingMode; model: LocalModelChoice; timeoutMs: number; reasoning?: Reasoning}): Promise<unknown> {
    if (!(await this.ensure()) || (this.protocol !== undefined && this.protocol !== MODEL_PROTOCOL)) return undefined;
    // A service started by an older NMSh does not know newer tasks; it is never sent one. Its welcome (sent right
    // after connecting) says which it knows.
    if (task === 'command' && (!(await this.welcomed(1500)) || !this.features.has('command'))) return undefined;
    const reply = await this.request({type: 'infer', task, input, priority: options.priority, mode: options.mode, model: options.model, ...(options.reasoning ? {reasoning: options.reasoning} : {})} as never, options.timeoutMs);
    if (reply?.type === 'result' && reply.ok) { this.lastReasoning = reply.reasoning ?? 'fast'; return reply.output; }
    return undefined;
  }

  /**
   * One general answer. `onPartial` receives the sanitized answer so far while it streams; aborting `signal` sends
   * a cancel for this request only and resolves at once as cancelled. Never throws: every failure is a reason.
   */
  async answer(input: AnswerRequest, options: {mode: LocalUnderstandingMode; model: LocalModelChoice; timeoutMs: number; reasoning: Reasoning; signal?: AbortSignal; onPartial?: (text: string) => void}):
    Promise<{ok: true; output: unknown; reasoning: Reasoning; stats?: AnswerStats} | {ok: false; reason: 'unavailable' | 'old-service' | 'timeout' | 'cancelled' | 'failed'; error?: string}> {
    if (options.signal?.aborted) return {ok: false, reason: 'cancelled'};
    if (!(await this.ensure()) || (this.protocol !== undefined && this.protocol !== MODEL_PROTOCOL)) return {ok: false, reason: 'unavailable'};
    if (!(await this.welcomed(1500))) return {ok: false, reason: 'unavailable'};
    if (!this.features.has('answer')) return {ok: false, reason: 'old-service'};
    if (!this.send) return {ok: false, reason: 'unavailable'};
    // Cancelled while connecting: nothing is sent.
    if (options.signal?.aborted) return {ok: false, reason: 'cancelled'};
    const id = this.nextId++;
    const stream = Boolean(options.onPartial) && this.features.has('stream');
    return new Promise(resolve => {
      let settled = false;
      const finish = (value: Awaited<ReturnType<ModelClient['answer']>>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        this.pending.delete(id);
        this.partials.delete(id);
        resolve(value);
      };
      const abort = () => {
        if (this.features.has('cancel')) this.send?.({type: 'cancel', id} satisfies ClientMessage);
        finish({ok: false, reason: 'cancelled'});
      };
      const timer = setTimeout(() => { if (this.features.has('cancel')) this.send?.({type: 'cancel', id} satisfies ClientMessage); finish({ok: false, reason: 'timeout'}); }, options.timeoutMs);
      timer.unref?.();
      options.signal?.addEventListener('abort', abort, {once: true});
      if (stream) this.partials.set(id, text => { if (!settled) options.onPartial!(text); });
      this.pending.set(id, reply => {
        if (reply?.type === 'result' && reply.ok) { this.lastReasoning = reply.reasoning ?? 'fast'; finish({ok: true, output: reply.output, reasoning: reply.reasoning ?? 'fast', ...(reply.stats ? {stats: reply.stats} : {})}); return; }
        finish(reply?.type === 'result' && !reply.ok ? {ok: false, reason: reply.error === 'cancelled' ? 'cancelled' : reply.error === 'timed out' ? 'timeout' : 'failed', error: reply.error}
          : {ok: false, reason: 'unavailable'});
      });
      this.send!({type: 'infer', task: 'answer', id, input, priority: 'interactive', mode: options.mode, model: options.model, reasoning: options.reasoning, ...(stream ? {stream: true} : {})} satisfies ClientMessage);
    });
  }

  /** The mode the service actually used for the newest successful result (diagnostics only). */
  lastReasoning: Reasoning = 'fast';

  /** Ask the running service to unload its model now; never starts a service. */
  async unload(): Promise<boolean> {
    if (!this.socket && !(await this.open())) return false;
    this.send?.({type: 'unload'});
    return true;
  }

  /** Status of a service that is already running; never starts one. */
  async status(): Promise<ModelStatus | undefined> {
    if (!this.socket && !(await this.open())) return undefined;
    const reply = await this.request({type: 'status'} as never, 1500);
    return reply?.type === 'status' ? {state: reply.state, clients: reply.clients, queued: reply.queued,
      ...(reply.model ? {model: reply.model} : {}), ...(reply.runtime ? {runtime: reply.runtime} : {}), ...(reply.error ? {error: reply.error} : {})} : undefined;
  }

  /** Tell a running service the mode changed (Off unloads it and lets it exit). */
  configure(mode: LocalUnderstandingMode): void {
    this.send?.({type: 'configure', mode} satisfies ClientMessage);
  }

  close(): void {
    this.socket?.destroy();
    this.socket = undefined;
  }
}

function startModelService(): void {
  const here = fileURLToPath(import.meta.url);
  const entry = fileURLToPath(new URL(`../modelService${extname(here)}`, import.meta.url));
  const runtimeDir = defaultRuntimeDir();
  try { ensurePrivateRuntimeDir(runtimeDir); } catch { return; }
  const execArgv = process.execArgv.filter(arg => !arg.startsWith('--test') && !arg.startsWith('--inspect'));
  const child = spawn(process.execPath, [...execArgv, entry], {detached: true, stdio: 'ignore',
    env: {PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, [RUNTIME_DIR_ENV]: runtimeDir}});
  child.on('error', () => {});
  child.unref();
}
