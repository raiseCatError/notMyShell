import {constants} from 'node:fs';
import {lstat, open, readlink, realpath} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve, sep} from 'node:path';
import {parseBlockLines, type Block} from './blocks.js';
import {headingsFromLines, resolveFragment, type HeadingEntry} from './sourceMap.js';

/**
 * Offline static diagnostics for Markdown, HTML and CSS documents (#466). Everything here reads the document's own lines (the
 * editor's buffer, saved or not) and, only through an injected `LocalFs`, checks that files the document names exist inside
 * the document's folder or project. It never fetches a URL, runs a script or a command, follows a link out of the root,
 * writes anything or reports a guess as a fact:
 *
 *   error       a reference that is certainly broken (the file is not there, the id/footnote/reference is not defined)
 *   warning     likely a problem (a missing alt text, an unclosed tag, a fragment that Jekyll ids might satisfy)
 *   info        worth knowing (a repeated heading)
 *   unverified  could not be checked, and is not claimed to be wrong (an absolute path, a path outside the project, a templated
 *               attribute, a relative file of a document that has no folder yet)
 *
 * External URLs are only counted. Positions are source lines and UTF-16 columns of the exact text, so a jump can select it.
 */

export type Severity = 'error' | 'warning' | 'info' | 'unverified';

export interface Diagnostic {
  id: string;
  code: string;
  severity: Severity;
  message: string;
  /** 0-based source line. */
  line: number;
  column?: number;
  endColumn?: number;
  /** The span is exactly the text at fault; otherwise only the line is known. */
  exact: boolean;
}

export interface DiagnosticReport {
  diagnostics: Diagnostic[];
  /** External references seen and deliberately not checked. */
  external: number;
  /** Filesystem checks made. */
  checked: number;
  /** Stopped early: too many findings or checks. */
  truncated: boolean;
  aborted?: boolean;
}

export type FileState = 'file' | 'directory' | 'missing' | 'unreadable' | 'outside';

export interface LocalFs {
  /** The state of a path written in the document (already percent-decoded, relative to the document's folder). */
  stat(path: string): Promise<FileState>;
  /** Up to `maxBytes` of a regular file inside the root, for checking a heading fragment in another Markdown file. */
  readText(path: string, maxBytes: number): Promise<string | undefined>;
}

export const MAX_DIAGNOSTICS = 500;
export const MAX_CHECKS = 400;
const MAX_PATH = 1024;
const MAX_TARGET_BYTES = 256 * 1024;
const MAX_TARGET_READS = 50;
/** Markdown lines longer than this are scanned only this far (the rest is reported, not guessed at). */
const MAX_LINE = 20_000;

/**
 * A checker confined to `root`. The path is lexically resolved, then walked one component at a time from the root: a symlink
 * (even a dangling one, even one into a folder this user cannot read) is resolved at the component where it is met and the
 * result must stay inside the real root before the walk goes on, so nothing beyond the root is ever looked at and a link
 * out of it can never be told apart from any other.
 */
export function createLocalFs(docDir: string, root: string): LocalFs {
  let realRoot: Promise<string> | undefined;
  const rootReal = () => realRoot ??= realpath(root).catch(() => root);
  const inside = (base: string, path: string) => { const rel = relative(base, path); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
  async function locate(path: string): Promise<{state: FileState; real?: string}> {
    if (!path || path.length > MAX_PATH || path.includes('\0')) return {state: 'unreadable'};
    const resolved = resolve(docDir, path);
    if (!inside(root, resolved)) return {state: 'outside'};
    const base = await rootReal();
    const segments = relative(root, resolved).split(sep).filter(Boolean);
    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
      const next = join(current, segments[index]!);
      let info;
      try { info = await lstat(next); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return {state: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable'};
      }
      if (info.isSymbolicLink()) {
        let target: string;
        try { target = await realpath(next); }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') return {state: 'unreadable'};
          // Dangling: the place it points to is judged without looking at it.
          try { return {state: inside(base, resolve(join(current), await readlink(next))) ? 'missing' : 'outside'}; } catch { return {state: 'unreadable'}; }
        }
        if (!inside(base, target)) return {state: 'outside'};
        current = target;
        continue;
      }
      current = next;
    }
    try {
      const info = await lstat(current);
      return {state: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'unreadable', real: current};
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {state: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable'};
    }
  }
  return {
    stat: async path => (await locate(path)).state,
    async readText(path, maxBytes) {
      const found = await locate(path);
      if (found.state !== 'file' || !found.real) return undefined;
      let handle;
      try {
        // Never follow a link or wait on a pipe: the file is opened as the regular file it was a moment ago, or not at all.
        handle = await open(found.real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0) | (constants.O_NOCTTY ?? 0));
        const info = await handle.stat();
        const before = await lstat(found.real);
        if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev) return undefined;
        if (await realpath(found.real) !== found.real) return undefined;
        const buffer = Buffer.alloc(Math.min(maxBytes, info.size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead).toString('utf8');
      } catch { return undefined; } finally { await handle?.close().catch(() => undefined); }
    },
  };
}

// ---- Destinations -----------------------------------------------------------------------------------------------

type Target =
  | {kind: 'fragment'; fragment: string}
  | {kind: 'local'; path: string; fragment?: string}
  | {kind: 'external'}
  | {kind: 'unsafe'; scheme: string}
  | {kind: 'absolute'}
  | {kind: 'ignore'};

function classify(destination: string): Target {
  const text = destination.trim();
  if (!text) return {kind: 'ignore'};
  if (text.startsWith('#')) return text.length > 1 ? {kind: 'fragment', fragment: text.slice(1)} : {kind: 'ignore'};
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/u.exec(text)?.[1]?.toLowerCase();
  if (scheme) {
    if (['javascript', 'vbscript', 'file'].includes(scheme)) return {kind: 'unsafe', scheme};
    if (scheme === 'data') return /^data:image\//iu.test(text) ? {kind: 'ignore'} : {kind: 'unsafe', scheme};
    if (scheme.length === 1) return {kind: 'absolute'};
    return {kind: 'external'};
  }
  if (text.startsWith('//')) return {kind: 'external'};
  if (text.startsWith('/') || text.startsWith('~') || text.startsWith('\\')) return {kind: 'absolute'};
  const hash = text.indexOf('#');
  const withoutFragment = hash >= 0 ? text.slice(0, hash) : text;
  const fragment = hash >= 0 ? text.slice(hash + 1) : undefined;
  const path = withoutFragment.replace(/\?.*$/u, '');
  if (!path) return fragment ? {kind: 'fragment', fragment} : {kind: 'ignore'};
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* keep it as written */ }
  return {kind: 'local', path: decoded, ...(fragment ? {fragment} : {})};
}

const TEMPLATED = /\{\{|\{%|<%|\$\{|\{#/u;

// ---- The run ----------------------------------------------------------------------------------------------------

export interface DiagnoseInput {
  lines: readonly string[];
  format: 'markdown' | 'html' | 'css';
  fs?: LocalFs;
  signal?: AbortSignal;
  maxChecks?: number;
}

class Run {
  diagnostics: Diagnostic[] = [];
  external = 0;
  truncated = false;
  private readonly states = new Map<string, Promise<FileState>>();
  private readonly targets = new Map<string, Promise<HeadingEntry[] | undefined>>();
  private ids = 0;
  constructor(readonly input: DiagnoseInput) {}
  get aborted() { return Boolean(this.input.signal?.aborted); }
  get checked() { return this.states.size; }

  add(code: string, severity: Severity, message: string, line: number, column?: number, endColumn?: number): void {
    if (this.diagnostics.length >= MAX_DIAGNOSTICS) { this.truncated = true; return; }
    this.diagnostics.push({id: `${code}:${line}:${column ?? ''}:${this.ids++}`, code, severity, message, line, exact: column !== undefined && endColumn !== undefined, ...(column === undefined ? {} : {column}), ...(endColumn === undefined ? {} : {endColumn})});
  }

  stat(path: string): Promise<FileState> | undefined {
    const known = this.states.get(path);
    if (known) return known;
    if (!this.input.fs || this.states.size >= (this.input.maxChecks ?? MAX_CHECKS)) { if (this.input.fs) this.truncated = true; return undefined; }
    const pending = this.input.fs.stat(path);
    this.states.set(path, pending);
    return pending;
  }

  /** The headings of another Markdown file, read once per path and counted against the same bound as other file work. */
  targetHeadings(path: string): Promise<HeadingEntry[] | undefined> | undefined {
    const known = this.targets.get(path);
    if (known) return known;
    if (!this.input.fs || this.targets.size >= MAX_TARGET_READS) { this.truncated = true; return undefined; }
    const pending = this.input.fs.readText(path, MAX_TARGET_BYTES).then(text => text === undefined ? undefined : headingsFromLines(text.split('\n')));
    this.targets.set(path, pending);
    return pending;
  }

  /** Report a destination written in the document; `exactSpan` false when only the line is known. */
  async reference(destination: string, line: number, column: number, headings: ReturnType<typeof headingsFromLines> | undefined, ids: ReadonlySet<string> | undefined, softFragments: boolean): Promise<void> {
    const end = column + destination.length;
    const exact = !destination.includes('\n') && !destination.includes('\r');
    const add = (code: string, severity: Severity, message: string) => this.add(code, severity, message, line, exact ? column : undefined, exact ? end : undefined);
    const target = classify(destination.replace(/\\([!-/:-@[-`{-~])/gu, '$1'));
    switch (target.kind) {
      case 'ignore': return;
      case 'external': this.external += 1; return;
      case 'unsafe': add('unsafe-scheme', 'warning', `A ${target.scheme}: link is never followed or checked here.`); return;
      case 'absolute': add('absolute-path', 'unverified', 'Absolute and home-relative paths are not checked.'); return;
      case 'fragment': {
        if (!headings && !ids) return;
        const found = headings ? resolveFragment(headings, target.fragment) : undefined;
        let decoded = target.fragment;
        try { decoded = decodeURIComponent(decoded); } catch { /* as written */ }
        if (found || ids?.has(decoded) || ids?.has(target.fragment) || decoded.toLowerCase() === 'top') return;
        add('broken-fragment', softFragments ? 'warning' : 'error', softFragments ? `No heading or id “${target.fragment}” here (other generators may build ids differently).` : `No heading or id “${target.fragment}” in this document.`);
        return;
      }
      case 'local': {
        const pending = this.stat(target.path);
        if (!pending) { if (!this.input.fs) add('unverified-local', 'unverified', 'Not checked: this document has no folder yet. Save it to check local files.'); return; }
        const state = await pending;
        if (this.aborted) return;
        if (state === 'outside') add('outside-root', 'unverified', 'Points outside the document\'s folder or project; not checked.');
        else if (state === 'unreadable') add('unreadable', 'warning', 'This path cannot be read or checked.');
        else if (state === 'missing') add('missing-file', 'error', `No such file: ${target.path.replace(/[\r\n]+/gu, ' ')}`);
        else if (state === 'file' && target.fragment && /\.(?:md|markdown)$/iu.test(target.path) && this.input.fs) {
          const headingsOfTarget = await this.targetHeadings(target.path);
          if (headingsOfTarget && !resolveFragment(headingsOfTarget, target.fragment)) add('broken-fragment-in-file', 'warning', `No heading “${target.fragment}” in ${target.path}.`);
        }
        return;
      }
    }
  }
}

function codeLines(blocks: readonly Block[], into: Set<number>): void {
  for (const block of blocks) {
    if (block.kind === 'code' && block.from !== undefined && block.to !== undefined) for (let line = block.from; line < block.to; line += 1) into.add(line);
    else if (block.kind === 'quote' || block.kind === 'details') codeLines(block.blocks, into);
    else if (block.kind === 'list') for (const item of block.items) codeLines(item.blocks, into);
  }
}

const normalize = (label: string) => label.trim().replace(/\s+/gu, ' ').toLowerCase();
const blankOut = (text: string) => text.replace(/[^\n]/gu, ' ');
const MAX_PARAGRAPH_FOR_SPANS = 200_000;

/** The lines to scan: code, front matter, HTML comments and code spans (also across lines of a paragraph) blanked, columns kept. */
function scannable(lines: readonly string[], skip: ReadonlySet<number>): string[] {
  let text = lines.map((line, at) => skip.has(at) ? '' : line).join('\n');
  text = text.replace(/<!--[\s\S]*?-->/gu, blankOut);
  const cut = text.split('\n');
  let start = 0;
  while (start < cut.length) {
    if (!cut[start]!.trim()) { start += 1; continue; }
    let end = start;
    while (end < cut.length && cut[end]!.trim()) end += 1;
    const paragraph = cut.slice(start, end).join('\n');
    if (paragraph.includes('`') && paragraph.length <= MAX_PARAGRAPH_FOR_SPANS) cut.splice(start, end - start, ...paragraph.replace(/(`+)[\s\S]*?\1/gu, blankOut).split('\n'));
    start = end;
  }
  return cut;
}

const LINK = /(!?)(?<!\\)\[((?:[^\[\]\\!]|\\.|\[[^\[\]\\]{0,200}\]|!\[[^\[\]]{0,200}\]\([^()\s]{0,500}\)|!(?!\[)){0,400})\]\(\s*(<[^>\n]{0,1000}>|[^\s()]{0,1000}(?:\([^\s()]{0,300}\)[^\s()]{0,300}){0,5})/gdu;
const REFERENCE = /(?<![\\!])\[([^\[\]\\]{1,400})\]\[([^\[\]\\]{0,400})\]/gdu;
const FOOTNOTE = /(?<!\\)\[\^([^\]\s]{1,200})\](?!:)/gdu;
const DEFINITION = /^((?:[ ]{0,3}>[ ]?)*[ ]{0,3})\[([^\]^][^\]]{0,999})\]:[ \t]*(<[^>\n]{0,1000}>|\S{0,1000})/du;
const NOTE_DEFINITION = /^((?:[ ]{0,3}>[ ]?)*[ ]{0,3})\[\^([^\]\s]{1,200})\]:/u;
const INLINE_IMG = /<img\b[^>]{0,2000}?\bsrc\s*=\s*(?:"([^"\n]{0,1000})"|'([^'\n]{0,1000})')/gdiu;

async function markdown(run: Run): Promise<void> {
  const lines = run.input.lines;
  const blocks = parseBlockLines(lines, {html: true});
  const skip = new Set<number>();
  codeLines(blocks, skip);
  const fence = lines[0]?.trim();
  if (fence === '---' || fence === '+++') for (let at = 1; at < Math.min(lines.length, 200); at += 1) if (lines[at]!.trim() === fence || (fence === '---' && lines[at]!.trim() === '...')) { for (let line = 0; line <= at; line += 1) skip.add(line); break; }
  const headings = headingsFromLines(lines, {html: true});
  const seen = new Map<string, number>();
  for (const heading of headings) {
    if (heading.slug === undefined) continue;
    const first = seen.get(heading.text.toLowerCase());
    if (first !== undefined) run.add('duplicate-heading', 'info', `Same heading text as line ${first + 1}; its anchor is #${heading.slug}.`, heading.line);
    else seen.set(heading.text.toLowerCase(), heading.line);
  }
  const soft = lines.some(line => /\bid\s*=|\{#/u.test(line));
  const text = scannable(lines, skip);
  const definitions = new Set<string>(), footnoteDefs = new Map<string, number>();
  const refs: Array<{label: string; line: number; start: number; end: number}> = [], notes: Array<{label: string; line: number; start: number; end: number}> = [];
  const destinations: Array<{destination: string; line: number; column: number; alt?: {text: string; start: number; end: number}}> = [];
  let longLine = false;
  text.forEach((full, line) => {
    if (skip.has(line) || run.aborted) return;
    if (full.length > MAX_LINE && !longLine) { longLine = true; run.add('long-line', 'info', `This line is over ${MAX_LINE.toLocaleString('en-US')} characters; only its first part is checked.`, line); }
    const masked = full.length > MAX_LINE ? full.slice(0, MAX_LINE) : full;
    let from = 0;
    const note = NOTE_DEFINITION.exec(masked);
    const definition = note ? undefined : DEFINITION.exec(masked);
    if (note) { footnoteDefs.set(note[2]!, line); from = note[0].length; }
    if (definition) {
      definitions.add(normalize(definition[2]!));
      let raw = definition[3]!, at = definition.indices![3]![0], target = line;
      if (!raw) {
        // The destination may start the next line.
        const following = /^\s*(<[^>\n]*>|\S+)/u.exec(text[line + 1] ?? '');
        if (following) { raw = following[1]!; at = following[0].length - raw.length; target = line + 1; }
      }
      if (raw) destinations.push({destination: raw.startsWith('<') ? raw.slice(1, -1) : raw, line: target, column: at + (raw.startsWith('<') ? 1 : 0)});
      from = definition[0].length;
    }
    const rest = masked.slice(from);
    for (const match of rest.matchAll(LINK)) {
      const raw = match[3]!;
      const [startIndex] = match.indices![3]!;
      const angle = raw.startsWith('<');
      destinations.push({destination: angle ? raw.slice(1, -1) : raw, line, column: from + startIndex + (angle ? 1 : 0),
        ...(match[1] ? {alt: {text: match[2]!, start: from + match.index!, end: from + match.index! + 3 + match[2]!.length}} : {})});
    }
    for (const match of rest.matchAll(INLINE_IMG)) {
      const group = match[1] !== undefined ? 1 : 2;
      destinations.push({destination: match[group]!, line, column: from + match.indices![group]![0]});
    }
    for (const match of rest.matchAll(REFERENCE)) {
      if (match[1]!.startsWith('^')) continue;
      const label = match[2]! || match[1]!;
      const [start, end] = match.indices![match[2]! ? 2 : 1]!;
      refs.push({label, line, start: from + start, end: from + end});
    }
    for (const match of rest.matchAll(FOOTNOTE)) { const [start, end] = match.indices![1]!; notes.push({label: match[1]!, line, start: from + start, end: from + end}); }
    run.external += [...rest.matchAll(/<([a-zA-Z][a-zA-Z0-9+.-]{0,30}:[^>\s]{0,1000})>/gu)].filter(autolink => classify(autolink[1]!).kind === 'external').length;
  });
  for (const item of destinations) {
    if (run.aborted) return;
    if (item.alt && !item.alt.text.trim()) run.add('image-alt', 'warning', 'This image has no alternative text.', item.line, item.alt.start, item.alt.end);
    await run.reference(item.destination, item.line, item.column, headings, undefined, soft);
  }
  for (const ref of refs) if (!definitions.has(normalize(ref.label))) run.add('undefined-reference', 'info', `“${ref.label}” looks like a reference link but nothing defines it; it will show as plain text.`, ref.line, ref.start, ref.end);
  const used = new Set<string>();
  for (const note of notes) { used.add(note.label); if (!footnoteDefs.has(note.label)) run.add('undefined-footnote', 'error', `No definition for footnote [^${note.label}].`, note.line, note.start, note.end); }
  for (const [label, line] of footnoteDefs) if (!used.has(label)) run.add('unreferenced-footnote', 'warning', `Footnote [^${label}] is defined but never referenced.`, line);
}

// ---- CSS and HTML -----------------------------------------------------------------------------------------------

interface CssUrl {value: string; line: number; column: number}

/** One pass over CSS: its url() and @import addresses (not those in comments or strings) and its first bracket problem. */
function scanCss(text: string, baseLine: number, baseColumn: number): {urls: CssUrl[]; issue?: {message: string; line: number; column: number}} {
  const urls: CssUrl[] = [];
  const stack: Array<{char: string; line: number; column: number}> = [];
  let issue: {message: string; line: number; column: number} | undefined;
  let line = baseLine, column = baseColumn;
  const advance = (char: string) => { if (char === '\n') { line += 1; column = 0; } else column += 1; };
  for (let at = 0; at < text.length;) {
    const char = text[at]!;
    if (char === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (; at < stop; at += 1) advance(text[at]!);
      if (end < 0 && !issue) issue = {message: 'A comment is never closed.', line, column};
      continue;
    }
    if (char === '"' || char === '\'') {
      let end = at + 1;
      while (end < text.length && text[end] !== char) end += text[end] === '\\' ? 2 : 1;
      const stop = Math.min(text.length, end + 1);
      for (; at < stop; at += 1) advance(text[at]!);
      continue;
    }
    if (char === '\\') { advance(char); at += 1; if (at < text.length) { advance(text[at]!); at += 1; } continue; }
    const rest = text.slice(at, at + 7);
    if (/^url\(/iu.test(rest) || /^@import\s/iu.test(text.slice(at, at + 8))) {
      const isUrl = /^url\(/iu.test(rest);
      let cursor = at + (isUrl ? 4 : 7);
      let startLine = line, startColumn = column + (cursor - at);
      for (let skipTo = at; skipTo < cursor; skipTo += 1) advance(text[skipTo]!);
      while (cursor < text.length && /\s/u.test(text[cursor]!)) { advance(text[cursor]!); startLine = line; startColumn = column; cursor += 1; }
      startLine = line; startColumn = column;
      const quote = text[cursor] === '"' || text[cursor] === '\'' ? text[cursor]! : undefined;
      let value = '';
      let end = cursor;
      if (quote) {
        end = cursor + 1;
        while (end < text.length && text[end] !== quote && value.length < 2000) { value += text[end] === '\\' ? text[end + 1] ?? '' : text[end]; end += text[end] === '\\' ? 2 : 1; }
        startColumn += 1;
        end += 1;
      } else if (isUrl) {
        while (end < text.length && text[end] !== ')' && !/\s/u.test(text[end]!) && value.length < 2000) { value += text[end]; end += 1; }
      }
      if (value && (quote || isUrl)) urls.push({value, line: startLine, column: startColumn});
      for (; cursor < end; cursor += 1) advance(text[cursor]!);
      // url( ... ): the closing bracket belongs to it.
      if (isUrl) {
        while (cursor < text.length && /\s/u.test(text[cursor]!)) { advance(text[cursor]!); cursor += 1; }
        if (text[cursor] === ')') { advance(')'); cursor += 1; }
      }
      at = cursor;
      continue;
    }
    if ((char === '{' || char === '(') ) stack.push({char, line, column});
    else if (char === '}' || char === ')') {
      const open = stack.pop();
      if (!issue && (!open || (open.char === '{') !== (char === '}'))) issue = {message: `Unexpected “${char}”.`, line, column};
    }
    advance(char); at += 1;
  }
  const open = stack.at(-1);
  if (!issue && open) issue = {message: `“${open.char}” is never closed.`, line: open.line, column: open.column};
  return {urls, ...(issue ? {issue} : {})};
}

async function cssUrls(run: Run, urls: readonly CssUrl[], ids: ReadonlySet<string> | undefined): Promise<void> {
  for (const url of urls) {
    if (run.aborted) return;
    if (TEMPLATED.test(url.value)) { run.add('unverified-dynamic', 'unverified', 'A templated address cannot be checked statically.', url.line, url.column, url.column + url.value.length); continue; }
    await run.reference(url.value, url.line, url.column, undefined, ids, false);
  }
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const OPTIONAL_END = new Set(['p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'option', 'optgroup', 'colgroup', 'html', 'head', 'body']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`=]+))?)*)\s*(\/?)>/gdu;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+)))?/gdu;
const MAX_HTML_CHARS = 1_500_000;

async function html(run: Run): Promise<void> {
  const lines = run.input.lines;
  const starts: number[] = [];
  let offset = 0;
  for (const text of lines) { starts.push(offset); offset += text.length + 1; }
  const source = lines.join('\n');
  if (source.length > MAX_HTML_CHARS) { run.truncated = true; return; }
  const where = (position: number) => { let low = 0, high = starts.length - 1; while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid]! <= position) low = mid; else high = mid - 1; } return {line: low, column: position - starts[low]!}; };
  const text = source;
  interface Tag {name: string; attributes: Map<string, {value: string; start: number; end: number}>; at: number}
  const ids = new Map<string, number>(), fragments: Array<{value: string; position: number; end: number}> = [], labelsFor = new Set<string>(), controls: Array<{tag: Tag; labelled: boolean}> = [];
  const stack: Array<{name: string; at: number}> = [];
  let dynamic = 0, inLabel = 0, templateDepth = 0, baseSeen = false;
  const jobs: Array<() => Promise<void>> = [];
  let last = 0;
  for (const match of text.matchAll(TAG)) {
    if (run.aborted) return;
    if (match.index! < last || match[0].startsWith('<!--')) continue;
    const closing = Boolean(match[1]);
    const name = match[2]!.toLowerCase();
    const attributes = new Map<string, {value: string; start: number; end: number}>();
    const attributeText = match[3] ?? '';
    const base = match.indices![3]?.[0] ?? match.index!;
    for (const attribute of attributeText.matchAll(ATTRIBUTE)) {
      const group = attribute.indices![2] ?? attribute.indices![3] ?? attribute.indices![4];
      if (!attributes.has(attribute[1]!.toLowerCase())) attributes.set(attribute[1]!.toLowerCase(), {value: attribute[2] ?? attribute[3] ?? attribute[4] ?? '', start: base + (group?.[0] ?? attribute.indices![1]![1]), end: base + (group?.[1] ?? attribute.indices![1]![1])});
    }
    const tag: Tag = {name, attributes, at: match.index!};
    const position = where(match.index!);
    if (closing) {
      if (name === 'label' && inLabel > 0) inLabel -= 1;
      if (name === 'template' && templateDepth > 0) templateDepth -= 1;
      const found = stack.map(entry => entry.name).lastIndexOf(name);
      if (found < 0) { if (!VOID.has(name)) run.add('unexpected-closing-tag', 'warning', `</${name}> has no matching opening tag.`, position.line, position.column, position.column + match[0].length); }
      else { for (let at = stack.length - 1; at > found; at -= 1) { const open = stack[at]!; if (!OPTIONAL_END.has(open.name)) { const place = where(open.at); run.add('unclosed-tag', 'warning', `<${open.name}> is never closed.`, place.line, place.column, place.column + open.name.length + 1); } } stack.length = found; }
    } else {
      if (!VOID.has(name) && !match[4]) {
        if (OPTIONAL_END.has(name) && stack.at(-1)?.name === name) stack.pop();
        stack.push({name, at: match.index!});
      }
      if (name === 'label') inLabel += 1;
      if (name === 'base' && attributes.has('href')) baseSeen = true;
      const inert = templateDepth > 0;
      if (name === 'template') templateDepth += 1;
      const dynamicHere = [...attributes.values()].some(attribute => TEMPLATED.test(attribute.value));
      if (dynamicHere) { dynamic += 1; const first = [...attributes.values()].find(attribute => TEMPLATED.test(attribute.value))!; const place = where(first.start); run.add('unverified-dynamic', 'unverified', 'A templated attribute cannot be checked statically.', place.line, place.column, place.column + (first.end - first.start)); }
      const id = inert ? undefined : attributes.get('id');
      if (id?.value) { if (ids.has(id.value)) { const place = where(id.start); run.add('duplicate-id', 'error', `The id “${id.value}” is used twice (first on line ${where(ids.get(id.value)!).line + 1}).`, place.line, place.column, place.column + id.value.length); } else ids.set(id.value, id.start); }
      const named = attributes.get('name');
      if (name === 'a' && named?.value) ids.set(named.value, named.start);
      const asset = (attribute: string) => {
        const entry = attributes.get(attribute);
        if (!entry || !entry.value || dynamicHere || inert) return;
        const place = where(entry.start);
        jobs.push(() => run.reference(entry.value, place.line, place.column, undefined, undefined, false));
      };
      if (['img', 'script', 'source', 'video', 'audio', 'embed', 'track', 'iframe'].includes(name)) asset('src');
      if (name === 'link') asset('href');
      if (name === 'img' && !attributes.has('alt')) run.add('image-alt', 'warning', 'This image has no alt attribute (use alt="" for a decorative one).', position.line, position.column, position.column + match[0].length);
      if (name === 'a') { const href = attributes.get('href'); if (href && !dynamicHere) { if (href.value.startsWith('#')) fragments.push({value: href.value.slice(1), position: href.start, end: href.end}); else asset('href'); } }
      if (name === 'label' && attributes.get('for')) labelsFor.add(attributes.get('for')!.value);
      if (['input', 'select', 'textarea'].includes(name) && !(name === 'input' && ['hidden', 'submit', 'button', 'image', 'reset'].includes((attributes.get('type')?.value ?? '').toLowerCase())) && !dynamicHere) {
        controls.push({tag, labelled: inLabel > 0 || attributes.has('aria-label') || attributes.has('aria-labelledby') || attributes.has('title')});
      }
      if (RAW_TEXT.has(name) && !match[4]) {
        // The text of a script, style, textarea or title is not markup: skip it, but read url() addresses out of a style.
        const contentStart = match.index! + match[0].length;
        const rest = text.slice(contentStart);
        const end = new RegExp(`</${name}\\s*>`, 'iu').exec(rest);
        const content = end ? rest.slice(0, end.index) : rest;
        if (name === 'style' && !inert) { const origin = where(contentStart); const scanned = scanCss(content, origin.line, origin.column); jobs.push(() => cssUrls(run, scanned.urls, new Set(ids.keys()))); }
        last = contentStart + content.length + (end ? end[0].length : 0);
        if (end) stack.pop();
      }
    }
  }
  for (const open of stack) if (!OPTIONAL_END.has(open.name)) { const place = where(open.at); run.add('unclosed-tag', 'warning', `<${open.name}> is never closed.`, place.line, place.column, place.column + open.name.length + 1); }
  for (const fragment of fragments) {
    let value = fragment.value;
    try { value = decodeURIComponent(value); } catch { /* as written */ }
    if (!value || value.toLowerCase() === 'top' || ids.has(value)) continue;
    const place = where(fragment.position);
    run.add('broken-fragment', 'error', `No element with the id “${value}” in this document.`, place.line, place.column, place.column + (fragment.end - fragment.position));
  }
  for (const control of controls) {
    const id = control.tag.attributes.get('id')?.value;
    if (control.labelled || (id && labelsFor.has(id))) continue;
    const place = where(control.tag.at);
    run.add('form-label', 'warning', `This <${control.tag.name}> has no label (use <label for>, a wrapping <label> or aria-label).`, place.line, place.column, place.column + control.tag.name.length + 1);
  }
  if (dynamic > 0) run.external += 0;
  if (baseSeen) run.add('unverified-dynamic', 'unverified', 'A <base href> changes how relative addresses resolve; local files are not checked in this document.', 0);
  else for (const job of jobs) { if (run.aborted) return; await job(); }
}

export async function diagnose(input: DiagnoseInput): Promise<DiagnosticReport> {
  const run = new Run(input);
  if (input.signal?.aborted) return {diagnostics: [], external: 0, checked: 0, truncated: false, aborted: true};
  try {
    if (input.format === 'markdown') await markdown(run);
    else if (input.format === 'html') await html(run);
    else {
      const scanned = scanCss(input.lines.map(line => line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line).join('\n'), 0, 0);
      if (scanned.issue) run.add('css-syntax', 'warning', scanned.issue.message, scanned.issue.line, scanned.issue.column, scanned.issue.column + 1);
      await cssUrls(run, scanned.urls, undefined);
    }
  } catch (error) {
    if (!run.aborted) run.add('diagnostics-failed', 'info', `Checking stopped early: ${error instanceof Error ? error.message : 'unknown error'}.`, 0);
  }
  if (run.aborted) return {diagnostics: [], external: run.external, checked: run.checked, truncated: run.truncated, aborted: true};
  run.diagnostics.sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));
  return {diagnostics: run.diagnostics, external: run.external, checked: run.checked, truncated: run.truncated};
}
