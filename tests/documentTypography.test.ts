import test from 'node:test';
import assert from 'node:assert/strict';
import {BASELINE_CAPABILITIES} from '../src/host/capabilities.js';
import {renderHtml, renderMarkdown, type ImageProvider, type ImageSlot, type MarkdownRow} from '../src/markdown/render.js';
import {configureTextSizing} from '../src/ui/textSizing.js';
import {setSizedBackend, setTextSizing} from '../src/ui/typography.js';
import {createViewer, renderViewer, viewerKey, type ViewerLook} from '../src/viewer/ViewerPanel.js';
import type {ViewDocument} from '../src/viewer/document.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const scaled = {...BASELINE_CAPABILITIES, textSizing: {scale: true, width: true}};
const enable = () => configureTextSizing({setting: 'auto', capabilities: scaled, env: {TERM_PROGRAM: 'kitty'}});
const disable = () => { setSizedBackend(undefined); setTextSizing({mode: 'auto', capability: {scale: false, width: false}, knownUnrendered: false}); };
const level = 'truecolor' as const;

/** A provider with fixed outcomes per source. */
function provider(ready: Record<string, number>, notes: Record<string, string> = {}): ImageProvider & {asked: string[]} {
  const asked: string[] = [];
  return {
    asked,
    slot(src: string, _alt: string): ImageSlot | undefined {
      asked.push(src);
      const rows = ready[src];
      return {
        index: asked.length - 1,
        ...(notes[src] ? {note: notes[src]} : {}),
        place: (columns, maxRows) => rows === undefined ? undefined : {lines: Array.from({length: Math.min(rows, maxRows)}, () => 'X'.repeat(Math.min(columns, 6))), columns: Math.min(columns, 6), rows: Math.min(rows, maxRows)},
      };
    },
  };
}
const plain = (rows: MarkdownRow[]) => rows.map(row => stripAnsi(row.ansi));

test('Markdown: an image alone in its paragraph becomes rows when it can be shown, otherwise a placeholder with the reason', () => {
  const ready = provider({'assets/logo.png': 3});
  const rows = renderMarkdown('Intro\n\n![Logo](assets/logo.png)\n\nAfter', 60, {images: ready, level});
  assert.deepEqual(rows.map(row => row.kind), ['text', 'blank', 'image', 'image', 'image', 'blank', 'text']);
  assert.deepEqual(rows.filter(row => row.kind === 'image').map(row => row.plain), ['[image: Logo]', '', ''], 'copy and search see the alt text once');
  assert.equal(rows[2]!.image, 0);
  assert.ok(rows.every(row => displayWidth(row.ansi) <= 60));
  const refused = provider({}, {'https://x.test/a.png': 'remote images are not fetched'});
  const placeholder = renderMarkdown('![Banner](https://x.test/a.png)', 60, {images: refused, level});
  assert.equal(placeholder.length, 1);
  assert.match(stripAnsi(placeholder[0]!.ansi), /\[image: Banner\] \(remote images are not fetched\)/u);
  assert.equal(renderMarkdown('![Logo](assets/logo.png)', 60, {level})[0]!.plain, '[image: Logo]', 'no provider: the placeholder as before');
});

test('Markdown: images among words stay placeholders; a linked image shows its host; several images stack; the row cap holds', () => {
  const images = provider({'a.png': 2, 'b.png': 2, 'big.png': 40});
  const mixed = renderMarkdown('See ![a](a.png) in the text', 60, {images, level});
  assert.deepEqual(mixed.map(row => row.kind), ['text']);
  assert.match(mixed[0]!.plain, /See \[image: a\] in the text/u);
  const linked = renderMarkdown('[![CI](a.png)](https://example.com/ci)', 60, {images, level});
  assert.deepEqual(linked.map(row => row.kind), ['image', 'image', 'text']);
  assert.match(linked.at(-1)!.plain, /example\.com/u);
  const stack = renderMarkdown('![a](a.png) ![b](b.png)', 60, {images, level});
  assert.equal(stack.filter(row => row.kind === 'image').length, 4);
  const capped = renderMarkdown('![big](big.png)', 60, {images, maxImageRows: 10, level});
  assert.equal(capped.filter(row => row.kind === 'image').length, 10);
});

test('HTML: <img> sources reach the provider decoded and bounded, never fetched; scripts and odd schemes are just strings', () => {
  const images = provider({'a&b.png': 1, 'p.png': 1});
  const rows = renderHtml('<p><img src="a&amp;b.png" alt="Pair"></p><div><picture><source srcset="x.webp"><img src="p.png" alt="Pic"></picture></div>', 60, {images, level});
  assert.deepEqual(images.asked.slice(0, 2), ['a&b.png', 'p.png']);
  assert.equal(rows.filter(row => row.kind === 'image').length, 2);
  const hostile = provider({});
  renderHtml('<img src="javascript:alert(1)" alt="x"><img src="file:///etc/passwd" alt="y"><img src="data:image/png;base64,AAAA" alt="z"><img onerror="x()" alt="w">', 60, {images: hostile, level});
  assert.deepEqual(hostile.asked, ['javascript:alert(1)', 'file:///etc/passwd', 'data:image/png;base64,AAAA'], 'passed on as plain strings for the graphics service to refuse');
  const long = provider({});
  renderHtml(`<img src="${'a'.repeat(5000)}" alt="long">`, 60, {images: long, level});
  assert.ok(!long.asked[0] || long.asked[0].length <= 2000, 'an absurd source is bounded or ignored');
});

test('headings: H1 to H6 map onto one scale, in Markdown and in HTML, only when the viewer asks and the terminal was shown to scale', () => {
  enable();
  try {
    const options = {sizedHeadings: {maxRows: 3}, level};
    const md = renderMarkdown('# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six', 100, options);
    const heads = md.filter(row => row.block?.index === 0 || row.kind === 'heading' && !row.block);
    assert.deepEqual(heads.map(row => row.block?.of ?? 1), [3, 2, 2, 1, 1, 1]);
    assert.match(heads[0]!.block!.sized!.sequence, /\u001b\]66;s=3;One\u001b\\/u);
    assert.match(heads[1]!.block!.sized!.sequence, /\u001b\]66;s=2;Two\u001b\\/u);
    assert.match(heads[2]!.block!.sized!.sequence, /\u001b\]66;s=2:n=3:d=4:v=2;Three\u001b\\/u);
    const html = renderHtml('<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4>', 100, options);
    assert.deepEqual(html.filter(row => row.block?.index === 0).map(row => row.block!.of), [3, 2, 2], 'the same typography for HTML headings');
    assert.equal(md.find(row => row.block?.index === 0)!.plain, 'One', 'search and copy see the words');
    assert.equal(md.filter(row => row.block && row.block.index > 0).every(row => row.plain === '' && stripAnsi(row.ansi) === ''), true);
    assert.equal(renderMarkdown('# One', 100, {level}).some(row => row.block), false, 'not unless asked (transcripts, agent replies)');
    assert.equal(renderMarkdown('> # In a quote\n\n- # In a list', 100, options).some(row => row.block), false, 'a block cannot sit behind a bar or a bullet');
    assert.equal(renderMarkdown('# 日本語 heading', 100, options).some(row => row.block), false, 'text of uncertain width stays plain');
    assert.equal(renderMarkdown('# One', 50, options).find(row => row.block)?.block?.sized?.sequence.includes('s=2'), true, 'a narrower window gets 2x');
    assert.equal(renderMarkdown('# One', 30, options).some(row => row.block), false, 'a very narrow window gets ordinary text');
  } finally { disable(); }
});

test('headings keep their inline styling piece by piece, and plain rendering is unchanged without scaling', () => {
  enable();
  try {
    const rows = renderMarkdown('## Use `npm test` and **bold**', 100, {sizedHeadings: {maxRows: 3}, level});
    const sequence = rows[0]!.block!.sized!.sequence;
    assert.equal((sequence.match(/\u001b\]66;/gu) ?? []).length, 4, 'one sized piece per styled span');
    assert.match(sequence, /\u001b\[1m[^]*Use /u);
    assert.equal(stripAnsi(sequence.replace(/\u001b\]66;[^;]*;([^\u001b]*)\u001b\\/gu, '$1')), 'Use npm test and bold');
  } finally { disable(); }
  const rows = renderMarkdown('# One', 100, {sizedHeadings: {maxRows: 3}, level});
  assert.deepEqual(rows.map(row => row.kind), ['heading']);
  assert.equal(rows[0]!.block, undefined);
});

// ---- the viewer ------------------------------------------------------------------------------------------------------

function doc(text: string, format: ViewDocument['format'] = 'markdown'): ViewDocument {
  return {title: 'README.md', origin: {kind: 'file', path: '/x/README.md', realPath: '/x/README.md', symlink: false, bytes: text.length, mtimeMs: 0}, lines: text.split('\n'), text, format, notes: [], lineEnding: 'lf', complete: true};
}
const SOURCE = '# Title\n\nIntro paragraph.\n\n## Section\n\nMore text here.\n\n' + Array.from({length: 40}, (_, i) => `Line ${i}`).join('\n\n');
const look: ViewerLook = {sized: true};

test('viewer: a sized heading is an overlay over its blank rows when every row is on screen; elsewhere its plain text', () => {
  enable();
  try {
    const state = createViewer(doc(SOURCE));
    const rows = renderViewer(state, 100, 30, look).map(row => stripAnsi(row));
    assert.equal(state.overlays?.length, 2, 'the H1 and the H2 are both on screen');
    const [first, second] = state.overlays!;
    assert.equal(first!.rows, 3);
    assert.equal(second!.rows, 2);
    for (const block of state.overlays!) {
      for (let row = block.y; row < block.y + block.rows; row += 1) assert.equal(rows[row]!.slice(block.x, block.x + block.columns).trim(), '', 'blank cells under the block');
    }
    assert.ok(!rows.join('\n').includes('Title'), 'the words are in the sized block, not repeated as text');
    // Scrolled so the H1 is cut at the top: its plain row shows (if its first row is on screen) and no overlay is placed for it.
    viewerKey(state, {kind: 'down'}, 100, 26, look);
    renderViewer(state, 100, 30, look);
    assert.equal(state.overlays!.length, 1);
    viewerKey(state, {kind: 'down'}, 100, 26, look);
    viewerKey(state, {kind: 'down'}, 100, 26, look);
    const scrolled = renderViewer(state, 100, 30, look).map(row => stripAnsi(row));
    assert.equal(state.overlays!.length, 1);
    assert.ok(!scrolled.join('\n').includes('Title'));
    // A block at the bottom edge with only some rows visible is not placed.
    const small = createViewer(doc('# Title\n\ntext'));
    renderViewer(small, 100, 7, look);
    assert.deepEqual(small.overlays, [], 'no room for three rows plus chrome: plain text');
    // Without scaling nothing changes.
    disable();
    const plain = createViewer(doc(SOURCE));
    const plainRows = renderViewer(plain, 100, 30, {sized: true}).map(row => stripAnsi(row));
    assert.deepEqual(plain.overlays, []);
    assert.ok(plainRows.join('\n').includes('Title'));
  } finally { disable(); }
});

test('viewer: a search match in a heading shows plain text with the highlight; copy gives the source with no escape sequences', () => {
  enable();
  try {
    const state = createViewer(doc(SOURCE));
    renderViewer(state, 100, 30, look);
    viewerKey(state, {kind: 'text', value: '/'}, 100, 26, look);
    for (const char of 'Title') viewerKey(state, {kind: 'text', value: char}, 100, 26, look);
    viewerKey(state, {kind: 'enter'}, 100, 26, look);
    const rows = renderViewer(state, 100, 30, look).map(row => stripAnsi(row));
    assert.equal(state.overlays!.length, 1, 'the matching heading is drawn as text so the highlight shows');
    assert.ok(rows.join('\n').includes('Title'));
    const action = viewerKey(state, {kind: 'text', value: 'c'}, 100, 26, look);
    assert.equal(action?.kind, 'copy');
    assert.equal((action as {text: string}).text, SOURCE);
    assert.doesNotMatch((action as {text: string}).text, /\u001b/u);
  } finally { disable(); }
});

test('viewer: the i key opens the image nearest the top, and says so when a document has none', () => {
  const images = Object.assign(provider({'a.png': 3, 'b.png': 3}), {count: 2, version: 1});
  const state = createViewer(doc('Intro\n\n![A](a.png)\n\ntext\n\n![B](b.png)'));
  const withImages: ViewerLook = {images};
  renderViewer(state, 80, 40, withImages);
  const action = viewerKey(state, {kind: 'text', value: 'i'}, 80, 36, withImages);
  assert.deepEqual(action, {kind: 'image', index: 0});
  const none = createViewer(doc('no pictures'));
  const empty: ViewerLook = {images: Object.assign(provider({}), {count: 0, version: 1})};
  renderViewer(none, 80, 20, empty);
  assert.equal(viewerKey(none, {kind: 'text', value: 'i'}, 80, 16, empty), undefined);
  assert.equal(none.note, 'No images in this document.');
});
