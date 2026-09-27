import {isPrivateCommand, type CommandEntry, type Suggestion, type SuggestionContext, type SuggestionProvider} from './types.js';

/**
 * Ranking weights, tuned by replaying real and synthetic histories
 * (tests/suggestionRanking.test.ts). Each signal is normalized to about
 * 0..1 before weighting.
 */
export const NATIVE_WEIGHTS = {
  frecency: 1,
  frequency: 0.35,
  directory: 1.2,
  sequence: 1.6,
  failure: 0.6,
  fuzzy: 0.45,
};
/** Frecency half-life-like decay constant. */
const DECAY_MS = 10 * 24 * 60 * 60 * 1000;
const MAX_RESULTS = 5;
/** Session-added commands are scanned linearly until the next index rebuild. */
const REBUILD_AFTER = 400;
/** Fuzzy matching, and very short prefixes, scan only the most-used and most-recent commands. */
const FUZZY_SCAN_LIMIT = 20000;
/** Prefix ranges wider than this are ranked from the bounded most-used/most-recent lists instead. */
const WIDE_PREFIX_RANGE = 4000;
const LOAD_CHUNK = 25000;
const MAX_SEQUENCE_SUCCESSORS = 32;

interface CommandStats {
  command: string;
  count: number;
  failures: number;
  /** Decayed use weight as of `frecencyAt`. */
  frecency: number;
  frecencyAt: number;
  directories: Map<string, number>;
}

const WORD_BREAK = /[\s/._-]/u;

/**
 * In-order subsequence match, case-insensitive, starting at a word boundary
 * with a bounded spread. Word-start (acronym) matches such as `dcu` for
 * `docker compose up` are tried first and score higher.
 */
export function fuzzyMatch(query: string, candidate: string): number | undefined {
  const needle = query.toLowerCase();
  const haystack = candidate.toLowerCase();
  if (!needle) return undefined;
  const wordStart = (index: number) => index === 0 || WORD_BREAK.test(haystack[index - 1]!);
  let best: number | undefined;
  for (let start = haystack.indexOf(needle[0]!); start !== -1; start = haystack.indexOf(needle[0]!, start + 1)) {
    if (!wordStart(start)) continue;
    // Acronym pass: each next character at the next word start that has it.
    let position = start + 1;
    let acronym = true;
    for (let index = 1; index < needle.length && acronym; index += 1) {
      let found = -1;
      for (let probe = haystack.indexOf(needle[index]!, position); probe !== -1; probe = haystack.indexOf(needle[index]!, probe + 1)) {
        if (wordStart(probe)) { found = probe; break; }
      }
      if (found === -1) acronym = false; else position = found + 1;
    }
    if (acronym) return 1 - start / (candidate.length + 1) * 0.2;
    // Greedy pass with a bounded spread.
    position = start + 1;
    let matched = true;
    for (let index = 1; index < needle.length; index += 1) {
      position = haystack.indexOf(needle[index]!, position);
      if (position === -1) { matched = false; break; }
      position += 1;
    }
    const spread = position - start;
    if (matched && spread <= needle.length * 3 + 6) {
      const score = needle.length / spread - start / (candidate.length + 1) * 0.2;
      if (best === undefined || score > best) best = score;
    }
  }
  return best;
}

/**
 * NMSh Native suggestions: fuzzy matching, frecency, directory affinity and
 * previous-command sequence prediction over local history. Everything stays
 * in memory; nothing leaves the machine and nothing is written.
 */
export class NativeSuggestions implements SuggestionProvider {
  readonly id = 'nmsh' as const;
  private readonly stats = new Map<string, CommandStats>();
  private readonly sequences = new Map<string, Map<string, number>>();
  /** Sorted unique commands for prefix range lookup. */
  private sorted: string[] = [];
  /** Most used first, for fuzzy scanning. */
  private byUse: string[] = [];
  /** Most recently used first, for the same bounded scans. */
  private byRecent: string[] = [];
  private pending: string[] = [];
  /** Commands recorded this session, replayed after a (re)load so none are lost. */
  private readonly recorded: CommandEntry[] = [];
  weights = {...NATIVE_WEIGHTS};

  constructor(private readonly ignore?: RegExp) {}

  /** Replaces the index with a loaded history, oldest first. */
  load(entries: readonly CommandEntry[], now = Date.now()): void {
    this.beginLoad();
    this.learnRange(entries, 0, entries.length, now);
    this.finishLoad(now);
  }

  /** The same as `load`, yielding between chunks so huge histories never stall keystrokes. */
  async loadInChunks(entries: readonly CommandEntry[], now = Date.now()): Promise<void> {
    this.beginLoad();
    for (let start = 0; start < entries.length; start += LOAD_CHUNK) {
      this.learnRange(entries, start, Math.min(entries.length, start + LOAD_CHUNK), now);
      await new Promise(resolve => setImmediate(resolve));
    }
    this.finishLoad(now);
  }

  private beginLoad(): void {
    this.stats.clear();
    this.sequences.clear();
    this.pending = [];
    this.sorted = [];
    this.byUse = [];
    this.byRecent = [];
  }

  private learnRange(entries: readonly CommandEntry[], start: number, end: number, now: number): void {
    let previous = start > 0 ? entries[start - 1]?.command : undefined;
    for (let index = start; index < end; index += 1) {
      const entry = entries[index]!;
      this.learn({...entry, previous: entry.previous ?? previous}, now);
      previous = entry.command;
    }
    // Commands learned mid-load stay searchable until the index is rebuilt.
    this.pending = [...this.stats.keys()].slice(-REBUILD_AFTER);
  }

  private finishLoad(now: number): void {
    for (const entry of this.recorded) this.learn(entry, now);
    this.rebuild();
  }

  get size(): number {
    return this.stats.size;
  }

  record(entry: CommandEntry): void {
    if (!this.learn(entry, entry.at ?? Date.now())) return;
    this.recorded.push(entry);
    if (this.recorded.length > 2000) this.recorded.shift();
    if (this.stats.get(entry.command)!.count === 1) this.pending.push(entry.command);
    if (this.pending.length >= REBUILD_AFTER) this.rebuild();
  }

  private learn(entry: CommandEntry, fallbackTime: number): boolean {
    const command = entry.command;
    // Multi-line commands are never drawn as ghost text, so they are not learned either.
    if (isPrivateCommand(command, this.ignore) || command.includes('\n')) return false;
    const at = entry.at ?? fallbackTime;
    let stats = this.stats.get(command);
    if (!stats) {
      stats = {command, count: 0, failures: 0, frecency: 0, frecencyAt: at, directories: new Map()};
      this.stats.set(command, stats);
    }
    stats.count += 1;
    if (entry.exitCode !== undefined && entry.exitCode !== 0 && entry.exitCode !== -1) stats.failures += 1;
    const decayed = decay(stats.frecency, stats.frecencyAt, at);
    stats.frecency = decayed + 1;
    stats.frecencyAt = Math.max(stats.frecencyAt, at);
    if (entry.cwd && entry.cwd !== 'unknown') stats.directories.set(entry.cwd, (stats.directories.get(entry.cwd) ?? 0) + 1);
    if (entry.previous && entry.previous !== command && !isPrivateCommand(entry.previous, this.ignore)) {
      let next = this.sequences.get(entry.previous);
      if (!next) this.sequences.set(entry.previous, next = new Map());
      next.set(command, (next.get(command) ?? 0) + 1);
      if (next.size > MAX_SEQUENCE_SUCCESSORS) {
        const weakest = [...next.entries()].reduce((low, item) => item[1] < low[1] ? item : low);
        next.delete(weakest[0]);
      }
    }
    return true;
  }

  private rebuild(): void {
    this.sorted = [...this.stats.keys()].sort();
    const all = [...this.stats.values()];
    this.byUse = all.sort((a, b) => b.count - a.count).slice(0, FUZZY_SCAN_LIMIT).map(stats => stats.command);
    this.byRecent = all.sort((a, b) => b.frecencyAt - a.frecencyAt).slice(0, FUZZY_SCAN_LIMIT).map(stats => stats.command);
    this.pending = [];
  }

  /** Individual signals for one candidate, each about 0..1. */
  signals(command: string, context: SuggestionContext): {frecency: number; frequency: number; directory: number; sequence: number; failure: number} {
    const stats = this.stats.get(command);
    if (!stats) return {frecency: 0, frequency: 0, directory: 0, sequence: 0, failure: 0};
    const current = decay(stats.frecency, stats.frecencyAt, context.now);
    let directory = 0;
    if (stats.directories.size > 0) {
      const exact = stats.directories.get(context.cwd) ?? 0;
      let related = 0;
      for (const [path, count] of stats.directories) {
        if (path !== context.cwd && (context.cwd.startsWith(`${path}/`) || path.startsWith(`${context.cwd}/`))) related += count;
      }
      directory = Math.min(1, (exact + related * 0.5) / stats.count + (exact > 0 ? 0.25 : 0));
    }
    const previous = context.previous[0];
    const successors = previous ? this.sequences.get(previous) : undefined;
    let sequence = 0;
    if (successors) {
      let total = 0;
      for (const count of successors.values()) total += count;
      sequence = (successors.get(command) ?? 0) / Math.max(1, total);
    }
    return {
      frecency: current / (current + 3),
      frequency: Math.log1p(stats.count) / Math.log1p(stats.count + 20),
      directory,
      sequence,
      failure: stats.failures / stats.count,
    };
  }

  score(command: string, context: SuggestionContext): number {
    const signal = this.signals(command, context);
    const weights = this.weights;
    return weights.frecency * signal.frecency + weights.frequency * signal.frequency + weights.directory * signal.directory
      + weights.sequence * signal.sequence - weights.failure * signal.failure;
  }

  query(context: SuggestionContext): Suggestion[] {
    const buffer = context.buffer;
    if (!buffer.trim()) return this.predictEmpty(context);
    const top: Suggestion[] = [];
    const offer = (command: string, bonus: number) => {
      if (command === buffer || top.some(item => item.text === command)) return;
      const score = this.score(command, context) + bonus;
      if (top.length === MAX_RESULTS && score <= top[MAX_RESULTS - 1]!.score) return;
      top.push({text: command, source: 'nmsh', score});
      top.sort((a, b) => b.score - a.score);
      if (top.length > MAX_RESULTS) top.pop();
    };
    // Prefix matches can become ghost text; they always outrank fuzzy ones.
    const PREFIX = 10;
    const first = lowerBound(this.sorted, buffer);
    const end = lowerBound(this.sorted, `${buffer}\u{10FFFF}`);
    if (end - first <= WIDE_PREFIX_RANGE) {
      for (let index = first; index < end; index += 1) offer(this.sorted[index]!, PREFIX);
    } else {
      for (const command of this.byUse) if (command.startsWith(buffer)) offer(command, PREFIX);
      for (const command of this.byRecent) if (command.startsWith(buffer)) offer(command, PREFIX);
    }
    for (const command of this.pending) if (command.startsWith(buffer)) offer(command, PREFIX);
    if (top.length < MAX_RESULTS && buffer.trim().length >= 2) {
      const fuzzyWeight = this.weights.fuzzy;
      for (const command of [...this.pending, ...this.byUse, ...this.byRecent]) {
        if (command.startsWith(buffer)) continue;
        const match = fuzzyMatch(buffer.trim(), command);
        if (match !== undefined) offer(command, fuzzyWeight * match);
      }
    }
    return top;
  }

  /** Empty-prompt prediction: what usually follows the previous command, here. */
  private predictEmpty(context: SuggestionContext): Suggestion[] {
    const previous = context.previous[0];
    const successors = previous ? this.sequences.get(previous) : undefined;
    if (!successors) return [];
    return [...successors.keys()]
      .filter(command => this.stats.has(command))
      .map(command => ({text: command, source: 'nmsh' as const, score: this.score(command, context)}))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);
  }
}

function decay(value: number, from: number, to: number): number {
  return to <= from ? value : value * Math.exp(-(to - from) / DECAY_MS);
}

function lowerBound(sorted: readonly string[], value: string): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]! < value) low = middle + 1; else high = middle;
  }
  return low;
}
