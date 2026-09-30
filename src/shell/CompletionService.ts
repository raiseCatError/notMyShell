import {runExternal} from '../providers/providers.js';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {filterCompletions, parseNativeCompletions, type CompletionCandidate, type CompletionContext, type CompletionSource} from './completion.js';

export type {CompletionCandidate} from './completion.js';
const script = join(dirname(fileURLToPath(import.meta.url)), 'capture.zsh');

/** Existing isolated capture source; no composer text is submitted to the managed shell. */
export class NativeCompletionSource implements CompletionSource {
  readonly id = 'zsh-native';
  private readonly cache = new Map<string, {at: number; output: string}>();

  async query(context: CompletionContext, signal: AbortSignal): Promise<CompletionCandidate[]> {
    // Capture the token's parent context once, then fuzzy-filter locally while typing.
    // Keep the legacy whitespace replacement boundary until quoted-token support is designed.
    const start = context.buffer.lastIndexOf(' ') + 1;
    const token = context.buffer.slice(start);
    const pathPrefix = token.includes('/') ? token.slice(0, token.lastIndexOf('/') + 1) : '';
    // Keep path components in the capture context; stripping them loses nested directory candidates.
    const parent = /[\\'"]/u.test(token) ? context.buffer : context.buffer.slice(0, start) + pathPrefix;
    const key = JSON.stringify([context.cwd, parent]);
    const cached = this.cache.get(key);
    let output: string;
    if (cached && Date.now() - cached.at < 2000) output = cached.output;
    else {
      const result = await runExternal('zsh', [script, parent], {
        cwd: context.cwd, env: process.env, signal, timeoutMs: 1500, maxBytes: 1024 * 1024,
      });
      if (!result.ok || signal.aborted) return [];
      output = result.stdout;
      if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, {at: Date.now(), output});
    }
    return signal.aborted ? [] : filterCompletions(parseNativeCompletions(output, context), context.buffer.slice(start));
  }

}

/** Owns request lifetime independently of any completion source or UI. */
export class CompletionService {
  private active?: AbortController;
  private generation = 0;

  constructor(private readonly source: CompletionSource = new NativeCompletionSource()) {}

  cancel(): void {
    this.generation += 1;
    this.active?.abort();
    this.active = undefined;
  }

  async suggest(input: string, cwd: string): Promise<CompletionCandidate[]> {
    this.cancel();
    if (!input.trim()) return [];
    const generation = this.generation;
    const active = new AbortController();
    this.active = active;
    try {
      const candidates = await this.source.query({buffer: input, cwd}, active.signal);
      return generation === this.generation && !active.signal.aborted ? candidates : [];
    } catch {
      return [];
    } finally {
      if (this.active === active) this.active = undefined;
    }
  }
}
