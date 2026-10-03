import {resolveHostCapabilities} from '../host/capabilities.js';
import {backgroundOf, foregroundOf, theme} from '../chroma/chroma.js';
import {graphemes} from '../input/inputLayout.js';
import {colorLevel} from '../presentation/capabilities.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {displayWidth, truncateAnsi} from '../util/text.js';

/**
 * Renders explicitly NMSh-authored Markdown (help, setup guidance, provider
 * docs, release notes) into styled terminal rows.
 *
 * SAFETY BOUNDARY: this is never applied to shell output, PTY streams,
 * transcript command output, archived output or `/copy` data. The input type is
 * branded so a plain string cannot be passed by accident; the only way in is
 * `authoredMarkdown()`, called on content that ships in NMSh's own source.
 * A test pins the modules allowed to import this file.
 */
declare const AUTHORED: unique symbol;
export type AuthoredMarkdown = string & {readonly [AUTHORED]: true};

export function authoredMarkdown(source: string): AuthoredMarkdown {
  return source as AuthoredMarkdown;
}

export interface MarkdownOptions {
  columns: number;
  /** Emit OSC 8 hyperlinks; otherwise links read `text (url)`. */
  hyperlinks?: boolean;
}

const RESET = '\u001B[0m';
const BOLD = '\u001B[1m';
const ITALIC = '\u001B[3m';
const UNDERLINE = '\u001B[4m';
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;

/** Terminals known to implement OSC 8. `NMSH_HYPERLINKS=1|0` overrides detection. */
export function supportsHyperlinks(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveHostCapabilities(env).hyperlinks;
}

// ---- Inline ---------------------------------------------------------------

type Style = 'text' | 'code' | 'strong' | 'em' | 'link';
interface Piece {text: string; style: Style; url?: string}

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/gu;

function safeUrl(url: string): string | undefined {
  return /^https?:\/\/[^\s\u0000-\u001F\u007F]+$/u.test(url) ? url : undefined;
}

function parseInline(source: string): Piece[] {
  const pieces: Piece[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    if (match.index! > last) pieces.push({text: source.slice(last, match.index), style: 'text'});
    if (match[1] !== undefined) pieces.push({text: match[1], style: 'code'});
    else if (match[2] !== undefined) pieces.push({text: match[2], style: 'strong'});
    else if (match[3] !== undefined) pieces.push({text: match[3], style: 'em'});
    else pieces.push({text: match[4]!, style: 'link', url: match[5]});
    last = match.index! + match[0].length;
  }
  if (last < source.length) pieces.push({text: source.slice(last), style: 'text'});
  return pieces;
}

function styleFor(style: Style): string {
  switch (style) {
    case 'code': return `${backgroundOf(theme('selection'))}${foregroundOf(theme('primary'))}`;
    case 'strong': return BOLD;
    case 'em': return ITALIC;
    case 'link': return `${UNDERLINE}${foregroundOf(theme('accent'))}`;
    case 'text': return '';
  }
}

/** Plain-terminal fallback for code so it is never distinguished by color alone. */
function plainCode(text: string): string {
  return colorLevel() === 'none' ? `\`${text}\`` : text;
}

interface Word {text: string; style: Style; url?: string; /** Attached to the previous word with no space between (e.g. punctuation after a link). */ glue: boolean}

function toWords(pieces: Piece[], hyperlinks: boolean): Word[] {
  const words: Word[] = [];
  let previousEndsSpace = true;
  for (const piece of pieces) {
    const url = piece.style === 'link' ? safeUrl(piece.url ?? '') : undefined;
    const style: Style = piece.style === 'link' && !url ? 'text' : piece.style;
    const parts = piece.style === 'code' ? [plainCode(piece.text)] : piece.text.split(/\s+/u).filter(Boolean);
    const startsSpace = /^\s/u.test(piece.text);
    parts.forEach((part, index) => words.push({text: part, style, url, glue: index === 0 && !startsSpace && !previousEndsSpace}));
    if (parts.length) previousEndsSpace = piece.style !== 'code' && /\s$/u.test(piece.text);
    if (piece.style === 'link' && url && !hyperlinks) {
      words.push({text: `(${url})`, style: 'text', glue: false});
      previousEndsSpace = false;
    }
  }
  return words;
}

function paintWord(word: Word, hyperlinks: boolean): string {
  const style = styleFor(word.style);
  const body = word.style === 'link' && word.url && hyperlinks ? `\u001B]8;;${word.url}\u001B\\${word.text}\u001B]8;;\u001B\\` : word.text;
  return style ? `${style}${body}${RESET}` : body;
}

/** Word-wraps inline Markdown into rows no wider than `width`; every row carries its own resets. */
function wrapInline(source: string, width: number, hyperlinks: boolean, firstIndent: string, restIndent: string): string[] {
  const words = toWords(parseInline(source), hyperlinks);
  const rows: string[] = [];
  let line = firstIndent;
  let used = displayWidth(firstIndent);
  let empty = true;
  const push = () => { rows.push(line); line = restIndent; used = displayWidth(restIndent); empty = true; };
  for (const word of words) {
    const size = displayWidth(word.text);
    const gap = word.glue ? 0 : 1;
    if (!empty && used + gap + size > width) push();
    if (empty && used + size > width) {
      // A single word wider than the row is hard-split rather than overflowing.
      let chunk = '';
      for (const glyph of graphemes(word.text)) {
        if (used + displayWidth(chunk + glyph) > width && chunk) { line += paintWord({...word, text: chunk}, hyperlinks); push(); chunk = ''; }
        chunk += glyph;
      }
      line += paintWord({...word, text: chunk}, hyperlinks);
      used += displayWidth(chunk);
      empty = false;
      continue;
    }
    if (!empty && !word.glue) { line += ' '; used += 1; }
    line += paintWord(word, hyperlinks);
    used += size;
    empty = false;
  }
  if (!empty || rows.length === 0) rows.push(line);
  return rows;
}

// ---- Blocks ---------------------------------------------------------------

function plainInline(source: string): string {
  return parseInline(source).map(piece => piece.text).join('');
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map(cell => cell.trim());
}

function renderTable(rows: string[][], width: number, hyperlinks: boolean): string[] {
  const [header, ...body] = rows;
  const widths = header!.map((_, column) => Math.max(...rows.map(row => displayWidth(plainInline(row[column] ?? '')))));
  const total = widths.reduce((sum, value) => sum + value, 0) + 3 * (widths.length - 1) + 2;
  if (total > width) {
    // Too narrow for columns: each row becomes a labelled list.
    return body.flatMap(row => wrapInline(row.map((cell, column) => (column === 0 ? `**${cell}**` : cell)).join(' — '), width, hyperlinks, '  ', '    '));
  }
  const cellText = (cell: string, column: number, bold: boolean) => {
    const rendered = wrapInline(bold ? `**${cell}**` : cell, widths[column]!, hyperlinks, '', '')[0] ?? '';
    return rendered + ' '.repeat(Math.max(0, widths[column]! - displayWidth(rendered)));
  };
  const line = (row: string[], bold: boolean) => `  ${header!.map((_, column) => cellText(row[column] ?? '', column, bold)).join(' │ ')}`
    .replace(/│/gu, getCurrentGlyphMode() === 'nerd' ? '│' : '|').trimEnd();
  const rule = `  ${widths.map(size => (getCurrentGlyphMode() === 'nerd' ? '─' : '-').repeat(size)).join(getCurrentGlyphMode() === 'nerd' ? '─┼─' : '-+-')}`;
  return [line(header!, true), rule, ...body.map(row => line(row, false))];
}

/** Rows for `source`, each at most `columns` wide. Paragraphs wrap; code and tables never reflow. */
export function renderMarkdown(source: AuthoredMarkdown, options: MarkdownOptions): string[] {
  const width = Math.max(8, options.columns);
  const hyperlinks = options.hyperlinks ?? supportsHyperlinks();
  const lines = source.replace(/\r\n?/gu, '\n').replace(CONTROL, match => (match === '\t' ? '  ' : '')).split('\n');
  const out: string[] = [];
  const gap = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };
  const bullet = getCurrentGlyphMode() === 'nerd' ? '•' : '-';
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push(...wrapInline(paragraph.join(' '), width, hyperlinks, '', ''));
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const heading = /^(#{1,3})\s+(.*)$/u.exec(line);
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/u.exec(line);
    if (/^```/u.test(line)) {
      flush();
      const code: string[] = [];
      for (index += 1; index < lines.length && !/^```/u.test(lines[index]!); index += 1) code.push(lines[index]!);
      gap();
      out.push(...code.map(row => truncateAnsi(`  ${foregroundOf(theme('secondary'))}${row}${RESET}`, width)));
      out.push('');
    } else if (heading) {
      flush();
      gap();
      const role = heading[1]!.length === 1 ? 'accent' : heading[1]!.length === 2 ? 'primary' : 'secondary';
      out.push(truncateAnsi(`${BOLD}${foregroundOf(theme(role))}${plainInline(heading[2]!)}${RESET}`, width));
    } else if (/^\s*\|/u.test(line) && /^\s*\|[\s:|-]+\|\s*$/u.test(lines[index + 1] ?? '')) {
      flush();
      const table = [splitRow(line)];
      for (index += 2; index < lines.length && /^\s*\|/u.test(lines[index]!); index += 1) table.push(splitRow(lines[index]!));
      index -= 1;
      gap();
      out.push(...renderTable(table, width, hyperlinks), '');
    } else if (item) {
      flush();
      const marker = /\d/u.test(item[2]!) ? item[2]! : bullet;
      const indent = `${item[1]!.replace(/\t/gu, '  ')}${marker} `;
      out.push(...wrapInline(item[3]!, width, hyperlinks, indent, ' '.repeat(displayWidth(indent))));
    } else if (line.trim() === '') {
      flush();
      gap();
    } else paragraph.push(line.trim());
  }
  flush();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.map(row => truncateAnsi(row, width));
}

/** Rendered rows joined for the transcript's multi-line result slot. */
export function renderMarkdownText(source: AuthoredMarkdown, options: MarkdownOptions): string {
  return renderMarkdown(source, options).join('\n');
}

