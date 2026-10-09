import {safeHyperlinkTarget} from '../output/Hyperlinks.js';

/**
 * Inline Markdown for untrusted text (agent replies, GitHub bodies): code spans, emphasis, strong, strikethrough,
 * links, images and autolinks. The input is display-safe already (terminal controls scrubbed by the caller); this
 * module only decides styling. A link target is kept only when it is a safe http(s) URL, so a hostile
 * `[docs](javascript:...)` or `[x](file:///...)` renders as plain text. Parsing is linear and bounded: a span's
 * delimiters never nest more than a few levels and unmatched delimiters stay literal text.
 */

export interface InlineStyle {
  code?: boolean;
  strong?: boolean;
  em?: boolean;
  strike?: boolean;
  /** A safe http(s) target; present only on link text. */
  link?: string;
  /** Text of an image (its alt text): shown, never fetched. */
  image?: boolean;
}

export interface InlineSpan {
  text: string;
  style: InlineStyle;
}

const PUNCTUATION = /[!-/:-@[-`{-~\p{P}]/u;
const WHITESPACE = /\s/u;
const ALNUM = /[\p{L}\p{N}]/u;
/** Bound on scanned characters per inline run: longer paragraphs still render, only as fewer styled spans. */
const MAX_INLINE = 64 * 1024;

/** Untrusted text links only to the web: http(s) with a host, never file, data, javascript or custom schemes. */
function safeLink(url: string): string | undefined {
  const target = safeHyperlinkTarget(url);
  return target && /^https?:/u.test(target) ? target : undefined;
}

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', mdash: '—', ndash: '–', hellip: '…', rarr: '→', larr: '←', times: '×'};

function decodeEntity(source: string, index: number): {text: string; length: number} | undefined {
  const match = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/u.exec(source.slice(index, index + 12));
  if (!match) return undefined;
  if (match[3]) { const named = ENTITIES[match[3]]; return named ? {text: named, length: match[0].length} : undefined; }
  const code = match[1] ? Number(match[1]) : parseInt(match[2]!, 16);
  // Controls and surrogates never come back through an entity.
  if (!code || code < 0x20 || (code >= 0x7f && code < 0xa0) || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return undefined;
  return {text: String.fromCodePoint(code), length: match[0].length};
}

/** Raw tokens before emphasis resolution: literal text, finished spans (code, links) and delimiter runs. */
type Token =
  | {kind: 'text'; text: string}
  | {kind: 'span'; span: InlineSpan[]}
  | {kind: 'delim'; char: '*' | '_' | '~'; count: number; open: boolean; close: boolean};

/** The text of a bracket pair starting at `start` (`[`), honoring one level of nested brackets and escapes. */
function bracket(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length && index < start + 2000; index++) {
    const char = source[index];
    if (char === '\\') { index++; continue; }
    if (char === '`') { const end = source.indexOf('`', index + 1); if (end > 0) index = end; continue; }
    if (char === '[') depth++;
    else if (char === ']') { depth--; if (depth === 0) return index; }
  }
  return -1;
}

/** `(url "title")` after a bracket: the URL and where the destination ends. */
function destination(source: string, open: number): {url: string; end: number} | undefined {
  if (source[open] !== '(') return undefined;
  let index = open + 1;
  while (source[index] === ' ') index++;
  let url = '';
  if (source[index] === '<') {
    const close = source.indexOf('>', index);
    if (close < 0) return undefined;
    url = source.slice(index + 1, close);
    index = close + 1;
  } else {
    let depth = 0;
    for (; index < source.length && index < open + 4096; index++) {
      const char = source[index]!;
      if (char === '\\' && index + 1 < source.length) { url += source[++index]; continue; }
      if (char === '(') depth++;
      else if (char === ')') { if (depth === 0) break; depth--; }
      else if (WHITESPACE.test(char)) break;
      url += char;
    }
  }
  while (source[index] === ' ') index++;
  if (source[index] === '"' || source[index] === "'") {
    const quote = source[index]!;
    const close = source.indexOf(quote, index + 1);
    if (close < 0) return undefined;
    index = close + 1;
    while (source[index] === ' ') index++;
  }
  if (source[index] !== ')') return undefined;
  return {url, end: index + 1};
}

/** A trailing-punctuation-trimmed bare URL (GFM autolink literal), or undefined. */
function bareUrl(source: string, index: number): string | undefined {
  if (!/^https?:\/\//iu.test(source.slice(index, index + 8))) return undefined;
  const before = source[index - 1];
  if (before && ALNUM.test(before)) return undefined;
  let end = index;
  while (end < source.length && end < index + 2048 && !WHITESPACE.test(source[end]!) && source[end] !== '<') end++;
  let url = source.slice(index, end);
  // Trailing punctuation belongs to the sentence; a closing parenthesis only when unbalanced.
  for (;;) {
    const last = url.at(-1);
    if (!last) break;
    if ('.,:;!?*_~\'"'.includes(last)) { url = url.slice(0, -1); continue; }
    if (last === ')' && (url.match(/\(/gu)?.length ?? 0) < (url.match(/\)/gu)?.length ?? 0)) { url = url.slice(0, -1); continue; }
    break;
  }
  return url.length > 8 ? url : undefined;
}

function flanking(source: string, start: number, length: number, char: string): {open: boolean; close: boolean} {
  const before = start > 0 ? source[start - 1]! : ' ';
  const after = start + length < source.length ? source[start + length]! : ' ';
  const beforeSpace = WHITESPACE.test(before), afterSpace = WHITESPACE.test(after);
  const beforePunct = PUNCTUATION.test(before), afterPunct = PUNCTUATION.test(after);
  const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
  const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
  if (char === '_') {
    // Intraword underscores (snake_case) never emphasize.
    return {open: left && (!right || beforePunct), close: right && (!left || afterPunct)};
  }
  return {open: left, close: right};
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let text = '';
  const flush = () => { if (text) { tokens.push({kind: 'text', text}); text = ''; } };
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (char === '\\' && index + 1 < source.length && PUNCTUATION.test(source[index + 1]!)) { text += source[index + 1]; index += 2; continue; }
    if (char === '&') {
      const entity = decodeEntity(source, index);
      if (entity) { text += entity.text; index += entity.length; continue; }
    }
    if (char === '`') {
      let run = 1;
      while (source[index + run] === '`') run++;
      const fence = '`'.repeat(run);
      let close = source.indexOf(fence, index + run);
      // The closing run must be exactly as long as the opening one.
      while (close >= 0 && source[close + run] === '`') { let skip = close; while (source[skip] === '`') skip++; close = source.indexOf(fence, skip); }
      if (close >= 0) {
        flush();
        let code = source.slice(index + run, close).replace(/\n/gu, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        tokens.push({kind: 'span', span: [{text: code, style: {code: true}}]});
        index = close + run;
        continue;
      }
      text += fence; index += run; continue;
    }
    if (char === '<') {
      const auto = /^<(https?:\/\/[^\s<>]{1,2000})>/iu.exec(source.slice(index, index + 2100));
      if (auto) {
        flush();
        const url = safeLink(auto[1]!);
        tokens.push({kind: 'span', span: [{text: auto[1]!, style: url ? {link: url} : {}}]});
        index += auto[0].length;
        continue;
      }
    }
    if (char === '!' && source[index + 1] === '[' || char === '[') {
      const image = char === '!';
      const open = image ? index + 1 : index;
      const close = bracket(source, open);
      const target = close > 0 ? destination(source, close + 1) : undefined;
      if (close > 0 && target) {
        flush();
        const label = source.slice(open + 1, close);
        const url = safeLink(target.url);
        if (image) tokens.push({kind: 'span', span: [{text: label.trim() || 'image', style: {image: true}}]});
        else {
          const inner = parseInline(label).map(span => ({text: span.text, style: {...span.style, ...(url && !span.style.code ? {link: url} : {})}}));
          // A link whose target was refused still shows its text, and the refused target as text so nothing is hidden.
          tokens.push({kind: 'span', span: url ? inner : [...inner, ...(target.url ? [{text: ` (${target.url.slice(0, 200)})`, style: {}}] : [])]});
        }
        index = target.end;
        continue;
      }
    }
    if (char === 'h' || char === 'H') {
      const url = bareUrl(source, index);
      if (url) {
        flush();
        const safe = safeLink(url);
        tokens.push({kind: 'span', span: [{text: url, style: safe ? {link: safe} : {}}]});
        index += url.length;
        continue;
      }
    }
    if (char === '*' || char === '_' || char === '~') {
      let run = 1;
      while (source[index + run] === char && run < 64) run++;
      if (char === '~' && run !== 2) { text += char.repeat(run); index += run; continue; }
      flush();
      const {open, close} = flanking(source, index, run, char);
      tokens.push({kind: 'delim', char, count: run, open, close});
      index += run;
      continue;
    }
    text += char; index++;
  }
  flush();
  return tokens;
}

/**
 * Resolve emphasis with a simplified CommonMark delimiter stack: a closer pairs with the nearest compatible opener of
 * the same character; two or more on both sides make strong, `~~` makes strikethrough. Unpaired delimiters become text.
 */
function resolve(tokens: Token[]): InlineSpan[] {
  type Delim = {kind: 'delim'; char: '*' | '_' | '~'; count: number; length: number; open: boolean; close: boolean};
  type Node = {kind: 'text'; text: string} | {kind: 'span'; span: InlineSpan[]} | Delim;
  const nodes: Node[] = tokens.map(token => token.kind === 'delim' ? {...token, length: token.count} : token);
  type Wrap = {from: number; to: number; style: 'strong' | 'em' | 'strike'};
  const wraps: Wrap[] = [];
  /** Positions of delimiter runs that may still open. */
  const openers: number[] = [];
  for (let position = 0; position < nodes.length; position++) {
    const node = nodes[position]!;
    if (node.kind !== 'delim') continue;
    let matched = node.close;
    while (matched && node.count > 0) {
      matched = false;
      for (let depth = openers.length - 1; depth >= 0; depth--) {
        const opener = nodes[openers[depth]!] as Delim;
        if (opener.char !== node.char || opener.count === 0) continue;
        if (node.char === '~' && (opener.count < 2 || node.count < 2)) continue;
        // The "rule of three": runs that can both open and close do not pair when their lengths sum to a multiple of three.
        if (node.char !== '~' && (opener.close || node.open) && (opener.length + node.length) % 3 === 0 && !(opener.length % 3 === 0 && node.length % 3 === 0)) continue;
        const used = node.char === '~' || (opener.count >= 2 && node.count >= 2) ? 2 : 1;
        wraps.push({from: openers[depth]!, to: position, style: node.char === '~' ? 'strike' : used === 2 ? 'strong' : 'em'});
        opener.count -= used; node.count -= used;
        // Delimiters between the pair can no longer match; an exhausted opener leaves too.
        openers.length = opener.count > 0 ? depth + 1 : depth;
        matched = true;
        break;
      }
    }
    if (node.open && node.count > 0) openers.push(position);
  }
  const spans: InlineSpan[] = [];
  const active = {strong: 0, em: 0, strike: 0};
  for (let position = 0; position < nodes.length; position++) {
    // Leftover delimiter characters sit outside their pair: close before the closer, open after the opener.
    for (const wrap of wraps) if (wrap.to === position) active[wrap.style]--;
    const node = nodes[position]!;
    const style: InlineStyle = {...(active.strong > 0 ? {strong: true} : {}), ...(active.em > 0 ? {em: true} : {}), ...(active.strike > 0 ? {strike: true} : {})};
    if (node.kind === 'text') spans.push({text: node.text, style});
    else if (node.kind === 'span') for (const span of node.span) spans.push({text: span.text, style: {...style, ...span.style}});
    else if (node.count > 0) spans.push({text: node.char.repeat(node.count), style});
    for (const wrap of wraps) if (wrap.from === position) active[wrap.style]++;
  }
  // Merge neighbours with identical styling so wrapping sees whole words.
  const merged: InlineSpan[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && JSON.stringify(last.style) === JSON.stringify(span.style)) last.text += span.text;
    else if (span.text) merged.push({...span});
  }
  return merged;
}

/** Inline spans for one paragraph's source text. Soft line breaks become spaces; text past the bound stays plain. */
export function parseInline(source: string): InlineSpan[] {
  const bounded = source.length > MAX_INLINE ? source.slice(0, MAX_INLINE) : source;
  const spans = resolve(tokenize(bounded.replace(/[ \t]*\n[ \t]*/gu, ' ')));
  if (bounded.length < source.length) spans.push({text: source.slice(MAX_INLINE).replace(/\s*\n\s*/gu, ' '), style: {}});
  return spans;
}

/** The text a reader sees, without styling (search, copy-visible, width measurement). */
export function plainInline(source: string): string {
  return parseInline(source).map(span => span.text).join('');
}
