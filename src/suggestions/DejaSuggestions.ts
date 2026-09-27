import {runExternal} from '../providers/providers.js';
import type {Suggestion, SuggestionContext, SuggestionProvider} from './types.js';

/** Deja's own per-query read timeout is 150 ms; the CLI then falls back to SQLite. */
const QUERY_TIMEOUT_MS = 400;
const CACHE_SIZE = 64;

/**
 * Deja (https://github.com/Giammarco-Ferranti/deja) as an optional external
 * prediction engine through its public CLI:
 * `deja query --buffer … --dir … --prev … --json` → {suggestion, alternatives}.
 * NMSh draws the ghost text and alternatives; Deja's ZLE presentation is never
 * used. Recording stays with Deja's own zsh preexec/precmd hooks (from
 * `deja init zsh` in ~/.zshrc, which also run in NMSh's managed zsh), so
 * NMSh never calls `deja record` and commands are not recorded twice.
 */
export class DejaSuggestions implements SuggestionProvider {
  readonly id = 'deja' as const;
  private readonly cache = new Map<string, Suggestion[]>();

  constructor(private readonly binary: string, private readonly env: NodeJS.ProcessEnv = process.env) {}

  async query(context: SuggestionContext): Promise<Suggestion[]> {
    const previous = context.previous[0] ?? '';
    const key = `${context.buffer}\u0000${context.cwd}\u0000${previous}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = await runExternal(this.binary, ['query', '--buffer', context.buffer, '--dir', context.cwd, '--prev', previous, '--json'],
      {timeoutMs: QUERY_TIMEOUT_MS, maxBytes: 64 * 1024, env: this.env});
    if (!result.ok) throw new Error(`deja query ${result.error ?? 'failed'}`);
    const suggestions = parseDejaResponse(result.stdout);
    this.cache.set(key, suggestions);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return suggestions;
  }

  /** New history can change rankings; forget cached answers after each command. */
  record(): void {
    this.cache.clear();
  }
}

export function parseDejaResponse(output: string): Suggestion[] {
  const text = output.trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('deja query returned invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('deja query returned an unexpected shape');
  const {suggestion, alternatives} = parsed as {suggestion?: unknown; alternatives?: unknown};
  const lines = [suggestion, ...(Array.isArray(alternatives) ? alternatives : [])]
    .filter((line): line is string => typeof line === 'string' && line.length > 0);
  return lines.map((line, index) => ({text: line, source: 'deja', score: lines.length - index}));
}
