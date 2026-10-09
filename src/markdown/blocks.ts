/**
 * Block structure of untrusted Markdown: headings, paragraphs, fenced and indented code, lists (nested, ordered,
 * task items), block quotes, GFM tables and thematic breaks. A pragmatic subset of CommonMark/GFM tuned for agent
 * replies and GitHub text, not a conformance implementation. Streaming-safe: an unclosed fence runs to the end and
 * is marked open, so a half-arrived reply still reads as code. Bounded in depth and lines; tabs are expected to be
 * expanded by the caller's display scrubber.
 */

export type Alignment = 'left' | 'center' | 'right' | undefined;

export type Block =
  | {kind: 'heading'; level: number; text: string}
  | {kind: 'paragraph'; text: string}
  | {kind: 'code'; language?: string; lines: string[]; closed: boolean}
  | {kind: 'list'; ordered: boolean; start: number; loose: boolean; items: ListItem[]}
  | {kind: 'quote'; blocks: Block[]}
  | {kind: 'table'; align: Alignment[]; header: string[]; rows: string[][]}
  | {kind: 'rule'};

export interface ListItem {
  /** `•`-style bullets are drawn by the renderer; ordered items keep their number and delimiter. */
  number?: number;
  task?: 'open' | 'done';
  blocks: Block[];
}

const MAX_DEPTH = 12;
const MAX_LINES = 50_000;

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`]*?)[ \t]*$/u;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/u;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
const QUOTE = /^ {0,3}>[ ]?/u;
const ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)/u;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/u;
const DELIMITER_CELL = /^:?-+:?$/u;

const blank = (line: string) => line.trim() === '';
const indentOf = (line: string) => line.length - line.trimStart().length;

/** Cells of a pipe table row; escaped pipes stay text, and pipes inside code spans do not split. */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let cell = '', code = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '\\' && text[index + 1] === '|') { cell += '|'; index++; continue; }
    if (char === '`') code = code ? 0 : 1;
    if (char === '|' && !code) { cells.push(cell.trim()); cell = ''; continue; }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function delimiterRow(line: string): Alignment[] | undefined {
  if (!line.includes('-') || (!line.includes('|') && !/^\s*:?-+:?\s*$/u.test(line))) return undefined;
  const cells = splitRow(line);
  if (!cells.length || !cells.every(cell => DELIMITER_CELL.test(cell))) return undefined;
  return cells.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : undefined);
}

/** Whether a line starts a block that interrupts a paragraph (a lazy continuation line must not). */
function interrupts(line: string, next: string | undefined): boolean {
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
  const item = ITEM.exec(line);
  // An ordered item interrupts a paragraph only when it starts at 1, and an empty item never does (CommonMark).
  if (item && line.slice(item[0].length).trim() && (!/\d/u.test(item[2]!) || /^1[.)]$/u.test(item[2]!))) return true;
  return Boolean(line.includes('|') && next !== undefined && delimiterRow(next) && splitRow(line).length === delimiterRow(next)!.length);
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  if (lines.length > MAX_LINES) lines.length = MAX_LINES;
  return parseLines(lines, 0);
}

function parseLines(lines: readonly string[], depth: number): Block[] {
  const blocks: Block[] = [];
  if (depth > MAX_DEPTH) {
    const text = lines.join('\n').trim();
    return text ? [{kind: 'paragraph', text}] : [];
  }
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (blank(line)) { index++; continue; }

    const fence = FENCE.exec(line);
    if (fence && !(fence[2]!.startsWith('`') && fence[3]!.includes('`'))) {
      const marker = fence[2]!;
      const indent = fence[1]!.length;
      const code: string[] = [];
      let closed = false;
      for (index++; index < lines.length; index++) {
        const candidate = lines[index]!;
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(candidate);
        if (close && close[1]![0] === marker[0] && close[1]!.length >= marker.length) { closed = true; index++; break; }
        // Content keeps its own indentation, less the fence's.
        code.push(candidate.slice(Math.min(indent, indentOf(candidate))));
      }
      const language = fence[3]!.split(/[\s{,]/u)[0]?.toLowerCase() || undefined;
      blocks.push({kind: 'code', ...(language ? {language} : {}), lines: code, closed});
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) { blocks.push({kind: 'heading', level: heading[1]!.length, text: (heading[2] ?? '').trim()}); index++; continue; }

    // A thematic break wins over a list item (`* * *`).
    if (RULE.test(line)) { blocks.push({kind: 'rule'}); index++; continue; }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index]!;
        if (QUOTE.test(candidate)) inner.push(candidate.replace(QUOTE, ''));
        // Lazy continuation: a plain text line continues the quote's paragraph.
        else if (!blank(candidate) && inner.length && !blank(inner.at(-1)!) && !interrupts(candidate, lines[index + 1])) inner.push(candidate);
        else break;
        index++;
      }
      blocks.push({kind: 'quote', blocks: parseLines(inner, depth + 1)});
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const parsed = parseList(lines, index, depth);
      blocks.push(parsed.block);
      index = parsed.next;
      continue;
    }

    const alignment = line.includes('|') ? delimiterRow(lines[index + 1] ?? '') : undefined;
    if (alignment) {
      const header = splitRow(line);
      if (header.length === alignment.length) {
        const rows: string[][] = [];
        for (index += 2; index < lines.length && !blank(lines[index]!) && lines[index]!.includes('|') && !interrupts(lines[index]!.replace(/\|/gu, ''), undefined); index++) {
          const cells = splitRow(lines[index]!);
          rows.push(Array.from({length: header.length}, (_, column) => cells[column] ?? ''));
        }
        blocks.push({kind: 'table', align: alignment, header, rows});
        continue;
      }
    }

    // Indented code: four spaces, never continuing a paragraph.
    if (indentOf(line) >= 4) {
      const code: string[] = [];
      while (index < lines.length && (indentOf(lines[index]!) >= 4 || blank(lines[index]!))) code.push(lines[index++]!.slice(4));
      while (code.length && blank(code.at(-1)!)) code.pop();
      blocks.push({kind: 'code', lines: code, closed: true});
      continue;
    }

    const paragraph: string[] = [line.trim()];
    for (index++; index < lines.length; index++) {
      const candidate = lines[index]!;
      if (blank(candidate)) break;
      const setext = SETEXT.exec(candidate);
      if (setext) {
        blocks.push({kind: 'heading', level: setext[1]![0] === '=' ? 1 : 2, text: paragraph.join(' ')});
        paragraph.length = 0;
        index++;
        break;
      }
      if (interrupts(candidate, lines[index + 1])) break;
      // A hard line break (two trailing spaces or a backslash) keeps the break.
      const previous = paragraph.at(-1)!;
      if (/ {2,}$|\\$/u.test(lines[index - 1]!)) paragraph[paragraph.length - 1] = `${previous.replace(/\\$/u, '')}\n`;
      paragraph.push(candidate.trim());
    }
    if (paragraph.length) blocks.push({kind: 'paragraph', text: paragraph.join('\n').replace(/\n\n/gu, '\n')});
  }
  return blocks;
}

function parseList(lines: readonly string[], start: number, depth: number): {block: Extract<Block, {kind: 'list'}>; next: number} {
  const first = ITEM.exec(lines[start]!)!;
  const ordered = /\d/u.test(first[2]!);
  const delimiter = ordered ? first[2]!.slice(-1) : first[2]!;
  const items: ListItem[] = [];
  let loose = false;
  let index = start;
  let sawBlankBetween = false;
  while (index < lines.length) {
    const match = ITEM.exec(lines[index]!);
    if (!match) break;
    const sameKind = ordered ? /\d/u.test(match[2]!) && match[2]!.slice(-1) === delimiter : match[2] === delimiter;
    if (!sameKind || match[1]!.length > first[1]!.length + 1) break;
    if (sawBlankBetween) loose = true;
    const marker = match[1]!.length + match[2]!.length;
    const spacing = match[3]!.length;
    // Content starts after one to four spaces; more means the content itself is indented (code), so one space counts.
    const width = marker + (spacing >= 1 && spacing <= 4 ? spacing : 1);
    const body: string[] = [lines[index]!.slice(width)];
    let blankRun = 0;
    for (index++; index < lines.length; index++) {
      const candidate = lines[index]!;
      if (blank(candidate)) { blankRun++; body.push(''); continue; }
      if (indentOf(candidate) >= width) { body.push(candidate.slice(width)); blankRun = 0; continue; }
      // Lazy continuation of the item's paragraph text.
      if (!blankRun && !interrupts(candidate, lines[index + 1]) && !ITEM.test(candidate)) { body.push(candidate.trim()); continue; }
      break;
    }
    while (body.length && blank(body.at(-1)!)) body.pop();
    // Items separated by blank lines read as a loose list (a blank row between items).
    sawBlankBetween = blankRun > 0;
    let task: ListItem['task'];
    const taskMatch = /^\[([ xX])\][ \t]+/u.exec(body[0] ?? '');
    if (taskMatch) { task = taskMatch[1] === ' ' ? 'open' : 'done'; body[0] = body[0]!.slice(taskMatch[0].length); }
    items.push({...(ordered ? {number: Number(match[2]!.slice(0, -1))} : {}), ...(task ? {task} : {}), blocks: parseLines(body, depth + 1)});
  }
  return {block: {kind: 'list', ordered, start: items[0]?.number ?? 1, loose, items}, next: index};
}
