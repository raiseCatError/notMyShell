/** Source-independent completion data. Offsets are UTF-16 indices in context.buffer. */
export type CompletionKind = 'command' | 'subcommand' | 'option' | 'argument' | 'file' | 'directory' | 'value';
/**
 * What a command-position name is in the current zsh session, separate from
 * the syntactic kind: an alias and a PATH executable are both `command`s.
 */
export type CommandIdentity = 'executable' | 'alias' | 'function' | 'builtin' | 'keyword';

export interface CompletionContext {
  buffer: string;
  cwd: string;
  cursor?: number;
  generation?: number;
  expiresAt?: number;
}

export interface CompletionCandidate {
  /** Text replacing replacement.start..end. Never executed by completion. */
  value: string;
  display: string;
  description: string;
  kind: CompletionKind;
  source: string;
  group?: string;
  prefix?: string;
  suffix?: string;
  replacement: {start: number; end: number};
  context: CompletionContext;
  /** Full buffer and display aliases for existing composer consumers. */
  insertion: string;
  insertionCursor?: number;
  name: string;
  /** Command-position candidates only: what the name is in the session. */
  identity?: CommandIdentity;
}

export interface CompletionSource {
  readonly id: string;
  query(context: CompletionContext, signal: AbortSignal): Promise<CompletionCandidate[]>;
  dispose?(): void;
}

/** Presentation data cannot inject terminal controls; insertion values are validated separately. */
export function completionLabel(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '').replace(/[\u0000-\u001f\u007f-\u009f]/gu, '');
}

/** Preserve the capture helper's existing full-buffer insertion contract. */
export function parseNativeCompletions(output: string, context: CompletionContext): CompletionCandidate[] {
  const start = context.buffer.lastIndexOf(' ') + 1;
  const base = context.buffer.slice(0, start);
  const seen = new Set<string>();
  const result: CompletionCandidate[] = [];
  for (const line of output.split('\n')) {
    const text = line.replace(/\r$/u, '').trim();
    if (!text) continue;
    const split = text.indexOf(' -- ');
    const value = split === -1 ? text : text.slice(0, split).trim();
    if (!value || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || seen.has(value)) continue;
    seen.add(value);
    const display = completionLabel(value);
    const kind: CompletionKind = value.endsWith('/') ? 'directory' : value.startsWith('-') ? 'option' : start === 0 ? 'command' : 'argument';
    result.push({value, display, name: display, description: split === -1 ? '' : completionLabel(text.slice(split + 4)),
      kind, source: 'zsh-native', replacement: {start, end: context.buffer.length}, context: {...context}, insertion: base + value});
  }
  return result;
}

/** Stable subsequence ranking. Exact/prefix matches lead; ties retain source order. */
export function filterCompletions(candidates: readonly CompletionCandidate[], query: string): CompletionCandidate[] {
  const needle = query.toLowerCase();
  if (!needle) return [...candidates];
  const scored: Array<{candidate: CompletionCandidate; score: number; index: number}> = [];
  candidates.forEach((candidate, index) => {
    const text = candidate.value.toLowerCase();
    let position = -1;
    let gaps = 0;
    for (const character of needle) {
      const next = text.indexOf(character, position + 1);
      if (next === -1) return;
      gaps += next - position - 1;
      position = next;
    }
    const score = text === needle ? -2000 : text.startsWith(needle) ? -1000 + text.length : gaps + text.length;
    scored.push({candidate, score, index});
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map(item => item.candidate);
}

/** zsh `_command_names` group tags and semantic-metadata types, to one identity. */
export function commandIdentity(value: string | undefined): CommandIdentity | undefined {
  if (!value) return undefined;
  const text = value.toLowerCase();
  if (text === 'alias' || text.includes('alias')) return 'alias';
  if (text === 'function' || text.includes('function')) return 'function';
  if (text === 'builtin' || text.includes('builtin')) return 'builtin';
  if (text === 'reserved' || text.includes('reserved') || text.includes('keyword')) return 'keyword';
  if (text === 'executable' || text.includes('external command') || text === 'command') return 'executable';
  return undefined;
}

/**
 * Plugin and completion-system helpers (`_fzf_*`, `__atuin_*`, `_zoxide_*`)
 * stay known to NMSh but are not offered while typing a command name unless
 * the user's word itself starts with `_`.
 */
export function isInternalHelper(candidate: CompletionCandidate, word: string): boolean {
  return candidate.kind === 'command' && candidate.value.startsWith('_') && !word.startsWith('_');
}

/** Local use counts and recency for command names, from eligible (non-private) history. */
export interface CommandUsage {
  count: number;
  /** Most recent use, epoch ms. */
  last: number;
}

/**
 * A command candidate's frecency: frequent and recent names score higher.
 * Bounded and pure; equal-quality matches only are reordered by it.
 */
export function usageScore(usage: CommandUsage | undefined, now: number): number {
  if (!usage) return 0;
  const days = Math.max(0, (now - usage.last) / 86_400_000);
  const recency = days < 1 ? 4 : days < 7 ? 2 : days < 30 ? 1 : 0.5;
  return Math.log2(1 + usage.count) * recency;
}

/** Match quality tier for a candidate against the typed word: lower is better. */
export function matchTier(value: string, word: string): number {
  const text = value.toLowerCase();
  const needle = word.toLowerCase();
  if (!needle) return 2;
  return text === needle ? 0 : text.startsWith(needle) ? 1 : 2;
}

/**
 * Command-position ordering: match tier first (exact, prefix, fuzzy), then
 * frecency, then the source's own order. Deterministic for equal inputs.
 */
export function rankCommandCandidates(candidates: readonly CompletionCandidate[], word: string,
  usage: ReadonlyMap<string, CommandUsage>, now: number): CompletionCandidate[] {
  return candidates.map((candidate, index) => ({candidate, index, tier: matchTier(candidate.value, word), score: usageScore(usage.get(candidate.value), now)}))
    .sort((a, b) => a.tier - b.tier || b.score - a.score || a.index - b.index)
    .map(entry => entry.candidate);
}
