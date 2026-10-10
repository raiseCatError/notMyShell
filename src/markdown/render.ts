import {colorEscape} from '../chroma/escape.js';
import {colorLevel, type ColorLevel} from '../presentation/capabilities.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {UI_COLORS, type RgbColor} from '../ui/palette.js';
import type {SyntaxSgr} from '../input/syntaxTheme.js';
import {displayWidth, truncateAnsi} from '../util/text.js';
import {stripTerminalControls} from '../util/terminalControls.js';
import {parseBlocks, type Alignment, type Block} from './blocks.js';
import {highlightCode, type CodeTokenKind} from './highlight.js';
import {parseInline, plainInline, type InlineSpan, type InlineStyle} from './inline.js';

/**
 * Markdown for untrusted text, as terminal rows: agent replies, provider command output and GitHub bodies. Every row
 * fits `columns` display cells and ends reset, so rows compose with any surrounding chrome. Colors are semantic roles
 * resolved when painted (themes and NO_COLOR apply), structure never depends on color (bullets, gutters, labels), and
 * Safe glyphs replace every decorative character. The caller scrubs terminal controls first (`displayText`).
 */

export type MarkdownRowKind = 'text' | 'heading' | 'code' | 'quote' | 'table' | 'rule' | 'list' | 'blank';

export interface MarkdownRow {
  /** Styled row, at most `columns` cells, reset at its end. */
  ansi: string;
  /** What the row shows, for search, selection and copy-visible. */
  plain: string;
  kind: MarkdownRowKind;
  /** The code block a row belongs to (0-based, in source order), for copy-code actions. */
  code?: number;
}

export interface MarkdownOptions {
  level?: ColorLevel;
  glyphs?: 'nerd' | 'safe';
  /** Emit OSC 8 hyperlinks for safe http(s) links. */
  hyperlinks?: boolean;
  /** The person's syntax roles, so code follows /syntax; theme roles otherwise. */
  syntax?: SyntaxSgr;
  /** Base text role for prose (agent replies use primary; quieter contexts may pass secondary). */
  tone?: 'primary' | 'secondary';
}

const RESET = '\u001b[0m';
const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const ITALIC = '\u001b[3m';
const UNDERLINE = '\u001b[4m';
const STRIKE = '\u001b[9m';

interface Context {
  level: ColorLevel;
  safe: boolean;
  hyperlinks: boolean;
  syntax?: SyntaxSgr;
  fg: (color: RgbColor) => string;
  tone: RgbColor;
  codeIndex: number;
}

function glyph(context: Context, nerd: string, safe: string): string {
  return context.safe ? safe : nerd;
}

// ---- Inline -------------------------------------------------------------------------------------------------------

interface Atom {text: string; sgr: string; link?: string; space: boolean}

function spanSgr(style: InlineStyle, context: Context, base: string): string {
  let sgr = base;
  if (style.code) sgr = context.level === 'none' ? base : context.fg(UI_COLORS.accent);
  if (style.strong) sgr += BOLD;
  if (style.em) sgr += ITALIC;
  if (style.strike) sgr += STRIKE;
  if (style.link) sgr += `${UNDERLINE}${context.fg(UI_COLORS.accent)}`;
  if (style.image) sgr += `${DIM}${context.fg(UI_COLORS.subtle)}`;
  return sgr;
}

function hostOf(url: string): string {
  try { return new URL(url).host.toLowerCase(); } catch { return url; }
}

/** Hostname-like words in link text, normalized the way URLs normalize them (lowercase, punycode for lookalikes). */
function hostsIn(text: string): string[] {
  const hosts: string[] = [];
  for (const word of text.split(/[^A-Za-z0-9.\-\u00a0-\uffff]+/u)) {
    let start = 0, end = word.length;
    while (start < end && (word[start] === '.' || word[start] === '-')) start++;
    while (end > start && (word[end - 1] === '.' || word[end - 1] === '-')) end--;
    const candidate = word.slice(start, end);
    if (!candidate.includes('.') || !/\p{L}/u.test(candidate) || candidate.length > 253) continue;
    try { hosts.push(new URL(`http://${candidate}`).host.toLowerCase()); } catch { /* not a hostname */ }
  }
  return hosts;
}

const bare = (host: string) => host.replace(/^www\./u, '');

/**
 * Whether link text already shows exactly where the link goes. It must name the target's host as a whole hostname and
 * name no other host: `[example.com](https://le.com)` or `[github.com login](https://github.com.evil.io)` reveal
 * their real destination, while `[docs on example.com](https://example.com/docs)` needs nothing more.
 */
function textShowsHost(text: string, url: string): boolean {
  const host = hostOf(url);
  // An internationalized host can imitate another script's letters even when text and target agree: always reveal it.
  if (host.split('.').some(label => label.startsWith('xn--'))) return false;
  if (text === url) return true;
  const target = bare(host);
  const named = hostsIn(text).map(bare);
  return named.length > 0 && named.every(host => host === target);
}

/** Spans as wrap atoms: words and spaces, each carrying its own SGR so every row can start fresh. */
function atomsOf(spans: readonly InlineSpan[], context: Context, base: string): Atom[] {
  const atoms: Atom[] = [];
  const subtle = context.fg(UI_COLORS.subtle);
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index]!;
    let text = span.text;
    if (span.style.image) text = `[image: ${text}]`;
    // Without color, code keeps its backticks so it never depends on color to read as code.
    if (span.style.code && context.level === 'none') text = `\`${text}\``;
    const sgr = spanSgr(span.style, context, base);
    const link = span.style.link && context.hyperlinks ? span.style.link : undefined;
    for (const part of text.split(/(\s+)/u)) {
      if (!part) continue;
      const space = /^\s+$/u.test(part);
      atoms.push({text: space ? ' ' : part, sgr: space ? base : sgr, ...(link && !space ? {link} : {}), space});
    }
    // A link reveals where it goes, judged on its whole text (it may span several styled pieces): the host when the
    // text does not already show exactly that host, or the full URL when there are no hyperlinks to inspect.
    const next = spans[index + 1];
    if (span.style.link && next?.style.link !== span.style.link) {
      let first = index;
      while (first > 0 && spans[first - 1]!.style.link === span.style.link) first--;
      const whole = spans.slice(first, index + 1).map(part => part.text).join('');
      const reveal = context.hyperlinks ? (textShowsHost(whole, span.style.link) ? '' : hostOf(span.style.link)) : whole === span.style.link ? '' : span.style.link;
      if (reveal) atoms.push({text: ' ', sgr: base, space: true}, {text: `(${reveal})`, sgr: subtle, space: false});
    }
  }
  return atoms;
}

function paintAtom(atom: Atom): string {
  const body = atom.link ? `\u001b]8;;${atom.link}\u001b\\${atom.text}\u001b]8;;\u001b\\` : atom.text;
  return `${atom.sgr}${body}${RESET}`;
}

/** Greedy word wrap of atoms into rows of `width` cells after the given prefixes; words wider than a row hard-break. */
function wrapAtoms(atoms: readonly Atom[], width: number, first: string, rest: string): Array<{ansi: string; plain: string}> {
  const rows: Array<{ansi: string; plain: string}> = [];
  let ansi = first, plain = first.replace(/\u001b\[[0-9;]*m/gu, ''), used = displayWidth(first);
  let empty = true;
  const push = () => { rows.push({ansi, plain: plain.trimEnd()}); ansi = rest; plain = rest.replace(/\u001b\[[0-9;]*m/gu, ''); used = displayWidth(rest); empty = true; };
  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index]!;
    if (atom.space) {
      // Spaces never start a row and never trail one.
      if (empty) continue;
      const next = atoms[index + 1];
      if (!next || used + 1 + displayWidth(next.text) > width) continue;
      ansi += paintAtom(atom); plain += ' '; used += 1;
      continue;
    }
    const size = displayWidth(atom.text);
    if (!empty && used + size > width) push();
    if (used + size > width) {
      // Hard-break a word wider than the row, measuring one character at a time (never re-measuring the chunk).
      let chunk = '', chunkWidth = 0;
      for (const char of atom.text) {
        const cell = displayWidth(char);
        if (used + chunkWidth + cell > width && chunk) {
          ansi += paintAtom({...atom, text: chunk}); plain += chunk; push(); chunk = ''; chunkWidth = 0;
        }
        chunk += char; chunkWidth += cell;
      }
      ansi += paintAtom({...atom, text: chunk}); plain += chunk; used += chunkWidth; empty = false;
      continue;
    }
    ansi += paintAtom(atom); plain += atom.text; used += size; empty = false;
  }
  if (!empty || !rows.length) rows.push({ansi, plain: plain.trimEnd()});
  return rows;
}

function inlineRows(source: string, width: number, context: Context, base: string, first = '', rest = first): Array<{ansi: string; plain: string}> {
  // A hard break inside a paragraph is a new row with the same hanging indent.
  return source.split('\n').flatMap((line, index) => wrapAtoms(atomsOf(parseInline(line), context, base), width, index === 0 ? first : rest, rest));
}

// ---- Code ---------------------------------------------------------------------------------------------------------

function tokenSgr(kind: CodeTokenKind, context: Context): string {
  const s = context.syntax;
  const fg = context.fg;
  switch (kind) {
    case 'keyword': case 'tag': return s?.KnownCommand ?? fg(UI_COLORS.accent);
    case 'function': return s?.Function ?? fg(UI_COLORS.accent);
    case 'string': return s?.String ?? fg(UI_COLORS.secondary);
    case 'number': case 'constant': case 'variable': return s?.Variable ?? fg(UI_COLORS.accent);
    case 'comment': return `${ITALIC}${s?.Comment ?? fg(UI_COLORS.subtle)}`;
    case 'type': case 'property': return s?.Path ?? fg(UI_COLORS.secondary);
    case 'operator': return s?.Operator ?? fg(UI_COLORS.subtle);
    case 'inserted': return fg(UI_COLORS.success);
    case 'deleted': return fg(UI_COLORS.failure);
    case 'meta': return fg(UI_COLORS.subtle);
    case 'heading': return `${BOLD}${fg(UI_COLORS.primary)}`;
    case 'plain': return s?.Normal ?? fg(UI_COLORS.primary);
  }
}

function codeRows(block: Extract<Block, {kind: 'code'}>, width: number, context: Context): MarkdownRow[] {
  const index = context.codeIndex++;
  const gutter = `${context.fg(UI_COLORS.separator)}${glyph(context, '│', '|')}${RESET} `;
  const inner = Math.max(1, width - 2);
  const label = block.language ? block.language.slice(0, 24) : '';
  const rows: MarkdownRow[] = [];
  const tokens = highlightCode(block.lines.length ? block.lines : [''], block.language);
  tokens.forEach((line, number) => {
    // Wrap long lines by cells; continuation rows indent two cells so a wrap reads as one line.
    let ansi = '', plain = '', used = 0;
    const flush = () => { rows.push({ansi: `${gutter}${ansi}${RESET}`, plain: `${glyph(context, '│', '|')} ${plain}`.trimEnd(), kind: 'code', code: index}); ansi = '  '; plain = '  '; used = 2; };
    for (const token of line) {
      const sgr = tokenSgr(token.kind, context);
      let text = '';
      for (const char of token.text) {
        const size = displayWidth(char);
        if (used + size > inner) { if (text) ansi += `${sgr}${text}${RESET}`; plain += text; text = ''; flush(); }
        text += char; used += size;
      }
      if (text) { ansi += `${sgr}${text}${RESET}`; plain += text; }
    }
    rows.push({ansi: `${gutter}${ansi}${RESET}`, plain: `${glyph(context, '│', '|')} ${plain}`.trimEnd(), kind: 'code', code: index});
    if (number === 0 && label) {
      // The language rides the first row's right edge when there is room, never displacing code.
      const first = rows[0]!;
      const free = width - displayWidth(first.ansi);
      if (free >= label.length + 2) first.ansi = `${first.ansi}${' '.repeat(free - label.length)}${context.fg(UI_COLORS.subtle)}${label}${RESET}`;
    }
  });
  if (!block.closed) rows.push({ansi: `${gutter}${context.fg(UI_COLORS.subtle)}${glyph(context, '…', '...')}${RESET}`, plain: `${glyph(context, '│', '|')} ${glyph(context, '…', '...')}`, kind: 'code', code: index});
  return rows;
}

// ---- Tables -------------------------------------------------------------------------------------------------------

function alignCell(text: string, width: number, align: Alignment): string {
  const free = Math.max(0, width - displayWidth(text));
  if (align === 'right') return `${' '.repeat(free)}${text}`;
  if (align === 'center') return `${' '.repeat(Math.floor(free / 2))}${text}${' '.repeat(Math.ceil(free / 2))}`;
  return `${text}${' '.repeat(free)}`;
}

function tableRows(block: Extract<Block, {kind: 'table'}>, width: number, context: Context): MarkdownRow[] {
  const columns = block.header.length;
  const all = [block.header, ...block.rows];
  const natural = Array.from({length: columns}, (_, column) => Math.max(1, ...all.map(row => displayWidth(plainInline(row[column] ?? '')))));
  const separator = glyph(context, ' │ ', ' | ');
  const chrome = 3 * (columns - 1);
  const available = width - chrome;
  const minimum = Array.from({length: columns}, (_, column) => Math.min(natural[column]!, Math.max(3, Math.min(10, ...[block.header[column] ?? ''].map(cell => displayWidth(plainInline(cell)))))));
  if (available < minimum.reduce((a, b) => a + b, 0)) {
    // Too narrow for a grid: each row becomes a short record of "Header: value" lines.
    const rows: MarkdownRow[] = [];
    const subtle = context.fg(UI_COLORS.subtle), base = context.fg(context.tone);
    block.rows.forEach((row, index) => {
      if (index) rows.push({ansi: '', plain: '', kind: 'blank'});
      row.forEach((cell, column) => {
        const label = plainInline(block.header[column] ?? '');
        const lead = `${subtle}${label}:${RESET} `;
        for (const line of inlineRows(cell || '—', width, context, base, lead, '  ')) rows.push({...line, kind: 'table'});
      });
    });
    return rows;
  }
  // Shrink the widest columns first until the grid fits, wrapping their cells.
  const widths = [...natural];
  while (widths.reduce((a, b) => a + b, 0) > available) {
    const widest = widths.indexOf(Math.max(...widths.map((value, column) => value > minimum[column]! ? value : 0)));
    if (widest < 0 || widths[widest]! <= minimum[widest]!) break;
    widths[widest]! -= 1;
  }
  const rule = context.fg(UI_COLORS.separator);
  const out: MarkdownRow[] = [];
  const renderRow = (cells: readonly string[], header: boolean) => {
    const base = header ? `${BOLD}${context.fg(UI_COLORS.primary)}` : context.fg(context.tone);
    const wrapped = cells.map((cell, column) => inlineRows(cell, widths[column]!, context, base));
    const height = Math.max(...wrapped.map(lines => lines.length));
    for (let line = 0; line < height; line++) {
      const ansi = wrapped.map((lines, column) => {
        const part = lines[line];
        const text = part ? alignCell(part.ansi, widths[column]!, block.align[column]) : ' '.repeat(widths[column]!);
        return text;
      }).join(`${rule}${separator}${RESET}`);
      const plain = wrapped.map((lines, column) => alignCell(lines[line]?.plain ?? '', widths[column]!, block.align[column])).join(separator);
      out.push({ansi, plain: plain.trimEnd(), kind: 'table'});
    }
  };
  renderRow(block.header, true);
  const line = widths.map(size => glyph(context, '─', '-').repeat(size)).join(glyph(context, '─┼─', '-+-'));
  out.push({ansi: `${rule}${line}${RESET}`, plain: line, kind: 'table'});
  for (const row of block.rows) renderRow(row, false);
  return out;
}

// ---- Blocks -------------------------------------------------------------------------------------------------------

const BULLETS = {nerd: ['•', '◦', '▪'], safe: ['-', '*', '+']};

function renderBlocks(blocks: readonly Block[], width: number, context: Context, depth: number, tight = false): MarkdownRow[] {
  const out: MarkdownRow[] = [];
  const gap = () => { if (out.length && out.at(-1)!.kind !== 'blank') out.push({ansi: '', plain: '', kind: 'blank'}); };
  const base = context.fg(context.tone);
  for (const block of blocks) {
    if (!tight) gap();
    switch (block.kind) {
      case 'paragraph':
        for (const row of inlineRows(block.text, width, context, base)) out.push({...row, kind: 'text'});
        break;
      case 'heading': {
        const role = block.level === 1 ? UI_COLORS.accent : block.level === 2 ? UI_COLORS.primary : UI_COLORS.secondary;
        const sgr = `${block.level <= 3 ? BOLD : ''}${block.level >= 4 ? ITALIC : ''}${context.fg(role)}`;
        for (const row of inlineRows(block.text, width, context, sgr)) out.push({...row, kind: 'heading'});
        break;
      }
      case 'code':
        out.push(...codeRows(block, width, context));
        break;
      case 'rule': {
        const line = glyph(context, '─', '-').repeat(Math.max(1, Math.min(width, 48)));
        out.push({ansi: `${context.fg(UI_COLORS.separator)}${line}${RESET}`, plain: line, kind: 'rule'});
        break;
      }
      case 'quote': {
        const bar = `${context.fg(UI_COLORS.subtle)}${glyph(context, '▎', '|')}${RESET} `;
        const inner = renderBlocks(block.blocks, Math.max(1, width - 2), {...context, tone: UI_COLORS.secondary}, depth + 1);
        for (const row of inner) out.push({ansi: `${bar}${row.ansi}`, plain: `${glyph(context, '▎', '|')} ${row.plain}`.trimEnd(), kind: 'quote', ...(row.code !== undefined ? {code: row.code} : {})});
        break;
      }
      case 'table':
        out.push(...tableRows(block, width, context));
        break;
      case 'list': {
        const numberWidth = block.ordered ? String(block.start + block.items.length - 1).length + 1 : 0;
        block.items.forEach((item, index) => {
          if (block.loose && index) out.push({ansi: '', plain: '', kind: 'blank'});
          const subtle = context.fg(UI_COLORS.subtle);
          let marker: string;
          if (item.task) marker = item.task === 'done' ? glyph(context, '☑', '[x]') : glyph(context, '☐', '[ ]');
          else if (block.ordered) marker = `${item.number ?? block.start + index}.`.padStart(numberWidth);
          else marker = (context.safe ? BULLETS.safe : BULLETS.nerd)[depth % 3]!;
          const lead = displayWidth(marker) + 1;
          const markerSgr = item.task === 'done' ? context.fg(UI_COLORS.success) : block.ordered ? subtle : context.fg(UI_COLORS.accent);
          const childContext = item.task === 'done' ? {...context, tone: UI_COLORS.subtle} : context;
          const inner = renderBlocks(item.blocks, Math.max(1, width - lead), childContext, depth + 1, !block.loose);
          if (!inner.length) inner.push({ansi: '', plain: '', kind: 'text'});
          inner.forEach((row, line) => {
            const prefix = line === 0 ? `${markerSgr}${marker}${RESET} ` : ' '.repeat(lead);
            out.push({ansi: `${prefix}${row.ansi}`, plain: `${line === 0 ? `${marker} ` : ' '.repeat(lead)}${row.plain}`.trimEnd(), kind: row.kind === 'blank' ? 'blank' : 'list', ...(row.code !== undefined ? {code: row.code} : {})});
          });
        });
        break;
      }
    }
  }
  return out;
}

/** Rows for untrusted Markdown at `columns` cells. */
export function renderMarkdown(source: string, columns: number, options: MarkdownOptions = {}): MarkdownRow[] {
  const width = Math.max(4, columns);
  const level = options.level ?? colorLevel();
  const context: Context = {
    level,
    safe: (options.glyphs ?? getCurrentGlyphMode()) === 'safe',
    hyperlinks: options.hyperlinks ?? false,
    ...(options.syntax ? {syntax: options.syntax} : {}),
    fg: color => colorEscape(38, color, level),
    tone: options.tone === 'secondary' ? UI_COLORS.secondary : UI_COLORS.primary,
    codeIndex: 0,
  };
  // The renderer never trusts its caller to have scrubbed: terminal controls and bidi formatting go, tabs become spaces.
  const safe = source.split('\n').map(line => stripTerminalControls(line.replace(/\t/gu, '    '), Number.MAX_SAFE_INTEGER)).join('\n');
  const rows = renderBlocks(parseBlocks(safe), width, context, 0);
  while (rows.length && rows.at(-1)!.kind === 'blank') rows.pop();
  // A last line of defence: no row may exceed the width whatever a rule above computed.
  return rows.map(row => displayWidth(row.ansi) > width ? {...row, ansi: truncateAnsi(row.ansi, width)} : row);
}

/** The code blocks of a Markdown text, in order: what a copy-code action copies (exact source lines). */
export function codeBlocks(source: string): Array<{language?: string; text: string}> {
  const found: Array<{language?: string; text: string}> = [];
  const walk = (blocks: readonly Block[]) => {
    for (const block of blocks) {
      if (block.kind === 'code') found.push({...(block.language ? {language: block.language} : {}), text: block.lines.join('\n')});
      else if (block.kind === 'quote') walk(block.blocks);
      else if (block.kind === 'list') for (const item of block.items) walk(item.blocks);
    }
  };
  walk(parseBlocks(source));
  return found;
}
