import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {completionLabel, matchTier, type CompletionCandidate, type CompletionContext, type CompletionKind, type CompletionSource} from './completion.js';
import {completionWord} from './ConfiguredCompletion.js';

/**
 * Completion source normalization: several knowledge sources feed ONE NMSh
 * completion menu. Each source runs with its own deadline and failure
 * isolation; candidates are validated, deduplicated on a stable identity,
 * annotated with every source that produced them, and ranked
 * deterministically. Nothing here executes a candidate or touches the network.
 */

export interface RegisteredSource {
  source: CompletionSource;
  /** Lower wins when two sources produce the same candidate, and orders equal matches. */
  priority: number;
  /** Per-source deadline; a slow source is dropped for this request, never awaited past it. */
  timeoutMs?: number;
}

export interface NormalizedCandidate extends CompletionCandidate {
  /** Every source that produced this candidate, highest priority first. */
  provenance: string[];
}

/** Same text replacing the same range is the same candidate, whichever source found it. */
export function candidateIdentity(candidate: Pick<CompletionCandidate, 'value' | 'replacement'>): string {
  return `${candidate.replacement.start}:${candidate.replacement.end}:${candidate.value}`;
}

/** Reject anything that could corrupt the buffer or inject terminal controls. */
export function validCandidate(candidate: CompletionCandidate, context: CompletionContext): boolean {
  const {start, end} = candidate.replacement ?? {start: -1, end: -1};
  return typeof candidate.value === 'string' && candidate.value.length > 0 && candidate.value.length <= 4096
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(candidate.value)
    && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end <= context.buffer.length;
}

const KIND_ORDER: Record<CompletionKind, number> = {subcommand: 0, command: 1, option: 2, directory: 3, file: 4, argument: 5, value: 6};

/**
 * Merge per-source results. Order: match tier against the typed word
 * (exact, prefix, other), then the best source priority, then each source's
 * own order. Deterministic for equal inputs.
 */
export function mergeCandidates(results: ReadonlyArray<{priority: number; id: string; candidates: readonly CompletionCandidate[]}>,
  context: CompletionContext): NormalizedCandidate[] {
  const merged = new Map<string, {candidate: NormalizedCandidate; priority: number; order: number}>();
  const sorted = [...results].sort((a, b) => a.priority - b.priority);
  let order = 0;
  for (const result of sorted) {
    for (const raw of result.candidates) {
      order += 1;
      if (!validCandidate(raw, context)) continue;
      const key = candidateIdentity(raw);
      const existing = merged.get(key);
      if (existing) {
        if (!existing.candidate.provenance.includes(raw.source)) existing.candidate.provenance.push(raw.source);
        // Lower-priority sources may fill gaps (a description, an identity), never overwrite.
        if (!existing.candidate.description && raw.description) existing.candidate.description = completionLabel(raw.description);
        if (!existing.candidate.identity && raw.identity) existing.candidate.identity = raw.identity;
        continue;
      }
      merged.set(key, {priority: result.priority, order, candidate: {...raw, display: completionLabel(raw.display || raw.value),
        name: completionLabel(raw.name || raw.display || raw.value), description: completionLabel(raw.description ?? ''), provenance: [raw.source]}});
    }
  }
  // A single contributing source keeps its own order exactly (zsh's configured
  // completion orders by group); ranking only arbitrates between sources.
  if (results.filter(result => result.candidates.length > 0).length <= 1) return [...merged.values()].map(entry => entry.candidate);
  const cursor = context.cursor ?? context.buffer.length;
  const range = completionWord({...context, cursor});
  const word = range ? context.buffer.slice(range.start, cursor) : '';
  return [...merged.values()]
    .sort((a, b) => matchTier(a.candidate.value, word) - matchTier(b.candidate.value, word) || a.priority - b.priority || a.order - b.order
      || KIND_ORDER[a.candidate.kind] - KIND_ORDER[b.candidate.kind])
    .map(entry => entry.candidate);
}

/** Query every source concurrently; a failing, slow or aborted source contributes nothing. */
export class CompletionAggregator implements CompletionSource {
  readonly id = 'aggregate';
  /** Last failure per source id, for /status; never the candidate data. */
  readonly failures = new Map<string, string>();

  constructor(private readonly sources: readonly RegisteredSource[]) {}

  get sourceIds(): string[] { return this.sources.map(entry => entry.source.id); }

  async query(context: CompletionContext, signal: AbortSignal): Promise<CompletionCandidate[]> {
    const results = await Promise.all(this.sources.map(async entry => {
      const child = new AbortController();
      const abort = () => child.abort();
      signal.addEventListener('abort', abort, {once: true});
      let timer: NodeJS.Timeout | undefined;
      // Race the deadline: a source that ignores its signal still cannot hold the menu.
      const deadline = new Promise<CompletionCandidate[]>(resolve => { timer = setTimeout(() => { abort(); resolve([]); }, entry.timeoutMs ?? 2500); });
      const aborted = new Promise<CompletionCandidate[]>(resolve => child.signal.addEventListener('abort', () => resolve([]), {once: true}));
      try {
        const candidates = await Promise.race([entry.source.query(context, child.signal), deadline, aborted]);
        this.failures.delete(entry.source.id);
        return {priority: entry.priority, id: entry.source.id, candidates: child.signal.aborted ? [] : candidates};
      } catch (error) {
        this.failures.set(entry.source.id, error instanceof Error ? error.message.slice(0, 200) : 'failed');
        return {priority: entry.priority, id: entry.source.id, candidates: []};
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    }));
    return signal.aborted ? [] : mergeCandidates(results, context);
  }

  dispose(): void { for (const entry of this.sources) entry.source.dispose?.(); }
}

// ------------------------------------------------------------ declarative specs

/**
 * A small declarative spec format (a JSON subset of the Fig/withfig autocomplete
 * model: names, descriptions, subcommands, options). NMSh ships no third-party
 * specs; users may place their own or converted specs in the spec directory.
 * Specs are data only: no generators, scripts or dynamic code are executed.
 */
export interface DeclarativeSpec {
  name: string | string[];
  description?: string;
  subcommands?: DeclarativeSpec[];
  options?: Array<{name: string | string[]; description?: string}>;
}

const MAX_SPEC_BYTES = 512 * 1024;
const MAX_SPECS = 512;
const names = (value: string | string[]) => (Array.isArray(value) ? value : [value]).filter(name => typeof name === 'string' && /^[^\s\u0000-\u001f]{1,128}$/u.test(name));

export function normalizeSpec(value: unknown, depth = 0): DeclarativeSpec | undefined {
  if (!value || typeof value !== 'object' || depth > 8) return undefined;
  const record = value as Record<string, unknown>;
  const specNames = names(record.name as string | string[]);
  if (specNames.length === 0) return undefined;
  const subcommands = Array.isArray(record.subcommands) ? record.subcommands.slice(0, 512).map(item => normalizeSpec(item, depth + 1)).filter((item): item is DeclarativeSpec => !!item) : [];
  const options = Array.isArray(record.options) ? record.options.slice(0, 512).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const optionNames = names((item as {name: string | string[]}).name);
    const description = (item as {description?: unknown}).description;
    return optionNames.length ? [{name: optionNames, ...(typeof description === 'string' ? {description: description.slice(0, 200)} : {})}] : [];
  }) : [];
  return {name: specNames, ...(typeof record.description === 'string' ? {description: record.description.slice(0, 200)} : {}), subcommands, options};
}

/** Words before the cursor, split on unquoted whitespace (simple; specs are a hint source). */
function wordsBefore(buffer: string, start: number): string[] {
  return buffer.slice(0, start).trim().split(/\s+/u).filter(Boolean);
}

/** Candidates from loaded specs for the word at the cursor. Pure. */
export function specCandidates(specs: ReadonlyMap<string, DeclarativeSpec>, context: CompletionContext, source = 'spec'): CompletionCandidate[] {
  const cursor = context.cursor ?? context.buffer.length;
  const range = completionWord({...context, cursor});
  if (!range || range.start === 0) return [];
  const words = wordsBefore(context.buffer, range.start);
  const root = specs.get(words[0] ?? '');
  if (!root) return [];
  let spec: DeclarativeSpec = root;
  for (const word of words.slice(1)) {
    if (word.startsWith('-')) continue;
    const next: DeclarativeSpec | undefined = spec.subcommands?.find(sub => names(sub.name).includes(word));
    if (!next) break;
    spec = next;
  }
  const typed = context.buffer.slice(range.start, cursor);
  const make = (value: string, description: string | undefined, kind: CompletionKind): CompletionCandidate => ({value, display: value, name: value,
    description: description ?? '', kind, source, replacement: range, context: {...context}, insertion: context.buffer.slice(0, range.start) + value + context.buffer.slice(range.end),
    insertionCursor: range.start + value.length});
  const result: CompletionCandidate[] = [];
  if (!typed.startsWith('-')) for (const sub of spec.subcommands ?? []) for (const name of names(sub.name)) if (name.startsWith(typed)) result.push(make(name, sub.description, 'subcommand'));
  if (typed.startsWith('-') || !typed) for (const option of spec.options ?? []) for (const name of names(option.name)) if (name.startsWith(typed)) result.push(make(name, option.description, 'option'));
  return result;
}

/**
 * Loads `*.json` specs from a directory once (bounded size and count), then
 * answers from memory: no I/O on the typing path after the first query.
 */
export class DeclarativeSpecSource implements CompletionSource {
  readonly id = 'spec';
  private specs?: Map<string, DeclarativeSpec>;
  /** Files skipped as invalid, oversize or unreadable. */
  skipped = 0;

  constructor(private readonly directory: string | undefined) {}

  load(): Map<string, DeclarativeSpec> {
    if (this.specs) return this.specs;
    this.specs = new Map();
    if (!this.directory) return this.specs;
    let files: string[] = [];
    try { files = readdirSync(this.directory).filter(name => name.endsWith('.json')).sort().slice(0, MAX_SPECS); } catch { return this.specs; }
    for (const file of files) {
      try {
        const path = join(this.directory, file);
        if (statSync(path).size > MAX_SPEC_BYTES) { this.skipped += 1; continue; }
        const spec = normalizeSpec(JSON.parse(readFileSync(path, 'utf8')));
        if (!spec) { this.skipped += 1; continue; }
        for (const name of names(spec.name)) if (!this.specs.has(name)) this.specs.set(name, spec);
      } catch { this.skipped += 1; }
    }
    return this.specs;
  }

  async query(context: CompletionContext, signal: AbortSignal): Promise<CompletionCandidate[]> {
    if (signal.aborted) return [];
    return specCandidates(this.load(), context, this.id);
  }
}
