import {accessSync, constants, statSync} from 'node:fs';
import {delimiter, isAbsolute, join} from 'node:path';
import {parseShellKnowledge} from './ShellKnowledge.js';
import type {CommandSource, CommandType, CompletionFacts} from './SemanticService.js';
import type {ShellAdapter} from './adapters/ShellAdapter.js';

/** What the frontend needs from a command classifier, whichever shell runs. */
export interface CommandClassifier {
  cache: Map<string, CommandType>;
  classifyCommand(command: string): Promise<CommandType>;
  resolveSource(word: string): Promise<CommandSource | undefined>;
  completionFacts(): Promise<CompletionFacts | undefined>;
  applyShellKnowledge(text: string): void;
  kill(): void;
}

/**
 * Classification for backends without an isolated introspection helper
 * (Fish, Bash): the live session's own name snapshot (functions, aliases,
 * abbreviations, builtins), the adapter's builtin list, then PATH. No shell is
 * spawned and nothing is evaluated; unknown stays unknown.
 */
export class PathClassifier implements CommandClassifier {
  cache = new Map<string, CommandType>();
  private names = new Map<string, CommandType>();

  constructor(private readonly adapter: ShellAdapter, private readonly env: NodeJS.ProcessEnv = process.env) {}

  applyShellKnowledge(text: string): void {
    this.names = parseShellKnowledge(text);
    this.cache.clear();
    for (const [name, type] of this.names) this.cache.set(name, type);
  }

  private executable(word: string): string | undefined {
    if (word.includes('/')) {
      try { if (statSync(word).isFile()) { accessSync(word, constants.X_OK); return word; } } catch { /* not runnable */ }
      return undefined;
    }
    for (const directory of (this.env.PATH ?? '').split(delimiter)) {
      if (!isAbsolute(directory)) continue;
      const candidate = join(directory, word);
      try { if (statSync(candidate).isFile()) { accessSync(candidate, constants.X_OK); return candidate; } } catch { /* next */ }
    }
    return undefined;
  }

  async classifyCommand(command: string): Promise<CommandType> {
    const cached = this.cache.get(command);
    if (cached) return cached;
    const type: CommandType = this.names.get(command) ?? (this.adapter.builtins.has(command) ? 'builtin' : this.executable(command) ? 'executable' : 'unknown');
    this.cache.set(command, type);
    return type;
  }

  async resolveSource(word: string): Promise<CommandSource | undefined> {
    const kind = await this.classifyCommand(word);
    if (kind === 'unknown') return {kind: 'missing'};
    const path = kind === 'executable' ? this.executable(word) : undefined;
    return {kind, ...(path ? {path} : {})};
  }

  async completionFacts(): Promise<CompletionFacts | undefined> { return undefined; }

  kill(): void { this.cache.clear(); }
}
