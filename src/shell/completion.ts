/** Source-independent completion data. Offsets are UTF-16 indices in context.buffer. */
export type CompletionKind = 'command' | 'subcommand' | 'option' | 'argument' | 'file' | 'directory' | 'value';

export interface CompletionContext {
  buffer: string;
  cwd: string;
}

export interface CompletionCandidate {
  /** Text replacing replacement.start..end. Never executed by completion. */
  value: string;
  display: string;
  description: string;
  kind: CompletionKind;
  source: string;
  group?: string;
  replacement: {start: number; end: number};
  context: CompletionContext;
  /** Full buffer and display aliases for existing composer consumers. */
  insertion: string;
  name: string;
}

export interface CompletionSource {
  readonly id: string;
  query(context: CompletionContext, signal: AbortSignal): Promise<CompletionCandidate[]>;
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
