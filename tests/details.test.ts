import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBlocks, type Block} from '../src/markdown/blocks.js';
import {htmlToBlocks} from '../src/markdown/html.js';
import {renderMarkdown, renderHtml} from '../src/markdown/render.js';
import {headingsOf} from '../src/markdown/sourceMap.js';
import {createViewer, renderViewer, viewerKey, type ViewerState} from '../src/viewer/ViewerPanel.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {ViewDocument} from '../src/viewer/document.js';

const plain = (rows: ReturnType<typeof renderMarkdown>) => rows.map(row => row.plain);
const DOC = ['# Title', '', '<details>', '<summary>Click for <b>more</b></summary>', '', 'Hidden *markdown* paragraph.', '', '- item one', '- item two', '', '</details>', '', 'After.'].join('\n');
const GH = (extra = '') => parseBlocks(DOC.replace('<details>', `<details${extra}>`), {html: true});
const kinds = (blocks: Block[]) => blocks.map(block => block.kind);

test('markdown: GitHub-style <details> with a blank line and Markdown inside is one details block with its source span', () => {
  const blocks = GH();
  assert.deepEqual(kinds(blocks), ['heading', 'details', 'paragraph']);
  const details = blocks[1] as Extract<Block, {kind: 'details'}>;
  assert.equal(details.summary, 'Click for <b>more</b>', 'a summary is HTML, as on GitHub: Markdown punctuation in it stays literal');
  assert.equal(details.open, false);
  assert.deepEqual(kinds(details.blocks), ['paragraph', 'list']);
  assert.deepEqual([details.from, details.to], [2, 11]);
  assert.deepEqual(details.blocks.map(block => block.from), [5, 7]);
  assert.equal((GH(' open')[1] as Extract<Block, {kind: 'details'}>).open, true);
});

test('html documents and one-block details parse the same way; nested details and content in the opening chunk are kept', () => {
  const html = htmlToBlocks('<details open><summary>S</summary><p>one</p><details><summary>inner</summary><p>deep</p></details></details>');
  const outer = html[0] as Extract<Block, {kind: 'details'}>;
  assert.deepEqual([outer.kind, outer.open, outer.summary], ['details', true, 'S']);
  assert.equal((outer.blocks.find(block => block.kind === 'details') as Extract<Block, {kind: 'details'}>).summary, 'inner');
  const md = parseBlocks('<details>\n<summary>S</summary>\nfirst line right away\n\nsecond\n\n</details>', {html: true});
  const details = md[0] as Extract<Block, {kind: 'details'}>;
  assert.deepEqual(kinds(details.blocks), ['paragraph', 'paragraph']);
  const nested = parseBlocks('<details>\n<summary>a</summary>\n\n<details>\n<summary>b</summary>\n\ninner text\n\n</details>\n\nouter text\n\n</details>', {html: true});
  const a = nested[0] as Extract<Block, {kind: 'details'}>;
  assert.deepEqual(kinds(a.blocks), ['details', 'paragraph']);
});

test('unclosed or odd details never lose text: it renders as the HTML would; a missing summary says Details', () => {
  const unclosed = parseBlocks('<details>\n<summary>S</summary>\n\ntext after', {html: true});
  assert.ok(unclosed.length >= 1);
  assert.ok(plain(renderMarkdown('<details>\n<summary>S</summary>\n\ntext after', 60, {html: true, level: 'none'} as never)).join('\n').includes('text after'));
  const bare = htmlToBlocks('<details><p>x</p></details>')[0] as Extract<Block, {kind: 'details'}>;
  assert.equal(bare.summary, 'Details');
});

test('rendering: collapsed shows only the summary, expanded shows the content indented; Safe Glyphs use > and v; narrow widths fit', () => {
  const collapsed = plain(renderMarkdown(DOC, 40, {html: true, level: 'none', glyphs: 'nerd'} as never)).join('\n');
  assert.match(collapsed, /▸ Click for more/u);
  assert.doesNotMatch(collapsed, /Hidden/u);
  const open = plain(renderMarkdown(DOC, 40, {html: true, level: 'none', glyphs: 'nerd', disclosure: {isOpen: () => true}} as never));
  assert.match(open.join('\n'), /▾ Click for more/u);
  assert.ok(open.some(row => /^ {2}Hidden markdown paragraph\./u.test(row)), open.join('|'));
  assert.ok(open.some(row => /^ {2}\S? ?item one/u.test(row)));
  const safe = plain(renderMarkdown(DOC, 40, {html: true, level: 'none', glyphs: 'safe', disclosure: {isOpen: () => true}} as never)).join('\n');
  assert.match(safe, /v Click for more/u);
  for (const width of [8, 12, 30, 80]) for (const row of renderMarkdown(DOC, width, {html: true, level: 'none', disclosure: {isOpen: () => true}} as never)) assert.ok(displayWidth(row.plain) <= width, `${width}: ${row.plain}`);
  const withHtml = plain(renderHtml('<details open><summary>S</summary><p>body</p></details>', 40, {level: 'none'} as never)).join('\n');
  assert.match(withHtml, /body/u, 'the open attribute is honoured');
});

test('rows carry the disclosure key and the source line; headings inside details are still in the outline', () => {
  const rows = renderMarkdown(DOC, 60, {html: true, level: 'none', disclosure: {isOpen: () => true}} as never);
  const header = rows.find(row => row.plain.includes('Click for more'))!;
  assert.equal(header.details, 'Click for <b>more</b>#0');
  assert.equal(header.line, 2);
  assert.deepEqual(headingsOf('<details>\n<summary>s</summary>\n\n## Inside\n\n</details>', {html: true}).map(heading => heading.text), ['Inside']);
});

test('scripts and handlers in a details block are inert text', () => {
  const rows = renderMarkdown('<details open onclick="alert(1)"><summary><script>alert(1)</script>Safe</summary><img src=x onerror=alert(1)>text</details>', 60, {html: true, level: 'none'} as never);
  const text = plain(rows).join('\n');
  assert.doesNotMatch(text, /alert|onerror|onclick/u);
  assert.match(text, /Safe/u);
});

// ---- The viewer -------------------------------------------------------------------------------------------------

const doc = (text: string): ViewDocument => ({title: 'd.md', origin: {kind: 'file', path: '/x/d.md', realPath: '/x/d.md', symlink: false, bytes: text.length, mtimeMs: 0}, lines: text.split('\n'), text, format: 'markdown', language: 'markdown', notes: [], lineEnding: 'lf', complete: true});
const keys = (state: ViewerState, bytes: string, columns = 80, height = 24) => { for (const key of decodeKeys(bytes)) viewerKey(state, key, columns, height); };
const shown = (state: ViewerState, columns = 80, height = 24) => renderViewer(state, columns, height).map(row => stripAnsi(row)).join('\n');

test('viewer: z opens and closes the summary on screen, Z all that are visible, state survives scrolling and a resize and never touches the source', () => {
  const state = createViewer(doc(`${DOC}\n\n<details>\n<summary>Second</summary>\n\nBody two.\n\n</details>\n`));
  assert.match(shown(state), /▸ Click for more/u);
  assert.doesNotMatch(shown(state), /Hidden markdown/u);
  keys(state, 'z');
  assert.match(shown(state), /Hidden markdown paragraph/u);
  assert.doesNotMatch(shown(state), /Body two/u);
  assert.match(shown(state, 50), /Hidden markdown paragraph/u, 'a resize keeps the state');
  keys(state, 'z');
  assert.doesNotMatch(shown(state), /Hidden markdown/u);
  keys(state, 'Z');
  assert.match(shown(state), /Hidden markdown paragraph/u); assert.match(shown(state), /Body two/u);
  keys(state, 'Z');
  assert.doesNotMatch(shown(state), /Body two/u);
  assert.equal(state.document.text, `${DOC}\n\n<details>\n<summary>Second</summary>\n\nBody two.\n\n</details>\n`);
});

test('viewer: the state follows the summary text, so editing above does not lose it; the control row names z', () => {
  const state = createViewer(doc(DOC));
  keys(state, 'z');
  state.document = doc(`New first paragraph.\n\nAnother.\n\n${DOC}`);
  delete state.markdown;
  assert.match(shown(state), /Hidden markdown paragraph/u);
  assert.match(shown(state, 110), /z details/u);
});

// ---- Workspace modes --------------------------------------------------------------------------------------------

import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocumentSession, documentSessionKey, renderDocumentSession} from '../src/viewer/DocumentWorkspace.js';
import {openForEdit} from '../src/viewer/fileEdit.js';

async function workspace() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-details-')));
  const path = join(root, 'd.md'); writeFileSync(path, `${DOC}\n`);
  const opened = await openForEdit(path, '/');
  if (!opened.ok) throw new Error(opened.reason);
  return {root, state: createDocumentSession(opened.file, 'source')};
}
const press = (state: ReturnType<typeof createDocumentSession>, bytes: string, columns = 120, height = 24) => { for (const key of decodeKeys(bytes)) documentSessionKey(state, key, columns, height); };
const draw = (state: ReturnType<typeof createDocumentSession>, columns = 120, height = 24) => renderDocumentSession(state, columns, height).map(row => stripAnsi(row)).join('\n');

test('preview, split and hybrid all show details; z works in the preview and in the split\'s preview pane; the text is never changed', async () => {
  const { root, state } = await workspace();
  try {
    press(state, 'h');
    assert.equal(state.mode, 'preview');
    assert.match(draw(state), /▸ Click for more/u);
    press(state, 'z');
    assert.match(draw(state), /Hidden markdown paragraph/u);
    press(state, 'z');
    assert.doesNotMatch(draw(state), /Hidden markdown/u);
    press(state, '\u001b');
    press(state, 's');
    assert.equal(state.mode, 'split');
    assert.match(draw(state, 140), /▸ Click for more/u);
    press(state, 'z', 140);
    assert.match(draw(state, 140).split('\n').map(row => row.split('│').at(-1)!).join('\n'), /Hidden markdown paragraph/u);
    press(state, '\u001b');
    press(state, 'H', 120);
    assert.equal(state.mode, 'hybrid');
    state.editor.buffer.caret = {line: 0, column: 0};
    assert.match(draw(state), /Click for more/u, 'hybrid renders the block when the caret is elsewhere');
    state.editor.buffer.caret = {line: 3, column: 3};
    assert.match(draw(state), /<summary>Click for <b>more<\/b><\/summary>/u, 'and shows its source under the caret');
    assert.equal(state.editor.buffer.text, `${DOC}\n`.replace(/\n$/u, ''));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('many unclosed <details> cost a bounded amount in total (one scan budget per parse), and a normal document still pairs its tags', () => {
  const lines: string[] = [];
  for (let index = 0; index < 15_000; index += 1) lines.push('<details>', `<summary>s${index}</summary>`, '');
  const started = process.hrtime.bigint();
  const blocks = parseBlocks(lines.join('\n'), {html: true});
  assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 3, 'bounded');
  assert.ok(blocks.length > 0);
  const paired = parseBlocks(['<details>', '<summary>a</summary>', '', 'x', '', '</details>', '', '<details>', '<summary>b</summary>', '', 'y', '', '</details>'].join('\n'), {html: true});
  assert.deepEqual(paired.map(block => block.kind), ['details', 'details']);
});
