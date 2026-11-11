import {existsSync, unlinkSync} from 'node:fs';
import {connect, createServer, type Server, type Socket} from 'node:net';
import {join} from 'node:path';
import type {LocalModelChoice, LocalUnderstandingMode} from '../prompt/configuration.js';
import {isQwen3, type ModelRuntime, type Reasoning} from './runtimes.js';
import {answerMessages, ANSWER_TOKENS, boundAnswerRequest, commandPrompt, COMMAND_SCHEMA, foldPrompt, FOLD_SCHEMA, intentPrompt, INTENT_SCHEMA, sanitizeModelText, type AnswerRequest, type AnswerStats, type CommandRequest, type FoldRequest, type IntentRequest} from './tasks.js';

/**
 * The user-global local model service. Every NMSh window is a client of one
 * process that owns one runtime and one loaded model, so memory is shared,
 * not multiplied per window. Requests are self-contained (each carries only
 * its own bounded facts); the service keeps no conversation, transcript or
 * per-window context between requests. A general answer carries its own
 * bounded history from the asking window; nothing of it stays here, and the
 * runtime's prompt cache is off, so one window's conversation never reaches another's.
 */
export const MODEL_PROTOCOL = 1;
/** answer: the general-answer task; stream: partial text while it generates; cancel: a client may stop its own request. */
export const MODEL_FEATURES = ['intent', 'fold', 'status', 'command', 'answer', 'stream', 'cancel'] as const;
export const modelSocketPath = (runtimeDir: string) => join(runtimeDir, `nmsh-model-v${MODEL_PROTOCOL}.sock`);

export type Priority = 'interactive' | 'diagnostic' | 'background';
const PRIORITY_ORDER: Record<Priority, number> = {interactive: 0, diagnostic: 1, background: 2};
export type ModelState = 'unloaded' | 'loading' | 'ready' | 'busy' | 'error';

export type ClientMessage =
  | {type: 'hello'; protocol: number}
  | {type: 'infer'; id: number; priority: Priority; task: 'intent'; input: IntentRequest; mode: LocalUnderstandingMode; model: LocalModelChoice; reasoning?: Reasoning}
  | {type: 'infer'; id: number; priority: Priority; task: 'fold'; input: FoldRequest; mode: LocalUnderstandingMode; model: LocalModelChoice; reasoning?: Reasoning}
  /** #432: one suggested shell command; only to services that advertise 'command'. */
  | {type: 'infer'; id: number; priority: Priority; task: 'command'; input: CommandRequest; mode: LocalUnderstandingMode; model: LocalModelChoice; reasoning?: Reasoning}
  /** A general answer; only to services that advertise 'answer'. `stream` asks for partial text as it is generated. */
  | {type: 'infer'; id: number; priority: Priority; task: 'answer'; input: AnswerRequest; mode: LocalUnderstandingMode; model: LocalModelChoice; reasoning?: Reasoning; stream?: boolean}
  /** Stop one of this client's own requests: dropped if queued, aborted if running. Another client's work is never touched. */
  | {type: 'cancel'; id: number}
  | {type: 'status'; id: number}
  | {type: 'configure'; mode: LocalUnderstandingMode; model?: LocalModelChoice}
  /** Unload the model now (it loads again on next use); queued work still finishes first. */
  | {type: 'unload'};

export type ServiceMessage =
  | {type: 'welcome'; protocol: number; features: readonly string[]; build?: string}
  | {type: 'result'; id: number; ok: true; output: unknown; reasoning?: Reasoning; stats?: AnswerStats}
  /** Answer text generated so far (sanitized, cumulative); the final result still carries the whole answer. */
  | {type: 'partial'; id: number; text: string}
  | {type: 'result'; id: number; ok: false; error: string}
  | {type: 'status'; id: number; state: ModelState; model?: string; runtime?: string; clients: number; queued: number; error?: string};

export interface ModelServiceOptions {
  runtimeFor: (model: LocalModelChoice) => ModelRuntime | undefined;
  /** Auto: unload after this long without requests (global, across all windows). */
  idleMs?: number;
  /** With no clients left: unload and exit after this grace period. */
  graceMs?: number;
  /** Background (folding) work older than this is stale and dropped. */
  staleMs?: number;
  requestTimeoutMs?: number;
  /** Generation limit for a general answer (non-thinking; a thinking pass gets half again). */
  answerTimeoutMs?: number;
  build?: string;
  onExit?: () => void;
  now?: () => number;
}

type Task = 'intent' | 'fold' | 'command' | 'answer';
interface Job {client: Client; id: number; priority: Priority; task: Task; input: unknown; model: LocalModelChoice; enqueued: number; reasoning: Reasoning; stream: boolean; controller: AbortController}
interface Client {send: (message: ServiceMessage) => void}

const TOKEN_BUDGET = {intent: 160, fold: 40, command: 220, answer: ANSWER_TOKENS.fast} as const;
/** A bounded thinking pass: room for brief reasoning plus the JSON answer, never open-ended. */
const THINKING_BUDGET = 640;

export class ModelService {
  private readonly clients = new Set<Client>();
  private readonly queue: Job[] = [];
  private runtime?: ModelRuntime;
  private model?: LocalModelChoice;
  private mode: LocalUnderstandingMode = 'auto';
  state: ModelState = 'unloaded';
  private error?: string;
  private working = false;
  private idleTimer?: NodeJS.Timeout;
  private graceTimer?: NodeJS.Timeout;
  /** Diagnostics for tests: how many times a model was loaded. */
  loads = 0;
  private readonly idleMs: number;
  private readonly graceMs: number;
  private readonly staleMs: number;
  private readonly requestTimeoutMs: number;
  private readonly answerTimeoutMs: number;
  private readonly now: () => number;
  /** The job the runtime is working on, so its own client can cancel it. */
  private current?: Job;

  constructor(private readonly options: ModelServiceOptions) {
    this.idleMs = options.idleMs ?? 90_000;
    this.graceMs = options.graceMs ?? 30_000;
    this.staleMs = options.staleMs ?? 10_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
    this.answerTimeoutMs = options.answerTimeoutMs ?? 45_000;
    this.now = options.now ?? Date.now;
  }

  get clientCount(): number { return this.clients.size; }

  connect(client: Client): void {
    this.clients.add(client);
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = undefined; }
    client.send({type: 'welcome', protocol: MODEL_PROTOCOL, features: MODEL_FEATURES, ...(this.options.build ? {build: this.options.build} : {})});
  }

  disconnect(client: Client): void {
    this.clients.delete(client);
    // Only this client's queued work goes; another window's requests and the loaded model stay.
    for (let index = this.queue.length - 1; index >= 0; index -= 1) if (this.queue[index]!.client === client) this.queue.splice(index, 1);
    // A closed window's answer stops generating; nobody is left to read it.
    if (this.current?.client === client) this.current.controller.abort(new Error('cancelled'));
    if (this.clients.size === 0) this.scheduleGrace();
  }

  handle(client: Client, message: ClientMessage): void {
    if (message.type === 'hello') return;
    if (message.type === 'status') {
      client.send({type: 'status', id: message.id, state: this.state, ...(this.model ? {model: this.model.label, runtime: this.model.runtime} : {}),
        clients: this.clients.size, queued: this.queue.length, ...(this.error ? {error: this.error} : {})});
      return;
    }
    if (message.type === 'unload') { void (async () => { while (this.working) await new Promise(resolve => setTimeout(resolve, 50)); await this.unload(); })(); return; }
    if (message.type === 'cancel') {
      const queued = this.queue.find(job => job.client === client && job.id === message.id);
      if (queued) { this.drop(queued, 'cancelled'); return; }
      if (this.current?.client === client && this.current.id === message.id) this.current.controller.abort(new Error('cancelled'));
      return;
    }
    if (message.type === 'configure') {
      this.mode = message.mode;
      if (message.mode === 'off') void this.shutdownWhenIdle();
      return;
    }
    if (message.mode === 'off') { client.send({type: 'result', id: message.id, ok: false, error: 'local understanding is off'}); return; }
    this.mode = message.mode;
    if (message.priority === 'background') {
      // Advisory work never piles up: keep the newest few, drop stale ones.
      const background = this.queue.filter(job => job.priority === 'background');
      if (background.length >= 3) this.drop(background[0]!, 'superseded');
    }
    if (message.task === 'answer' && !boundAnswerRequest(message.input)) { client.send({type: 'result', id: message.id, ok: false, error: 'malformed request'}); return; }
    this.queue.push({client, id: message.id, priority: message.priority, task: message.task, input: message.input, model: message.model, enqueued: this.now(),
      // Smart Folding and command suggestions are always non-thinking; only an Ask intent retry or an answer the
      // person asked to think through may use a bounded thinking pass.
      reasoning: (message.task === 'intent' || message.task === 'answer') && message.reasoning === 'thinking' ? 'thinking' : 'fast',
      stream: message.task === 'answer' && message.stream === true, controller: new AbortController()});
    this.queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.enqueued - b.enqueued);
    void this.pump();
  }

  private drop(job: Job, reason: string): void {
    const index = this.queue.indexOf(job);
    if (index !== -1) this.queue.splice(index, 1);
    job.client.send({type: 'result', id: job.id, ok: false, error: reason});
  }

  private async pump(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        if (job.priority === 'background' && this.now() - job.enqueued > this.staleMs) { job.client.send({type: 'result', id: job.id, ok: false, error: 'stale'}); continue; }
        if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
        this.current = job;
        try {
          const runtime = await this.ensureLoaded(job.model);
          if (job.controller.signal.aborted) throw new Error('cancelled');
          this.state = 'busy';
          if (job.task === 'answer') { await this.answer(job, runtime); continue; }
          const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(this.requestTimeoutMs)]);
          const prompt = job.task === 'intent' ? intentPrompt(job.input as IntentRequest) : job.task === 'command' ? commandPrompt(job.input as CommandRequest) : foldPrompt(job.input as FoldRequest);
          // Only llama.cpp gets the explicit Qwen3 template; other runtimes apply their own and stay non-thinking.
          if (job.reasoning === 'thinking' && job.model.runtime !== 'llama.cpp') job.reasoning = 'fast';
          const output = await runtime.infer(prompt, job.task === 'intent' ? INTENT_SCHEMA : job.task === 'command' ? COMMAND_SCHEMA : FOLD_SCHEMA, job.reasoning === 'thinking' ? THINKING_BUDGET : TOKEN_BUDGET[job.task], signal,
            {reasoning: job.reasoning, qwen3: isQwen3(job.model)});
          this.state = 'ready';
          job.client.send({type: 'result', id: job.id, ok: true, output, reasoning: job.reasoning});
        } catch (error) {
          const message = job.controller.signal.aborted ? 'cancelled' : error instanceof Error ? error.message : String(error);
          this.state = this.runtime?.loaded ? 'ready' : 'error';
          // A cancelled request is not a model error: status keeps showing the model as it is.
          if (message !== 'cancelled') this.error = message;
          job.client.send({type: 'result', id: job.id, ok: false, error: message});
        } finally { this.current = undefined; }
      }
    } finally {
      this.working = false;
      this.scheduleIdle();
    }
  }

  /**
   * One general answer: bounded request, published Qwen3 settings for the mode, a token budget and a time limit,
   * and partial text (sanitized, at most every 50 ms) when the client asked for a stream. The result is
   * {text, truncated}; the client validates it again.
   */
  private async answer(job: Job, runtime: ModelRuntime): Promise<void> {
    const request = boundAnswerRequest(job.input)!;
    if (!runtime.generate) throw new Error(`${runtime.label} cannot answer questions`);
    if (job.reasoning === 'thinking' && job.model.runtime === 'lmstudio') job.reasoning = 'fast';
    const timeout = job.reasoning === 'thinking' ? this.answerTimeoutMs * 1.5 : this.answerTimeoutMs;
    const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(timeout)]);
    let text = '';
    let sent = 0;
    let timer: NodeJS.Timeout | undefined;
    const flush = () => {
      timer = undefined;
      // Reasoning is never streamed: only what follows a closed think block (or text with none) is shown.
      const shown = sanitizeModelText(text);
      if (shown.length !== sent) { sent = shown.length; job.client.send({type: 'partial', id: job.id, text: shown}); }
    };
    try {
      const generated = await runtime.generate(answerMessages(request), job.reasoning === 'thinking' ? ANSWER_TOKENS.thinking : ANSWER_TOKENS.fast, signal, {
        reasoning: job.reasoning, qwen3: isQwen3(job.model),
        ...(job.stream ? {onText: (piece: string) => { text += piece; timer ??= setTimeout(flush, 50); }} : {})});
      if (timer) { clearTimeout(timer); timer = undefined; }
      this.state = 'ready';
      job.client.send({type: 'result', id: job.id, ok: true, output: {text: generated.text, truncated: generated.truncated}, reasoning: job.reasoning, ...(generated.stats ? {stats: generated.stats} : {})});
    } catch (error) {
      // The generation limit, not the person: said as such.
      if (signal.aborted && !job.controller.signal.aborted) throw new Error('timed out');
      throw error;
    } finally { if (timer) clearTimeout(timer); }
  }

  private async ensureLoaded(model: LocalModelChoice): Promise<ModelRuntime> {
    const same = this.model && this.model.runtime === model.runtime && this.model.path === model.path && this.model.name === model.name;
    if (this.runtime?.loaded && same) return this.runtime;
    if (this.runtime) await this.runtime.unload();
    const runtime = this.options.runtimeFor(model);
    if (!runtime) { this.runtime = undefined; throw new Error(`no ${model.runtime} runtime is available for ${model.label}`); }
    this.state = 'loading';
    this.runtime = runtime;
    this.model = model;
    await runtime.load();
    this.loads += 1;
    this.error = undefined;
    this.state = 'ready';
    return runtime;
  }

  /** Auto unloads after a global idle period; Always keeps the one model warm while any window is connected. */
  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.mode === 'always' && this.clients.size > 0) return;
    this.idleTimer = setTimeout(() => { this.idleTimer = undefined; if (!this.queue.length && !this.working) void this.unload(); }, this.idleMs);
    this.idleTimer.unref?.();
  }

  private scheduleGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => { this.graceTimer = undefined; if (this.clients.size === 0) void this.shutdownWhenIdle(); }, this.graceMs);
    this.graceTimer.unref?.();
  }

  async unload(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = undefined;
    if (runtime) await runtime.unload();
    if (this.state !== 'error') this.state = 'unloaded';
  }

  private async shutdownWhenIdle(): Promise<void> {
    while (this.working) await new Promise(resolve => setTimeout(resolve, 50));
    await this.unload();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.clients.size === 0 || this.mode === 'off') this.options.onExit?.();
  }
}

/** JSON-lines over a private Unix socket. */
export function lineChannel(socket: Socket, onMessage: (message: unknown) => void): (message: unknown) => void {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) { socket.destroy(); return; }
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try { onMessage(JSON.parse(line)); } catch { socket.destroy(); return; }
    }
  });
  return message => { if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`); };
}

/**
 * Bind the user's one model-service socket. If another service already
 * answers there, this one exits; a stale socket file is replaced. Two
 * simultaneous starters cannot both bind the path.
 */
export function serveModelService(socketPath: string, service: ModelService): Promise<Server | undefined> {
  return new Promise(resolve => {
    const server = createServer(socket => {
      const client = {send: lineChannel(socket, message => service.handle(client, message as ClientMessage))};
      service.connect(client);
      socket.on('close', () => service.disconnect(client));
      socket.on('error', () => {});
    });
    const listen = (retry: boolean) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EADDRINUSE' || !retry) { resolve(undefined); return; }
        const probe = connect(socketPath);
        probe.once('connect', () => { probe.destroy(); resolve(undefined); });
        probe.once('error', () => { try { if (existsSync(socketPath)) unlinkSync(socketPath); } catch { /* raced */ } listen(false); });
      });
      server.listen(socketPath, () => resolve(server));
    };
    listen(true);
  });
}
