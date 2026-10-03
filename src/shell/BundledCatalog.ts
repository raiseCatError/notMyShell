import {closeSync, openSync, readFileSync, readSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateRawSync} from 'node:zlib';
import {completionWord} from './ConfiguredCompletion.js';
import type {CompletionCandidate, CompletionContext, CompletionKind, CompletionSource} from './completion.js';

/**
 * The bundled completion catalog: static command knowledge imported at build
 * time from withfig/autocomplete and carapace-bin (both MIT; see
 * assets/completion/provenance.json). It is data only; nothing upstream is
 * executed, and dynamic completions were dropped by the importer.
 *
 * Format: `catalog-index.json` maps root names to entry keys and entry keys to
 * [offset, length] in `catalog.bin`, where each entry is deflateRaw'd JSON of
 * one node. A large subcommand is its own entry, referenced as `{n, d, r}`.
 * The index is read on first use; entries are inflated on demand and kept in a
 * small LRU, so a lookup touches only the command path being completed.
 */

export interface CatalogArg {
  n?: string;
  d?: string;
  /** Static choices: [value, description?]. */
  c?: Array<[string, string?]>;
  /** The argument is a path. */
  t?: 'files' | 'folders';
  o?: 1;
  v?: 1;
}
export interface CatalogOption {n: string[]; d?: string; a?: CatalogArg[]; p?: 1}
export interface CatalogNode {
  n: string[];
  d?: string;
  s?: CatalogNode[];
  o?: CatalogOption[];
  a?: CatalogArg[];
  /** Entry key holding this node's body. */
  r?: string;
}
interface CatalogIndex {version: number; roots: Record<string, string>; entries: Record<string, [number, number]>}

const MAX_CACHED_ENTRIES = 24;
const MAX_CHOICES = 500;
export const BUNDLED_CATALOG_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'completion');

export class BundledCatalog {
  private index?: CatalogIndex | null;
  private readonly cache = new Map<string, CatalogNode>();
  /** Entries inflated so far (diagnostics and tests). */
  loads = 0;

  constructor(private readonly directory: string = BUNDLED_CATALOG_DIRECTORY) {}

  /** Undefined when the catalog is absent or unreadable; never throws. */
  private readIndex(): CatalogIndex | undefined {
    if (this.index === undefined) {
      try {
        const parsed = JSON.parse(readFileSync(join(this.directory, 'catalog-index.json'), 'utf8')) as CatalogIndex;
        this.index = parsed.version === 1 && parsed.roots && parsed.entries ? parsed : null;
      } catch { this.index = null; }
    }
    return this.index ?? undefined;
  }

  get available(): boolean { return !!this.readIndex(); }
  get rootCount(): number { return Object.keys(this.readIndex()?.roots ?? {}).length; }
  hasRoot(name: string): boolean { return Object.hasOwn(this.readIndex()?.roots ?? {}, name); }

  entry(key: string): CatalogNode | undefined {
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    const location = this.readIndex()?.entries[key];
    if (!location) return undefined;
    let fd: number | undefined;
    try {
      const [offset, length] = location;
      const buffer = Buffer.alloc(length);
      fd = openSync(join(this.directory, 'catalog.bin'), 'r');
      if (readSync(fd, buffer, 0, length, offset) !== length) return undefined;
      const node = JSON.parse(inflateRawSync(buffer).toString('utf8')) as CatalogNode;
      this.loads += 1;
      this.cache.set(key, node);
      if (this.cache.size > MAX_CACHED_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
      return node;
    } catch { return undefined; } finally { if (fd !== undefined) closeSync(fd); }
  }

  root(name: string): CatalogNode | undefined {
    return this.hasRoot(name) ? this.entry(this.readIndex()!.roots[name]!) : undefined;
  }

  /** A referenced subcommand's body; inline nodes are returned as they are. */
  resolve(node: CatalogNode): CatalogNode { return node.r ? this.entry(node.r) ?? node : node; }
}

/** Words before the cursor, split on unquoted whitespace. */
function wordsBefore(buffer: string, start: number): string[] {
  return buffer.slice(0, start).trim().split(/\s+/u).filter(Boolean);
}

/** Candidates from the catalog for the word at the cursor. */
export function catalogCandidates(catalog: BundledCatalog, context: CompletionContext, source = 'catalog'): CompletionCandidate[] {
  const cursor = context.cursor ?? context.buffer.length;
  const range = completionWord({...context, cursor});
  if (!range || range.start === 0) return [];
  const words = wordsBefore(context.buffer, range.start);
  let node = catalog.root(words[0] ?? '');
  if (!node) return [];
  const persistent: CatalogOption[] = [];
  const findOption = (word: string) => [...(node!.o ?? []), ...persistent].find(option => option.n.includes(word));
  let pendingOption: CatalogOption | undefined;
  let positional = 0;
  for (const word of words.slice(1)) {
    if (pendingOption) { pendingOption = undefined; continue; }
    if (word.startsWith('-')) {
      const option = word.includes('=') ? undefined : findOption(word);
      if (option?.a?.length) pendingOption = option;
      continue;
    }
    const sub = node.s?.find(item => item.n.includes(word));
    if (sub) {
      persistent.push(...(node.o ?? []).filter(option => option.p));
      node = catalog.resolve(sub);
      positional = 0;
    } else positional += 1;
  }
  const typed = context.buffer.slice(range.start, cursor);
  const make = (value: string, description: string | undefined, kind: CompletionKind): CompletionCandidate => ({value, display: value, name: value,
    description: description ?? '', kind, source, replacement: range, context: {...context}, insertion: context.buffer.slice(0, range.start) + value + context.buffer.slice(range.end),
    insertionCursor: range.start + value.length});
  const result: CompletionCandidate[] = [];
  const choices = (arg: CatalogArg | undefined) => {
    for (const [value, description] of (arg?.c ?? []).slice(0, MAX_CHOICES)) if (value.startsWith(typed)) result.push(make(value, description ?? arg?.d, 'value'));
  };
  // The value of an option that takes one: only its static choices (paths are the shell's job).
  if (pendingOption) { choices(pendingOption.a?.[0]); return result; }
  if (!typed.startsWith('-')) {
    for (const sub of node.s ?? []) for (const name of sub.n) if (name.startsWith(typed)) result.push(make(name, sub.d, 'subcommand'));
    const args = node.a ?? [];
    choices(positional < args.length ? args[positional] : args.at(-1)?.v ? args.at(-1) : undefined);
  }
  if (typed.startsWith('-') || !typed) {
    const seen = new Set<string>();
    for (const option of [...(node.o ?? []), ...persistent]) for (const name of option.n) {
      if (!seen.has(name) && name.startsWith(typed)) { seen.add(name); result.push(make(name, option.d, 'option')); }
    }
  }
  return result;
}

/**
 * `shadowed(root)` names commands a higher-priority custom spec defines: the
 * user's spec then replaces the bundled knowledge for that command entirely.
 */
export class BundledCatalogSource implements CompletionSource {
  readonly id = 'catalog';
  constructor(readonly catalog = new BundledCatalog(), private readonly shadowed: (root: string) => boolean = () => false) {}
  async query(context: CompletionContext, signal: AbortSignal): Promise<CompletionCandidate[]> {
    if (signal.aborted) return [];
    const root = context.buffer.trimStart().split(/\s+/u)[0] ?? '';
    if (this.shadowed(root)) return [];
    return catalogCandidates(this.catalog, context, this.id);
  }
}
