import type {Position, TextBuffer} from './textBuffer.js';

/**
 * Built-in snippets and the placeholder session for the native editor (#468). A snippet is a small template of plain text
 * inserted into the buffer as ONE undoable edit; afterwards Tab / Shift+Tab visit its placeholders for as long as the
 * session lives. Nothing is executed or fetched: templates are fixed strings in this file, parsed by the tiny subset of
 * the TextMate syntax below, and everything unrecognised is kept as literal text.
 *
 *   ${1:default}  a placeholder (selected on arrival); `$1` is an empty one; numbers are visited in order
 *   $0            where the caret ends up (default: the end of the inserted text)
 *   $SEL          the selected text; `${SEL:default}` is an ordinary placeholder when nothing was selected
 *   \$ \\ \}      the characters themselves
 *
 * Not supported (literal text): nested placeholders, choices, variables, transforms. A number used twice is inserted twice
 * with the first default and is one stop (no mirroring).
 */

export const MAX_TEMPLATE_BYTES = 8192;
export const MAX_STOPS = 50;

export interface Snippet {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  format: 'markdown' | 'html';
  body: string;
  /** Inserted exactly at the caret. Any other snippet is a block: it starts on its own line when text precedes the caret and ends on its own when text follows. */
  inline?: boolean;
}

export interface ParsedTemplate {
  text: string;
  /** Placeholders in the order they are visited; offsets into `text`. */
  stops: Array<{index: number; start: number; end: number}>;
  final?: number;
  /** Where the selected text went, so its own line breaks are never re-indented. */
  selection?: {start: number; end: number};
}

const unescape = (text: string) => text.replace(/\\([$}\\])/gu, '$1');
const BRACED = /^\$\{(\d+|SEL)(?::((?:[^}\\$]|\\[$}\\])*))?\}/u;

export function parseTemplate(body: string, selected = ''): ParsedTemplate {
  const source = body.length > MAX_TEMPLATE_BYTES ? body.slice(0, MAX_TEMPLATE_BYTES) : body;
  let text = '';
  const stops: ParsedTemplate['stops'] = [];
  const first = new Map<number, string>();
  let final: number | undefined;
  let selection: ParsedTemplate['selection'];
  let lastNumber = 0;
  const stop = (index: number, value: string) => {
    if (first.has(index)) { text += first.get(index)!; return; }
    if (stops.length >= MAX_STOPS) { text += value; return; }
    first.set(index, value);
    stops.push({index, start: text.length, end: text.length + value.length});
    text += value;
  };
  for (let at = 0; at < source.length;) {
    const char = source[at]!;
    if (char === '\\') {
      const next = source[at + 1];
      if (next === '$' || next === '\\' || next === '}') { text += next; at += 2; } else { text += char; at += 1; }
      continue;
    }
    if (char !== '$') { text += char; at += 1; continue; }
    const rest = source.slice(at);
    const braced = BRACED.exec(rest);
    const bare = /^\$(\d+)/u.exec(rest);
    const sel = /^\$SEL(?![A-Za-z0-9_])/u.exec(rest);
    if (braced && braced[1] !== 'SEL') {
      const index = Number(braced[1]);
      const value = unescape(braced[2] ?? '');
      if (index === 0) { if (final === undefined) final = text.length; text += value; } else { lastNumber = Math.max(lastNumber, index); stop(index, value); }
      at += braced[0].length; continue;
    }
    if (bare) {
      const index = Number(bare[1]);
      if (index === 0) { if (final === undefined) final = text.length; } else { lastNumber = Math.max(lastNumber, index); stop(index, ''); }
      at += bare[0].length; continue;
    }
    if (braced?.[1] === 'SEL' || sel) {
      if (selected) { selection ??= {start: text.length, end: text.length + selected.length}; text += selected; }
      else if (braced) { stop(lastNumber + 0.5, unescape(braced[2] ?? '')); }
      at += (braced ?? sel)![0].length; continue;
    }
    if (rest.startsWith('${')) {
      // Not a placeholder this parser understands (nested, unterminated, odd name): the whole braced span stays text.
      let depth = 0, length = 0;
      for (; length < rest.length; length += 1) {
        if (rest[length] === '{') depth += 1;
        else if (rest[length] === '}' && --depth === 0) { length += 1; break; }
      }
      text += rest.slice(0, length); at += length; continue;
    }
    text += char; at += 1;
  }
  stops.sort((a, b) => a.index - b.index);
  return {text, stops, ...(final === undefined ? {} : {final}), ...(selection ? {selection} : {})};
}

// ---- Insertion and the placeholder session ----------------------------------------------------------------------

const same = (a: Position, b: Position) => a.line === b.line && a.column === b.column;
const before = (a: Position, b: Position) => a.line < b.line || (a.line === b.line && a.column < b.column);

/** Where `p` goes when [from, to) of the text is replaced by text ending at `end`; a range's end follows text typed at its end. */
export function mapPosition(p: Position, from: Position, to: Position, end: Position, isEnd: boolean): Position {
  if (before(p, from)) return p;
  if (same(p, from)) return isEnd && same(from, to) ? end : p;
  if (before(p, to) && !same(p, to)) return end;
  if (same(p, to)) return end;
  return p.line === to.line ? {line: end.line, column: end.column + (p.column - to.column)} : {line: p.line + (end.line - to.line), column: p.column};
}

export interface SnippetSession {
  stops: Array<{start: Position; end: Position}>;
  current: number;
  final: Position;
  /** The inserted text as a whole: the session ends when the caret leaves it. */
  span: {start: Position; end: Position};
  dispose(): void;
}

function startSession(buffer: TextBuffer, stops: SnippetSession['stops'], final: Position, span: SnippetSession['span']): SnippetSession | undefined {
  if (!stops.length) return undefined;
  const session: SnippetSession = {stops, current: 0, final, span, dispose: () => stop()};
  const stop = buffer.observe((from, to, end) => {
    for (const range of session.stops) { range.start = mapPosition(range.start, from, to, end, false); range.end = mapPosition(range.end, from, to, end, true); }
    session.final = mapPosition(session.final, from, to, end, true);
    session.span.start = mapPosition(session.span.start, from, to, end, false);
    session.span.end = mapPosition(session.span.end, from, to, end, true);
  });
  return session;
}

function select(buffer: TextBuffer, range: {start: Position; end: Position}): void {
  buffer.caret = range.end;
  buffer.anchor = same(range.start, range.end) ? undefined : range.start;
}

/** Insert `snippet` at the caret (replacing the selection) as one edit, select the first placeholder and return the session that visits the rest. */
export function insertSnippet(buffer: TextBuffer, snippet: Pick<Snippet, 'body' | 'inline'>): SnippetSession | undefined {
  const selection = buffer.selection;
  const from = selection?.start ?? buffer.caret, to = selection?.end ?? buffer.caret;
  const parsed = parseTemplate(snippet.body, selection ? buffer.selectedText() : '');
  const indent = /^[ \t]*/u.exec(buffer.lines[from.line]!.slice(0, from.column))![0];
  const lead = snippet.inline || !buffer.lines[from.line]!.slice(0, from.column).trim() ? '' : '\n';
  const trail = snippet.inline || !buffer.lines[to.line]!.slice(to.column).trim() ? '' : '\n';
  if (lead) {
    parsed.text = lead + parsed.text;
    for (const item of parsed.stops) { item.start += 1; item.end += 1; }
    if (parsed.final !== undefined) parsed.final += 1;
    if (parsed.selection) { parsed.selection.start += 1; parsed.selection.end += 1; }
  }
  parsed.text += trail;
  // Every line break the template wrote continues at the caret line's indentation; the selected text keeps its own.
  const shift = (offset: number) => {
    let extra = 0;
    for (let index = 0; index < offset; index += 1) if (parsed.text[index] === '\n' && !(parsed.selection && index >= parsed.selection.start && index < parsed.selection.end)) extra += indent.length;
    return offset + extra;
  };
  let text = '';
  for (let index = 0; index < parsed.text.length; index += 1) {
    text += parsed.text[index];
    if (parsed.text[index] === '\n' && !(parsed.selection && index >= parsed.selection.start && index < parsed.selection.end)) text += indent;
  }
  const at = (offset: number): Position => {
    const head = text.slice(0, offset);
    const breaks = head.split('\n');
    return breaks.length === 1 ? {line: from.line, column: from.column + offset} : {line: from.line + breaks.length - 1, column: breaks.at(-1)!.length};
  };
  const stops = parsed.stops.map(item => ({start: at(shift(item.start)), end: at(shift(item.end))}));
  const final = at(parsed.final === undefined ? text.length : shift(parsed.final));
  const span = {start: from, end: at(text.length)};
  const first = stops[0];
  buffer.edit(from, to, text, {caret: first?.end ?? final, ...(first && !same(first.start, first.end) ? {anchor: first.start} : {})});
  return startSession(buffer, stops, final, {start: span.start, end: span.end});
}

/** Tab (+1) / Shift+Tab (-1): to the next or previous placeholder. 'finished' puts the caret at the final position and ends the session; 'stay' means there is no earlier one. */
export function advanceSnippet(buffer: TextBuffer, session: SnippetSession, delta: 1 | -1): 'moved' | 'finished' | 'stay' {
  const next = session.current + delta;
  if (next < 0) return 'stay';
  if (next >= session.stops.length) {
    buffer.caret = session.final; buffer.anchor = undefined;
    session.dispose();
    return 'finished';
  }
  session.current = next;
  select(buffer, session.stops[next]!);
  return 'moved';
}

/** Whether the caret is still inside the inserted text; a session whose caret has wandered away ends. */
export function insideSnippet(buffer: TextBuffer, session: SnippetSession): boolean {
  const caret = buffer.caret;
  return !before(caret, session.span.start) && !before(session.span.end, caret);
}

/** A footnote: the next unused number as a reference at the caret and its definition at the end of the document, as one edit; the definition's text is the placeholder. */
export function insertFootnote(buffer: TextBuffer): SnippetSession | undefined {
  const taken = [...buffer.text.matchAll(/\[\^(\d+)\]/gu)].map(match => Number(match[1]));
  const number = (taken.length ? Math.max(...taken) : 0) + 1;
  const selection = buffer.selection;
  const at = selection?.end ?? buffer.caret;
  const last = buffer.lines.length - 1;
  const endOfDocument = {line: last, column: buffer.lines[last]!.length};
  const rest = buffer.slice(at, endOfDocument);
  const separator = buffer.lines[last] === '' && last > at.line ? '\n' : '\n\n';
  const label = `[^${number}]: `;
  const definition = 'Footnote text';
  const text = `[^${number}]${rest}${separator}${label}${definition}`;
  const written = text.split('\n');
  const line = at.line + written.length - 1;
  const start = {line, column: label.length}, end = {line, column: label.length + definition.length};
  buffer.edit(at, endOfDocument, text, {caret: end, anchor: start});
  return startSession(buffer, [{start, end}], end, {start: at, end: {line, column: end.column}});
}

// ---- Catalog ----------------------------------------------------------------------------------------------------

const INLINE = new Set(['md-math-inline', 'html-link', 'html-image']);

const md = (id: string, title: string, description: string, keywords: string, body: string): Snippet => ({id, title, description, keywords: keywords.split(' '), format: 'markdown', body, ...(INLINE.has(id) ? {inline: true} : {})});
const html = (id: string, title: string, description: string, keywords: string, body: string): Snippet => ({id, title, description, keywords: keywords.split(' '), format: 'html', body, ...(INLINE.has(id) ? {inline: true} : {})});

export const SNIPPETS: readonly Snippet[] = [
  md('md-heading-1', 'Heading 1', 'Top-level heading', 'heading title h1 header', '# ${1:Title}$0'),
  md('md-heading-2', 'Heading 2', 'Section heading', 'heading section h2 header', '## ${1:Section}$0'),
  md('md-heading-3', 'Heading 3', 'Subsection heading', 'heading subsection h3 header', '### ${1:Subsection}$0'),
  md('md-table', 'Table', 'A two-column GFM table', 'table grid columns gfm', '| ${1:Column} | ${2:Column} |\n| --- | --- |\n| ${3:Cell} | ${4:Cell} |$0'),
  md('md-task-list', 'Task list', 'Three checkbox items', 'task todo checklist checkbox', '- [ ] ${1:First task}\n- [ ] ${2:Second task}\n- [ ] ${3:Third task}$0'),
  md('md-code-block', 'Fenced code block', 'A code fence; wraps the selection', 'code fence fenced block backticks', '```${1:language}\n${SEL:code}\n```$0'),
  md('md-quote', 'Block quote', 'Quote the selection', 'quote blockquote callout', '> ${SEL:quote}$0'),
  md('md-mermaid', 'Mermaid diagram (source)', 'Source text only, not rendered by NMSh', 'mermaid diagram flowchart graph source', '```mermaid\ngraph TD\n  ${1:A} --> ${2:B}\n```$0'),
  md('md-math-block', 'Math block (source)', 'Source text only, not rendered by NMSh', 'math latex tex equation formula block source', '$$\n${1:E = mc^2}\n$$$0'),
  md('md-math-inline', 'Inline math (source)', 'Source text only, not rendered by NMSh', 'math latex tex equation formula inline source', '\\$${1:x^2}\\$$0'),
  md('md-details', 'Details block (source)', 'HTML details/summary as source text', 'details summary collapsible disclosure html', '<details>\n<summary>${1:Summary}</summary>\n\n${2:Content}\n\n</details>$0'),
  md('md-horizontal-rule', 'Horizontal rule', 'A thematic break', 'rule hr divider separator line', '---$0'),
  html('html-skeleton', 'HTML document', 'A minimal HTML5 page', 'html document skeleton page boilerplate doctype', '<!doctype html>\n<html lang="${1:en}">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${2:Title}</title>\n</head>\n<body>\n  ${3}\n</body>\n</html>$0'),
  html('html-section', 'Section', 'A semantic <section>; wraps the selection', 'section semantic structure wrap', '<section>\n  <h2>${1:Heading}</h2>\n  ${SEL:Content}\n</section>$0'),
  html('html-article', 'Article', 'A semantic <article>; wraps the selection', 'article semantic post wrap', '<article>\n  <h2>${1:Heading}</h2>\n  ${SEL:Content}\n</article>$0'),
  html('html-header', 'Header', 'A semantic <header>', 'header banner semantic top', '<header>\n  ${SEL:Content}\n</header>$0'),
  html('html-nav', 'Navigation', 'A <nav> with a list of links', 'nav navigation menu links semantic', '<nav>\n  <ul>\n    <li><a href="${1:#}">${2:Link}</a></li>\n  </ul>\n</nav>$0'),
  html('html-main', 'Main', 'The page\'s <main> landmark', 'main landmark content semantic', '<main>\n  ${SEL:Content}\n</main>$0'),
  html('html-footer', 'Footer', 'A semantic <footer>', 'footer bottom semantic', '<footer>\n  ${SEL:Content}\n</footer>$0'),
  html('html-aside', 'Aside', 'A semantic <aside>', 'aside sidebar semantic', '<aside>\n  ${SEL:Content}\n</aside>$0'),
  html('html-div', 'Div with class', 'A <div class="…">; wraps the selection', 'div container class wrap', '<div class="${1:container}">\n  ${SEL:content}\n</div>$0'),
  html('html-paragraph', 'Paragraph', 'A <p>; wraps the selection', 'paragraph p text wrap', '<p>${SEL:text}</p>$0'),
  html('html-link', 'Link', 'An <a href>', 'link anchor a href', '<a href="${1:https://}">${SEL:text}</a>$0'),
  html('html-image', 'Image', 'An <img> with alt text', 'image img picture alt', '<img src="${1:image.png}" alt="${2:Describe the image}">$0'),
  html('html-list', 'Unordered list', 'A <ul> with items', 'list ul bullets items', '<ul>\n  <li>${1:Item}</li>\n  <li>${2:Item}</li>\n</ul>$0'),
  html('html-ordered-list', 'Ordered list', 'An <ol> with items', 'list ol numbered items', '<ol>\n  <li>${1:Item}</li>\n  <li>${2:Item}</li>\n</ol>$0'),
  html('html-table', 'Table', 'A <table> with a header row', 'table thead tbody grid', '<table>\n  <thead>\n    <tr><th>${1:Heading}</th><th>${2:Heading}</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>${3:Cell}</td><td>${4:Cell}</td></tr>\n  </tbody>\n</table>$0'),
  html('html-style', 'Style block', 'A <style> element for CSS', 'style css stylesheet', '<style>\n  ${1:body} {\n    ${2:margin: 0;}\n  }\n</style>$0'),
];

/** Snippets of `format` whose title, description, id or keywords contain every word of the query; title matches first. */
export function searchSnippets(query: string, format: Snippet['format']): Snippet[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  const pool = SNIPPETS.filter(item => item.format === format);
  if (!words.length) return pool;
  const scored: Array<{item: Snippet; score: number}> = [];
  for (const item of pool) {
    const title = item.title.toLowerCase();
    const rest = `${item.id} ${item.description} ${item.keywords.join(' ')}`.toLowerCase();
    if (!words.every(word => title.includes(word) || rest.includes(word))) continue;
    scored.push({item, score: words.reduce((sum, word) => sum + (title.startsWith(word) ? 3 : title.includes(word) ? 2 : 1), 0)});
  }
  return scored.sort((a, b) => b.score - a.score).map(entry => entry.item);
}
