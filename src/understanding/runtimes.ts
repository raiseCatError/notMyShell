import {spawn, type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import type {LocalModelChoice} from '../prompt/configuration.js';

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
  infer(prompt: string, schema: object, maxTokens: number, signal: AbortSignal): Promise<unknown>;
  unload(): Promise<void>;
}

export const CONTEXT_TOKENS = 2048;

async function postJson(url: string, body: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal});
  if (!response.ok) throw new Error(`runtime answered ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

function parseJsonText(text: unknown): unknown {
  if (typeof text !== 'string') throw new Error('no text');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error('no JSON object');
  return JSON.parse(text.slice(start, end + 1));
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

  async infer(prompt: string, schema: object, maxTokens: number, signal: AbortSignal): Promise<unknown> {
    const reply = await postJson(`http://127.0.0.1:${this.port}/completion`,
      {prompt, n_predict: maxTokens, temperature: 0, json_schema: schema, cache_prompt: false}, signal);
    return parseJsonText(reply.content);
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
  async infer(prompt: string, schema: object, maxTokens: number, signal: AbortSignal): Promise<unknown> {
    const reply = await postJson(`${this.base}/api/generate`, {model: this.model, prompt, stream: false, format: schema,
      options: {temperature: 0, num_predict: maxTokens, num_ctx: CONTEXT_TOKENS}, keep_alive: '5m'}, signal);
    return parseJsonText(reply.response);
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
  async infer(prompt: string, schema: object, maxTokens: number, signal: AbortSignal): Promise<unknown> {
    const reply = await postJson(`${this.base}/v1/chat/completions`, {model: this.model, messages: [{role: 'user', content: prompt}], temperature: 0, max_tokens: maxTokens,
      response_format: {type: 'json_schema', json_schema: {name: 'nmsh', strict: true, schema}}}, signal);
    const choices = reply.choices as Array<{message?: {content?: string}}> | undefined;
    return parseJsonText(choices?.[0]?.message?.content);
  }
  async unload(): Promise<void> { /* not NMSh's to unload */ }
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
