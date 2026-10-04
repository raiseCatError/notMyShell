import type {Reasoning} from './runtimes.js';
import {spawn} from 'node:child_process';
import {connect, type Socket} from 'node:net';
import {extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultRuntimeDir, ensurePrivateRuntimeDir, RUNTIME_DIR_ENV} from '../session/runtimeDir.js';
import type {LocalModelChoice, LocalUnderstandingMode} from '../prompt/configuration.js';
import {lineChannel, MODEL_PROTOCOL, modelSocketPath, type ClientMessage, type Priority, type ServiceMessage} from './ModelService.js';
import type {FoldRequest, IntentRequest} from './tasks.js';

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
  /** Protocol of the connected service; a different one is never spoken to. */
  protocol?: number;

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
          this.socket = undefined; this.send = undefined; this.protocol = undefined;
          for (const resolveRequest of this.pending.values()) resolveRequest(undefined);
          this.pending.clear();
        });
        this.send({type: 'hello', protocol: MODEL_PROTOCOL} satisfies ClientMessage);
        resolve(true);
      });
    });
  }

  private receive(message: ServiceMessage): void {
    if (message.type === 'welcome') { this.protocol = message.protocol; return; }
    const resolveRequest = this.pending.get(message.id);
    if (!resolveRequest) return;
    this.pending.delete(message.id);
    resolveRequest(message);
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
  async infer(task: 'intent' | 'fold', input: IntentRequest | FoldRequest, options: {priority: Priority; mode: LocalUnderstandingMode; model: LocalModelChoice; timeoutMs: number; reasoning?: Reasoning}): Promise<unknown> {
    if (!(await this.ensure()) || (this.protocol !== undefined && this.protocol !== MODEL_PROTOCOL)) return undefined;
    const reply = await this.request({type: 'infer', task, input, priority: options.priority, mode: options.mode, model: options.model, ...(options.reasoning ? {reasoning: options.reasoning} : {})} as never, options.timeoutMs);
    if (reply?.type === 'result' && reply.ok) { this.lastReasoning = reply.reasoning ?? 'fast'; return reply.output; }
    return undefined;
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
