import type {Position, TextBuffer} from '../viewer/textBuffer.js';
import {mapPosition} from '../viewer/snippets.js';
import {parseBlockLines, parseBlocks, type Block} from './blocks.js';
import type {MarkdownRow} from './render.js';

/**
 * The shared source-position map of the document workspace (#462, serving #466, #461 and #460). There is ONE authority, the
 * editor's `TextBuffer`, and ONE Markdown parser, `parseBlocks`; this module only adds the ways to move between them:
 *
 *   buffer position (line, UTF-16 column)  ──  Block.from/to (source lines of every block)  ──  MarkdownRow.line (rows drawn)
 *
 * - Positions are the buffer's logical lines, with line endings and the BOM already taken out (they are the file encoder's
 *   concern), and columns on grapheme boundaries; nothing here counts bytes.
 * - Nothing is reconstructed from rendered text. Rows know the first source line of their block; going from a row to the
 *   source, or from a source line to a row, is a lookup, never a parse of the rows.
 * - Positions that must survive edits (where you were before a jump) are `SourceAnchor`s: the buffer tells them about every
 *   change, undo and redo included.
 * - Parsing is bounded (`parseBlocks` stops at 50,000 lines and says so) and cached per buffer version in `DocumentIndex`;
 *   a block without a known span simply has no line, and every lookup falls back to its neighbours.
 */

export interface HeadingEntry {
  level: number;
  /** What the reader sees: inline markup removed. */
  text: string;
  /** The source line of the heading. */
  line: number;
  /** GitHub-style fragment; undefined for headings written as raw HTML (they get no anchor from GitHub). */
  slug?: string;
  /** How many shallower headings enclose it, however many levels were skipped. */
  depth: number;
}

// ---- Heading text and anchors -----------------------------------------------------------------------------------

const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!>~|<])/gu;

/** The text a reader sees for inline Markdown: links, images, code, emphasis, HTML tags and escapes reduced to their words. */
export function plainInline(text: string): string {
  const escaped: string[] = [];
  let out = text.replace(ESCAPABLE, (_, character: string) => { escaped.push(character); return `${escaped.length - 1}`; });
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1').replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1').replace(/\[([^\]]*)\]\[[^\]]*\]/gu, '$1');
  out = out.replace(/(`+)([\s\S]*?)\1/gu, '$2').replace(/<[^>]*>/gu, '');
  out = out.replace(/\*+/gu, '').replace(/~~/gu, '').replace(/(^|[^\p{L}\p{N}])_+(?=\S)([\s\S]*?\S)_+(?![\p{L}\p{N}])/gu, '$1$2');
  return out.replace(/(\d+)/gu, (_, index: string) => escaped[Number(index)]!);
}

/** A heading's GitHub fragment: lowercase, everything but letters, numbers, marks, underscores, hyphens and spaces removed, each space a hyphen. */
export function githubSlug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /gu, '-');
}

/** Give every non-HTML heading its fragment; a repeated one gets -1, -2 … as GitHub's slugger does. */
export function assignSlugs<T extends {text: string; fromHtml?: boolean; slug?: string}>(headings: T[]): T[] {
  const occurrences = new Map<string, number>();
  for (const heading of headings) {
    if (heading.fromHtml) continue;
    const base = githubSlug(plainInline(heading.text).trim());
    let slug = base;
    while (occurrences.has(slug)) { occurrences.set(base, (occurrences.get(base) ?? 0) + 1); slug = `${base}-${occurrences.get(base)}`; }
    occurrences.set(slug, 0);
    heading.slug = slug;
  }
  return headings;
}

function walk(blocks: readonly Block[], lines: readonly string[], out: Array<HeadingEntry & {fromHtml?: boolean}>): void {
  for (const block of blocks) {
    if (block.kind === 'heading' && block.from !== undefined) {
      out.push({level: block.level, text: plainInline(block.text).trim(), line: block.from, depth: 0, ...(lines[block.from]?.trimStart().startsWith('<') ? {fromHtml: true} : {})});
    } else if (block.kind === 'quote' || block.kind === 'details') walk(block.blocks, lines, out);
    else if (block.kind === 'list') for (const item of block.items) walk(item.blocks, lines, out);
  }
}

function outline(blocks: readonly Block[], lines: readonly string[]): HeadingEntry[] {
  const found: Array<HeadingEntry & {fromHtml?: boolean}> = [];
  walk(blocks, lines, found);
  const stack: number[] = [];
  for (const heading of found) {
    while (stack.length && stack.at(-1)! >= heading.level) stack.pop();
    heading.depth = stack.length;
    stack.push(heading.level);
  }
  // The slug is computed from the raw text of the heading as parsed, not from the display text, so it matches what GitHub hashes.
  assignSlugs(found.map(heading => Object.assign(heading, {})));
  return found.map(({fromHtml: _html, ...heading}) => heading);
}

/** The headings of a Markdown source, in document order. */
export function headingsOf(source: string, options: {html?: boolean} = {}): HeadingEntry[] {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  return outline(parseBlocks(source, {html: options.html ?? false, math: true}), lines);
}

/** The headings of lines already cut (a buffer's), so a stray CR cannot shift a line number. */
export function headingsFromLines(lines: readonly string[], options: {html?: boolean} = {}): HeadingEntry[] {
  return outline(parseBlockLines(lines, {html: options.html ?? false, math: true}), lines);
}

/** The heading a `#fragment` names (case-insensitive, percent-decoded), if any. */
export function resolveFragment(headings: readonly HeadingEntry[], fragment: string): HeadingEntry | undefined {
  let wanted = fragment.replace(/^#/u, '');
  try { wanted = decodeURIComponent(wanted); } catch { return undefined; }
  wanted = wanted.toLowerCase();
  return wanted ? headings.find(heading => heading.slug !== undefined && heading.slug.toLowerCase() === wanted) : undefined;
}

// ---- Rendered rows <-> source lines -----------------------------------------------------------------------------

/** The source line of a drawn row; a gap row takes the nearest mapped row above it. */
export function lineForRow(rows: readonly MarkdownRow[], index: number): number | undefined {
  for (let at = Math.min(index, rows.length - 1); at >= 0; at -= 1) if (rows[at]!.line !== undefined) return rows[at]!.line;
  return undefined;
}

/** The row to show for a source line: the first row of the block that holds it (the last block when the line is past the end, the first when before). */
export function rowForLine(rows: readonly MarkdownRow[], line: number): number {
  let best: number | undefined;
  let firstMapped: number | undefined;
  for (let at = 0; at < rows.length; at += 1) {
    const rowLine = rows[at]!.line;
    if (rowLine === undefined) continue;
    firstMapped ??= at;
    if (rowLine <= line && (best === undefined || rowLine > rows[best]!.line!)) best = at;
  }
  return best ?? firstMapped ?? 0;
}

// ---- Index and anchors ------------------------------------------------------------------------------------------

export interface DocumentIndexOptions {
  html?: boolean;
  onParse?: () => void;
}

/** The parsed structure of a buffer, kept until the buffer changes. */
export class DocumentIndex {
  private versionCounter = 0;
  /** How many times the buffer was parsed: tests and budgets read it. */
  parseCount = 0;
  private cached?: {version: number; blocks: Block[]; headings: HeadingEntry[]};
  private readonly stop: () => void;
  constructor(private readonly buffer: TextBuffer, private readonly options: DocumentIndexOptions = {}) {
    this.stop = buffer.observe(() => { this.versionCounter += 1; });
  }

  /** Changes whenever the buffer's text does. */
  get version(): number { return this.versionCounter; }

  /** The document was longer than the parser reads; only its first lines are indexed. */
  get truncated(): boolean { return this.buffer.lines.length > 50_000; }

  private ensure() {
    if (this.cached?.version === this.versionCounter) return this.cached;
    this.parseCount += 1;
    this.options.onParse?.();
    const blocks = parseBlockLines(this.buffer.lines, {html: this.options.html ?? false, math: true});
    this.cached = {version: this.versionCounter, blocks, headings: outline(blocks, this.buffer.lines)};
    return this.cached;
  }

  blocks(): Block[] { return this.ensure().blocks; }
  headings(): HeadingEntry[] { return this.ensure().headings; }

  /** The nearest heading at or above a source line. */
  headingAt(line: number): HeadingEntry | undefined {
    let found: HeadingEntry | undefined;
    for (const heading of this.headings()) { if (heading.line > line) break; found = heading; }
    return found;
  }

  /** The top-level block holding a source line, for "the raw block under the caret". */
  blockAt(line: number): Block | undefined {
    return this.blocks().find(block => block.from !== undefined && block.to !== undefined && line >= block.from && line < block.to);
  }

  dispose(): void { this.stop(); }
}

/** A position in the buffer that follows the text through every edit, undo and redo. */
export class SourceAnchor {
  position: Position;
  private readonly stop: () => void;
  constructor(buffer: TextBuffer, position: Position) {
    this.position = {...position};
    this.stop = buffer.observe((from, to, end) => { this.position = mapPosition(this.position, from, to, end, false); });
  }

  dispose(): void { this.stop(); }
}
