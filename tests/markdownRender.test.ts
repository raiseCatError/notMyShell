import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInline, plainInline} from '../src/markdown/inline.js';
import {parseBlocks} from '../src/markdown/blocks.js';
import {highlightCode} from '../src/markdown/highlight.js';
import {codeBlocks, renderMarkdown} from '../src/markdown/render.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const styleOf = (source: string, text: string) => parseInline(source).find(span => span.text.includes(text))?.style;
const plain = (source: string, columns = 60, options = {}) => renderMarkdown(source, columns, {level: 'truecolor', glyphs: 'nerd', ...options}).map(row => row.plain);

test('inline: emphasis, strong, strikethrough and code spans', () => {
  assert.deepEqual(styleOf('a *b* c', 'b'), {em: true});
  assert.deepEqual(styleOf('a **b** c', 'b'), {strong: true});
  assert.deepEqual(styleOf('a ***b*** c', 'b'), {strong: true, em: true});
  assert.deepEqual(styleOf('a ~~gone~~ c', 'gone'), {strike: true});
  assert.deepEqual(styleOf('use `npm test` now', 'npm test'), {code: true});
  assert.equal(plainInline('``a ` b``'), 'a ` b', 'a longer backtick run may contain a shorter one');
  assert.equal(plainInline('**bold *nested* bold**'), 'bold nested bold');
  assert.deepEqual(styleOf('**bold *nested* bold**', 'nested'), {strong: true, em: true});
});

test('inline: identifiers and arithmetic stay literal where emphasis would be wrong', () => {
  assert.equal(plainInline('call my_function_name and a_b_c here'), 'call my_function_name and a_b_c here');
  // CommonMark (and GitHub) make __init__ strong; replies normally put such names in code spans.
  assert.deepEqual(styleOf('the __init__ method', 'init'), {strong: true});
  assert.equal(plainInline('a * b * c'), 'a * b * c', 'spaced asterisks are not emphasis');
  assert.equal(plainInline('**unclosed bold'), '**unclosed bold');
  assert.equal(plainInline('\\*literal\\*'), '*literal*');
  assert.equal(plainInline('`code with **stars**`'), 'code with **stars**');
});

test('inline: only safe http(s) links become links; refused targets stay visible as text', () => {
  assert.equal(styleOf('[docs](https://example.com/a)', 'docs')?.link, 'https://example.com/a');
  const hostile = parseInline('[click](javascript:alert(1))');
  assert.ok(hostile.every(span => !span.style.link));
  assert.ok(hostile.map(span => span.text).join('').includes('javascript:alert(1)'), 'the refused target is shown, never hidden behind text');
  assert.ok(parseInline('[f](file:///etc/passwd)').every(span => !span.style.link));
  assert.equal(styleOf('<https://example.com>', 'example')?.link, 'https://example.com/');
  assert.equal(plainInline('see https://example.com/docs.'), 'see https://example.com/docs.');
  assert.equal(styleOf('see https://example.com/docs.', 'example')?.link, 'https://example.com/docs');
  assert.equal(plainInline('![a diagram](https://x.y/z.png)'), 'a diagram');
  assert.equal(plainInline('Tom &amp; Jerry &lt;3 &#x41;'), 'Tom & Jerry <3 A');
  assert.equal(plainInline('&#27;[31m'), '&#27;[31m', 'entities never produce control characters');
});

test('blocks: headings, paragraphs, rules and hard breaks', () => {
  const blocks = parseBlocks('# Title\n\nSetext\n======\n\nline one  \nline two\n\n---\n\n## Sub ##');
  assert.deepEqual(blocks.map(block => block.kind), ['heading', 'heading', 'paragraph', 'rule', 'heading']);
  assert.deepEqual(blocks[0], {kind: 'heading', level: 1, text: 'Title'});
  assert.deepEqual(blocks[1], {kind: 'heading', level: 1, text: 'Setext'});
  assert.equal((blocks[2] as {text: string}).text, 'line one\nline two');
  assert.deepEqual(blocks[4], {kind: 'heading', level: 2, text: 'Sub'});
});

test('blocks: fenced code keeps lines literally; an unclosed fence runs to the end (streaming)', () => {
  const closed = parseBlocks('```ts\nconst a = 1;\n  indented();\n```\nafter');
  assert.deepEqual(closed[0], {kind: 'code', language: 'ts', lines: ['const a = 1;', '  indented();'], closed: true});
  assert.deepEqual(closed[1], {kind: 'paragraph', text: 'after'});
  const open = parseBlocks('text\n\n~~~python\nprint("hi")\n# still code');
  assert.deepEqual(open[1], {kind: 'code', language: 'python', lines: ['print("hi")', '# still code'], closed: false});
  assert.deepEqual(parseBlocks('````\n```\ninner\n```\n````')[0], {kind: 'code', lines: ['```', 'inner', '```'], closed: true});
});

test('blocks: nested and ordered lists, task items, loose lists and quotes', () => {
  const [list] = parseBlocks('3. three\n4. four\n   - nested\n   - [x] done\n5. five');
  assert.equal(list!.kind, 'list');
  const ordered = list as Extract<typeof list, {kind: 'list'}>;
  assert.equal(ordered.ordered, true);
  assert.equal(ordered.start, 3);
  assert.equal(ordered.items.length, 3);
  const nested = ordered.items[1]!.blocks[1] as Extract<typeof list, {kind: 'list'}>;
  assert.equal(nested.kind, 'list');
  assert.equal(nested.items[1]!.task, 'done');
  assert.equal((parseBlocks('- a\n\n- b')[0] as {loose: boolean}).loose, true);
  assert.equal((parseBlocks('- a\n- b')[0] as {loose: boolean}).loose, false);
  const [quote] = parseBlocks('> quoted\nlazy line\n> - item');
  assert.equal(quote!.kind, 'quote');
  assert.deepEqual((quote as {blocks: Array<{kind: string}>}).blocks.map(block => block.kind), ['paragraph', 'list']);
  assert.equal(parseBlocks('* * *')[0]!.kind, 'rule', 'a thematic break wins over a list item');
});

test('blocks: GFM tables with alignment and escaped pipes', () => {
  const [table] = parseBlocks('| a | b | c |\n|:--|:-:|--:|\n| 1 | `x|y` | 3 \\| 4 |\n| short |');
  assert.equal(table!.kind, 'table');
  const t = table as Extract<typeof table, {kind: 'table'}>;
  assert.deepEqual(t.align, ['left', 'center', 'right']);
  assert.deepEqual(t.rows[0], ['1', '`x|y`', '3 | 4']);
  assert.deepEqual(t.rows[1], ['short', '', ''], 'short rows are padded to the header width');
});

test('render: every row fits its width at every width, for every construct', () => {
  const source = [
    '# A very long heading that certainly needs wrapping at narrow widths',
    'Paragraph with **bold**, *em*, `code`, a [link](https://example.com/very/long/path?q=1) and averyveryveryverylongunbrokenword.',
    '- item one that wraps\n  - nested item\n    1. deep ordered',
    '> quote with a list\n> - inside',
    '```js\nconst x = "a long string literal that will wrap at narrow widths"; // comment\n```',
    '| Column | Another column | Third |\n|---|---|---|\n| value with several words | 2 | three |',
    '---',
  ].join('\n\n');
  for (const columns of [4, 8, 12, 20, 30, 40, 60, 80, 120, 200]) {
    for (const glyphs of ['nerd', 'safe'] as const) {
      for (const row of renderMarkdown(source, columns, {level: 'truecolor', glyphs, hyperlinks: true})) {
        assert.ok(displayWidth(row.ansi) <= Math.max(4, columns), `${columns}/${glyphs}: "${stripAnsi(row.ansi)}" is ${displayWidth(row.ansi)} wide`);
        const sgr = row.ansi.match(/\u001b\[[0-9;]*m/gu) ?? [];
        assert.ok(!sgr.length || sgr.at(-1) === '\u001b[0m', `no style leaks past the row: ${JSON.stringify(row.ansi)}`);
        assert.equal((row.ansi.match(/\u001b\]8;;[^\u001b]/gu) ?? []).length, (row.ansi.match(/\u001b\]8;;\u001b/gu) ?? []).length, 'every hyperlink closes on its row');
      }
    }
  }
});

test('render: tables fit by wrapping cells, then fall back to records when far too narrow', () => {
  const table = '| Name | Description |\n|---|---|\n| sum | adds two numbers together and returns the result |';
  const wide = plain(table, 80);
  assert.equal(wide[0], 'Name │ Description');
  assert.ok(wide[1]!.startsWith('─'));
  const narrow = plain(table, 30);
  assert.ok(narrow.length > 3, 'cells wrap into more rows');
  assert.ok(narrow.every(row => displayWidth(row) <= 30));
  const tiny = plain('| A | B | C | D | E |\n|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 |', 12);
  assert.ok(tiny.includes('A: 1') && tiny.includes('E: 5'), `records: ${JSON.stringify(tiny)}`);
});

test('render: Safe glyphs and NO_COLOR keep structure without decorative characters or color', () => {
  const source = '- a\n  - b\n- [x] c\n\n> q\n\n```\ncode\n```\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\nUse `npm test`.';
  const rows = renderMarkdown(source, 40, {level: 'none', glyphs: 'safe'});
  const text = rows.map(row => row.plain).join('\n');
  assert.ok(!/[•◦▪☑☐▎│─┼]/u.test(text), `no Unicode decoration in Safe mode:\n${text}`);
  assert.ok(text.includes('- a') && text.includes('[x] c') && text.includes('| q') && text.includes('| code') && text.includes('x | y'));
  assert.ok(text.includes('Use `npm test`.'), 'without color, inline code keeps its backticks');
  assert.ok(rows.every(row => !/\u001b\[(?:3|4)8;/u.test(row.ansi)), 'no color escapes without color');
});

test('render: OSC 8 hyperlinks only for safe links, and the destination host is always visible', () => {
  const rows = renderMarkdown('[docs](https://example.com/a) and [bad](javascript:x)', 80, {level: 'truecolor', hyperlinks: true});
  const ansi = rows.map(row => row.ansi).join('');
  assert.ok(ansi.includes('\u001b]8;;https://example.com/a\u001b\\docs'), 'safe link is a hyperlink');
  assert.ok(!ansi.includes(']8;;javascript'), 'unsafe target is never a hyperlink');
  assert.ok(rows[0]!.plain.includes('docs (example.com)'), 'the host is shown beside link text');
  const offline = renderMarkdown('[docs](https://example.com/a)', 80, {level: 'truecolor', hyperlinks: false});
  assert.ok(offline[0]!.plain.includes('docs (https://example.com/a)'), 'without hyperlinks the full URL is visible');
});

test('render: code is highlighted without changing its text; copy-code returns exact source lines', () => {
  const source = 'Intro\n\n```ts\nconst x = 1; // one\n```\n\n- ```sh\n  npm test\n  ```';
  const rows = renderMarkdown(source, 60, {level: 'truecolor'});
  const code = rows.filter(row => row.kind === 'code' || row.code !== undefined);
  assert.ok(code.some(row => row.plain.includes('const x = 1; // one')));
  assert.deepEqual(codeBlocks(source), [{language: 'ts', text: 'const x = 1; // one'}, {language: 'sh', text: 'npm test'}]);
  for (const language of ['ts', 'python', 'rust', 'go', 'sh', 'json', 'yaml', 'toml', 'html', 'css', 'sql', 'diff', 'markdown', 'unknown-lang']) {
    const lines = ['const a = "x"; /* c */ # z', '  call(1, 2.5) -- y', '+added', '<div class="a">t</div>'];
    const tokens = highlightCode(lines, language);
    tokens.forEach((line, index) => assert.equal(line.map(token => token.text).join(''), lines[index], `${language}: tokens rebuild the line`));
  }
  const diff = highlightCode(['@@ -1 +1 @@', '-old', '+new', ' same'], 'diff');
  assert.deepEqual(diff.map(line => line[0]!.kind), ['meta', 'deleted', 'inserted', 'plain']);
});

test('highlight: block comments and multi-line strings carry across lines', () => {
  const tokens = highlightCode(['a /* start', 'still comment', 'end */ b', 'x = """doc', 'more"""'], 'python');
  assert.equal(tokens[1]![0]!.kind, 'plain', 'Python has no /* */ comments');
  const js = highlightCode(['a /* start', 'still comment', 'end */ b', 'const t = `tpl', 'line ${x}`;'], 'ts');
  assert.equal(js[1]![0]!.kind, 'comment');
  assert.equal(js[2]![0]!.kind, 'comment');
  assert.equal(js[4]![0]!.kind, 'string');
  const py = highlightCode(['x = """doc', 'more""" + y'], 'python');
  assert.equal(py[1]![0]!.kind, 'string');
});

test('render: deep nesting and huge inputs stay bounded', () => {
  const deep = `${'> '.repeat(40)}deep`;
  assert.ok(plain(deep, 80).join('').includes('deep'));
  const big = Array.from({length: 3000}, (_, index) => `- item ${index}`).join('\n');
  const started = Date.now();
  const rows = renderMarkdown(big, 80, {level: 'truecolor'});
  assert.equal(rows.length, 3000);
  assert.ok(Date.now() - started < 2000, 'thousands of rows render quickly');
});
