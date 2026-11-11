import {spawn, type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import type {LocalModelChoice} from '../prompt/configuration.js';
import type {AnswerStats, ChatMessage} from './tasks.js';

/**
 * One loaded model behind a small interface. Every adapter talks only to
 * 127.0.0.1, asks for JSON constrained by a schema, with a small context,
 * short outputs and temperature 0. Owned by the shared model service: never
 * started per NMSh window.
 */
export interface ModelRuntime {
  readonly label: string;
  readonly loaded: boolean;
  load(signal?: AbortSignal): Promise<void>;
  infer(prompt: string, schema: object, maxTokens: number, signal: AbortSignal, options?: InferOptions): Promise<unknown>;
  /**
   * Free text for a conversation (the general-answer task). `onText` receives each new piece as it streams;
   * aborting the signal stops generation (the runtime drops the request when its connection closes).
   * The text is untrusted: the caller validates and sanitizes it.
   */
  generate?(messages: ChatMessage[], maxTokens: number, signal: AbortSignal, options?: GenerateOptions): Promise<Generated>;
  unload(): Promise<void>;
}

export interface GenerateOptions extends InferOptions {onText?: (piece: string) => void}
export interface Generated {text: string; truncated: boolean; stats?: AnswerStats}

/**
 * Qwen3 runs in one of its two officially supported modes. Fast (non-thinking)
 * is the default for every task; a thinking pass is only ever a bounded Ask
 * retry. Reasoning text is discarded here; only the validated JSON leaves.
 */
export type Reasoning = 'fast' | 'thinking';
export interface InferOptions {reasoning?: Reasoning; qwen3?: boolean}

/** Qwen's published sampling per mode (Qwen3 model card): thinking 0.6/0.95/20, non-thinking 0.7/0.8/20; never greedy for thinking. */
export const QWEN3_SAMPLING = {thinking: {temperature: 0.6, top_p: 0.95, top_k: 20}, fast: {temperature: 0.7, top_p: 0.8, top_k: 20}} as const;
/**
 * Free-text answers follow the same published settings with min_p 0 (llama.cpp's own default is 0.05), and the
 * model card's presence penalty against the endless repetition small quantized models fall into.
 */
export const QWEN3_ANSWER_SAMPLING = {thinking: {...QWEN3_SAMPLING.thinking, min_p: 0, presence_penalty: 1.5}, fast: {...QWEN3_SAMPLING.fast, min_p: 0, presence_penalty: 1.5}} as const;

export function isQwen3(model: {label: string; name?: string; path?: string}): boolean {
  // Qwen3 text models (not Qwen3-VL or Qwen3-Coder, whose templates differ).
  const text = `${model.label} ${model.name ?? ''} ${model.path ?? ''}`.toLowerCase().replace(/qwen[\s_.-]*3[\s_.-]*(?:vl|coder)\S*/gu, '');
  return /qwen[\s_.-]*3(?!\d)/u.test(text);
}

/**
 * Qwen3's chat template by hand (ChatML), for llama-server's raw /completion:
 * non-thinking prefills the empty think block exactly as the official
 * template does when enable_thinking is false; thinking leaves it open.
 */
export function qwen3Prompt(prompt: string, reasoning: Reasoning): string {
  return `<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n${reasoning === 'fast' ? '<think>\n\n</think>\n\n' : ''}`;
}

/**
 * A whole conversation in Qwen3's ChatML. History carries final answers only (the model card's multi-turn advice:
 * no reasoning in history); non-thinking prefills the empty think block, thinking leaves it open.
 */
export function qwen3ChatPrompt(messages: readonly ChatMessage[], reasoning: Reasoning): string {
  const turns = messages.map(message => `<|im_start|>${message.role}\n${message.content}<|im_end|>\n`).join('');
  return `${turns}<|im_start|>assistant\n${reasoning === 'fast' ? '<think>\n\n</think>\n\n' : ''}`;
}

/** Remove any reasoning block (closed, or cut off by the token budget) before JSON is looked for. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gu, '').replace(/<think>[\s\S]*$/u, '').trim();
}

export const CONTEXT_TOKENS = 2048;

async function postJson(url: string, body: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal});
  if (!response.ok) throw new Error(`runtime answered ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

export function parseJsonText(raw: unknown): unknown {
  if (typeof raw !== 'string') throw new Error('no text');
  const text = stripThinking(raw);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error('no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

/** Read a streamed reply line by line (server-sent `data:` lines or NDJSON), handing each parsed JSON object on. */
export async function readStream(response: Response, onObject: (value: Record<string, unknown>) => void): Promise<void> {
  if (!response.body) throw new Error('no stream');
  const decoder = new TextDecoder();
  let buffer = '';
  const line = (raw: string) => {
    const text = raw.startsWith('data:') ? raw.slice(5).trim() : raw.trim();
    if (!text || text === '[DONE]' || text.startsWith(':') || text.startsWith('event:')) return;
    let value: unknown;
    try { value = JSON.parse(text); } catch { return; }
    if (value && typeof value === 'object' && !Array.isArray(value)) onObject(value as Record<string, unknown>);
  };
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, {stream: true});
    if (buffer.length > 4 * 1024 * 1024) throw new Error('runtime stream too large');
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) { line(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
  }
  line(buffer);
}

async function postStream(url: string, body: unknown, signal: AbortSignal, onObject: (value: Record<string, unknown>) => void): Promise<void> {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal});
  if (!response.ok) throw new Error(`runtime answered ${response.status}`);
  await readStream(response, onObject);
}

/** Text a streamed answer collects; the budget is a hard stop even if a runtime ignores its own limit. */
class Collector {
  text = '';
  truncated = false;
  constructor(private readonly onText?: (piece: string) => void, private readonly limit = 24_000) {}
  add(piece: unknown): void {
    if (typeof piece !== 'string' || !piece) return;
    if (this.text.length + piece.length > this.limit) { this.truncated = true; return; }
    this.text += piece;
    this.onText?.(piece);
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port')));
    });
  });
}

/** llama.cpp's llama-server on a private localhost port, started and stopped by the model service. */
export class LlamaServerRuntime implements ModelRuntime {
  private child?: ChildProcess;
  private port = 0;
  constructor(private readonly executable: string, private readonly modelPath: string, readonly label: string) {}
  get loaded(): boolean { return Boolean(this.child && this.child.exitCode === null); }

  async load(signal?: AbortSignal): Promise<void> {
    if (this.loaded) return;
    this.port = await freePort();
    this.child = spawn(this.executable, ['-m', this.modelPath, '--host', '127.0.0.1', '--port', String(this.port), '-c', String(CONTEXT_TOKENS), '-np', '1'],
      {stdio: 'ignore', env: {PATH: process.env.PATH, HOME: process.env.HOME}});
    this.child.on('error', () => {});
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && !signal?.aborted) {
      if (this.child.exitCode !== null) throw new Error('llama-server exited while loading');
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/health`, {signal: AbortSignal.timeout(1000)});
        if (response.ok) return;
      } catch { /* still starting */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await this.unload();
    throw new Error('llama-server did not become ready');
  }

  async infer(prompt: string, schema: object, maxTokens: number, signal: AbortSignal, options: InferOptions = {}): Promise<unknown> {
    // Non-Qwen models keep deterministic decoding. Qwen3 uses its own template and per-mode sampling; the
    // fast mode stays grammar-constrained, while a thinking pass can't be (the grammar would forbid the
    // think block), so its JSON is extracted after the block and validated as strictly as ever.
    const reasoning = options.reasoning ?? 'fast';
    const body = options.qwen3
      ? {prompt: qwen3Prompt(prompt, reasoning), n_predict: maxTokens, ...QWEN3_SAMPLING[reasoning], ...(reasoning === 'fast' ? {json_schema: schema} : {}), cache_prompt: false}
      : {prompt, n_predict: maxTokens, temperature: 0, json_schema: schema, cache_prompt: false};
    const reply = await postJson(`http://127.0.0.1:${this.port}/completion`, body, signal);
    return parseJsonText(reply.content);
  }

  async generate(messages: ChatMessage[], maxTokens: number, signal: AbortSignal, options: GenerateOptions = {}): Promise<Generated> {
    const reasoning = options.reasoning ?? 'fast';
    const collector = new Collector(options.onText);
    let stats: AnswerStats | undefined;
    // Qwen3 gets its own template and published sampling; other models use the server's chat endpoint and template.
    if (options.qwen3) {
      await postStream(`http://127.0.0.1:${this.port}/completion`, {prompt: qwen3ChatPrompt(messages, reasoning), n_predict: maxTokens, stream: true,
        ...QWEN3_ANSWER_SAMPLING[reasoning], cache_prompt: false}, signal, value => {
        collector.add(value.content);
        if (value.stop === true) {
          if (value.stop_type === 'limit' || value.truncated === true) collector.truncated = true;
          const timings = value.timings as Record<string, number> | undefined;
          if (timings) stats = {promptTokens: timings.prompt_n, outputTokens: timings.predicted_n, promptMs: timings.prompt_ms, generateMs: timings.predicted_ms, tokensPerSecond: timings.predicted_per_second};
        }
      });
    } else {
      await postStream(`http://127.0.0.1:${this.port}/v1/chat/completions`, {messages, max_tokens: maxTokens, stream: true, temperature: 0.7, top_p: 0.8, cache_prompt: false}, signal, value => {
        const choice = (value.choices as Array<{delta?: {content?: string}; finish_reason?: string}> | undefined)?.[0];
        collector.add(choice?.delta?.content);
        if (choice?.finish_reason === 'length') collector.truncated = true;
      });
    }
    return {text: collector.text, truncated: collector.truncated, ...(stats ? {stats} : {})};
  }

  async unload(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null) child.kill('SIGTERM');
  }
}

/** A running Ollama the user already has: reused, never started or stopped by NMSh; unloading only releases NMSh's use. */
export class OllamaRuntime implements ModelRuntime {
  private warm = false;
  constructor(private readonly model: string, readonly label: string, private readonly base = 'http://127.0.0.1:11434') {}
  get loaded(): boolean { return this.warm; }
  async load(signal?: AbortSignal): Promise<void> {
    await postJson(`${this.base}/api/generate`, {model: this.model, prompt: '', keep_alive: '5m'}, signal ?? AbortSignal.timeout(60_000));
    this.warm = true;
  }
  async infer(prompt: string, schema: object, maxTokens: number, signal: AbortSignal, options: InferOptions = {}): Promise<unknown> {
    // Qwen3's documented soft switch selects non-thinking through Ollama's own template; schema output stays enforced.
    const text = options.qwen3 ? `${prompt} /no_think` : prompt;
    const sampling = options.qwen3 ? QWEN3_SAMPLING.fast : {temperature: 0};
    const reply = await postJson(`${this.base}/api/generate`, {model: this.model, prompt: text, stream: false, format: schema,
      options: {...sampling, num_predict: maxTokens, num_ctx: CONTEXT_TOKENS}, keep_alive: '5m'}, signal);
    return parseJsonText(reply.response);
  }
  async generate(messages: ChatMessage[], maxTokens: number, signal: AbortSignal, options: GenerateOptions = {}): Promise<Generated> {
    const reasoning = options.reasoning ?? 'fast';
    // Qwen3's documented soft switch on the newest user turn, plus Ollama's own `think` flag where it knows it.
    const sent = options.qwen3 ? softSwitch(messages, reasoning) : messages;
    const collector = new Collector(options.onText);
    let stats: AnswerStats | undefined;
    await postStream(`${this.base}/api/chat`, {model: this.model, messages: sent, stream: true, ...(options.qwen3 ? {think: reasoning === 'thinking'} : {}),
      options: {...(options.qwen3 ? QWEN3_ANSWER_SAMPLING[reasoning] : {temperature: 0.7, top_p: 0.8}), num_predict: maxTokens, num_ctx: CONTEXT_TOKENS}, keep_alive: '5m'}, signal, value => {
      collector.add((value.message as {content?: string} | undefined)?.content);
      if (value.done === true) {
        if (value.done_reason === 'length') collector.truncated = true;
        if (typeof value.eval_count === 'number') stats = {outputTokens: value.eval_count, ...(typeof value.prompt_eval_count === 'number' ? {promptTokens: value.prompt_eval_count} : {}),
          ...(typeof value.eval_duration === 'number' && value.eval_duration > 0 ? {generateMs: value.eval_duration / 1e6, tokensPerSecond: value.eval_count / (value.eval_duration / 1e9)} : {})};
      }
    });
    this.warm = true;
    return {text: collector.text, truncated: collector.truncated, ...(stats ? {stats} : {})};
  }
  async unload(): Promise<void> {
    this.warm = false;
    try { await postJson(`${this.base}/api/generate`, {model: this.model, prompt: '', keep_alive: 0}, AbortSignal.timeout(3000)); } catch { /* Ollama gone */ }
  }
}

/** LM Studio's local server: its own model lifecycle; NMSh only sends requests. */
export class LmStudioRuntime implements ModelRuntime {
  constructor(private readonly model: string, readonly label: string, private readonly base = 'http://127.0.0.1:1234') {}
  get loaded(): boolean { return true; }
  async load(): Promise<void> { /* LM Studio loads models itself */ }
  async infer(prompt: string, schema: object, maxTokens: number, signal: AbortSignal, options: InferOptions = {}): Promise<unknown> {
    const content = options.qwen3 ? `${prompt} /no_think` : prompt;
    const sampling = options.qwen3 ? {temperature: QWEN3_SAMPLING.fast.temperature, top_p: QWEN3_SAMPLING.fast.top_p} : {temperature: 0};
    const reply = await postJson(`${this.base}/v1/chat/completions`, {model: this.model, messages: [{role: 'user', content}], ...sampling, max_tokens: maxTokens,
      response_format: {type: 'json_schema', json_schema: {name: 'nmsh', strict: true, schema}}}, signal);
    const choices = reply.choices as Array<{message?: {content?: string}}> | undefined;
    return parseJsonText(choices?.[0]?.message?.content);
  }
  async generate(messages: ChatMessage[], maxTokens: number, signal: AbortSignal, options: GenerateOptions = {}): Promise<Generated> {
    const reasoning = options.reasoning ?? 'fast';
    const sent = options.qwen3 ? softSwitch(messages, reasoning) : messages;
    const sampling = options.qwen3 ? QWEN3_ANSWER_SAMPLING[reasoning] : {temperature: 0.7, top_p: 0.8};
    const collector = new Collector(options.onText);
    await postStream(`${this.base}/v1/chat/completions`, {model: this.model, messages: sent, stream: true, temperature: sampling.temperature, top_p: sampling.top_p, max_tokens: maxTokens}, signal, value => {
      // Only the answer: a separate reasoning field (reasoning_content) is never collected.
      const choice = (value.choices as Array<{delta?: {content?: string}; finish_reason?: string}> | undefined)?.[0];
      collector.add(choice?.delta?.content);
      if (choice?.finish_reason === 'length') collector.truncated = true;
    });
    return {text: collector.text, truncated: collector.truncated};
  }
  async unload(): Promise<void> { /* not NMSh's to unload */ }
}

/** Qwen3's /think and /no_think soft switch on the newest user message, for runtimes that apply their own template. */
export function softSwitch(messages: readonly ChatMessage[], reasoning: Reasoning): ChatMessage[] {
  const last = messages.map(message => message.role).lastIndexOf('user');
  return messages.map((message, index) => index === last ? {...message, content: `${message.content} ${reasoning === 'thinking' ? '/think' : '/no_think'}`} : message);
}

export function runtimeFor(choice: LocalModelChoice, which: (name: string) => string | undefined): ModelRuntime | undefined {
  if (choice.runtime === 'llama.cpp') {
    const executable = which('llama-server');
    return executable && choice.path ? new LlamaServerRuntime(executable, choice.path, choice.label) : undefined;
  }
  if (choice.runtime === 'ollama' && choice.name) return new OllamaRuntime(choice.name, choice.label);
  if (choice.runtime === 'lmstudio' && choice.name) return new LmStudioRuntime(choice.name, choice.label);
  return undefined;
}
