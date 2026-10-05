import {existsSync, readFileSync, statSync} from 'node:fs';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {lineRevision, type StyledLine} from './AnsiOutputParser.js';

const CONTROL = /[\u0000-\u0020\u007f-\u009f]/u;
const MAX_LINE = 8192;
const MAX_TARGETS = 16;

/** Generated payloads only: never copy terminal controls into OSC strings. */
export function safeHyperlinkTarget(target: string): string | undefined {
  if (!target || target.length > 4096 || CONTROL.test(target)) return undefined;
  try {
    const url = new URL(target);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) return undefined;
    if (url.protocol !== 'file:' && (!url.hostname || url.username || url.password)) return undefined;
    if (url.protocol === 'file:' && url.hostname) return undefined;
    return url.href;
  } catch { return undefined; }
}

/** Only an explicit origin GitHub remote identifies shorthand. No session default. */
export function githubRepository(cwd: string): string | undefined {
  let directory = resolve(cwd);
  for (let depth = 0; depth < 16; depth++) {
    const dotgit = join(directory, '.git');
    try {
      if (existsSync(dotgit)) {
        let gitdir = dotgit;
        if (statSync(dotgit).isFile()) {
          if (statSync(dotgit).size > 4096) return undefined;
          const pointer = /^gitdir: ([^\r\n]+)\s*$/u.exec(readFileSync(dotgit, 'utf8'));
          if (!pointer) return undefined;
          gitdir = resolve(directory, pointer[1]!);
          const common = join(gitdir, 'commondir');
          if (existsSync(common) && statSync(common).size <= 4096) gitdir = resolve(gitdir, readFileSync(common, 'utf8').trim());
        }
        const config = join(gitdir, 'config');
        if (statSync(config).size > 65536) return undefined;
        const source = readFileSync(config, 'utf8');
        const origin = /^\[remote "origin"\]\s*\n([^[]*)/mu.exec(source)?.[1];
        const remote = origin && /^\s*url\s*=\s*(\S+)\s*$/mu.exec(origin)?.[1];
        const match = remote && /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(remote);
        return match ? `https://github.com/${match[1]}` : undefined;
      }
    } catch { return undefined; }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/** Bounded, presentation-only clones. Original parser cells are never decorated. */
export class HyperlinkPresenter {
  private readonly cache = new WeakMap<StyledLine, {revision: number; cwd?: string; line: StyledLine}>();
  private readonly repositories = new Map<string, string | undefined>();

  line(source: StyledLine, cwd?: string): StyledLine {
    const revision = lineRevision(source);
    const cached = this.cache.get(source);
    if (cached && cached.revision === revision && cached.cwd === cwd) return cached.line;
    if (source.length > MAX_LINE) return source;
    const plain = source.map(cell => cell === null ? '' : cell?.text ?? ' ').join('');
    if (plain.length > MAX_LINE) return source;
    let repository: string | undefined;
    if (cwd && /(?:^|\s)#[1-9]\d*\b/u.test(plain)) {
      if (!this.repositories.has(cwd)) {
        if (this.repositories.size >= 128) this.repositories.delete(this.repositories.keys().next().value!);
        this.repositories.set(cwd, githubRepository(cwd));
      }
      repository = this.repositories.get(cwd);
    }
    const spans: Array<{start: number; end: number; payload: string}> = [];
    // Require whole whitespace-delimited paths or explicit punctuation-delimited URLs/refs.
    const tokens = /(?:^|[\s([<])((?:https?:\/\/[^\s<>"']+)|(?:#[1-9]\d*)|(?:\.{1,2}\/[^\s<>"']+)|(?:\/[^\s<>"']+)|(?:[A-Za-z0-9_.-]+\/[^\s<>"']+)|(?:[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+))(?=$|[\s)>.,:;!?])/gu;
    let count = 0;
    for (const match of plain.matchAll(tokens)) {
      if (++count > MAX_TARGETS) break;
      const raw = match[1]!;
      let token = raw;
      if (/^https?:/u.test(raw)) {
        token = raw.replace(/[.,;!?]+$/u, '');
        while (token.endsWith(')') && (token.match(/\)/gu)?.length ?? 0) > (token.match(/\(/gu)?.length ?? 0)) token = token.slice(0, -1);
      }
      let target: string | undefined;
      if (/^https?:\/\//u.test(token)) target = safeHyperlinkTarget(token);
      else if (/^#[1-9]\d*$/u.test(token) && repository) target = `${repository}/issues/${token.slice(1)}`;
      else if (cwd && !token.startsWith('#') && !CONTROL.test(token) && !token.includes(':')) {
        const path = isAbsolute(token) ? token : resolve(cwd, token);
        try { if (existsSync(path)) target = safeHyperlinkTarget(pathToFileURL(path).href); } catch { /* plain fallback */ }
      }
      if (target) {
        const start = match.index! + match[0].indexOf(raw);
        spans.push({start, end: start + token.length, payload: `8;;${target}`});
      }
    }
    // An existing program link owns its entire recognized token, even if the
    // program linked only part of it. Never add a competing target around it.
    let position = 0;
    const originalRanges: Array<{start: number; end: number}> = [];
    for (const cell of source) {
      if (cell === null) continue;
      const length = cell?.text.length ?? 1;
      if (cell?.hyperlink) originalRanges.push({start: position, end: position + length});
      position += length;
    }
    const generated = spans.filter(span => !originalRanges.some(range => range.start < span.end && range.end > span.start));
    let offset = 0;
    const line = source.map(cell => {
      if (cell === null) return cell;
      const length = cell?.text.length ?? 1;
      const span = generated.find(candidate => offset >= candidate.start && offset + length <= candidate.end);
      offset += length;
      return cell && !cell.hyperlink && span ? {...cell, hyperlink: span.payload} : cell;
    });
    this.cache.set(source, {revision, cwd, line});
    return line;
  }
}

const OSC8_CLOSE = '\u001B]8;;\u001B\\';

/**
 * An NMSh-authored link for live UI rows (task URLs, docs): the text wrapped
 * in OSC 8 only when the host supports links and the target is safe; plain
 * text otherwise. Callers that truncate append `closeAuthoredLinks` so a cut
 * never leaves a link open.
 */
export function authoredLink(text: string, target: string, enabled: boolean): string {
  const safe = enabled ? safeHyperlinkTarget(target) : undefined;
  return safe ? `\u001B]8;;${safe}\u001B\\${text}${OSC8_CLOSE}` : text;
}

export function closeAuthoredLinks(row: string): string {
  return row.includes('\u001B]8;;') ? `${row}${OSC8_CLOSE}` : row;
}
