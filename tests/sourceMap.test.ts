import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBlocks, type Block} from '../src/markdown/blocks.js';
import {renderMarkdown} from '../src/markdown/render.js';
import {TextBuffer} from '../src/viewer/textBuffer.js';
import {DocumentIndex, SourceAnchor, assignSlugs, githubSlug, headingsOf, lineForRow, plainInline, resolveFragment, rowForLine} from '../src/markdown/sourceMap.js';

const spans = (source: string, html = false) => parseBlocks(source, {html}).map(block => [block.kind, block.from, block.to]);

// ---- Block spans ------------------------------------------------------------------------------------------------

test('blocks carry their source line span (0-based, end exclusive), blank lines between blocks excluded', () => {
  const source = ['# Title', '', 'para one', 'still para', '', '```js', 'code', '```', '', '- a', '- b', '', '> quote', '', '---'].join('\n');
  assert.deepEqual(spans(source), [['heading', 0, 1], ['paragraph', 2, 4], ['code', 5, 8], ['list', 9, 11], ['quote', 12, 13], ['rule', 14, 15]]);
});

test('spans: setext headings cover both lines, tables their rows, unclosed fences run to the end, indented code, CRLF sources', () => {
  assert.deepEqual(spans('Title\n=====\n\ntext'), [['heading', 0, 2], ['paragraph', 3, 4]]);
  assert.deepEqual(spans('| a | b |\n|---|---|\n| 1 | 2 |\n\nafter'), [['table', 0, 3], ['paragraph', 4, 5]]);
  assert.deepEqual(spans('```\nnever closed\nstill code'), [['code', 0, 3]]);
  assert.deepEqual(spans('    indented\n    code\n\ntext'), [['code', 0, 2], ['paragraph', 3, 4]]);
  assert.deepEqual(spans('# A\r\n\r\ntext\r\nmore'), [['heading', 0, 1], ['paragraph', 2, 4]]);
});

test('spans: nested blocks inside quotes and list items point at their real source lines', () => {
  const source = ['intro', '', '> # Quoted', '>', '> text', '', '- item', '  ## Nested', '  body'].join('\n');
  const blocks = parseBlocks(source);
  const quote = blocks.find((block): block is Extract<Block, {kind: 'quote'}> => block.kind === 'quote')!;
  assert.deepEqual([quote.from, quote.to], [2, 5]);
  assert.deepEqual(quote.blocks.map(block => [block.kind, block.from]), [['heading', 2], ['paragraph', 4]]);
  const list = blocks.find((block): block is Extract<Block, {kind: 'list'}> => block.kind === 'list')!;
  assert.deepEqual(list.items[0]!.blocks.map(block => [block.kind, block.from]), [['paragraph', 6], ['heading', 7], ['paragraph', 8]]);
});

test('spans: HTML blocks give all their blocks the HTML block\'s span', () => {
  const blocks = parseBlocks('<h2>Hi</h2>\n<p>text</p>\n\nafter', {html: true});
  assert.ok(blocks.slice(0, -1).every(block => block.from === 0 && block.to === 2));
  assert.deepEqual([blocks.at(-1)!.from, blocks.at(-1)!.to], [3, 4]);
});

// ---- Slugs ------------------------------------------------------------------------------------------------------

test('githubSlug: lowercase, punctuation dropped, spaces become hyphens one by one, Unicode letters kept, emoji dropped', () => {
  const cases: Array<[string, string]> = [
    ['Hello, World!', 'hello-world'], ['  Spaced   out  ', 'spaced---out'], ['Under_score and-dash', 'under_score-and-dash'],
    ['日本語 の 見出し', '日本語-の-見出し'], ['Café résumé', 'café-résumé'], ['Rocket 🚀 launch', 'rocket--launch'],
    ['C++ & C#', 'c--c'], ['1. Intro', '1-intro'], ['`code` and **bold**', 'code-and-bold'], ['', ''], ['---', '---'], ['ÀÉÎ', 'àéî'],
  ];
  for (const [text, slug] of cases) assert.equal(githubSlug(plainInline(text).trim()), slug, JSON.stringify(text));
});

test('plainInline: links, images, code spans, emphasis, HTML tags and escapes reduce to the text a reader sees', () => {
  assert.equal(plainInline('see [the docs](http://x.y/z) and ![alt text](p.png) `x` *i* **b** ~~s~~ <b>t</b> \\* done'), 'see the docs and alt text x i b s t * done');
  assert.equal(plainInline('[ref][1] [empty]()'), 'ref empty');
});

test('assignSlugs: duplicates get -1, -2 in order, a later heading that already looks like a suffix is not confused', () => {
  const headings = ['A', 'A', 'A-1', 'A', 'b', 'B', ''].map(text => ({level: 1, text, line: 0, depth: 0}));
  assert.deepEqual(assignSlugs(headings).map(heading => heading.slug), ['a', 'a-1', 'a-1-1', 'a-2', 'b', 'b-1', '']);
});

test('headingsOf: document order across quotes and lists, fenced code ignored, HTML headings listed without an anchor, lines and depth right', () => {
  const source = ['# One', '', '```', '# not a heading', '```', '', '> ## In quote', '', '- item', '', '### Deep', '', '<h2>Raw</h2>', '', '## One', '#### Skip'].join('\n');
  const found = headingsOf(source, {html: true});
  assert.deepEqual(found.map(heading => [heading.level, heading.text, heading.line, heading.slug]), [
    [1, 'One', 0, 'one'], [2, 'In quote', 6, 'in-quote'], [3, 'Deep', 10, 'deep'], [2, 'Raw', 12, undefined], [2, 'One', 14, 'one-1'], [4, 'Skip', 15, 'skip'],
  ]);
  assert.deepEqual(found.map(heading => heading.depth), [0, 1, 2, 1, 1, 2], 'depth follows the nearest shallower heading, however many levels are skipped');
});

test('resolveFragment: case-insensitive, percent-decoded, safe on bad input, no match is undefined', () => {
  const found = headingsOf('# Hello World\n\n## Café\n');
  assert.equal(resolveFragment(found, '#hello-world')?.line, 0);
  assert.equal(resolveFragment(found, 'HELLO-WORLD')?.line, 0);
  assert.equal(resolveFragment(found, '#caf%C3%A9')?.line, 2);
  assert.equal(resolveFragment(found, '#%E0%A4%A'), undefined);
  assert.equal(resolveFragment(found, '#nope'), undefined);
  assert.equal(resolveFragment(found, '#'), undefined);
});

// ---- Rows <-> lines ---------------------------------------------------------------------------------------------

test('rendered rows carry the source line of their block; the mapping is monotonic and round-trips to the same block', () => {
  const source = ['# Title', '', 'A paragraph that is long enough to wrap onto several rows when the width is small enough to force it.', '', '- one', '- two', '', '```', 'code', '```', '', '## End'].join('\n');
  for (const width of [30, 50, 80]) {
    const rows = renderMarkdown(source, width, {level: 'none', glyphs: 'safe'} as never);
    const lines = rows.map(row => row.line);
    assert.ok(rows.every(row => row.kind === 'blank' || row.line !== undefined), `every content row maps to a line at ${width}`);
    const known = lines.filter((line): line is number => line !== undefined);
    assert.deepEqual(known, [...known].sort((a, b) => a - b), 'rows never go backwards through the source');
    const heading = rows.findIndex(row => row.plain.startsWith('End'));
    assert.equal(lineForRow(rows, heading), 11);
    assert.equal(rowForLine(rows, 11), heading);
    assert.equal(rowForLine(rows, 0), rows.findIndex(row => row.plain.includes('Title')));
    assert.equal(rowForLine(rows, 2), rows.findIndex(row => row.plain.startsWith('A paragraph')), 'a line inside a block lands on that block\'s first row');
    assert.equal(rowForLine(rows, 999), heading, 'past the end: the last block');
  }
});

test('fuzz: hostile and malformed Markdown never throws and always yields ordered, in-range spans', () => {
  let seed = 99;
  const random = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pieces = ['# h', '```', '~~~', '> ', '- ', '1. ', '| a | b |', '|---|---|', '<div>', '</div>', '<!--', '-->', 'text', '', '    code', '***', '===', '[x](', '\t', '\u0000', '😀'];
  for (let round = 0; round < 400; round += 1) {
    const lines = Array.from({length: random(30)}, () => pieces[random(pieces.length)]! + (random(3) ? '' : pieces[random(pieces.length)]!));
    const source = lines.join(random(2) ? '\n' : '\r\n');
    const check = (blocks: Block[], within: [number, number]) => {
      let last = within[0];
      for (const block of blocks) {
        if (block.from === undefined) continue;
        assert.ok(block.from >= last && block.to! >= block.from && block.to! <= within[1], `${JSON.stringify(source)} -> ${block.kind} ${block.from}-${block.to}`);
        last = block.from;
        if (block.kind === 'quote') check(block.blocks, [block.from, block.to!]);
        if (block.kind === 'list') for (const item of block.items) check(item.blocks, [block.from, block.to!]);
      }
    };
    check(parseBlocks(source, {html: true}), [0, lines.length]);
    headingsOf(source, {html: true});
  }
});

// ---- Index and anchors ------------------------------------------------------------------------------------------

test('DocumentIndex: parsed once per buffer version, recomputed after an edit, undo and redo, and reports truncation', () => {
  const buffer = new TextBuffer(['# One', '', 'text', '', '## Two'], () => 0);
  let parses = 0;
  const index = new DocumentIndex(buffer, {onParse: () => { parses += 1; }});
  assert.deepEqual(index.headings().map(heading => heading.text), ['One', 'Two']);
  index.headings(); index.blocks(); index.headingAt(4);
  assert.equal(parses, 1, 'cached while nothing changed');
  buffer.caret = {line: 4, column: 6}; buffer.insert('!');
  assert.deepEqual(index.headings().map(heading => heading.text), ['One', 'Two!']);
  assert.equal(parses, 2);
  buffer.undo();
  assert.deepEqual(index.headings().map(heading => heading.text), ['One', 'Two']);
  buffer.redo();
  assert.equal(index.headings()[1]!.text, 'Two!');
  assert.equal(index.headingAt(2)?.text, 'One', 'the heading a line belongs to is the nearest one above it');
  assert.equal(index.headingAt(0)?.text, 'One');
  index.dispose();
  const huge = new TextBuffer(Array.from({length: 60_000}, (_, i) => (i % 1000 === 0 ? `# H${i}` : 'x')), () => 0);
  const big = new DocumentIndex(huge);
  assert.equal(big.truncated, true);
  assert.ok(big.headings().length >= 50);
  big.dispose();
});

test('SourceAnchor: a position that follows the text through edits, undo and redo, and is gone only with its text', () => {
  const buffer = new TextBuffer(['alpha', 'beta', 'gamma'], () => 0);
  const anchor = new SourceAnchor(buffer, {line: 1, column: 2});
  buffer.caret = {line: 0, column: 0}; buffer.insert('XX\n');
  assert.deepEqual(anchor.position, {line: 2, column: 2});
  buffer.undo();
  assert.deepEqual(anchor.position, {line: 1, column: 2});
  buffer.redo();
  assert.deepEqual(anchor.position, {line: 2, column: 2});
  buffer.caret = {line: 2, column: 0}; buffer.anchor = {line: 2, column: 3};
  buffer.insert('');
  assert.deepEqual(anchor.position, {line: 2, column: 0}, 'text around the anchor was removed: it collapses to where the text was');
  anchor.dispose();
  buffer.caret = {line: 0, column: 0}; buffer.insert('y');
  assert.deepEqual(anchor.position, {line: 2, column: 0}, 'a disposed anchor stops following');
});
