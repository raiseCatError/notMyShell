import test from 'node:test';
import assert from 'node:assert/strict';
import {TextBuffer, type Position} from '../src/viewer/textBuffer.js';
import {MAX_STOPS, MAX_TEMPLATE_BYTES, SNIPPETS, advanceSnippet, insertSnippet, insertFootnote, parseTemplate, searchSnippets, type Snippet} from '../src/viewer/snippets.js';

const at = (line: number, column: number): Position => ({line, column});
const buf = (lines: string[], caret: Position, anchor?: Position) => {
  const buffer = new TextBuffer(lines, () => 0);
  buffer.caret = caret; if (anchor) buffer.anchor = anchor;
  return buffer;
};
const snip = (body: string, format: Snippet['format'] = 'markdown', inline = false): Snippet => ({id: 't', title: 't', description: '', keywords: [], format, body, ...(inline ? {inline} : {})});

// ---- Template syntax ---------------------------------------------------------------------------------------------

test('template: plain text, numbered stops with defaults, the final stop and escapes', () => {
  const parsed = parseTemplate('# ${1:Title}\n\n${2:Body} end $0');
  assert.equal(parsed.text, '# Title\n\nBody end ');
  assert.deepEqual(parsed.stops.map(stop => parsed.text.slice(stop.start, stop.end)), ['Title', 'Body']);
  assert.equal(parsed.final, parsed.text.length);
  assert.equal(parseTemplate('cost \\$5 and \\\\ and \\}').text, 'cost $5 and \\ and }');
  assert.deepEqual(parseTemplate('$2 then $1').stops.map(stop => stop.index), [1, 2], 'stops are visited in numeric order');
});

test('template: malformed syntax is literal text, never an error or a hang', () => {
  for (const body of ['${1:unclosed', '${}', '${a:b}', '$', 'trailing \\', '${1:${2:nested}}', '${1', '$$', '${1:x}${']) {
    const parsed = parseTemplate(body);
    assert.equal(typeof parsed.text, 'string', body);
    assert.ok(parsed.stops.length <= MAX_STOPS);
  }
  assert.equal(parseTemplate('${1:unclosed').text, '${1:unclosed');
  assert.equal(parseTemplate('${1:${2:nested}}').stops.length, 0, 'nesting is not supported: literal');
  assert.equal(parseTemplate('$').text, '$');
});

test('template: a repeated number inserts its default again but is one stop; template and stop counts are bounded', () => {
  const parsed = parseTemplate('${1:x} and $1 and ${1:y}');
  assert.equal(parsed.text, 'x and x and x');
  assert.equal(parsed.stops.length, 1);
  const big = parseTemplate('a'.repeat(MAX_TEMPLATE_BYTES + 10));
  assert.ok(big.text.length <= MAX_TEMPLATE_BYTES);
  const many = parseTemplate(Array.from({length: MAX_STOPS + 20}, (_, index) => `\${${index + 1}:s}`).join(' '));
  assert.ok(many.stops.length <= MAX_STOPS);
});

test('template: the selection token inserts the selected text, or becomes an ordinary stop with its default', () => {
  assert.equal(parseTemplate('<b>$SEL</b>', 'hello').text, '<b>hello</b>');
  assert.equal(parseTemplate('<b>$SEL</b>', 'hello').stops.length, 0);
  const none = parseTemplate('<b>${SEL:text}</b>', '');
  assert.equal(none.text, '<b>text</b>');
  assert.deepEqual(none.stops.map(stop => none.text.slice(stop.start, stop.end)), ['text']);
});

// ---- Insertion -------------------------------------------------------------------------------------------------

test('insert: one undoable edit, the first stop selected, indentation kept on every following line', () => {
  const b = buf(['  - item', '  '], at(1, 2));
  const session = insertSnippet(b, snip('```${1:lang}\n${2:code}\n```'))!;
  assert.deepEqual(b.lines, ['  - item', '  ```lang', '  code', '  ```']);
  assert.equal(b.selectedText(), 'lang');
  assert.ok(session);
  assert.equal(b.undo(), true);
  assert.deepEqual(b.lines, ['  - item', '  ']);
  assert.deepEqual(b.caret, at(1, 2));
  assert.equal(b.undo(), false, 'exactly one step');
});

test('insert: a selection replaces what is selected, is available to the template, and a template without stops leaves the caret at its end', () => {
  const b = buf(['say hello now'], at(0, 9), at(0, 4));
  const none = insertSnippet(b, snip('<em>$SEL</em>', 'html', true));
  assert.deepEqual(b.lines, ['say <em>hello</em> now']);
  assert.equal(none, undefined, 'no stops: no snippet mode');
  assert.deepEqual(b.caret, at(0, 'say <em>hello</em>'.length));
  assert.equal(b.selection, undefined);
});

test('insert: Unicode and very long lines keep exact offsets', () => {
  const line = '日本語 😀 '.repeat(1000);
  const b = buf([line], at(0, line.length));
  const session = insertSnippet(b, snip('[${1:テキスト}](${2:url})'))!;
  assert.equal(b.selectedText(), 'テキスト');
  advanceSnippet(b, session, 1);
  assert.equal(b.selectedText(), 'url');
  assert.equal(b.lines[0]!.startsWith(line), true);
});

// ---- Placeholder navigation ------------------------------------------------------------------------------------

test('Tab / Shift+Tab visit the stops in order; after the last the caret goes to the final position and the session ends', () => {
  const b = buf([''], at(0, 0));
  const session = insertSnippet(b, snip('| ${1:A} | ${2:B} |\n| --- | --- |\n| ${3:c} | ${4:d} |$0'))!;
  const seen: string[] = [b.selectedText()];
  while (advanceSnippet(b, session, 1) === 'moved') seen.push(b.selectedText());
  assert.deepEqual(seen, ['A', 'B', 'c', 'd']);
  assert.deepEqual(b.caret, at(2, b.lines[2]!.length));
  assert.equal(b.selection, undefined);
  const other = buf([''], at(0, 0));
  const again = insertSnippet(other, snip('${1:a} ${2:b}'))!;
  assert.equal(advanceSnippet(other, again, -1), 'stay', 'before the first stop there is nothing to go back to');
  assert.equal(advanceSnippet(other, again, 1), 'moved');
  assert.equal(advanceSnippet(other, again, -1), 'moved');
  assert.equal(other.selectedText(), 'a');
});

test('typing in a stop replaces its default and later stops move with the text; edits outside the snippet leave it alone', () => {
  const b = buf([''], at(0, 0));
  const session = insertSnippet(b, snip('<a href="${1:url}">${2:text}</a>'))!;
  b.insert('https://example.com/a/much/longer/address');
  assert.equal(advanceSnippet(b, session, 1), 'moved');
  assert.equal(b.selectedText(), 'text', 'the second stop followed the first stop\'s new length');
  b.insert('link');
  assert.deepEqual(b.lines, ['<a href="https://example.com/a/much/longer/address">link</a>']);
  session.dispose();
});

test('undo of typing inside a stop keeps the stops correct', () => {
  const b = buf([''], at(0, 0));
  const session = insertSnippet(b, snip('${1:one} ${2:two}'))!;
  b.insert('XYZ');
  b.undo();
  assert.equal(advanceSnippet(b, session, 1), 'moved');
  assert.equal(b.selectedText(), 'two');
});

// ---- Footnote ---------------------------------------------------------------------------------------------------

test('footnote: a numbered reference at the caret and its definition at the end, as one undoable edit, with the next unused number', () => {
  const b = buf(['Claim here.', '', '[^1]: existing'], at(0, 11));
  const session = insertFootnote(b)!;
  assert.deepEqual(b.lines, ['Claim here.[^2]', '', '[^1]: existing', '', '[^2]: Footnote text']);
  assert.equal(b.selectedText(), 'Footnote text');
  assert.ok(session);
  b.undo();
  assert.deepEqual(b.lines, ['Claim here.', '', '[^1]: existing']);
  const fresh = buf(['text'], at(0, 4));
  insertFootnote(fresh);
  assert.deepEqual(fresh.lines, ['text[^1]', '', '[^1]: Footnote text']);
});

// ---- Catalog and search -----------------------------------------------------------------------------------------

test('catalog: every built-in parses without literal markup left over, ids are unique, formats are honest', () => {
  const ids = new Set<string>();
  for (const snippet of SNIPPETS) {
    assert.ok(!ids.has(snippet.id), snippet.id); ids.add(snippet.id);
    const parsed = parseTemplate(snippet.body, 'sel');
    assert.doesNotMatch(parsed.text, /\$\{|\$[0-9]|\$SEL/u, `${snippet.id} left template syntax in its text`);
    assert.ok(snippet.title && snippet.description, snippet.id);
    assert.ok(['markdown', 'html'].includes(snippet.format));
  }
  for (const wanted of ['heading', 'table', 'task', 'code', 'mermaid', 'math', 'skeleton', 'section']) assert.ok(SNIPPETS.some(item => `${item.id} ${item.keywords.join(' ')}`.includes(wanted)), wanted);
  for (const mermaid of SNIPPETS.filter(item => /mermaid|math/u.test(item.id))) assert.match(mermaid.description, /source|text/iu, 'described as source text, not as rendered');
});

test('search: all words must match; the format limits the list; the empty query lists everything for the format; ranking puts title matches first', () => {
  const md = searchSnippets('', 'markdown'), html = searchSnippets('', 'html');
  assert.ok(md.length > 5 && html.length > 5);
  assert.ok(md.every(item => item.format === 'markdown') && html.every(item => item.format === 'html'));
  assert.deepEqual(searchSnippets('zzzz', 'markdown'), []);
  assert.ok(searchSnippets('code fence', 'markdown').length >= 1);
  assert.ok(searchSnippets('TABLE', 'markdown').some(item => /table/iu.test(item.title)));
  assert.match(searchSnippets('table', 'markdown')[0]!.title, /table/iu);
  assert.ok(searchSnippets('semantic section', 'html').length >= 1);
});
