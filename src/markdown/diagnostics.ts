import {lstat, open, realpath} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {parseBlockLines, type Block} from './blocks.js';
import {headingsFromLines, resolveFragment} from './sourceMap.js';

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

/** A checker confined to `root`: lexical `..` and symlinks are both resolved before a path is called inside. */
export function createLocalFs(docDir: string, root: string): LocalFs {
  let realRoot: Promise<string> | undefined;
  const rootReal = () => realRoot ??= realpath(root).catch(() => root);
  const inside = (base: string, path: string) => { const rel = relative(base, path); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
  async function locate(path: string): Promise<{state: FileState; real?: string}> {
    if (!path || path.length > MAX_PATH || path.includes('\0')) return {state: 'unreadable'};
    const resolved = resolve(docDir, path);
    if (!inside(root, resolved)) return {state: 'outside'};
    const base = await rootReal();
    try {
      const real = await realpath(resolved);
      if (!inside(base, real)) return {state: 'outside'};
      const info = await lstat(real);
      return {state: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'unreadable', real};
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') return {state: 'unreadable'};
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return {state: 'unreadable'};
      // Missing: but a symlinked folder on the way may already lead out of the root.
      for (let ancestor = dirname(resolved); ancestor !== dirname(ancestor); ancestor = dirname(ancestor)) {
        try { const real = await realpath(ancestor); return {state: inside(base, real) ? 'missing' : 'outside'}; } catch { /* keep climbing */ }
      }
      return {state: 'missing'};
    }
  }
  return {
    stat: async path => (await locate(path)).state,
    async readText(path, maxBytes) {
      const found = await locate(path);
      if (found.state !== 'file' || !found.real) return undefined;
      let handle;
      try { handle = await open(found.real, 'r'); const buffer = Buffer.alloc(maxBytes); const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0); return buffer.subarray(0, bytesRead).toString('utf8'); }
      catch { return undefined; } finally { await handle?.close().catch(() => undefined); }
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

  /** Report a destination written in the document. `kindOfAsset`: a missing file is an error either way; the wording differs. */
  async reference(destination: string, line: number, column: number, headings: ReturnType<typeof headingsFromLines> | undefined, ids: ReadonlySet<string> | undefined, softFragments: boolean): Promise<void> {
    const end = column + destination.length;
    const target = classify(destination);
    switch (target.kind) {
      case 'ignore': return;
      case 'external': this.external += 1; return;
      case 'unsafe': this.add('unsafe-scheme', 'warning', `A ${target.scheme}: link is never followed or checked here.`, line, column, end); return;
      case 'absolute': this.add('absolute-path', 'unverified', 'Absolute and home-relative paths are not checked.', line, column, end); return;
      case 'fragment': {
        const found = headings ? resolveFragment(headings, target.fragment) : undefined;
        let decoded = target.fragment;
        try { decoded = decodeURIComponent(decoded); } catch { /* as written */ }
        if (found || ids?.has(decoded) || ids?.has(target.fragment) || decoded.toLowerCase() === 'top') return;
        this.add('broken-fragment', softFragments ? 'warning' : 'error', softFragments ? `No heading or id “${target.fragment}” here (other generators may build ids differently).` : `No heading or id “${target.fragment}” in this document.`, line, column, end);
        return;
      }
      case 'local': {
        const pending = this.stat(target.path);
        if (!pending) { if (!this.input.fs) this.add('unverified-local', 'unverified', 'Not checked: this document has no folder yet. Save it to check local files.', line, column, end); return; }
        const state = await pending;
        if (this.aborted) return;
        if (state === 'outside') this.add('outside-root', 'unverified', 'Points outside the document\'s folder or project; not checked.', line, column, end);
        else if (state === 'unreadable') this.add('unreadable', 'warning', 'This path cannot be read or checked.', line, column, end);
        else if (state === 'missing') this.add('missing-file', 'error', `No such file: ${target.path}`, line, column, end);
        else if (state === 'file' && target.fragment && /\.(?:md|markdown)$/iu.test(target.path) && this.input.fs) {
          const text = await this.input.fs.readText(target.path, MAX_TARGET_BYTES);
          if (text !== undefined && !resolveFragment(headingsFromLines(text.split('\n')), target.fragment)) this.add('broken-fragment-in-file', 'warning', `No heading “${target.fragment}” in ${target.path}.`, line, column, end);
        }
        return;
      }
    }
  }
}

function codeLines(blocks: readonly Block[], into: Set<number>): void {
  for (const block of blocks) {
    if (block.kind === 'code' && block.from !== undefined && block.to !== undefined) for (let line = block.from; line < block.to; line += 1) into.add(line);
    else if (block.kind === 'quote') codeLines(block.blocks, into);
    else if (block.kind === 'list') for (const item of block.items) codeLines(item.blocks, into);
  }
}

const normalize = (label: string) => label.trim().replace(/\s+/gu, ' ').toLowerCase();
const maskCode = (text: string) => text.replace(/(`+)[\s\S]*?\1/gu, span => ' '.repeat(span.length));

async function markdown(run: Run): Promise<void> {
  const lines = run.input.lines;
  const blocks = parseBlockLines(lines, {html: true});
  const skip = new Set<number>();
  codeLines(blocks, skip);
  if (lines[0]?.trim() === '---') for (let at = 1; at < Math.min(lines.length, 200); at += 1) if (/^(?:---|\.\.\.)\s*$/u.test(lines[at]!)) { for (let line = 0; line <= at; line += 1) skip.add(line); break; }
  const headings = headingsFromLines(lines, {html: true});
  const seen = new Map<string, number>();
  for (const heading of headings) {
    const key = heading.slug;
    if (key === undefined) continue;
    const first = seen.get(heading.text.toLowerCase());
    if (first !== undefined) run.add('duplicate-heading', 'info', `Same heading text as line ${first + 1}; its anchor is #${key}.`, heading.line);
    else seen.set(heading.text.toLowerCase(), heading.line);
  }
  const soft = lines.some(line => /\bid\s*=|\{#/u.test(line));
  const definitions = new Set<string>(), footnoteDefs = new Map<string, number>();
  const refs: Array<{label: string; line: number; start: number; end: number}> = [], notes: Array<{label: string; line: number; start: number; end: number}> = [];
  const destinations: Array<{destination: string; line: number; column: number; image?: boolean; alt?: string}> = [];
  lines.forEach((text, line) => {
    if (skip.has(line) || run.aborted) return;
    const masked = maskCode(text);
    let from = 0;
    const note = /^ {0,3}\[\^([^\]\s]+)\]:/u.exec(masked);
    const definition = note ? undefined : /^ {0,3}\[([^\]]+)\]:[ \t]*(<[^>\n]*>|\S+)/du.exec(masked);
    if (note) { footnoteDefs.set(note[1]!, line); from = note[0].length; }
    if (definition) {
      definitions.add(normalize(definition[1]!));
      const raw = definition[2]!;
      const start = definition.indices![2]![0] + (raw.startsWith('<') ? 1 : 0);
      destinations.push({destination: raw.startsWith('<') ? raw.slice(1, -1) : raw, line, column: start});
      from = definition[0].length;
    }
    const rest = masked.slice(from);
    for (const match of rest.matchAll(/(!?)(?<!\\)\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)/gdu)) {
      const raw = match[3]!;
      const [startIndex] = match.indices![3]!;
      const angle = raw.startsWith('<');
      destinations.push({destination: angle ? raw.slice(1, -1) : raw, line, column: from + startIndex + (angle ? 1 : 0), ...(match[1] ? {image: true, alt: match[2]!} : {})});
    }
    for (const match of rest.matchAll(/(?<![\\!])\[((?:[^\]\\]|\\.)+)\]\[((?:[^\]\\]|\\.)*)\]/gdu)) {
      if (match[1]!.startsWith('^')) continue;
      const label = match[2]! || match[1]!;
      const [start, end] = match.indices![match[2]! ? 2 : 1]!;
      refs.push({label, line, start: from + start, end: from + end});
    }
    for (const match of rest.matchAll(/(?<!\\)\[\^([^\]\s]+)\](?!:)/gdu)) { const [start, end] = match.indices![1]!; notes.push({label: match[1]!, line, start: from + start, end: from + end}); }
    run.external += [...rest.matchAll(/<([a-zA-Z][a-zA-Z0-9+.-]*:[^>\s]*)>/gu)].filter(autolink => classify(autolink[1]!).kind === 'external').length;
  });
  for (const item of destinations) {
    if (run.aborted) return;
    if (item.image && !item.alt!.trim()) run.add('image-alt', 'warning', 'This image has no alternative text.', item.line, item.column - 1, item.column - 1 + item.destination.length + 1);
    await run.reference(item.destination, item.line, item.column, headings, undefined, soft);
  }
  for (const ref of refs) if (!definitions.has(normalize(ref.label))) run.add('undefined-reference', 'error', `No link reference definition for “${ref.label}”.`, ref.line, ref.start, ref.end);
  const used = new Set<string>();
  for (const note of notes) { used.add(note.label); if (!footnoteDefs.has(note.label)) run.add('undefined-footnote', 'error', `No definition for footnote [^${note.label}].`, note.line, note.start, note.end); }
  for (const [label, line] of footnoteDefs) if (!used.has(label)) run.add('unreferenced-footnote', 'warning', `Footnote [^${label}] is defined but never referenced.`, line);
}

// ---- CSS and HTML -----------------------------------------------------------------------------------------------

async function cssUrls(run: Run, text: string, line: number, columnBase: number): Promise<void> {
  for (const match of text.matchAll(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)\s'"]*))\s*\)/gdu)) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    const [start] = match.indices![match[1] !== undefined ? 1 : match[2] !== undefined ? 2 : 3]!;
    if (TEMPLATED.test(value)) { run.add('unverified-dynamic', 'unverified', 'A templated address cannot be checked statically.', line, columnBase + start, columnBase + start + value.length); continue; }
    await run.reference(value, line, columnBase + start, undefined, undefined, false);
  }
}

function cssSyntax(run: Run, lines: readonly string[]): void {
  const stack: Array<{char: string; line: number; column: number}> = [];
  let comment = false, quote = '';
  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line]!;
    for (let column = 0; column < text.length; column += 1) {
      const char = text[column]!;
      if (comment) { if (char === '*' && text[column + 1] === '/') { comment = false; column += 1; } continue; }
      if (quote) { if (char === '\\') column += 1; else if (char === quote) quote = ''; continue; }
      if (char === '/' && text[column + 1] === '*') { comment = true; column += 1; continue; }
      if (char === '"' || char === '\'') { quote = char; continue; }
      if (char === '{' || char === '(') stack.push({char, line, column});
      else if (char === '}' || char === ')') {
        const open = stack.pop();
        if (!open || (open.char === '{') !== (char === '}')) { run.add('css-syntax', 'warning', `Unexpected “${char}”.`, line, column, column + 1); return; }
      }
    }
    quote = '';
  }
  const open = stack.at(-1);
  if (open) run.add('css-syntax', 'warning', `“${open.char}” is never closed.`, open.line, open.column, open.column + 1);
  else if (comment) run.add('css-syntax', 'warning', 'A comment is never closed.', lines.length - 1);
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const OPTIONAL_END = new Set(['p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'option', 'optgroup', 'colgroup', 'html', 'head', 'body']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`=]+))?)*)\s*(\/?)>/gdu;
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
  const text = source.replace(/<!--[\s\S]*?-->/gu, comment => comment.replace(/[^\n]/gu, ' '));
  interface Tag {name: string; attributes: Map<string, {value: string; start: number; end: number}>; at: number}
  const ids = new Map<string, number>(), fragments: Array<{value: string; position: number; end: number}> = [], labelsFor = new Set<string>(), controls: Array<{tag: Tag; labelled: boolean}> = [];
  const stack: Array<{name: string; at: number}> = [];
  let dynamic = 0, inLabel = 0;
  const jobs: Array<() => Promise<void>> = [];
  let last = 0;
  for (const match of text.matchAll(TAG)) {
    if (run.aborted) return;
    if (match.index! < last) continue;
    const closing = Boolean(match[1]);
    const name = match[2]!.toLowerCase();
    const attributes = new Map<string, {value: string; start: number; end: number}>();
    const attributeText = match[3] ?? '';
    const base = match.indices![3]?.[0] ?? match.index!;
    for (const attribute of attributeText.matchAll(ATTRIBUTE)) {
      const group = attribute.indices![2] ?? attribute.indices![3] ?? attribute.indices![4];
      attributes.set(attribute[1]!.toLowerCase(), {value: attribute[2] ?? attribute[3] ?? attribute[4] ?? '', start: base + (group?.[0] ?? attribute.indices![1]![1]), end: base + (group?.[1] ?? attribute.indices![1]![1])});
    }
    const tag: Tag = {name, attributes, at: match.index!};
    const position = where(match.index!);
    if (closing) {
      if (name === 'label' && inLabel > 0) inLabel -= 1;
      const found = stack.map(entry => entry.name).lastIndexOf(name);
      if (found < 0) { if (!VOID.has(name)) run.add('unexpected-closing-tag', 'warning', `</${name}> has no matching opening tag.`, position.line, position.column, position.column + match[0].length); }
      else { for (let at = stack.length - 1; at > found; at -= 1) { const open = stack[at]!; if (!OPTIONAL_END.has(open.name)) { const place = where(open.at); run.add('unclosed-tag', 'warning', `<${open.name}> is never closed.`, place.line, place.column, place.column + open.name.length + 1); } } stack.length = found; }
    } else {
      if (!VOID.has(name) && !match[4]) {
        if (OPTIONAL_END.has(name) && stack.at(-1)?.name === name) stack.pop();
        stack.push({name, at: match.index!});
      }
      if (name === 'label') inLabel += 1;
      const dynamicHere = [...attributes.values()].some(attribute => TEMPLATED.test(attribute.value));
      if (dynamicHere) { dynamic += 1; const first = [...attributes.values()].find(attribute => TEMPLATED.test(attribute.value))!; const place = where(first.start); run.add('unverified-dynamic', 'unverified', 'A templated attribute cannot be checked statically.', place.line, place.column, place.column + (first.end - first.start)); }
      const id = attributes.get('id');
      if (id?.value) { if (ids.has(id.value)) { const place = where(id.start); run.add('duplicate-id', 'error', `The id “${id.value}” is used twice (first on line ${where(ids.get(id.value)!).line + 1}).`, place.line, place.column, place.column + id.value.length); } else ids.set(id.value, id.start); }
      const named = attributes.get('name');
      if (name === 'a' && named?.value) ids.set(named.value, named.start);
      const asset = (attribute: string) => {
        const entry = attributes.get(attribute);
        if (!entry || !entry.value || dynamicHere) return;
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
        if (name === 'style') { const origin = where(contentStart); content.split('\n').forEach((part, index) => jobs.push(() => cssUrls(run, part, origin.line + index, index === 0 ? origin.column : 0))); }
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
  for (const job of jobs) { if (run.aborted) return; await job(); }
}

export async function diagnose(input: DiagnoseInput): Promise<DiagnosticReport> {
  const run = new Run(input);
  if (input.signal?.aborted) return {diagnostics: [], external: 0, checked: 0, truncated: false, aborted: true};
  try {
    if (input.format === 'markdown') await markdown(run);
    else if (input.format === 'html') await html(run);
    else {
      cssSyntax(run, input.lines);
      for (let line = 0; line < input.lines.length && !run.aborted; line += 1) await cssUrls(run, input.lines[line]!, line, 0);
    }
  } catch (error) {
    if (!run.aborted) run.add('diagnostics-failed', 'info', `Checking stopped early: ${error instanceof Error ? error.message : 'unknown error'}.`, 0);
  }
  if (run.aborted) return {diagnostics: [], external: run.external, checked: run.checked, truncated: run.truncated, aborted: true};
  run.diagnostics.sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));
  return {diagnostics: run.diagnostics, external: run.external, checked: run.checked, truncated: run.truncated};
}
