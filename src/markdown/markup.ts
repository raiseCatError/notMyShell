/**
 * The pieces of HTML that `/view` reads (QA F01): character references and single tags, read by bounded linear scans.
 * Nothing here builds a document, resolves a URL, loads a resource or runs anything. Shared by the HTML converter
 * (html.ts) and the inline parser, which reads the same tags inside Markdown.
 */

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', mdash: '—', ndash: '–', hellip: '…', rarr: '→', larr: '←', times: '×'};

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}]/u;

/** One character reference at `index`, or undefined. */
export function decodeEntity(source: string, index: number): {text: string; length: number} | undefined {
  const match = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/u.exec(source.slice(index, index + 12));
  if (!match) return undefined;
  if (match[3]) { const named = ENTITIES[match[3]]; return named ? {text: named, length: match[0].length} : undefined; }
  const code = match[1] ? Number(match[1]) : parseInt(match[2]!, 16);
  if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return undefined;
  const text = String.fromCodePoint(code);
  // An entity never smuggles in what the display scrubber removes: controls, bidi and other format characters
  // (direction overrides, zero-width joiners), separators or private-use code points.
  if (INVISIBLE.test(text)) return undefined;
  return {text, length: match[0].length};
}

/** Every character reference in `text` decoded (unknown or unsafe ones stay as written). */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  let out = '';
  for (let index = 0; index < text.length;) {
    const entity = text[index] === '&' ? decodeEntity(text, index) : undefined;
    if (entity) { out += entity.text; index += entity.length; } else { out += text[index]; index += 1; }
  }
  return out;
}

/** How far one tag may run, and how much of an attribute value is kept. */
const MAX_TAG = 4096;
const MAX_ATTRIBUTE = 2048;

export interface Tag {
  /** Lowercase element name. */
  name: string;
  closing: boolean;
  selfClosing: boolean;
  /** Lowercase attribute names; raw values (references not decoded), each at most MAX_ATTRIBUTE characters. */
  attributes: Record<string, string>;
  /** Index just past the tag's `>`. */
  end: number;
}

const NAME_START = /[A-Za-z]/u;
const NAME = /[A-Za-z0-9-]/u;
const SPACE = /[\s]/u;

/** The tag starting at `start` (a `<`), or undefined when it is not one (then the `<` is text). */
export function readTag(source: string, start: number): Tag | undefined {
  const limit = Math.min(source.length, start + MAX_TAG);
  let index = start + 1;
  const closing = source[index] === '/';
  if (closing) index += 1;
  if (!NAME_START.test(source[index] ?? '')) return undefined;
  const nameStart = index;
  while (index < limit && NAME.test(source[index]!) && index - nameStart < 32) index += 1;
  const name = source.slice(nameStart, index).toLowerCase();
  if (index < limit && !SPACE.test(source[index]!) && source[index] !== '>' && source[index] !== '/') return undefined;
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
  let count = 0;
  while (index < limit) {
    while (index < limit && SPACE.test(source[index]!)) index += 1;
    const char = source[index];
    if (char === '>') return {name, closing, selfClosing: false, attributes, end: index + 1};
    if (char === '/' && source[index + 1] === '>') return {name, closing, selfClosing: true, attributes, end: index + 2};
    if (char === '/') { index += 1; continue; }
    if (char === undefined || char === '<') return undefined;
    const keyStart = index;
    while (index < limit && !SPACE.test(source[index]!) && !'"\'>/=<'.includes(source[index]!)) index += 1;
    const key = source.slice(keyStart, Math.min(index, keyStart + 64)).toLowerCase();
    if (index === keyStart) { index += 1; continue; }
    while (index < limit && SPACE.test(source[index]!)) index += 1;
    let value = '';
    if (source[index] === '=') {
      index += 1;
      while (index < limit && SPACE.test(source[index]!)) index += 1;
      const quote = source[index];
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, index + 1);
        if (close < 0 || close >= limit) return undefined;
        value = source.slice(index + 1, close);
        index = close + 1;
      } else {
        const valueStart = index;
        while (index < limit && !SPACE.test(source[index]!) && source[index] !== '>') index += 1;
        value = source.slice(valueStart, index);
      }
    }
    // Only the first of a repeated attribute counts, and a hostile tag cannot make the record unbounded.
    if (!(key in attributes) && count < 64) { attributes[key] = value.slice(0, MAX_ATTRIBUTE); count += 1; }
  }
  return undefined;
}

/** Elements with no content or end tag. */
export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * Elements dropped with everything in them: code (script), styling (style), templates and fallbacks for scripts,
 * embedded or interactive content, and the document's metadata. None of it is shown, loaded or run.
 */
export const DROPPED = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'applet', 'svg', 'math', 'canvas', 'audio', 'video',
  'form', 'button', 'select', 'textarea', 'option', 'optgroup', 'datalist', 'head', 'title', 'meta', 'link', 'base', 'frame', 'frameset', 'noframes', 'dialog',
  'map', 'portal', 'xmp', 'plaintext', 'noembed', 'slot']);

/** Elements whose content is raw text up to their end tag: never read as markup (all of them are dropped). */
export const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'plaintext', 'noscript', 'iframe', 'noembed', 'noframes', 'template']);

/** Block-level elements (CommonMark's HTML block names, and a few more containers). */
export const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'colgroup', 'dd', 'details', 'dir', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html', 'legend', 'li', 'main', 'menu', 'nav', 'ol',
  'p', 'pre', 'search', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);

/** Inline elements read for their meaning (emphasis, code, links, images, breaks) or just for their text. */
export const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'big', 'br', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'img', 'input', 'ins', 'kbd',
  'label', 'mark', 'picture', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'source', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'wbr', 'col', 'track', 'param', 'area', 'keygen']);

/** Names NMSh reads as HTML at all; any other `<word>` stays text (`a generic <T>`). */
export const KNOWN = new Set([...VOID, ...DROPPED, ...RAW_TEXT, ...BLOCK, ...INLINE]);

/** An image's words: its alt text, else its file name, else "image". */
export function imageLabel(attributes: Record<string, string>): string {
  const alt = decodeEntities(attributes.alt ?? '').replace(/\s+/gu, ' ').trim();
  if (alt) return alt.slice(0, 300);
  const name = decodeEntities(attributes.src ?? '').split(/[?#]/u)[0]!.split('/').filter(Boolean).pop() ?? '';
  return name.slice(0, 120) || 'image';
}
