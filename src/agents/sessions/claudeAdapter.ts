import {spawn, spawnSync, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import type {AgentEvent, AgentQuestion} from './model.js';
import {ClaudeStream, parseCatalog, parseContextUsage, parseSuggestions, parseToolResult, type PartialUpdate} from './claudeStream.js';
import type {ContextSnapshot, TelemetryUpdate} from '../telemetry.js';

export function claudeQuestions(input: unknown): AgentQuestion[] | undefined {
  const value = input as {questions?: unknown} | undefined;
  if (!Array.isArray(value?.questions) || value.questions.length < 1 || value.questions.length > 4) return undefined;
  const questions: AgentQuestion[] = [];
  for (const q of value.questions) {
    if (!q || typeof q.question !== 'string' || q.question.length > 10000 || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8) return undefined;
    const options: AgentQuestion['options'] = [];
    for (const option of q.options) {
      if (!option || typeof option.label !== 'string' || option.label.length > 1000) return undefined;
      options.push({label: option.label, description: typeof option.description === 'string' ? option.description.slice(0, 4000) : ''});
    }
    questions.push({question: q.question, header: typeof q.header === 'string' ? q.header.slice(0, 100) : '', options, multiSelect: q.multiSelect === true});
  }
  return questions;
}

/**
 * Claude Code through its own machine interface: `--print` with stream-json
 * input and output (the interface the installed CLI documents in --help).
 * NMSh answers permission prompts as the host only when the person chooses;
 * it never approves on its own, and anything it does not understand is
 * denied. No TUI is parsed and no model API is called by NMSh.
 */

export interface ClaudeCapabilities {
  streamJson: boolean;
  /** `--permission-prompts host`: NMSh answers each prompt; otherwise prompts are denied by the harness. */
  hostPermissions: boolean;
  resume: boolean;
  sessionId: boolean;
  /** `--include-partial-messages`: replies stream in as they are written (presentation only). */
  partialMessages?: boolean;
  /** `--effort <level>` at launch. */
  effortFlag?: boolean;
}

const capabilityCache = new Map<string, ClaudeCapabilities>();

/** Read the installed CLI's own --help (local, bounded) and keep only what it documents. */
export function claudeCapabilities(executable: string, help?: string): ClaudeCapabilities {
  const cached = help === undefined ? capabilityCache.get(executable) : undefined;
  if (cached) return cached;
  const text = help ?? (spawnSync(executable, ['--help'], {encoding: 'utf8', timeout: 5000, maxBuffer: 512 * 1024}).stdout ?? '');
  const capabilities = {
    streamJson: /--input-format[\s\S]*stream-json/u.test(text) && /--output-format[\s\S]*stream-json/u.test(text) && /--print\b/u.test(text),
    hostPermissions: /--permission-prompts[\s\S]{0,200}"host"/u.test(text),
    resume: /--resume\b/u.test(text),
    sessionId: /--session-id\b/u.test(text),
    ...(/--include-partial-messages\b/u.test(text) ? {partialMessages: true} : {}),
    ...(/--effort\b/u.test(text) ? {effortFlag: true} : {}),
  };
  if (help === undefined) capabilityCache.set(executable, capabilities);
  return capabilities;
}

/** The factual target of a tool call from its input: a path, a command or a pattern, never invented. */
function toolTarget(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'description']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.split('\n')[0]!.slice(0, 160);
  }
  return undefined;
}

const textOf = (content: unknown): string => typeof content === 'string' ? content
  : Array.isArray(content) ? content.map(part => (part && typeof part === 'object' && (part as {type?: unknown}).type === 'text' ? String((part as {text?: unknown}).text ?? '') : '')).join('') : '';

/** A model id the provider reported: a plain identifier, never a placeholder such as `<synthetic>` on error messages. */
const runtimeModel = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9][\w.:@/-]{0,79}$/u.test(value) ? value : undefined;

/** Readable words for a provider error code (`authentication_failed` → `authentication failed`); unknown shapes give nothing. */
export function providerErrorLabel(code: unknown): string | undefined {
  if (typeof code !== 'string' || !/^[a-z][a-z0-9_]{0,48}$/u.test(code)) return undefined;
  const known: Record<string, string> = {authentication_failed: 'authentication failed', billing_error: 'billing or usage limit', rate_limit: 'rate limited',
    invalid_request: 'invalid request', server_error: 'provider server error', max_output_tokens: 'output limit reached'};
  return known[code] ?? code.replace(/_/gu, ' ');
}

/**
 * Why a result reports failure, from structured fields only. Claude can report `is_error: true` with
 * `subtype: "success"` (an authentication failure did exactly that), so the subtype is a reason only when it
 * names an error; `terminal_reason` is used when it does. Otherwise there is no trustworthy reason.
 */
export function resultFailure(message: Record<string, unknown>): string | undefined {
  const subtype = message.subtype;
  const bySubtype: Record<string, string> = {error_max_turns: 'turn limit reached', error_max_budget_usd: 'budget limit reached', error_during_execution: 'error during execution'};
  if (typeof subtype === 'string' && bySubtype[subtype]) return bySubtype[subtype];
  if (typeof subtype === 'string' && /^error_[a-z_]{1,40}$/u.test(subtype)) return subtype.slice(6).replace(/_/gu, ' ');
  const terminal = message.terminal_reason;
  if (terminal === 'api_error') return 'provider API error';
  if (typeof terminal === 'string' && /^[a-z][a-z_]{0,40}$/u.test(terminal) && !['completed', 'end_turn', 'success'].includes(terminal)) return terminal.replace(/_/gu, ' ');
  return undefined;
}

type ClaudeLine = {events: AgentEvent[]; control?: {requestId: string; subtype: string; tool?: string; input?: unknown}; turnError?: string};

/** One stdout line → normalized events (unknown shapes produce nothing). */
export function claudeEvents(line: string, toolName?: (id: string) => string | undefined): ClaudeLine {
  let message: unknown;
  try { message = JSON.parse(line); } catch { return {events: []}; }
  return message && typeof message === 'object' && !Array.isArray(message) ? claudeMessageEvents(message as Record<string, unknown>, toolName) : {events: []};
}

/**
 * One parsed stream-json message → normalized events. `toolName` names the tool behind a tool_use id; without it a
 * tool result carries no structured reading (a result's shape alone never proves which tool produced it).
 */
export function claudeMessageEvents(message: Record<string, unknown>, toolName?: (id: string) => string | undefined): ClaudeLine {
  const type = message.type;
  const parent = typeof message.parent_tool_use_id === 'string' && message.parent_tool_use_id ? message.parent_tool_use_id.slice(0, 128) : undefined;
  if (type === 'system' && message.subtype === 'init') {
    const model = runtimeModel(message.model);
    return {events: [{kind: 'started', ...(typeof message.session_id === 'string' ? {harnessSessionId: message.session_id} : {})}, ...(model ? [{kind: 'model' as const, model}] : [])]};
  }
  if (type === 'assistant') {
    const content = (message.message as {content?: unknown} | undefined)?.content;
    const events: AgentEvent[] = [];
    const model = runtimeModel((message.message as {model?: unknown} | undefined)?.model);
    if (model) events.push({kind: 'model', model});
    const turnError = message.is_api_error_message === true || typeof message.error === 'string' ? providerErrorLabel(message.error) : undefined;
    for (const part of Array.isArray(content) ? content : []) {
      const block = part as {type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown};
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) events.push({kind: 'assistant', text: block.text});
      else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        const target = toolTarget(block.input);
        events.push({kind: 'tool', id: block.id, name: block.name, ...(target ? {target} : {}), status: 'started', ...(block.input && typeof block.input === 'object' && !Array.isArray(block.input) ? {input: block.input as Record<string, unknown>} : {}), ...(parent ? {parent} : {})});
      }
    }
    return {events, ...(turnError ? {turnError} : {})};
  }
  if (type === 'user') {
    const content = (message.message as {content?: unknown} | undefined)?.content;
    const events: AgentEvent[] = [];
    // One structured result per message: Claude Code sends each tool result as its own user message.
    for (const part of Array.isArray(content) ? content : []) {
      const block = part as {type?: unknown; tool_use_id?: unknown; is_error?: unknown; content?: unknown};
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const detail = textOf(block.content);
        const result = parseToolResult(message.tool_use_result, toolName?.(block.tool_use_id));
        events.push({kind: 'tool', id: block.tool_use_id, name: '', status: block.is_error === true ? 'failed' : 'finished', ...(detail ? {detail} : {}), ...(result && block.is_error !== true ? {result} : {}), ...(parent ? {parent} : {})});
      }
    }
    return {events};
  }
  if (type === 'result') {
    const ok = message.is_error !== true && (message.subtype === undefined || message.subtype === 'success');
    const reason = ok ? undefined : resultFailure(message);
    return {events: [{kind: 'settled', ok, ...(reason ? {message: reason} : {})}]};
  }
  if (type === 'control_request' && typeof message.request_id === 'string') {
    const request = message.request as {subtype?: unknown; tool_name?: unknown; input?: unknown; tool_use_id?: unknown; title?: unknown; description?: unknown;
      decision_reason?: unknown; permission_suggestions?: unknown; blocked_path?: unknown; default_to_no?: unknown} | undefined;
    const subtype = typeof request?.subtype === 'string' ? request.subtype : 'unknown';
    const tool = typeof request?.tool_name === 'string' ? request.tool_name : undefined;
    const target = toolTarget(request?.input);
    const questions = tool === 'AskUserQuestion' ? claudeQuestions(request?.input) : undefined;
    // What the provider says about the request (its own title and reason, and any rule it offers to remember).
    const text = (value: unknown, limit: number) => typeof value === 'string' && value.trim() ? value.slice(0, limit) : undefined;
    const suggestions = parseSuggestions(request?.permission_suggestions);
    const extra = {...(text(request?.tool_use_id, 128) ? {toolUseId: text(request?.tool_use_id, 128)!} : {}), ...(text(request?.title ?? request?.description, 300) ? {title: text(request?.title ?? request?.description, 300)!} : {}),
      ...(text(request?.decision_reason, 600) ? {reason: text(request?.decision_reason, 600)!} : {}), ...(suggestions.length ? {suggestions} : {}),
      ...(text(request?.blocked_path, 4096) ? {blockedPath: text(request?.blocked_path, 4096)!} : {}), ...(request?.default_to_no === true ? {defaultNo: true} : {})};
    return {events: subtype === 'can_use_tool' && tool ? tool === 'AskUserQuestion' ? questions ? [{kind: 'choice', requestId: message.request_id, questions}] : [] : [{kind: 'approval', requestId: message.request_id, tool, ...(target ? {target} : {}), ...(request?.input && typeof request.input === 'object' ? {input: request.input as Record<string, unknown>} : {}), ...extra}] : [],
      control: {requestId: message.request_id, subtype, ...(tool ? {tool} : {}), input: request?.input}};
  }
  return {events: []};
}

export interface ClaudeSessionOptions {
  executable: string;
  cwd: string;
  /** Resume this harness session id (only when the CLI documents --resume). */
  resume?: string;
  /** Extra provider-approved args from a launch profile (validated by the caller). */
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** A launch effort level (`--effort`), when the CLI documents it. */
  effort?: string;
  onEvent(event: AgentEvent): void;
  /** Runtime facts with provenance: catalog, model, usage, context, limits, files, tasks. */
  onTelemetry?(update: TelemetryUpdate): void;
  /** The reply streaming in now; presentation only, never source. Enables `--include-partial-messages`. */
  onPartial?(partial: PartialUpdate): void;
}

/** The outcome of a control request: the provider's acknowledgement (and answer), or why there is none. */
export type ControlResult<T = unknown> = {ok: true; value: T} | {ok: false; reason: string};

/** Permission modes NMSh offers through set_permission_mode; bypassing all checks is never offered. */
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk'] as const;
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** One managed Claude Code process for one conversation. */
export class ClaudeSession {
  private child?: ChildProcess;
  private buffer = '';
  private queue: string[] = [];
  private writable = true;
  private discardedFrame = false;
  private interruptTimer?: ReturnType<typeof setTimeout>;
  private readonly pending = new Map<string, {input: unknown; questions?: AgentQuestion[]}>();
  private initializeId?: string;
  private initialized = false;
  private initializationFailed = false;
  private initializeTimer?: ReturnType<typeof setTimeout>;
  private messages: string[] = [];
  /** Structured facts about the current turn, used only to explain a failed result. */
  private turnError?: string;
  private interruptRequested = false;
  private model?: string;
  private readonly stream = new ClaudeStream();
  /** NMSh's own control requests awaiting the provider's response. */
  private readonly requests = new Map<string, {resolve(result: ControlResult): void; timer: ReturnType<typeof setTimeout>}>();
  private readonly ready: Promise<boolean>;
  private settleReady!: (ok: boolean) => void;
  readonly capabilities: ClaudeCapabilities;

  constructor(private readonly options: ClaudeSessionOptions, help?: string) {
    this.capabilities = claudeCapabilities(options.executable, help);
    this.ready = new Promise(resolve => { this.settleReady = resolve; });
  }

  /** Whether the provider accepted the initialize handshake that control requests depend on. */
  get controllable(): boolean { return Boolean(this.child) && this.initialized && !this.initializationFailed && this.capabilities.hostPermissions; }

  get pid(): number | undefined { return this.child?.pid; }

  start(): {ok: true} | {ok: false; reason: string} {
    if (!this.capabilities.streamJson) return {ok: false, reason: 'This Claude Code version does not document stream-json input and output, so NMSh cannot drive it.'};
    const args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      // Host prompts let the person answer in NMSh; without them, anything that would prompt is denied by Claude itself.
      ...(this.capabilities.hostPermissions ? ['--permission-prompts', 'host', '--permission-prompt-tool', 'stdio'] : []),
      ...(this.options.resume && this.capabilities.resume ? ['--resume', this.options.resume] : this.capabilities.sessionId ? ['--session-id', randomUUID()] : []),
      // Live text as it is written; the completed messages that follow remain the only source.
      ...(this.options.onPartial && this.capabilities.partialMessages ? ['--include-partial-messages'] : []),
      ...(this.options.effort && this.capabilities.effortFlag && (EFFORT_LEVELS as readonly string[]).includes(this.options.effort) ? ['--effort', this.options.effort] : []),
      ...(this.options.args ?? [])];
    try {
      this.child = spawn(this.options.executable, args, {cwd: this.options.cwd, env: this.options.env ?? process.env, stdio: ['pipe', 'pipe', 'ignore']});
    } catch (error) { return {ok: false, reason: error instanceof Error ? error.message : String(error)}; }
    const child = this.child;
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => this.read(chunk));
    child.stdin!.on('drain', () => { this.writable = true; this.flush(); });
    child.stdin!.on('error', () => { /* the exit event reports it */ });
    child.on('error', () => { this.endRequests('The provider could not start'); this.options.onEvent({kind: 'exited', code: -1}); });
    child.on('exit', code => { this.child = undefined; this.endRequests('The provider exited'); this.settleReady(false); this.options.onEvent({kind: 'exited', code}); });
    this.initialized = !this.capabilities.hostPermissions;
    if (this.initialized) this.settleReady(false);
    if (!this.initialized) {
      this.initializeId = randomUUID();
      this.write({type: 'control_request', request_id: this.initializeId, request: {subtype: 'initialize', hooks: {}}});
      this.initializeTimer = setTimeout(() => this.failInitialization('Provider initialization timed out'), 15000);
      this.initializeTimer.unref();
    }
    return {ok: true};
  }

  private read(chunk: string): void {
    if (this.discardedFrame) {
      const end = chunk.indexOf('\n');
      if (end < 0) return;
      chunk = chunk.slice(end + 1); this.discardedFrame = false;
    }
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > 8 * 1024 * 1024) {this.options.onEvent({kind: 'incomplete', reason: 'Provider frame exceeds 8 MiB safety limit'}); continue;}
      if (!line) continue;
      let parsed: unknown;
      try {parsed = JSON.parse(line);} catch {continue;}
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const message = parsed as Record<string, unknown>;
      const raw = message as {type?: string; response?: {request_id?: string; subtype?: string; response?: unknown}};
      if (raw.type === 'control_response' && raw.response?.request_id === this.initializeId) {
        clearTimeout(this.initializeTimer);
        if (raw.response?.subtype === 'success') {
          this.initialized = true;
          this.settleReady(true);
          // The provider's model catalog, commands and account plan, as it published them.
          const catalog = parseCatalog(raw.response.response, Date.now());
          if (catalog) this.options.onTelemetry?.({kind: 'catalog', catalog});
          for (const text of this.messages.splice(0)) if (!this.sendFrame(text)) this.options.onEvent({kind: 'incomplete', reason: 'Queued message was not submitted'});
        } else this.failInitialization('Provider initialization was rejected');
        continue;
      }
      const parsedStream = this.stream.parse(message);
      if (parsedStream.response) {
        const waiting = this.requests.get(parsedStream.response.requestId);
        if (waiting) {
          this.requests.delete(parsedStream.response.requestId); clearTimeout(waiting.timer);
          waiting.resolve(parsedStream.response.ok ? {ok: true, value: parsedStream.response.body} : {ok: false, reason: parsedStream.response.error ?? 'The provider refused the request'});
        }
        continue;
      }
      for (const update of parsedStream.telemetry) this.options.onTelemetry?.(update);
      if (parsedStream.partial) this.options.onPartial?.(parsedStream.partial);
      const {events, control, turnError} = claudeMessageEvents(message, id => this.stream.toolName(id));
      if (turnError) this.turnError = turnError;
      for (let event of events) {
        if (event.kind === 'model') { if (event.model === this.model) continue; this.model = event.model; }
        if (event.kind === 'settled') {
          clearTimeout(this.interruptTimer); this.interruptTimer = undefined; this.pending.clear();
          // A failed turn the person interrupted is an interruption; otherwise the provider's own error code
          // (an assistant `error`) explains it better than the result's generic fields.
          if (!event.ok) event = this.interruptRequested ? {kind: 'settled', ok: false, interrupted: true} : {kind: 'settled', ok: false, ...(this.turnError ?? event.message ? {message: this.turnError ?? event.message} : {})};
          this.turnError = undefined; this.interruptRequested = false;
        }
        this.options.onEvent(event);
      }
      if (control) {
        if (control.subtype === 'can_use_tool' && control.tool && (control.tool !== 'AskUserQuestion' || claudeQuestions(control.input))) this.pending.set(control.requestId, {input: control.input, ...(control.tool === 'AskUserQuestion' ? {questions: claudeQuestions(control.input)} : {})});
        // Requests NMSh does not implement are refused rather than ignored, so the harness never waits on us.
        else this.write({type: 'control_response', response: {subtype: 'error', request_id: control.requestId, error: 'Not supported by NMSh'}});
      }
    }
    if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) {this.buffer = ''; this.discardedFrame = true; this.options.onEvent({kind: 'incomplete', reason: 'Provider frame exceeds 8 MiB safety limit'});}
  }

  private failInitialization(reason: string): void {
    this.initializationFailed = true; this.messages = [];
    this.settleReady(false);
    this.options.onEvent({kind: 'settled', ok: false, message: reason}); this.close();
  }

  private endRequests(reason: string): void {
    for (const [id, waiting] of this.requests) { clearTimeout(waiting.timer); waiting.resolve({ok: false, reason}); this.requests.delete(id); }
  }

  /**
   * One control request (the documented Agent SDK wire format), answered by the provider's control_response or a
   * timeout. Requests wait for the initialize handshake; nothing is sent to a provider that never accepted it.
   */
  async request(body: Record<string, unknown>, timeoutMs = 15000): Promise<ControlResult> {
    if (!this.child || this.initializationFailed) return {ok: false, reason: 'The provider is not running'};
    if (!this.capabilities.hostPermissions) return {ok: false, reason: 'This Claude Code version does not document the control channel NMSh uses'};
    if (!this.initialized && !(await Promise.race([this.ready, new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeoutMs).unref())]))) {
      return {ok: false, reason: 'The provider has not finished starting'};
    }
    if (this.requests.size >= 32) return {ok: false, reason: 'Too many requests are waiting for the provider'};
    const id = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => { if (this.requests.delete(id)) resolve({ok: false, reason: 'The provider did not answer in time'}); }, timeoutMs);
      timer.unref();
      this.requests.set(id, {resolve, timer});
      if (!this.write({type: 'control_request', request_id: id, request: body})) { this.requests.delete(id); clearTimeout(timer); resolve({ok: false, reason: 'The provider input queue is full'}); }
    });
  }

  /** Change the model for later turns (set_model); undefined restores the provider's default. */
  async setModel(model: string | undefined): Promise<ControlResult> {
    if (model !== undefined && !/^[\w.:@/\-[\]]{1,96}$/u.test(model)) return {ok: false, reason: 'Not a model identifier'};
    const result = await this.request({subtype: 'set_model', model: model ?? 'default'});
    if (result.ok) this.acknowledged('model', model ?? 'default');
    return result;
  }

  /** Session-only effort (apply_flag_settings effortLevel); null returns to the model's default. Never written to settings files. */
  async setEffort(level: string | null): Promise<ControlResult> {
    if (level !== null && !(EFFORT_LEVELS as readonly string[]).includes(level)) return {ok: false, reason: 'Not an effort level'};
    const result = await this.request({subtype: 'apply_flag_settings', settings: {effortLevel: level}});
    if (result.ok) this.acknowledged('effort', level);
    return result;
  }

  /** The session's permission mode (set_permission_mode). Bypassing all checks is never sent. */
  async setPermissionMode(mode: string): Promise<ControlResult> {
    if (!(PERMISSION_MODES as readonly string[]).includes(mode)) return {ok: false, reason: 'Not a permission mode NMSh offers'};
    const result = await this.request({subtype: 'set_permission_mode', mode});
    if (result.ok) this.acknowledged('permissionMode', mode);
    return result;
  }

  /** The provider's own breakdown of the context window. `full` asks the provider to count each category (slower, may call its API). */
  async contextUsage(detail: 'summary' | 'full' = 'summary'): Promise<ControlResult<ContextSnapshot>> {
    const result = await this.request({subtype: 'get_context_usage', detail}, detail === 'full' ? 45000 : 15000);
    if (!result.ok) return result;
    const snapshot = parseContextUsage(result.value, detail);
    if (!snapshot) return {ok: false, reason: 'The provider answered in a shape NMSh does not know'};
    this.options.onTelemetry?.({kind: 'context', snapshot, at: Date.now()});
    return {ok: true, value: snapshot};
  }

  /** MCP servers as the provider sees them now (mcp_status). */
  async mcpStatus(): Promise<ControlResult<unknown[]>> {
    const result = await this.request({subtype: 'mcp_status'});
    if (!result.ok) return result;
    const servers = result.value && typeof result.value === 'object' && Array.isArray((result.value as {mcpServers?: unknown}).mcpServers) ? (result.value as {mcpServers: unknown[]}).mcpServers : undefined;
    return servers ? {ok: true, value: servers.slice(0, 64)} : {ok: false, reason: 'The provider answered in a shape NMSh does not know'};
  }

  async mcpToggle(name: string, enabled: boolean): Promise<ControlResult> {
    return this.request({subtype: 'mcp_toggle', serverName: name.slice(0, 128), enabled});
  }

  async mcpReconnect(name: string): Promise<ControlResult> {
    return this.request({subtype: 'mcp_reconnect', serverName: name.slice(0, 128)}, 30000);
  }

  async stopTask(taskId: string): Promise<ControlResult> {
    return this.request({subtype: 'stop_task', task_id: taskId.slice(0, 128)});
  }

  private acknowledged(field: 'model' | 'effort' | 'permissionMode', value: string | null): void {
    const at = Date.now();
    this.options.onTelemetry?.({kind: 'requested', field, value, at});
    const label = field === 'model' ? `Model set to ${value}` : field === 'effort' ? value ? `Effort set to ${value}` : 'Effort back to the model default' : `Permission mode set to ${value}`;
    this.options.onEvent({kind: 'control', field, value, label});
  }

  private write(message: unknown, control = true): boolean {
    const frame = `${JSON.stringify(message)}\n`;
    // Reserve sixteen slots and one MiB for human control responses under backpressure.
    const bytes = this.queue.reduce((n, text) => n + Buffer.byteLength(text), 0);
    if (this.queue.length >= (control ? 128 : 112) || bytes + Buffer.byteLength(frame) > (control ? 8 : 7) * 1024 * 1024) {this.options.onEvent({kind: 'incomplete', reason: 'Provider input queue limit reached; action not submitted'}); return false;}
    this.queue.push(frame);
    this.flush();
    return true;
  }

  /** Honor stdin backpressure: write until the pipe asks to wait. */
  private flush(): void {
    const stdin = this.child?.stdin;
    while (stdin && this.writable && this.queue.length) this.writable = stdin.write(this.queue.shift()!);
  }

  send(text: string): boolean {
    if (!this.child || this.initializationFailed) return false;
    if (this.messages.length >= 64 || this.messages.reduce((n, t) => n + Buffer.byteLength(t), 0) + Buffer.byteLength(text) > 7 * 1024 * 1024) {this.options.onEvent({kind: 'incomplete', reason: 'Provider message queue/payload limit reached'}); return false;}
    if (this.initialized && !this.sendFrame(text)) return false;
    this.options.onEvent({kind: 'user', text});
    if (!this.initialized) this.messages.push(text);
    return true;
  }

  private sendFrame(text: string): boolean {
    return this.write({type: 'user', message: {role: 'user', content: [{type: 'text', text}]}}, false);
  }

  /**
   * Answer one pending permission prompt with the person's explicit choice; never automatic. `remember` is one of the
   * rule changes the provider itself offered with this request, returned verbatim (NMSh never composes a rule).
   */
  answer(requestId: string, allow: boolean, remember?: {update: Record<string, unknown>; label: string}): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.questions || !this.child) return false;
    if (!this.write({type: 'control_response', response: {subtype: 'success', request_id: requestId,
      response: allow ? {behavior: 'allow', updatedInput: pending.input ?? {}, ...(remember ? {updatedPermissions: [remember.update]} : {})} : {behavior: 'deny', message: 'Denied in NMSh.'}}})) return false;
    this.pending.delete(requestId);
    this.options.onEvent({kind: 'approvalAnswered', requestId, allowed: allow, ...(allow && remember ? {remembered: remember.label} : {})});
    return true;
  }

  /** Interrupt the current run (the harness's own interrupt request; SIGINT if it does not settle). */
  choose(requestId: string, answers: Record<string, string>): boolean {
    const pending = this.pending.get(requestId);
    if (!pending?.questions || !this.child || Object.keys(answers).length !== pending.questions.length || pending.questions.some(q => typeof answers[q.question] !== 'string' || !answers[q.question]!.trim() || answers[q.question]!.length > 4000)) return false;
    if (!this.write({type: 'control_response', response: {subtype: 'success', request_id: requestId, response: {behavior: 'allow', updatedInput: {...pending.input as Record<string, unknown>, answers}}}})) return false;
    this.pending.delete(requestId);
    this.options.onEvent({kind: 'choiceAnswered', requestId, answers});
    return true;
  }

  cancel(): void {
    if (!this.child) return;
    this.pending.clear(); this.options.onEvent({kind: 'requestsCleared'});
    this.interruptRequested = true;
    this.write({type: 'control_request', request_id: randomUUID(), request: {subtype: 'interrupt'}});
    const child = this.child;
    clearTimeout(this.interruptTimer);
    this.interruptTimer = setTimeout(() => { if (this.child === child) child.kill('SIGINT'); }, 3000);
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
