import {spawn, spawnSync, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import type {AgentEvent, AgentQuestion} from './model.js';

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

/** One stdout line → normalized events (unknown shapes produce nothing). */
export function claudeEvents(line: string): {events: AgentEvent[]; control?: {requestId: string; subtype: string; tool?: string; input?: unknown}} {
  let message: Record<string, unknown>;
  try { message = JSON.parse(line) as Record<string, unknown>; } catch { return {events: []}; }
  const type = message.type;
  if (type === 'system' && message.subtype === 'init') return {events: [{kind: 'started', ...(typeof message.session_id === 'string' ? {harnessSessionId: message.session_id} : {})}]};
  if (type === 'assistant') {
    const content = (message.message as {content?: unknown} | undefined)?.content;
    const events: AgentEvent[] = [];
    for (const part of Array.isArray(content) ? content : []) {
      const block = part as {type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown};
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) events.push({kind: 'assistant', text: block.text});
      else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        const target = toolTarget(block.input);
        events.push({kind: 'tool', id: block.id, name: block.name, ...(target ? {target} : {}), status: 'started', ...(block.input && typeof block.input === 'object' && !Array.isArray(block.input) ? {input: block.input as Record<string, unknown>} : {})});
      }
    }
    return {events};
  }
  if (type === 'user') {
    const content = (message.message as {content?: unknown} | undefined)?.content;
    const events: AgentEvent[] = [];
    for (const part of Array.isArray(content) ? content : []) {
      const block = part as {type?: unknown; tool_use_id?: unknown; is_error?: unknown; content?: unknown};
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const detail = textOf(block.content);
        events.push({kind: 'tool', id: block.tool_use_id, name: '', status: block.is_error === true ? 'failed' : 'finished', ...(detail ? {detail} : {})});
      }
    }
    return {events};
  }
  if (type === 'result') {
    const ok = message.is_error !== true && (message.subtype === undefined || message.subtype === 'success');
    return {events: [{kind: 'settled', ok, ...(!ok && typeof message.subtype === 'string' ? {message: message.subtype} : {})}]};
  }
  if (type === 'control_request' && typeof message.request_id === 'string') {
    const request = message.request as {subtype?: unknown; tool_name?: unknown; input?: unknown} | undefined;
    const subtype = typeof request?.subtype === 'string' ? request.subtype : 'unknown';
    const tool = typeof request?.tool_name === 'string' ? request.tool_name : undefined;
    const target = toolTarget(request?.input);
    const questions = tool === 'AskUserQuestion' ? claudeQuestions(request?.input) : undefined;
    return {events: subtype === 'can_use_tool' && tool ? tool === 'AskUserQuestion' ? questions ? [{kind: 'choice', requestId: message.request_id, questions}] : [] : [{kind: 'approval', requestId: message.request_id, tool, ...(target ? {target} : {}), ...(request?.input && typeof request.input === 'object' ? {input: request.input as Record<string, unknown>} : {})}] : [],
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
  onEvent(event: AgentEvent): void;
}

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
  readonly capabilities: ClaudeCapabilities;

  constructor(private readonly options: ClaudeSessionOptions, help?: string) {
    this.capabilities = claudeCapabilities(options.executable, help);
  }

  get pid(): number | undefined { return this.child?.pid; }

  start(): {ok: true} | {ok: false; reason: string} {
    if (!this.capabilities.streamJson) return {ok: false, reason: 'This Claude Code version does not document stream-json input and output, so NMSh cannot drive it.'};
    const args = ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      // Host prompts let the person answer in NMSh; without them, anything that would prompt is denied by Claude itself.
      ...(this.capabilities.hostPermissions ? ['--permission-prompts', 'host', '--permission-prompt-tool', 'stdio'] : []),
      ...(this.options.resume && this.capabilities.resume ? ['--resume', this.options.resume] : this.capabilities.sessionId ? ['--session-id', randomUUID()] : []),
      ...(this.options.args ?? [])];
    try {
      this.child = spawn(this.options.executable, args, {cwd: this.options.cwd, env: this.options.env ?? process.env, stdio: ['pipe', 'pipe', 'ignore']});
    } catch (error) { return {ok: false, reason: error instanceof Error ? error.message : String(error)}; }
    const child = this.child;
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => this.read(chunk));
    child.stdin!.on('drain', () => { this.writable = true; this.flush(); });
    child.stdin!.on('error', () => { /* the exit event reports it */ });
    child.on('error', () => this.options.onEvent({kind: 'exited', code: -1}));
    child.on('exit', code => { this.child = undefined; this.options.onEvent({kind: 'exited', code}); });
    this.initialized = !this.capabilities.hostPermissions;
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
      let raw: {type?: string; response?: {request_id?: string; subtype?: string}};
      try {raw = JSON.parse(line);} catch {continue;}
      if (raw.type === 'control_response' && raw.response?.request_id === this.initializeId) {
        clearTimeout(this.initializeTimer);
        if (raw.response?.subtype === 'success') {this.initialized = true; for (const text of this.messages.splice(0)) if (!this.sendFrame(text)) this.options.onEvent({kind: 'incomplete', reason: 'Queued message was not submitted'});}
        else this.failInitialization('Provider initialization was rejected');
        continue;
      }
      const {events, control} = claudeEvents(line);
      for (const event of events) {
        if (event.kind === 'settled') {clearTimeout(this.interruptTimer); this.interruptTimer = undefined; this.pending.clear();}
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
    this.options.onEvent({kind: 'settled', ok: false, message: reason}); this.close();
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

  /** Answer one pending permission prompt with the person's explicit choice; never automatic. */
  answer(requestId: string, allow: boolean): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.questions || !this.child) return false;
    if (!this.write({type: 'control_response', response: {subtype: 'success', request_id: requestId,
      response: allow ? {behavior: 'allow', updatedInput: pending.input ?? {}} : {behavior: 'deny', message: 'Denied in NMSh.'}}})) return false;
    this.pending.delete(requestId);
    this.options.onEvent({kind: 'approvalAnswered', requestId, allowed: allow});
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
