import {spawn, spawnSync, type ChildProcess} from 'node:child_process';
import type {AgentEvent} from './model.js';

/**
 * Codex CLI through its own machine interface: `codex app-server`, JSON-RPC
 * messages (without the `"jsonrpc"` member) as newline-delimited JSON on
 * stdio. Codex owns the model, the agent loop, its tools, sandbox and
 * approval policy; NMSh starts a thread, sends the person's messages,
 * presents structured items and answers approval requests only with the
 * person's explicit choice. Anything NMSh does not implement is refused with
 * a JSON-RPC error, so Codex never waits on NMSh. No TUI is parsed.
 *
 * Shapes follow the protocol schema Codex generates
 * (`codex app-server generate-json-schema`, checked against codex-cli
 * 0.162.1, where `app-server` is marked experimental). Fields the schema does
 * not guarantee are optional here, and unknown messages produce nothing.
 */

export interface CodexCapabilities {
  /** `codex app-server` exists in this installation. */
  appServer: boolean;
  /** The CLI labels it experimental: shown to the person, never hidden. */
  experimental: boolean;
}

/** Read the installed CLI's own `app-server --help` (local, bounded) and keep only what it states. */
export function codexCapabilities(executable: string, help?: string): CodexCapabilities {
  const text = help ?? (spawnSync(executable, ['app-server', '--help'], {encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024}).stdout ?? '');
  return {appServer: /Usage:\s+codex app-server\b/u.test(text), experimental: /\[experimental\][^\n]*app server/iu.test(text)};
}

type Json = Record<string, unknown>;
const record = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const string = (value: unknown, limit = 4000): string | undefined => typeof value === 'string' && value.length <= limit ? value : undefined;
const firstLine = (value: string | undefined) => value?.split('\n')[0]!.slice(0, 160);

/** A thread item → a normalized tool event, when the item is a tool the person should see. Unknown kinds give nothing. */
export function codexToolEvent(item: unknown, phase: 'started' | 'completed'): AgentEvent | undefined {
  if (!record(item) || typeof item.id !== 'string') return undefined;
  const status = item.status === 'failed' || item.status === 'declined' ? 'failed' : phase === 'started' || item.status === 'inProgress' ? 'started' : 'finished';
  if (item.type === 'commandExecution') {
    const target = firstLine(string(item.command));
    const exit = typeof item.exitCode === 'number' ? item.exitCode : undefined;
    return {kind: 'tool', id: item.id, name: 'command', ...(target ? {target} : {}), status: status === 'finished' && exit !== undefined && exit !== 0 ? 'failed' : status,
      ...(phase === 'completed' && exit !== undefined ? {detail: `exit ${exit}${item.status === 'declined' ? ' (declined)' : ''}`} : item.status === 'declined' ? {detail: 'declined'} : {})};
  }
  if (item.type === 'fileChange') {
    const paths = (Array.isArray(item.changes) ? item.changes : []).flatMap(change => (record(change) && typeof change.path === 'string' ? [change.path] : []));
    return {kind: 'tool', id: item.id, name: 'file change', ...(paths[0] ? {target: firstLine(paths[0])} : {}), status,
      ...(paths.length > 1 ? {detail: `${paths.length} files`} : item.status === 'declined' ? {detail: 'declined'} : {})};
  }
  if (item.type === 'mcpToolCall') {
    const server = string(item.server, 120), tool = string(item.tool, 120);
    return tool ? {kind: 'tool', id: item.id, name: server ? `${server}.${tool}` : tool, status} : undefined;
  }
  return undefined;
}

export interface CodexMessageResult {
  events: AgentEvent[];
  /** A request from Codex that needs a response (an approval, or something NMSh refuses). */
  request?: {id: number | string; method: string; params: Json};
  /** A response to one of NMSh's requests. */
  response?: {id: number | string; result?: unknown; error?: unknown};
  turnId?: string;
}

/** One stdout line → normalized events and protocol bookkeeping. Unknown shapes produce nothing. */
export function codexMessage(line: string): CodexMessageResult {
  let message: Json;
  try { const parsed = JSON.parse(line) as unknown; if (!record(parsed)) return {events: []}; message = parsed; } catch { return {events: []}; }
  const id = typeof message.id === 'number' || typeof message.id === 'string' ? message.id : undefined;
  const method = typeof message.method === 'string' ? message.method : undefined;
  const params = record(message.params) ? message.params : {};
  if (id !== undefined && !method) return {events: [], response: {id, ...('result' in message ? {result: message.result} : {}), ...('error' in message ? {error: message.error} : {})}};
  if (id !== undefined && method) {
    if (method === 'item/commandExecution/requestApproval') {
      const target = firstLine(string(params.command));
      return {events: [{kind: 'approval', requestId: String(id), tool: 'command', ...(target ? {target} : {}),
        input: {...(target ? {command: string(params.command)} : {}), ...(string(params.cwd) ? {cwd: string(params.cwd)} : {}), ...(string(params.reason) ? {reason: string(params.reason)} : {})}}],
      request: {id, method, params}};
    }
    if (method === 'item/fileChange/requestApproval') {
      return {events: [{kind: 'approval', requestId: String(id), tool: 'file change', ...(string(params.reason) ? {input: {reason: string(params.reason)}} : {})}], request: {id, method, params}};
    }
    return {events: [], request: {id, method, params}};
  }
  switch (method) {
    case 'thread/started': {
      const thread = record(params.thread) ? params.thread : {};
      return {events: typeof thread.id === 'string' ? [{kind: 'started', harnessSessionId: thread.id}] : []};
    }
    case 'turn/started': {
      const turn = record(params.turn) ? params.turn : {};
      return {events: [], ...(typeof turn.id === 'string' ? {turnId: turn.id} : {})};
    }
    case 'item/started': return {events: [codexToolEvent(params.item, 'started')].filter((event): event is AgentEvent => event !== undefined)};
    case 'item/completed': {
      const item = params.item;
      if (record(item) && item.type === 'agentMessage') {
        const text = string(item.text, 1_000_000);
        return {events: text?.trim() ? [{kind: 'assistant', text}] : []};
      }
      return {events: [codexToolEvent(item, 'completed')].filter((event): event is AgentEvent => event !== undefined)};
    }
    case 'turn/completed': {
      const turn = record(params.turn) ? params.turn : {};
      const status = turn.status;
      if (status === 'completed') return {events: [{kind: 'settled', ok: true}]};
      if (status === 'interrupted') return {events: [{kind: 'settled', ok: false, interrupted: true}]};
      const error = record(turn.error) ? string(turn.error.message, 300) : undefined;
      return {events: [{kind: 'settled', ok: false, ...(error ? {message: error.split('\n')[0]} : {})}]};
    }
    default: return {events: []};
  }
}

export interface CodexSessionOptions {
  executable: string;
  /** Arguments before the protocol starts; `['app-server']` for Codex itself (tests substitute a fixture server). */
  args?: readonly string[];
  cwd: string;
  /** Resume this Codex thread id instead of starting a new thread. */
  resume?: string;
  env?: NodeJS.ProcessEnv;
  clientVersion?: string;
  onEvent(event: AgentEvent): void;
}

const MAX_FRAME = 8 * 1024 * 1024;

/** One managed `codex app-server` process with one thread. Implements the TargetAdapter contract. */
export class CodexSession {
  private child?: ChildProcess;
  private buffer = '';
  private nextId = 1;
  private readonly calls = new Map<number, 'initialize' | 'thread' | 'turn' | 'interrupt'>();
  /** Approval requests awaiting the person, by NMSh request id → Codex JSON-RPC id. */
  private readonly approvals = new Map<string, number | string>();
  private threadId?: string;
  private startedReported = false;
  private turnId?: string;
  private queued: string[] = [];
  private failed = false;
  private interruptTimer?: ReturnType<typeof setTimeout>;
  private initializeTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: CodexSessionOptions) {}

  get pid(): number | undefined { return this.child?.pid; }

  start(): {ok: true} | {ok: false; reason: string} {
    try {
      this.child = spawn(this.options.executable, [...(this.options.args ?? ['app-server'])], {cwd: this.options.cwd, env: this.options.env ?? process.env, stdio: ['pipe', 'pipe', 'ignore']});
    } catch (error) { return {ok: false, reason: error instanceof Error ? error.message : String(error)}; }
    const child = this.child;
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => this.read(chunk));
    child.stdin!.on('error', () => { /* the exit event reports it */ });
    child.on('error', () => this.options.onEvent({kind: 'exited', code: -1}));
    child.on('exit', code => { this.child = undefined; this.options.onEvent({kind: 'exited', code}); });
    this.call('initialize', 'initialize', {clientInfo: {name: 'nmsh', title: 'notMyShell', version: this.options.clientVersion ?? '0'}});
    this.initializeTimer = setTimeout(() => this.fail('Codex app-server did not initialize in time'), 15000);
    this.initializeTimer.unref();
    return {ok: true};
  }

  private write(message: Json): boolean {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) return false;
    stdin.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  private call(kind: 'initialize' | 'thread' | 'turn' | 'interrupt', method: string, params: Json): boolean {
    const id = this.nextId++;
    this.calls.set(id, kind);
    return this.write({id, method, params});
  }

  private fail(reason: string): void {
    if (this.failed) return;
    this.failed = true; this.queued = [];
    clearTimeout(this.initializeTimer);
    this.options.onEvent({kind: 'settled', ok: false, message: reason});
    this.close();
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_FRAME && !this.buffer.includes('\n')) { this.buffer = ''; this.options.onEvent({kind: 'incomplete', reason: 'Provider frame exceeds 8 MiB safety limit'}); return; }
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      if (line.length > MAX_FRAME) { this.options.onEvent({kind: 'incomplete', reason: 'Provider frame exceeds 8 MiB safety limit'}); continue; }
      this.handle(codexMessage(line));
    }
  }

  private handle({events, request, response, turnId}: CodexMessageResult): void {
    if (turnId) this.turnId = turnId;
    if (response && typeof response.id === 'number') {
      const kind = this.calls.get(response.id);
      this.calls.delete(response.id);
      if (response.error !== undefined) {
        if (kind === 'initialize' || kind === 'thread') this.fail(kind === 'initialize' ? 'Codex app-server refused initialization' : 'Codex could not start a thread');
        else if (kind === 'turn') this.options.onEvent({kind: 'settled', ok: false, message: 'Codex refused the message'});
        else if (kind === 'interrupt') this.options.onEvent({kind: 'incomplete', reason: 'Codex refused the interrupt request'});
        return;
      }
      if (kind === 'initialize') {
        clearTimeout(this.initializeTimer);
        this.write({method: 'initialized'});
        this.call('thread', this.options.resume ? 'thread/resume' : 'thread/start', this.options.resume ? {threadId: this.options.resume} : {cwd: this.options.cwd});
      } else if (kind === 'thread') {
        const result = record(response.result) ? response.result : {};
        const thread = record(result.thread) ? result.thread : {};
        if (typeof thread.id !== 'string') { this.fail('Codex started a thread without an id'); return; }
        this.threadId = thread.id;
        if (!this.startedReported) { this.startedReported = true; this.options.onEvent({kind: 'started', harnessSessionId: thread.id}); }
        const model = typeof result.model === 'string' && /^[A-Za-z0-9][\w.:@/-]{0,79}$/u.test(result.model) ? result.model : undefined;
        if (model) this.options.onEvent({kind: 'model', model});
        for (const text of this.queued.splice(0)) this.startTurn(text);
      } else if (kind === 'turn') {
        const result = record(response.result) ? response.result : {};
        const turn = record(result.turn) ? result.turn : {};
        if (typeof turn.id === 'string') this.turnId = turn.id;
      }
      return;
    }
    for (const event of events) {
      if (event.kind === 'started') { if (this.startedReported) continue; this.startedReported = true; } // thread/started and the thread/start response may arrive in either order
      if (event.kind === 'settled') { clearTimeout(this.interruptTimer); this.interruptTimer = undefined; this.turnId = undefined; this.approvals.clear(); }
      this.options.onEvent(event);
    }
    if (request) {
      const approval = events.find(event => event.kind === 'approval');
      if (approval?.kind === 'approval') this.approvals.set(approval.requestId, request.id);
      // Requests NMSh does not implement are refused rather than ignored, so Codex never waits on NMSh.
      else this.write({id: request.id, error: {code: -32601, message: 'Not supported by NMSh'}});
    }
  }

  private startTurn(text: string): boolean {
    return this.call('turn', 'turn/start', {threadId: this.threadId, input: [{type: 'text', text, text_elements: []}]});
  }

  send(text: string): boolean {
    if (!this.child || this.failed || text.length > 1_000_000) return false;
    if (this.threadId) { if (!this.startTurn(text)) return false; }
    else if (this.queued.length < 16) this.queued.push(text);
    else { this.options.onEvent({kind: 'incomplete', reason: 'Provider message queue limit reached'}); return false; }
    this.options.onEvent({kind: 'user', text});
    return true;
  }

  /** Answer one approval with the person's explicit choice: accept once, or decline. Never "for the session". */
  answer(requestId: string, allow: boolean): boolean {
    const id = this.approvals.get(requestId);
    if (id === undefined || !this.child) return false;
    if (!this.write({id, result: {decision: allow ? 'accept' : 'decline'}})) return false;
    this.approvals.delete(requestId);
    this.options.onEvent({kind: 'approvalAnswered', requestId, allowed: allow});
    return true;
  }

  /**
   * Ask Codex to interrupt the running turn. A request is not an acknowledged cancellation: only a turn that completes
   * as `interrupted` is reported as one. Without an answer in time, the person is told the request is unconfirmed.
   */
  cancel(): void {
    if (!this.child || !this.threadId || !this.turnId) return;
    this.approvals.clear(); this.options.onEvent({kind: 'requestsCleared'});
    this.call('interrupt', 'turn/interrupt', {threadId: this.threadId, turnId: this.turnId});
    clearTimeout(this.interruptTimer);
    this.interruptTimer = setTimeout(() => this.options.onEvent({kind: 'incomplete', reason: 'Interrupt requested; Codex has not confirmed it yet'}), 5000);
    this.interruptTimer.unref();
  }

  close(): void {
    clearTimeout(this.interruptTimer);
    clearTimeout(this.initializeTimer);
    const child = this.child;
    if (!child) return;
    child.stdin?.end();
    setTimeout(() => { if (this.child === child) child.kill('SIGTERM'); }, 2000).unref();
    setTimeout(() => { if (this.child === child) child.kill('SIGKILL'); }, 5000).unref();
  }
}
