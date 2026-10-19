import type {Alignment, Block, ListItem} from './blocks.js';
import {BLOCK, decodeEntities, DROPPED, imageLabel, RAW_TEXT, readTag, VOID} from './markup.js';

/**
 * HTML as the Markdown renderer's own blocks (QA F01): what `/view` shows for an HTML file and for HTML inside
 * Markdown. A supported subset, mapped onto blocks the renderer already draws safely at any width:
 *   headings, paragraphs and containers (div, section, center, details…), ordered and unordered lists (nested, task
 *   check boxes), tables (header row, alignment), preformatted code (with its language class), block quotes, rules,
 *   definition lists; inline emphasis, code, keys, strikethrough, links and images.
 * Inline content is handed on as normalised inline HTML (escaped text and the few tags the inline parser reads), so
 * links follow the renderer's http(s)-only rule and an image is its alt text, never fetched or read.
 *
 * Nothing is executed or loaded: scripts, styles, templates, embedded and interactive content and the document head
 * are dropped with their contents, attributes other than a few (href, alt, src for a label, align, start, type,
 * checked, class for a code language) are ignored, CSS is never applied. The scan is linear; at most MAX_TOKENS
 * tokens are read and MAX_DEPTH elements nest (deeper content stays, flattened), so hostile markup stays bounded.
 */

const MAX_TOKENS = 200_000;
const MAX_DEPTH = 48;
const MAX_COLUMNS = 32;

type Token = {kind: 'text'; text: string} | {kind: 'open'; name: string; attributes: Record<string, string>; self: boolean} | {kind: 'close'; name: string};
interface Element {name: string; attributes: Record<string, string>; children: Node[]}
type Node = string | Element;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const lower = source.toLowerCase();
  let index = 0;
  while (index < source.length) {
    if (tokens.length >= MAX_TOKENS) {
      tokens.push({kind: 'text', text: ' … (the rest is too long to render here; m shows the source)'});
      break;
    }
    const open = source.indexOf('<', index);
    if (open < 0) { tokens.push({kind: 'text', text: source.slice(index)}); break; }
    if (open > index) tokens.push({kind: 'text', text: source.slice(index, open)});
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source[open + 1] === '!' || source[open + 1] === '?') {
      // A doctype, CDATA section or processing instruction: never content.
      const end = source.indexOf('>', open);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    const tag = readTag(source, open);
    if (!tag) { tokens.push({kind: 'text', text: '<'}); index = open + 1; continue; }
    index = tag.end;
    if (tag.closing) { tokens.push({kind: 'close', name: tag.name}); continue; }
    tokens.push({kind: 'open', name: tag.name, attributes: tag.attributes, self: tag.selfClosing});
    if (RAW_TEXT.has(tag.name) && !tag.selfClosing) {
      // Its content is never markup: skip to its end tag (or the end), unread.
      const close = lower.indexOf(`</${tag.name}`, index);
      const end = close < 0 ? -1 : source.indexOf('>', close);
      index = end < 0 ? source.length : end + 1;
      tokens.push({kind: 'close', name: tag.name});
    }
  }
  return tokens;
}

/** Elements an opening tag of the same family closes (an unclosed `<li>`, `<p>`, `<tr>`, a cell). */
const IMPLIED: Record<string, readonly string[]> = {li: ['li'], p: ['p'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'], dt: ['dt', 'dd'], dd: ['dt', 'dd']};
/** Where an implied close stops looking: it never reaches past its own list, table or row. */
const SCOPE = new Set(['ul', 'ol', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'dl', 'blockquote', 'div', 'body', 'html']);

function build(tokens: readonly Token[]): Element {
  const root: Element = {name: '#root', attributes: {}, children: []};
  const stack: Element[] = [root];
  for (const token of tokens) {
    const top = stack.at(-1)!;
    if (token.kind === 'text') { top.children.push(token.text); continue; }
    if (token.kind === 'close') {
      // The nearest open element of that name closes, with everything inside it; a stray end tag is ignored.
      for (let depth = stack.length - 1; depth > 0; depth--) if (stack[depth]!.name === token.name) { stack.length = depth; break; }
      continue;
    }
    const implied = IMPLIED[token.name];
    if (implied) {
      for (let depth = stack.length - 1; depth > 0; depth--) {
        const name = stack[depth]!.name;
        if (implied.includes(name)) { stack.length = depth; break; }
        if (SCOPE.has(name)) break;
      }
    }
    const element: Element = {name: token.name, attributes: token.attributes, children: []};
    stack.at(-1)!.children.push(element);
    // Past the depth bound an element keeps its place but not its own level: what follows is its sibling.
    if (!VOID.has(token.name) && !token.self && stack.length < MAX_DEPTH) stack.push(element);
  }
  return root;
}

// ---- Inline -------------------------------------------------------------------------------------------------------

/** Decoded text as the inline parser reads it literally: Markdown punctuation escaped, `&` and `<` as references. */
function escapeText(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/[\\`*_~[\]!]/gu, char => `\\${char}`).replace(/</gu, '&lt;');
}
const escapeAttribute = (value: string) => value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

/** All text inside, as written (for code and preformatted text). */
function textContent(nodes: readonly Node[]): string {
  let out = '';
  const walk = (list: readonly Node[]) => {
    for (const node of list) {
      if (typeof node === 'string') out += node;
      else if (node.name === 'br') out += '\n';
      else if (!DROPPED.has(node.name)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

const STRONG = new Set(['b', 'strong']);
const EMPHASIS = new Set(['i', 'em', 'cite', 'dfn', 'var']);
const STRIKE = new Set(['s', 'del', 'strike']);
const CODE = new Set(['code', 'kbd', 'samp', 'tt']);

/** Inline content as normalised inline HTML: whitespace collapsed, text escaped, only tags the inline parser reads. */
function inlineText(nodes: readonly Node[]): string {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') { out += escapeText(decodeEntities(node).replace(/\s+/gu, ' ')); continue; }
    const name = node.name;
    if (DROPPED.has(name)) continue;
    if (name === 'br') out += ' ';
    else if (name === 'img') out += `<img alt="${escapeAttribute(imageLabel(node.attributes))}">`;
    else if (name === 'input') out += node.attributes.type?.toLowerCase() === 'checkbox' ? ('checked' in node.attributes ? '☑ ' : '☐ ') : '';
    else if (CODE.has(name)) out += `<code>${escapeAttribute(decodeEntities(textContent(node.children)).replace(/\s+/gu, ' '))}</code>`;
    else if (STRONG.has(name)) out += `<b>${inlineText(node.children)}</b>`;
    else if (EMPHASIS.has(name)) out += `<i>${inlineText(node.children)}</i>`;
    else if (STRIKE.has(name)) out += `<s>${inlineText(node.children)}</s>`;
    else if (name === 'a' && node.attributes.href) out += `<a href="${escapeAttribute(decodeEntities(node.attributes.href).trim())}">${inlineText(node.children)}</a>`;
    else if (BLOCK.has(name)) out += ` ${inlineText(node.children)} `;
    else out += inlineText(node.children);
  }
  return out;
}

const clean = (text: string) => text.replace(/ {2,}/gu, ' ').trim();

// ---- Blocks -------------------------------------------------------------------------------------------------------

function blocksOf(nodes: readonly Node[]): Block[] {
  const out: Block[] = [];
  let inline: Node[] = [];
  const flush = () => {
    const text = clean(inlineText(inline));
    if (text) out.push({kind: 'paragraph', text});
    inline = [];
  };
  for (const node of nodes) {
    if (typeof node !== 'string' && DROPPED.has(node.name)) continue;
    if (typeof node !== 'string' && BLOCK.has(node.name)) { flush(); out.push(...blockOf(node)); }
    else inline.push(node);
  }
  flush();
  return out;
}

function blockOf(element: Element): Block[] {
  const name = element.name;
  const heading = /^h([1-6])$/u.exec(name);
  if (heading) {
    const text = clean(inlineText(element.children));
    return text ? [{kind: 'heading', level: Number(heading[1]), text}] : [];
  }
  switch (name) {
    case 'hr': return [{kind: 'rule'}];
    case 'pre': return [preformatted(element)];
    case 'blockquote': return [{kind: 'quote', blocks: blocksOf(element.children)}];
    case 'ul': case 'ol': case 'menu': case 'dir': return [list(element)];
    case 'table': return table(element);
    case 'summary': case 'dt': case 'caption': case 'legend': {
      const text = clean(inlineText(element.children));
      return text ? [{kind: 'paragraph', text: `<b>${text}</b>`}] : [];
    }
    default: return blocksOf(element.children);
  }
}

function preformatted(element: Element): Block {
  const code = element.children.find((node): node is Element => typeof node !== 'string' && node.name === 'code');
  const classes = `${code?.attributes.class ?? ''} ${element.attributes.class ?? ''}`;
  const language = /(?:^|\s)(?:language|lang)-([\w+#.-]{1,40})/u.exec(classes)?.[1]?.toLowerCase();
  const lines = decodeEntities(textContent(element.children)).replace(/\r\n?/gu, '\n').replace(/^\n/u, '').split('\n');
  while (lines.length > 1 && !lines.at(-1)!.trim()) lines.pop();
  return {kind: 'code', ...(language ? {language} : {}), lines, closed: true};
}

function list(element: Element): Block {
  const ordered = element.name === 'ol';
  const start = Math.min(1_000_000_000, Math.max(0, Number.parseInt(element.attributes.start ?? '1', 10) || 1));
  const items: ListItem[] = [];
  for (const node of element.children) {
    if (typeof node === 'string') {
      if (node.trim()) items.push({blocks: [{kind: 'paragraph', text: clean(escapeText(decodeEntities(node).replace(/\s+/gu, ' ')))}]});
      continue;
    }
    if (node.name === 'li') items.push(item(node));
    // A list written straight inside a list belongs to the item before it.
    else if ((node.name === 'ul' || node.name === 'ol') && items.length) items.at(-1)!.blocks.push(list(node));
    else if (!DROPPED.has(node.name)) items.push({blocks: blocksOf([node])});
  }
  return {kind: 'list', ordered, start, loose: false, items: items.map((entry, index) => ordered ? {...entry, number: start + index} : entry)};
}

function item(element: Element): ListItem {
  const children = [...element.children];
  // A check box first in the item makes it a task: shown as the renderer's task marker, never as a control.
  const first = children.findIndex(node => typeof node !== 'string' || node.trim());
  const box = children[first];
  let task: ListItem['task'];
  if (box && typeof box !== 'string' && box.name === 'input' && box.attributes.type?.toLowerCase() === 'checkbox') {
    task = 'checked' in box.attributes ? 'done' : 'open';
    children.splice(first, 1);
  }
  return {...(task ? {task} : {}), blocks: blocksOf(children)};
}

function table(element: Element): Block[] {
  const rows: Array<Array<{text: string; header: boolean; align?: Alignment}>> = [];
  const before: Block[] = [];
  const collect = (nodes: readonly Node[]) => {
    for (const node of nodes) {
      if (typeof node === 'string') continue;
      if (node.name === 'caption') before.push(...blockOf(node));
      else if (node.name === 'thead' || node.name === 'tbody' || node.name === 'tfoot') collect(node.children);
      else if (node.name === 'tr') {
        const cells = node.children.filter((cell): cell is Element => typeof cell !== 'string' && (cell.name === 'td' || cell.name === 'th')).slice(0, MAX_COLUMNS);
        if (cells.length) rows.push(cells.map(cell => ({text: clean(inlineText(cell.children)), header: cell.name === 'th', align: alignment(cell.attributes.align)})));
      }
    }
  };
  collect(element.children);
  if (!rows.length) return before;
  const width = Math.max(...rows.map(row => row.length));
  const pad = (row: ReadonlyArray<{text: string}>) => Array.from({length: width}, (_, column) => row[column]?.text ?? '');
  const [header, ...body] = rows;
  return [...before, {kind: 'table', align: Array.from({length: width}, (_, column) => header![column]?.align), header: pad(header!), rows: body.map(pad)}];
}

function alignment(value: string | undefined): Alignment {
  const align = value?.trim().toLowerCase();
  return align === 'left' || align === 'center' || align === 'right' ? align : undefined;
}

/** HTML (a document, or a block inside Markdown) as blocks; its inline text is for the inline parser in HTML mode. */
export function htmlToBlocks(source: string): Block[] {
  return blocksOf(build(tokenize(source)).children);
}
