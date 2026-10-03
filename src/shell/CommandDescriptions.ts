import {readFile, realpath, stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {resolveCommand} from '../providers/providers.js';
import type {CompletionCandidate} from './completion.js';

const inflate = promisify(gunzip);
/** Man pages larger than this are not read for a one-line summary. */
const MAX_PAGE_BYTES = 512 * 1024;
const CACHE_LIMIT = 512;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;

/** The fallback for session names, which are never expanded or printed. */
export function identityDescription(candidate: Pick<CompletionCandidate, 'identity'>): string | undefined {
  switch (candidate.identity) {
    case 'alias': return 'Alias in the current zsh session';
    case 'function': return 'Function in the current zsh session';
    case 'builtin': return 'zsh builtin';
    case 'keyword': return 'zsh reserved word';
    default: return undefined;
  }
}

const clean = (text: string) => text.replace(/\\f[BIRP]|\\\(.{2}|\\[&-]/gu, match => match === '\\-' ? '-' : '')
  .replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 120);

/**
 * The one-line summary from a man page's NAME section, in either man(7)
 * (`ls \- list directory contents`) or mdoc(7) (`.Nd list directory contents`)
 * form. Plain text parsing only; nothing is rendered or executed.
 */
export function parseManSummary(page: string): string | undefined {
  const lines = page.split('\n');
  const start = lines.findIndex(line => /^\.S[Hh]\s+"?NAME"?\s*$/u.test(line));
  if (start === -1) return undefined;
  const section: string[] = [];
  for (const line of lines.slice(start + 1, start + 12)) {
    if (/^\.S[Hh]\b/u.test(line)) break;
    const nd = /^\.Nd\s+(.+)$/u.exec(line);
    if (nd) return clean(nd[1]!) || undefined;
    if (!line.startsWith('.') && !line.startsWith("'")) section.push(line);
  }
  const text = section.join(' ');
  const split = text.search(/\s\\?-\s/u);
  return split === -1 ? undefined : clean(text.slice(split).replace(/^\s\\?-\s/u, '')) || undefined;
}

/** Candidate man page files for an executable: beside its prefix, then the system pages. Sections 1 and 8. */
export function manPageCandidates(name: string, binaries: readonly string[]): string[] {
  const prefixes = new Set<string>();
  for (const binary of binaries) prefixes.add(join(dirname(dirname(binary)), 'share', 'man'));
  prefixes.add('/usr/share/man');
  prefixes.add('/usr/local/share/man');
  return [...prefixes].flatMap(root => ['1', '8'].flatMap(section =>
    [join(root, `man${section}`, `${name}.${section}`), join(root, `man${section}`, `${name}.${section}.gz`)]));
}

/**
 * Local man-page summaries for PATH executables, read from the man page files
 * on disk: never the candidate itself, never `--help`, never `man`/`whatis`
 * (which can rebuild databases), never the network. Results (including
 * "none") are cached; lookups are asynchronous and bounded.
 */
export class CommandDescriptions {
  private readonly cache = new Map<string, string | null>();
  private readonly pending = new Map<string, Promise<string | undefined>>();
  private readonly lifetime = new AbortController();

  constructor(private readonly lookup: (name: string, signal: AbortSignal) => Promise<string | undefined> = manSummary) {}

  /** Cached description, if known. Never blocks. */
  cached(name: string): string | undefined {
    return this.cache.get(name) ?? undefined;
  }

  /** Start a lookup for a highlighted executable; resolves once, then cached. */
  request(name: string): Promise<string | undefined> {
    if (!SAFE_NAME.test(name)) return Promise.resolve(undefined);
    if (this.cache.has(name)) return Promise.resolve(this.cache.get(name) ?? undefined);
    const existing = this.pending.get(name);
    if (existing) return existing;
    const pending = this.lookup(name, this.lifetime.signal).catch(() => undefined).then(description => {
      this.pending.delete(name);
      if (this.lifetime.signal.aborted) return undefined;
      if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(name, description ?? null);
      return description;
    });
    this.pending.set(name, pending);
    return pending;
  }

  dispose(): void { this.lifetime.abort(); }
}

async function manSummary(name: string, signal: AbortSignal): Promise<string | undefined> {
  const binary = resolveCommand(name);
  const real = binary ? await realpath(binary).catch(() => binary) : undefined;
  for (const path of manPageCandidates(name, [binary, real].filter((value): value is string => Boolean(value)))) {
    if (signal.aborted) return undefined;
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_PAGE_BYTES) continue;
      const raw = await readFile(path);
      const page = (path.endsWith('.gz') ? await inflate(raw, {maxOutputLength: MAX_PAGE_BYTES * 4}) : raw).toString('utf8');
      // `.so` pages redirect to another page; follow nothing, just skip.
      const summary = parseManSummary(page);
      if (summary) return summary;
    } catch { /* Missing or unreadable: try the next location. */ }
  }
  return undefined;
}
