/**
 * Lightweight, bounded syntax highlighting for code blocks in agent replies and diffs. It tokenizes with per-language
 * rules (comments, strings, numbers, keywords, types, calls, tags, keys) and carries block-comment and multi-line
 * string state across lines. It is presentation only: the text of every line is returned unchanged, unknown
 * languages stay plain, and very large blocks highlight only their beginning. No grammar is loaded and nothing runs.
 */

export type CodeTokenKind = 'plain' | 'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type' | 'operator' | 'property' | 'tag'
  | 'constant' | 'inserted' | 'deleted' | 'meta' | 'heading' | 'variable';

export interface CodeToken {
  text: string;
  kind: CodeTokenKind;
}

const MAX_LINES = 2000;
const MAX_LINE_LENGTH = 4000;

interface Grammar {
  line?: readonly string[];
  block?: ReadonlyArray<readonly [string, string]>;
  quotes?: readonly string[];
  /** Strings that may span lines (template literals, triple quotes). */
  multiline?: readonly string[];
  keywords?: ReadonlySet<string>;
  constants?: ReadonlySet<string>;
  /** Capitalized identifiers read as types. */
  types?: boolean;
  caseInsensitive?: boolean;
  variables?: boolean;
  decorators?: boolean;
}

const words = (text: string) => new Set(text.split(/\s+/u).filter(Boolean));
const C_CONSTANTS = words('true false null undefined NaN Infinity nullptr nil None True False self this super');

const JS = words(`abstract as async await break case catch class const continue debugger declare default delete do else enum export extends finally for
  from function get if implements import in infer instanceof interface is keyof let module namespace new of package private protected public readonly
  return satisfies set static switch throw try type typeof var void while with yield`);
const PY = words(`and as assert async await break class continue def del elif else except finally for from global if import in is lambda match case
  nonlocal not or pass raise return try while with yield`);
const RUST = words(`as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return
  self Self static struct super trait type unsafe use where while`);
const GO = words(`break case chan const continue default defer else fallthrough for func go goto if import interface map package range return
  select struct switch type var`);
const C_LIKE = words(`abstract auto bool break case catch char class const constexpr continue default delete do double else enum explicit export
  extends extern final finally float for friend goto if implements import inline instanceof int interface long namespace native new operator
  override package private protected public register return short signed sizeof static struct super switch synchronized template this throw
  throws transient try typedef typename union unsigned using var virtual void volatile while fun val when object companion data sealed
  internal lateinit suspend let guard func init deinit protocol extension import struct mutating weak`);
const RUBY = words('alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require attr_accessor');
const SHELL = words('if then else elif fi for while until do done case esac in function select time return export local readonly declare unset source alias set shift exit');
const SQL = words(`select from where and or not insert into values update set delete create table index view drop alter add column primary key
  foreign references join left right inner outer full on group by order having limit offset as distinct union all case when then else end is null
  like in exists between returning with begin commit rollback transaction default unique check constraint`);
const LUA = words('and break do else elseif end false for function goto if in local nil not or repeat return then true until while');

const GRAMMARS: Record<string, Grammar> = {
  js: {line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], multiline: ['`'], keywords: JS, constants: C_CONSTANTS, types: true, decorators: true},
  py: {line: ['#'], quotes: ['"', "'"], multiline: ['"""', "'''"], keywords: PY, constants: C_CONSTANTS, types: true, decorators: true},
  rust: {line: ['//'], block: [['/*', '*/']], quotes: ['"'], keywords: RUST, constants: C_CONSTANTS, types: true, decorators: false},
  go: {line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], multiline: ['`'], keywords: GO, constants: C_CONSTANTS, types: true},
  c: {line: ['//'], block: [['/*', '*/']], quotes: ['"', "'"], keywords: C_LIKE, constants: C_CONSTANTS, types: true, decorators: true},
  ruby: {line: ['#'], quotes: ['"', "'"], keywords: RUBY, constants: C_CONSTANTS, types: true},
  shell: {line: ['#'], quotes: ['"', "'"], keywords: SHELL, variables: true},
  sql: {line: ['--'], block: [['/*', '*/']], quotes: ["'", '"'], keywords: SQL, caseInsensitive: true, constants: words('true false null')},
  lua: {line: ['--'], block: [['--[[', ']]']], quotes: ['"', "'"], keywords: LUA},
  css: {block: [['/*', '*/']], quotes: ['"', "'"]},
  json: {quotes: ['"'], constants: words('true false null')},
  yaml: {line: ['#'], quotes: ['"', "'"], constants: words('true false null yes no on off ~')},
  toml: {line: ['#'], quotes: ['"', "'"], multiline: ['"""', "'''"], constants: words('true false')},
  markup: {block: [['<!--', '-->']], quotes: ['"', "'"]},
};

const ALIASES: Record<string, string> = {
  javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', typescript: 'js', tsx: 'js', mts: 'js', cts: 'js', node: 'js', deno: 'js',
  python: 'py', py3: 'py', python3: 'py', pyi: 'py', rs: 'rust', golang: 'go',
  'c++': 'c', cpp: 'c', cc: 'c', cxx: 'c', h: 'c', hpp: 'c', hh: 'c', 'objective-c': 'c', objc: 'c', cs: 'c', csharp: 'c', java: 'c', kotlin: 'c',
  kt: 'c', kts: 'c', swift: 'c', scala: 'c', dart: 'c', php: 'c', zig: 'c', groovy: 'c', gradle: 'c', proto: 'c', protobuf: 'c',
  rb: 'ruby', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ksh: 'shell', console: 'shell', shellsession: 'shell', terminal: 'shell',
  dockerfile: 'shell', docker: 'shell', makefile: 'shell', make: 'shell', psql: 'sql', mysql: 'sql', postgres: 'sql', sqlite: 'sql', postgresql: 'sql',
  scss: 'css', sass: 'css', less: 'css', jsonc: 'json', json5: 'json', yml: 'yaml', ini: 'toml', cfg: 'toml', conf: 'toml', editorconfig: 'toml',
  html: 'markup', xml: 'markup', svg: 'markup', vue: 'markup', svelte: 'markup', xhtml: 'markup', plist: 'markup',
  diff: 'diff', patch: 'diff', udiff: 'diff', md: 'markdown', markdown: 'markdown', hcl: 'toml', tf: 'toml', nix: 'shell', ps1: 'shell', powershell: 'shell',
};

/** The grammar id for a fence info word, or undefined for plain text. */
export function languageId(language: string | undefined): string | undefined {
  if (!language) return undefined;
  const id = language.toLowerCase();
  return GRAMMARS[id] || id === 'diff' || id === 'markdown' ? id : ALIASES[id];
}

const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z%]*/u;
const IDENT = /^[A-Za-z_$][\w$]*[?!]?/u;

function diffLine(line: string): CodeToken[] {
  if (/^(?:diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename (?:from|to)|old mode|new mode)/u.test(line)) return [{text: line, kind: 'meta'}];
  if (line.startsWith('@@')) return [{text: line, kind: 'meta'}];
  if (line.startsWith('+')) return [{text: line, kind: 'inserted'}];
  if (line.startsWith('-')) return [{text: line, kind: 'deleted'}];
  return [{text: line, kind: 'plain'}];
}

function markdownLine(line: string, state: {fence?: boolean}): CodeToken[] {
  if (/^ {0,3}(?:```|~~~)/u.test(line)) { state.fence = !state.fence; return [{text: line, kind: 'meta'}]; }
  if (state.fence) return [{text: line, kind: 'string'}];
  if (/^ {0,3}#{1,6}\s/u.test(line)) return [{text: line, kind: 'heading'}];
  if (/^ {0,3}>/u.test(line)) return [{text: line, kind: 'comment'}];
  const list = /^(\s*(?:[-*+]|\d+[.)])\s)(.*)$/u.exec(line);
  if (list) return [{text: list[1]!, kind: 'keyword'}, {text: list[2]!, kind: 'plain'}];
  return [{text: line, kind: 'plain'}];
}

interface LineState {
  /** Inside a block comment, the closing delimiter. */
  comment?: string;
  /** Inside a multi-line string, its closing delimiter. */
  string?: string;
  fence?: boolean;
}

function tokenizeLine(line: string, grammar: Grammar, id: string, state: LineState): CodeToken[] {
  const tokens: CodeToken[] = [];
  const push = (text: string, kind: CodeTokenKind) => {
    if (!text) return;
    const last = tokens.at(-1);
    if (last && last.kind === kind) last.text += text; else tokens.push({text, kind});
  };
  let index = 0;
  // Keys and section headers in data formats.
  if (id === 'yaml') {
    const key = /^(\s*-?\s*)([\w.\-"' ]+?)(\s*:)(?=\s|$)/u.exec(line);
    if (key && !line.trimStart().startsWith('#')) { push(key[1]!, 'plain'); push(key[2]!, 'property'); push(key[3]!, 'operator'); index = key[0].length; }
  } else if (id === 'toml') {
    if (/^\s*\[[^\]]*\]\s*$/u.test(line)) return [{text: line, kind: 'heading'}];
    const key = /^(\s*)([\w.\-"']+)(\s*=)/u.exec(line);
    if (key) { push(key[1]!, 'plain'); push(key[2]!, 'property'); push(key[3]!, 'operator'); index = key[0].length; }
  } else if (id === 'shell') {
    // A shell session's prompt marker reads as structure, the command after it as code.
    const prompt = /^(\s*[$#%❯>]\s)/u.exec(line);
    if (prompt && line.trim().length > 2) { push(prompt[1]!, 'meta'); index = prompt[1]!.length; }
  }
  let expectCommand = id === 'shell';
  while (index < line.length) {
    const rest = line.slice(index);
    if (state.comment) {
      const end = rest.indexOf(state.comment);
      if (end < 0) { push(rest, 'comment'); return tokens; }
      push(rest.slice(0, end + state.comment.length), 'comment'); index += end + state.comment.length; state.comment = undefined; continue;
    }
    if (state.string) {
      const close = state.string;
      let end = -1;
      for (let at = 0; at <= rest.length - close.length; at++) {
        if (rest[at] === '\\') { at++; continue; }
        if (rest.startsWith(close, at)) { end = at; break; }
      }
      if (end < 0) { push(rest, 'string'); return tokens; }
      push(rest.slice(0, end + close.length), 'string'); index += end + close.length; state.string = undefined; continue;
    }
    const char = line[index]!;
    if (char === ' ' || char === '\t') { const space = /^\s+/u.exec(rest)![0]; push(space, 'plain'); index += space.length; continue; }
    const lineComment = grammar.line?.find(marker => rest.startsWith(marker) && (marker !== '#' || id !== 'shell' || index === 0 || /\s/u.test(line[index - 1]!)));
    if (lineComment && !(id === 'css')) { push(rest, 'comment'); return tokens; }
    const block = grammar.block?.find(([open]) => rest.startsWith(open));
    if (block) { state.comment = block[1]; push(block[0], 'comment'); index += block[0].length; continue; }
    const multi = grammar.multiline?.find(quote => rest.startsWith(quote));
    if (multi) { state.string = multi; push(multi, 'string'); index += multi.length; continue; }
    if (grammar.quotes?.includes(char)) {
      let end = 1;
      while (end < rest.length && rest[end] !== char) end += rest[end] === '\\' ? 2 : 1;
      const text = rest.slice(0, Math.min(rest.length, end + 1));
      // A JSON object key is a property, not a value.
      push(text, id === 'json' && /^\s*:/u.test(rest.slice(text.length)) ? 'property' : 'string');
      index += text.length; expectCommand = false; continue;
    }
    if (id === 'markup' && char === '<') {
      const tag = /^<\/?[A-Za-z][\w:.-]*/u.exec(rest);
      if (tag) { push(tag[0], 'tag'); index += tag[0].length; continue; }
    }
    if (id === 'markup' && /[A-Za-z]/u.test(char)) {
      const attribute = /^[A-Za-z_:][\w:.-]*(?==)/u.exec(rest);
      if (attribute) { push(attribute[0], 'property'); index += attribute[0].length; continue; }
    }
    if (grammar.variables && char === '$') {
      const variable = /^\$(?:\{[^}]{0,200}\}|[A-Za-z_]\w*|[0-9@*#?$!-])/u.exec(rest);
      if (variable) { push(variable[0], 'variable'); index += variable[0].length; continue; }
    }
    if (grammar.decorators && char === '@') {
      const decorator = /^@[A-Za-z_][\w.]*/u.exec(rest);
      if (decorator) { push(decorator[0], 'meta'); index += decorator[0].length; continue; }
    }
    if (id === 'css' && char === '#') {
      const color = /^#[0-9a-fA-F]{3,8}\b/u.exec(rest);
      if (color) { push(color[0], 'constant'); index += color[0].length; continue; }
    }
    if (/\d/u.test(char) && !(index > 0 && /[\w$]/u.test(line[index - 1]!))) {
      const number = NUMBER.exec(rest);
      if (number) { push(number[0], 'number'); index += number[0].length; continue; }
    }
    const ident = IDENT.exec(rest);
    if (ident) {
      const word = ident[0];
      const after = rest.slice(word.length);
      const key = grammar.caseInsensitive ? word.toLowerCase() : word;
      let kind: CodeTokenKind = 'plain';
      if (id === 'css' && /^\s*:/u.test(after) && !/^\s*:[a-z-]+\s*[{,]/u.test(after)) kind = 'property';
      else if (grammar.keywords?.has(key)) kind = 'keyword';
      else if (grammar.constants?.has(key)) kind = 'constant';
      else if (expectCommand) kind = 'function';
      else if (/^\s*\(/u.test(after)) kind = 'function';
      else if (grammar.types && /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/u.test(word)) kind = 'type';
      else if (/^[A-Z][A-Z0-9_]{2,}$/u.test(word)) kind = 'constant';
      push(word, kind);
      index += word.length;
      if (id === 'shell') expectCommand = false;
      continue;
    }
    if (id === 'shell' && (char === '|' || char === ';' || char === '&')) expectCommand = true;
    push(char, /[=+\-*/%<>!&|^~?:]/u.test(char) ? 'operator' : 'plain');
    index++;
  }
  return tokens;
}

/** Tokens for each line of a code block; a line's tokens always concatenate back to exactly that line. */
export function highlightCode(lines: readonly string[], language: string | undefined): CodeToken[][] {
  const id = languageId(language);
  if (!id) return lines.map(line => [{text: line, kind: 'plain'}]);
  const state: LineState = {};
  return lines.map((line, number) => {
    if (number >= MAX_LINES || line.length > MAX_LINE_LENGTH) return [{text: line, kind: 'plain'}];
    if (id === 'diff') return diffLine(line);
    if (id === 'markdown') return markdownLine(line, state);
    return tokenizeLine(line, GRAMMARS[id]!, id, state);
  });
}
