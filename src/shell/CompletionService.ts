import {enrichCompletion} from './CommandKnowledge.js';
import {ConfiguredCompletionSource} from './ConfiguredCompletion.js';
import type {CommandType} from './SemanticService.js';
import {completionWord} from './ConfiguredCompletion.js';
import {runExternal} from '../providers/providers.js';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {commandIdentity, filterCompletions, isInternalHelper, parseNativeCompletions, rankCommandCandidates, type CommandUsage, type CompletionCandidate,
  type CompletionContext, type CompletionSource} from './completion.js';

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
      const root = mkdtempSync(join(tmpdir(), 'nmsh-capture-'));
      let result;
      try {
        result = await runExternal('zsh', ['-f', script, parent], {
          cwd: context.cwd, env: {...process.env, NMSH_CAPTURE_ROOT: root}, signal, timeoutMs: 2000, maxBytes: 1024 * 1024, terminationGraceMs: 100,
        });
      } finally {
        // zpty children have their own process group; the outer group is insufficient.
        try {
          const pid = Number(readFileSync(join(root, 'pid'), 'utf8').trim());
          if (Number.isSafeInteger(pid) && pid > 1) {
            try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); }
          }
        } catch { /* Already cleaned by capture, or startup never reached the inner shell. */ }
        rmSync(root, {recursive: true, force: true});
      }
      if (!result.ok || signal.aborted) return [];
      output = result.stdout;
      if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, {at: Date.now(), output});
    }
    return signal.aborted ? [] : filterCompletions(parseNativeCompletions(output, context).map(enrichCompletion), context.buffer.slice(start));
  }

}

/** One completion pipeline, with native availability when configured knowledge fails. */
export class ShellCompletionSource implements CompletionSource {
  readonly id = 'shell';
  constructor(private readonly configured: CompletionSource = new ConfiguredCompletionSource(),
    private readonly native: CompletionSource = new NativeCompletionSource()) {}
  async query(context: CompletionContext, signal: AbortSignal): Promise<CompletionCandidate[]> {
    try {
      const values = await this.configured.query(context, signal);
      if (values.length || signal.aborted) return values;
    } catch { /* Native remains available. */ }
    if (signal.aborted) return [];
    if ((context.cursor ?? context.buffer.length) !== context.buffer.length) return [];
    return this.native.query(context, signal);
  }
  dispose(): void { this.configured.dispose?.(); this.native.dispose?.(); }
}

/** Owns request lifetime independently of any completion source or UI. */
export class CompletionService {
  private active?: AbortController;
  private generation = 0;
  private shellNames: ReadonlyMap<string, CommandType> = new Map();
  private usage: ReadonlyMap<string, CommandUsage> = new Map();

  constructor(private readonly source: CompletionSource = new ShellCompletionSource()) {}

  dispose(): void { this.cancel(); this.source.dispose?.(); }
  invalidate(): void { this.dispose(); }
  setShellKnowledge(names: ReadonlyMap<string, CommandType>): void { this.cancel(); this.shellNames = new Map(names); }
  /** Command-name use from eligible local history; never private or deleted entries. */
  setCommandUsage(usage: ReadonlyMap<string, CommandUsage>): void { this.usage = usage; }

  cancel(): void {
    this.generation += 1;
    this.active?.abort();
    this.active = undefined;
  }

  async suggest(input: string, cwd: string, cursor = input.length): Promise<CompletionCandidate[]> {
    this.cancel();
    if (!input.trim()) return [];
    const generation = this.generation;
    const active = new AbortController();
    this.active = active;
    try {
      let candidates = await this.source.query({buffer: input, cwd, cursor}, active.signal);
      const range = completionWord({buffer: input, cwd, cursor});
      if (range?.start === 0) {
        const prefix = input.slice(0, cursor);
        for (const [name, type] of this.shellNames) {
          if (name.startsWith(prefix) && !candidates.some(candidate => candidate.value === name)) candidates.push({
            value: name, display: name, name, kind: 'command', description: '', source: 'shell-metadata',
            ...(commandIdentity(type) ? {identity: commandIdentity(type)} : {}),
            replacement: range, context: {buffer: input, cwd, cursor}, insertionCursor: name.length,
            insertion: name + input.slice(range.end),
          });
        }
        // Semantic identity from the session's own metadata wins over source guesses.
        candidates = candidates.map(candidate => {
          if (candidate.kind !== 'command') return candidate;
          const known = commandIdentity(this.shellNames.get(candidate.value));
          return known && known !== candidate.identity ? {...candidate, identity: known} : candidate;
        });
        const word = input.slice(range.start, cursor);
        candidates = rankCommandCandidates(candidates.filter(candidate => !isInternalHelper(candidate, word)), word, this.usage, Date.now());
      }
      return generation === this.generation && !active.signal.aborted ? candidates : [];
    } catch {
      return [];
    } finally {
      if (this.active === active) this.active = undefined;
    }
  }
}
