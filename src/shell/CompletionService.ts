import {runExternal} from '../providers/providers.js';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseNativeCompletions, type CompletionCandidate, type CompletionContext, type CompletionSource} from './completion.js';

export type {CompletionCandidate} from './completion.js';
const script = join(dirname(fileURLToPath(import.meta.url)), 'capture.zsh');

/** Existing isolated capture source; no composer text is submitted to the managed shell. */
export class NativeCompletionSource implements CompletionSource {
  readonly id = 'zsh-native';

  async query(context: CompletionContext, signal: AbortSignal): Promise<CompletionCandidate[]> {
    const result = await runExternal('zsh', [script, context.buffer], {
      cwd: context.cwd, env: process.env, signal, timeoutMs: 1500, maxBytes: 1024 * 1024,
    });
    return result.ok && !signal.aborted ? parseNativeCompletions(result.stdout, context) : [];
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
