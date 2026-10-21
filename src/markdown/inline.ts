import {safeHyperlinkTarget} from '../output/Hyperlinks.js';
import {renderMath} from './math.js';
import {decodeEntities, decodeEntity, DROPPED, imageLabel, KNOWN, RAW_TEXT, readTag} from './markup.js';

/**
 * Inline Markdown for untrusted text (agent replies, GitHub bodies): code spans, emphasis, strong, strikethrough,
 * links, images and autolinks. The input is display-safe already (terminal controls scrubbed by the caller); this
 * module only decides styling. A link target is kept only when it is a safe http(s) URL, so a hostile
 * `[docs](javascript:...)` or `[x](file:///...)` renders as plain text. Parsing is linear and bounded: a span's
 * delimiters never nest more than a few levels and unmatched delimiters stay literal text.
 *
 * With `html` (what `/view` shows, QA F01) a few HTML tags are read too: b/strong, i/em, s/del, code/kbd, a (the same
 * http(s)-only rule), img (its alt text), br, and script-like elements dropped with their content; any other known
 * element's tags are dropped and its text kept, and an unknown `<word>` stays text. Without it, tags are text.
 */

export interface InlineStyle {
  code?: boolean;
  strong?: boolean;
  em?: boolean;
  strike?: boolean;
  /** A safe http(s) target; present only on link text. */
  link?: string;
  /** Rendered inline mathematics (`$…$`): the text is the formula as one row of Unicode. */
  math?: boolean;
  /** Text of an image (its alt text): shown, never fetched. */
  image?: boolean;
  /** The image's source reference as written (bounded). Never fetched here: the graphics service decides what may be read. */
  src?: string;
}

export interface InlineSpan {
  text: string;
  style: InlineStyle;
}

const PUNCTUATION = /[!-/:-@[-`{-~\p{P}]/u;
const WHITESPACE = /\s/u;
const ALNUM = /[\p{L}\p{N}]/u;
/** How far back a closing delimiter looks for its opener. */
const MAX_OPENERS = 64;
/** Bound on scanned characters per inline run: longer paragraphs still render, only as fewer styled spans. */
const MAX_INLINE = 64 * 1024;

/** Untrusted text links only to the web: http(s) with a host, never file, data, javascript or custom schemes. */
function safeLink(url: string): string | undefined {
  const target = safeHyperlinkTarget(url);
  return target && /^https?:/u.test(target) ? target : undefined;
}

export interface InlineOptions {
  /** Read the HTML tags `/view` renders (see the module comment); otherwise tags are text. */
  html?: boolean;
  /** Read `$…$` as mathematics (documents only): `ascii` draws it without box and bracket pieces. */
  math?: {ascii: boolean};
}

/** Raw tokens before emphasis resolution: literal text, finished spans (code, links) and delimiter runs. */
type Token =
  | {kind: 'text'; text: string}
  | {kind: 'span'; span: InlineSpan[]}
  | {kind: 'delim'; char: '*' | '_' | '~'; count: number; open: boolean; close: boolean}
  /** An HTML start or end tag that styles what is between (html mode); `target` is a link's refused URL, shown as text. */
  | {kind: 'tag'; style: 'strong' | 'em' | 'strike' | 'link'; open: boolean; link?: string; target?: string};

const TAG_STYLES: Record<string, 'strong' | 'em' | 'strike' | 'link'> = {b: 'strong', strong: 'strong', i: 'em', em: 'em', cite: 'em', dfn: 'em', var: 'em',
  s: 'strike', del: 'strike', strike: 'strike', a: 'link'};
const CODE_TAGS = new Set(['code', 'kbd', 'samp', 'tt']);

/** The text of a bracket pair starting at `start` (`[`), honoring one level of nested brackets and escapes. */
function bracket(source: string, start: number): number {
  let depth = 0;
  const limit = Math.min(source.length, start + 1000);
  for (let index = start; index < limit; index++) {
    const char = source[index];
    if (char === '\\') { index++; continue; }
    if (char === '`') {
      // A code span inside link text may contain brackets; search for its end only inside this bounded window.
      let end = index + 1;
      while (end < limit && source[end] !== '`') end++;
      if (end < limit) index = end;
      continue;
    }
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

/** Every backtick run's start, grouped by run length, for linear code-span matching. */
function backtickRuns(source: string): Map<number, number[]> {
  const runs = new Map<number, number[]>();
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== '`' || source[index - 1] === '`') continue;
    let end = index;
    while (source[end] === '`') end++;
    const list = runs.get(end - index) ?? [];
    list.push(index);
    runs.set(end - index, list);
  }
  return runs;
}

function tokenize(source: string, options: InlineOptions): Token[] {
  const tokens: Token[] = [];
  const closes = options.html ? closingTags(source) : () => -1;
  const runs = backtickRuns(source);
  /** Per run length, how many runs are already behind the scan position. */
  const consumed = new Map<number, number>();
  const closingRun = (length: number, after: number): number => {
    const list = runs.get(length);
    if (!list) return -1;
    let at = consumed.get(length) ?? 0;
    while (at < list.length && list[at]! < after) at++;
    consumed.set(length, at);
    return at < list.length ? list[at]! : -1;
  };
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
      // The closing run must be exactly as long as the opening one.
      const close = closingRun(run, index + run);
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
    if (char === '$' && options.math) {
      // GitHub's rules: `$x$` needs a non-space after the opener and before the closer, and the closer must not be followed by a digit
      // (so prices are not formulas); `$$x$$` may sit inside a paragraph too. A formula that cannot be drawn stays as written.
      const run = source[index + 1] === '$' ? 2 : 1;
      const open = index + run;
      let close = -1;
      if (open < source.length && !/\s/u.test(source[open]!)) {
        for (let at = open; at < Math.min(source.length, open + 1000); at += 1) {
          if (source[at] === '\\') { at += 1; continue; }
          if (source[at] === '$' && (run === 1 || source[at + 1] === '$')) { close = at; break; }
        }
      }
      if (close > open && !/\s/u.test(source[close - 1]!) && !(run === 1 && /[0-9]/u.test(source[close + 1] ?? ''))) {
        const result = renderMath(source.slice(open, close), {display: false, ascii: options.math.ascii});
        const end = close + run;
        if (result.ok) { flush(); tokens.push({kind: 'span', span: [{text: result.rows[0]!, style: {math: true}}]}); }
        else text += source.slice(index, end);
        index = end;
        continue;
      }
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
      const tag = options.html ? readTag(source, index) : undefined;
      if (tag && KNOWN.has(tag.name)) {
        flush();
        index = htmlTag(tag, source, closes, tokens);
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
        if (image) tokens.push({kind: 'span', span: [{text: label.trim() || 'image', style: {image: true, ...(target.url ? {src: target.url.slice(0, 2000)} : {})}}]});
        else {
          const inner = parseInline(label, options).map(span => ({text: span.text, style: {...span.style, ...(url && !span.style.code ? {link: url} : {})}}));
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
 * Where `</name` next appears at or after a position. Searches only move forward and each answer is remembered, so a
 * run of unclosed tags (`<code>` after `<code>`) stays linear.
 */
function closingTags(source: string): (name: string, from: number) => number {
  const lower = source.toLowerCase();
  const found = new Map<string, number>();
  return (name, from) => {
    const known = found.get(name);
    if (known !== undefined && (known < 0 || known >= from)) return known;
    const at = lower.indexOf(`</${name}`, from);
    found.set(name, at);
    return at;
  };
}

/** One HTML tag in html mode: its tokens, and where reading goes on. */
function htmlTag(tag: NonNullable<ReturnType<typeof readTag>>, source: string, closes: (name: string, from: number) => number, tokens: Token[]): number {
  const name = tag.name;
  // An element dropped with its content (a script, a style, a form control) leaves nothing, up to its end tag.
  if (!tag.closing && !tag.selfClosing && (DROPPED.has(name) || RAW_TEXT.has(name))) {
    const close = closes(name, tag.end);
    const end = close < 0 ? -1 : source.indexOf('>', close);
    return end < 0 ? source.length : end + 1;
  }
  if (tag.closing) {
    const style = TAG_STYLES[name];
    if (style) tokens.push({kind: 'tag', style, open: false});
    return tag.end;
  }
  if (name === 'br') { tokens.push({kind: 'text', text: ' '}); return tag.end; }
  if (name === 'img') { const src = decodeEntities(tag.attributes.src ?? '').trim().slice(0, 2000); tokens.push({kind: 'span', span: [{text: imageLabel(tag.attributes), style: {image: true, ...(src ? {src} : {})}}]}); return tag.end; }
  if (name === 'input' && tag.attributes.type?.toLowerCase() === 'checkbox') { tokens.push({kind: 'text', text: 'checked' in tag.attributes ? '☑ ' : '☐ '}); return tag.end; }
  if (CODE_TAGS.has(name) && !tag.selfClosing) {
    // Code is literal: its text up to the end tag, any markup inside dropped, references decoded (safely).
    const close = closes(name, tag.end);
    if (close < 0) return tag.end;
    const end = source.indexOf('>', close);
    const code = decodeEntities(source.slice(tag.end, close).replace(/<[^<>]{0,200}>/gu, '')).replace(/\s+/gu, ' ');
    if (code) tokens.push({kind: 'span', span: [{text: code, style: {code: true}}]});
    return end < 0 ? source.length : end + 1;
  }
  const style = TAG_STYLES[name];
  if (style === 'link') {
    const target = decodeEntities(tag.attributes.href ?? '').trim();
    const link = target ? safeLink(target) : undefined;
    tokens.push({kind: 'tag', style, open: true, ...(link ? {link} : {}), ...(!link && target ? {target: target.slice(0, 200)} : {})});
  } else if (style) tokens.push({kind: 'tag', style, open: true});
  // Any other known element: its tags go, its text stays.
  return tag.end;
}

/**
 * Resolve emphasis with a simplified CommonMark delimiter stack: a closer pairs with the nearest compatible opener of
 * the same character; two or more on both sides make strong, `~~` makes strikethrough. Unpaired delimiters become text.
 */
function resolve(tokens: Token[]): InlineSpan[] {
  type Delim = {kind: 'delim'; char: '*' | '_' | '~'; count: number; length: number; open: boolean; close: boolean};
  type Node = Exclude<Token, {kind: 'delim'}> | Delim;
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
      // Emphasis pairs nearby delimiters; a bounded look-back keeps hostile delimiter floods linear.
      for (let depth = openers.length - 1; depth >= Math.max(0, openers.length - MAX_OPENERS); depth--) {
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
  // HTML tags (html mode) style what they enclose; links nest, the innermost wins.
  const tagged = {strong: 0, em: 0, strike: 0};
  const links: Array<{link?: string; target?: string}> = [];
  const starting = new Map<number, Wrap[]>(), ending = new Map<number, Wrap[]>();
  for (const wrap of wraps) {
    starting.set(wrap.from, [...(starting.get(wrap.from) ?? []), wrap]);
    ending.set(wrap.to, [...(ending.get(wrap.to) ?? []), wrap]);
  }
  for (let position = 0; position < nodes.length; position++) {
    // Leftover delimiter characters sit outside their pair: close before the closer, open after the opener.
    for (const wrap of ending.get(position) ?? []) active[wrap.style]--;
    const node = nodes[position]!;
    if (node.kind === 'tag') {
      if (node.style === 'link') {
        if (node.open) links.push({...(node.link ? {link: node.link} : {}), ...(node.target ? {target: node.target} : {})});
        else {
          const closed = links.pop();
          // A link whose target was refused still shows its text, and the refused target as text so nothing is hidden.
          if (closed?.target) spans.push({text: ` (${closed.target})`, style: {}});
        }
      } else if (node.open) tagged[node.style]++;
      else if (tagged[node.style] > 0) tagged[node.style]--;
      continue;
    }
    const link = links.at(-1)?.link;
    const style: InlineStyle = {...(active.strong + tagged.strong > 0 ? {strong: true} : {}), ...(active.em + tagged.em > 0 ? {em: true} : {}),
      ...(active.strike + tagged.strike > 0 ? {strike: true} : {}), ...(link ? {link} : {})};
    if (node.kind === 'text') spans.push({text: node.text, style});
    else if (node.kind === 'span') for (const span of node.span) spans.push({text: span.text, style: {...style, ...span.style}});
    else if (node.count > 0) spans.push({text: node.char.repeat(node.count), style});
    for (const wrap of starting.get(position) ?? []) active[wrap.style]++;
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
export function parseInline(source: string, options: InlineOptions = {}): InlineSpan[] {
  const bounded = source.length > MAX_INLINE ? source.slice(0, MAX_INLINE) : source;
  const spans = resolve(tokenize(softBreaks(bounded), options));
  if (bounded.length < source.length) spans.push({text: softBreaks(source.slice(MAX_INLINE)), style: {}});
  return spans;
}

/** Soft line breaks read as one space, with the spaces around them dropped (a linear scan, not a pattern). */
function softBreaks(text: string): string {
  if (!text.includes('\n')) return text;
  const lines = text.split('\n');
  return lines.map((line, index) => index === 0 ? line.trimEnd() : index === lines.length - 1 ? line.trimStart() : line.trim()).join(' ');
}

/** The text a reader sees, without styling (search, copy-visible, width measurement). */
export function plainInline(source: string, options: InlineOptions = {}): string {
  return parseInline(source, options).map(span => span.text).join('');
}
