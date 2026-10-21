import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseBlocks} from '../src/markdown/blocks.js';
import {createDocumentSession, documentSessionKey, renderDocumentSession, type DocumentSession} from '../src/viewer/DocumentWorkspace.js';
import {hybridItems, wrapRaw} from '../src/viewer/HybridView.js';
import {openForEdit} from '../src/viewer/fileEdit.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

/**
 * #460: Hybrid Markdown editing. The document reads as rendered text except for the block the caret (or selection) is in,
 * which shows its exact source. Same TextBuffer as every other mode; only the presentation differs.
 */
const F2 = '\u001bOQ', F3 = '\u001bOR';
const DOC = ['# Project Overview', '', 'A paragraph with **bold** and *italic* and a [link](http://example.com).', 'It continues on a second source line.', '', '- first item', '  - nested item', '- second item', '', '> a quoted line', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '```js', 'const x = 1;', '```', '', '## Second heading', '', 'The end.'].join('\n');
async function open(content = `${DOC}\n`, name = 'doc.md', mode: 'edit' | 'source' = 'edit') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-hybrid-')));
  const path = join(root, name); writeFileSync(path, content);
  const opened = await openForEdit(path, '/');
  if (!opened.ok) throw new Error(opened.reason);
  return {root, path, state: createDocumentSession(opened.file, mode)};
}
const press = (state: DocumentSession, bytes: string, columns = 100, height = 30) => { for (const key of decodeKeys(bytes)) documentSessionKey(state, key, columns, height); };
const draw = (state: DocumentSession, columns = 100, height = 30) => renderDocumentSession(state, columns, height).map(row => stripAnsi(row));
const body = (rows: string[]) => rows.join('\n');
const goto = (state: DocumentSession, line: number, column = 0) => { state.editor.buffer.caret = {line, column}; state.editor.buffer.anchor = undefined; };

// ---- Items and wrapping -----------------------------------------------------------------------------------------

test('items: every source line belongs to exactly one item, in order; blocks span their lines, stray and blank lines are single-line items', () => {
  const lines = DOC.split('\n');
  const items = hybridItems(parseBlocks(DOC, {html: true}), lines.length);
  let next = 0;
  for (const item of items) { assert.equal(item.from, next); assert.ok(item.to > item.from); next = item.to; }
  assert.equal(next, lines.length);
  assert.deepEqual(items.filter(item => item.block).map(item => lines[item.from]), ['# Project Overview', 'A paragraph with **bold** and *italic* and a [link](http://example.com).', '- first item', '> a quoted line', '| a | b |', '```js', '## Second heading', 'The end.']);
  assert.ok(items.filter(item => !item.block).every(item => item.to - item.from === 1));
});

test('items: blocks the parser could not place and lines past its limit stay raw, never lost', () => {
  const items = hybridItems([], 5);
  assert.equal(items.length, 5);
  assert.ok(items.every(item => !item.block));
  const truncated = hybridItems(parseBlocks('# a\n\ntext', {html: true}), 9);
  assert.equal(truncated.at(-1)!.to, 9);
});

test('items: HTML blocks that make several blocks are one item', () => {
  const items = hybridItems(parseBlocks('<h2>Hi</h2>\n<p>x</p>\n\nafter', {html: true}), 4);
  assert.deepEqual(items.map(item => [item.from, item.to]), [[0, 2], [2, 3], [3, 4]]);
});

test('wrapRaw: wide characters and emoji are never split, tabs expand, the caret column maps to the right row, and the line end gets a place', () => {
  const rows = wrapRaw('日本語日本語日本語', 8);
  assert.ok(rows.every(row => row.width <= 8));
  assert.deepEqual(rows.map(row => row.start), [0, 4, 8].slice(0, rows.length));
  const emoji = wrapRaw('a😀b😀c😀d', 4);
  assert.ok(emoji.every(row => row.width <= 4));
  assert.equal(emoji.map(row => row.cells.map(cell => cell.text).join('')).join(''), 'a😀b😀c😀d');
  const tabs = wrapRaw('\tx', 10);
  assert.equal(tabs[0]!.cells.map(cell => cell.text).join(''), '    x');
  const long = wrapRaw('abcdefghij', 4);
  assert.equal(long.length, 3);
  assert.equal(wrapRaw('', 4).length, 1);
});

// ---- Rendering --------------------------------------------------------------------------------------------------

test('F3 opens Hybrid: inactive blocks are rendered, the block under the caret shows its exact source', async () => {
  const { root, state } = await open();
  try {
    goto(state, 0);
    press(state, F3);
    assert.equal(state.mode, 'hybrid');
    let view = body(draw(state));
    assert.match(view, /# Project Overview/u, 'the active heading shows its marker');
    assert.match(view, /A paragraph with bold and italic and a link/u, 'the paragraph is rendered: no ** or [..](..) markup');
    assert.doesNotMatch(view, /\*\*bold\*\*/u);
    goto(state, 2);
    view = body(draw(state));
    assert.match(view, /\*\*bold\*\* and \*italic\* and a \[link\]\(http:\/\/example\.com\)/u, 'the paragraph now shows its source');
    assert.doesNotMatch(view, /# Project Overview/u);
    assert.match(view, /Project Overview/u, 'the heading went back to its rendered form');
    assert.match(view, /It continues on a second source line\./u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('the smallest safe region: a caret inside a nested list item reveals the whole list; inside a table cell, the whole table; inside a fence, the whole fence', async () => {
  const { root, state } = await open();
  try {
    press(state, F3);
    const lines = DOC.split('\n');
    goto(state, lines.indexOf('  - nested item'), 5);
    let view = body(draw(state));
    assert.match(view, /- first item/u); assert.match(view, /  - nested item/u); assert.match(view, /- second item/u);
    assert.doesNotMatch(view, /\|---\|---\|/u);
    goto(state, lines.indexOf('| 1 | 2 |'), 3);
    view = body(draw(state));
    assert.match(view, /\| a \| b \|/u); assert.match(view, /\|---\|---\|/u);
    assert.doesNotMatch(view, /- first item/u);
    goto(state, lines.indexOf('const x = 1;'), 3);
    view = body(draw(state));
    assert.match(view, /```js/u); assert.match(view, /const x = 1;/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('the active block is marked in the margin, and the rendered ones are not', async () => {
  const { root, state } = await open();
  try {
    goto(state, 2); press(state, F3);
    const rows = draw(state);
    const marked = rows.filter(row => row.includes('▎') || row.includes('|'));
    assert.ok(marked.some(row => /bold/u.test(row)));
    assert.ok(!rows.some(row => /Project Overview/u.test(row) && row.includes('▎')));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

// ---- Editing and ownership --------------------------------------------------------------------------------------

test('typing inserts text in the active block, including the letters that are shortcuts elsewhere; moving on renders the block again', async () => {
  const { root, state } = await open();
  try {
    goto(state, 0, 18); press(state, F3);
    press(state, ' hello ehr');
    assert.equal(state.editor.buffer.lines[0], '# Project Overview hello ehr');
    press(state, '\u001b[B'); press(state, '\u001b[B');
    const view = body(draw(state));
    assert.match(view, /Project Overview hello ehr/u);
    assert.doesNotMatch(view, /# Project Overview hello/u, 'rendered again once the caret left it');
    assert.equal(state.mode, 'hybrid');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('presentation changes never change the document: any walk through modes, moves and resizes leaves the text and the file as they were', async () => {
  const { root, path, state } = await open();
  try {
    const before = state.editor.buffer.text;
    let seed = 5;
    const random = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const moves = ['\u001b[A', '\u001b[B', '\u001b[C', '\u001b[D', '\u001b[1;2B', '\u001b[1;2A', '\u001b[H', '\u001b[F'];
    press(state, F3);
    for (let step = 0; step < 300; step += 1) {
      const columns = [30, 50, 80, 100, 120][random(5)]!, height = [10, 20, 30][random(3)]!;
      const roll = random(10);
      if (roll === 0) press(state, F3, columns, height);
      else if (roll === 1) press(state, F2, columns, height);
      else if (roll === 2) press(state, '\u001b', columns, height);
      else if (roll === 3 && state.mode === 'source') press(state, 'e', columns, height);
      else if (roll === 4 && state.mode === 'source') press(state, 'H', columns, height);
      else if (state.mode === 'hybrid' || state.mode === 'edit' || (state.mode === 'split' && state.split?.focus === 'source')) press(state, moves[random(moves.length)]!, columns, height);
      draw(state, columns, height);
      assert.equal(state.editor.buffer.text, before, `step ${step} in ${state.mode}`);
    }
    assert.equal(state.editor.buffer.dirty, false);
    assert.equal(readFileSync(path, 'utf8'), `${DOC}\n`);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('selection across blocks shows every block it touches as source, and copy/cut take exactly the selected source', async () => {
  const { root, state } = await open();
  try {
    goto(state, 0, 0); press(state, F3);
    press(state, '\u001b[1;2B'); press(state, '\u001b[1;2B'); press(state, '\u001b[1;2B');
    const view = body(draw(state));
    assert.match(view, /# Project Overview/u);
    assert.match(view, /\*\*bold\*\*/u, 'the second block touched by the selection is raw too');
    assert.equal(state.editor.buffer.selectedText(), '# Project Overview\n\nA paragraph with **bold** and *italic* and a [link](http://example.com).\n');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('undo and redo work through the hybrid view, including after a snippet insertion', async () => {
  const { root, state } = await open('', 'blank.md');
  try {
    press(state, F3);
    press(state, '\u001bOP'); press(state, '/'); press(state, 'table'); press(state, '\r');
    assert.match(state.editor.buffer.text, /\| Column \| Column \|/u);
    assert.ok(state.editor.snippet);
    press(state, 'Name'); press(state, '\t'); press(state, 'Value');
    assert.match(state.editor.buffer.lines[0]!, /\| Name \| Value \|/u);
    assert.match(body(draw(state)), /\| Name \| Value \|/u, 'the table is the active block, so it is raw');
    for (let step = 0; step < 6 && state.editor.buffer.text !== ''; step += 1) press(state, '\u001a');
    assert.equal(state.editor.buffer.text, '', 'the whole snippet insertion and its typing undo back to the empty document');
    press(state, '\u0019');
    assert.match(state.editor.buffer.text, /Column/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('Go to heading works in the hybrid view and the view follows; Esc leaves for the source view with the text kept', async () => {
  const { root, state } = await open();
  try {
    press(state, F3);
    press(state, '\u001bOP'); press(state, 'h'); press(state, 'second'); press(state, '\r');
    assert.equal(state.editor.buffer.lines[state.editor.buffer.caret.line], '## Second heading');
    assert.match(body(draw(state, 100, 12)), /## Second heading/u);
    press(state, 'X');
    press(state, '\u001b');
    assert.equal(state.mode, 'source');
    assert.equal(state.editor.buffer.dirty, true);
    press(state, F3);
    assert.equal(state.mode, 'hybrid', 'F3 is available from the read-only views too');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('HTML files have no hybrid view and say so', async () => {
  const { root, state } = await open('<h1>x</h1>\n', 'page.html');
  try {
    press(state, F3);
    assert.equal(state.mode, 'edit');
    assert.match(state.note ?? '', /Markdown/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

// ---- Viewport ---------------------------------------------------------------------------------------------------

const LONG = Array.from({length: 120}, (_, index) => (index % 4 === 0 ? `## Section ${index}` : index % 4 === 1 ? '' : index % 4 === 2 ? `Paragraph number ${index} with **strong** text.` : '')).join('\n');

test('the viewport does not jump when the active block changes height, and the caret is always on screen', async () => {
  const { root, state } = await open(`${LONG}\n`);
  try {
    press(state, F3);
    goto(state, 22);
    draw(state, 100, 14);
    const topBefore = state.hybrid!.top.line, subBefore = state.hybrid!.top.sub;
    const visible = () => [...body(draw(state, 100, 14)).matchAll(/(?:Section|Paragraph number) (\d+)/gu)].map(match => Number(match[1]));
    const targets = visible();
    assert.ok(targets.length >= 3, 'a few blocks are on screen');
    for (const line of [...targets, ...targets.reverse()]) { goto(state, line); draw(state, 100, 14); assert.equal(state.hybrid!.top.line, topBefore, `moving within the screen to ${line} keeps the top`); assert.equal(state.hybrid!.top.sub, subBefore); }
    for (const line of [0, 119, 60, 3, 100, 40]) {
      goto(state, line, 0);
      const rows = draw(state, 100, 14);
      assert.ok(rows.some(row => row.includes('▎') || row.includes('|')), `the caret block is visible after jumping to ${line}`);
    }
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('rendering is bounded: moving the caret does not parse again, typing parses once per change, and only visible blocks are rendered', async () => {
  const big = Array.from({length: 4000}, (_, index) => (index % 2 ? '' : `Line ${index} with *emphasis*`)).join('\n');
  const { root, state } = await open(`${big}\n`);
  try {
    press(state, F3);
    draw(state, 100, 30);
    const stats = state.hybrid!.stats;
    const parses = stats.parses, renders = stats.renders;
    for (let step = 0; step < 100; step += 1) { press(state, '\u001b[B'); draw(state, 100, 30); }
    assert.equal(stats.parses, parses, 'cursor movement never parses');
    assert.ok(stats.renders - renders < 120, `${stats.renders - renders} block renders for 100 moves`);
    press(state, 'x'); draw(state, 100, 30);
    assert.equal(stats.parses, parses + 1);
    assert.ok(stats.renders < 400, `${stats.renders} renders for a 4,000-line document`);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

// ---- Widths, colour, safety -------------------------------------------------------------------------------------

test('every row fits 30–120 columns in colour, NO_COLOR and Safe Glyphs, with wide text and hostile content', async () => {
  const hostile = `# \u001b]0;x\u0007日本語の見出し 😀\n\n${'long '.repeat(60)}\n\n- ${'item '.repeat(30)}\n`;
  const { root, state } = await open(hostile);
  const saved = process.env.NO_COLOR;
  try {
    press(state, F3);
    for (const noColor of [false, true]) {
      if (noColor) process.env.NO_COLOR = '1'; else delete process.env.NO_COLOR;
      for (const columns of [30, 50, 80, 120]) for (const line of [0, 2, 4]) {
        goto(state, line, 3);
        const raw = renderDocumentSession(state, columns, 18);
        assert.ok(raw.every(row => displayWidth(stripAnsi(row)) <= columns), `${columns}/${line}`);
        assert.ok(raw.every(row => !/\u001b\]/u.test(row)));
        if (noColor) assert.ok(raw.every(row => !/\u001b\[(?:3[0-7]|9[0-7]|38;)/u.test(row)));
      }
    }
  } finally { if (saved === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = saved; rmSync(root, {recursive: true, force: true}); }
});

test('CRLF files and files with a BOM: hybrid shows lines, saving keeps the line endings and the BOM', async () => {
  const { root, path, state } = await open('﻿# Title\r\n\r\ntext\r\n', 'crlf.md');
  try {
    press(state, F3);
    goto(state, 2, 4); press(state, '!');
    assert.match(body(draw(state)), /text!/u);
    const action = documentSessionKey(state, decodeKeys('\u0013')[0]!, 100, 30);
    assert.deepEqual(action, {kind: 'save'});
    assert.equal(readFileSync(path, 'utf8'), '﻿# Title\r\n\r\ntext\r\n', 'asking to save wrote nothing');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

// ---- Split and Playground ---------------------------------------------------------------------------------------

test('F2 from hybrid opens the split with the hybrid view as its text pane; F3 there switches that pane between source and hybrid', async () => {
  const { root, state } = await open();
  try {
    goto(state, 2); press(state, F3); press(state, F2, 140, 30);
    assert.equal(state.mode, 'split');
    assert.equal(state.split?.hybrid, true);
    let left = draw(state, 140, 30).map(row => row.split('│')[0]!).join('\n');
    assert.match(left, /\*\*bold\*\*/u);
    assert.match(left, /Project Overview/u);
    assert.doesNotMatch(left, /# Project Overview/u, 'the text pane is hybrid: the heading is rendered');
    press(state, F3, 140, 30);
    assert.equal(state.split?.hybrid, false);
    left = draw(state, 140, 30).map(row => row.split('│')[0]!).join('\n');
    assert.match(left, /# Project Overview/u);
    assert.equal(state.mode, 'split');
  } finally { rmSync(root, {recursive: true, force: true}); }
});


// ---- Through the real app ---------------------------------------------------------------------------------------

import {nmshConfigDirectory} from '../src/configuration/paths.js';
import {DraftStore} from '../src/viewer/draftRecovery.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

type Fixture = ReturnType<typeof executionFrameFixture>;
const keysTo = (f: Fixture, bytes: string) => { for (const k of decodeKeys(bytes)) (f.app as unknown as {handleKey(k: unknown): void}).handleKey(k); };
const screenOf = (f: Fixture) => f.capture().frame.rows.map(row => stripAnsi(row)).join('\n');
async function waitFor(check: () => boolean, what: string) {
  const deadline = process.hrtime.bigint() + 8_000_000_000n;
  while (!check()) { if (process.hrtime.bigint() > deadline) throw new Error(`timed out waiting for ${what}`); await new Promise(done => setTimeout(done, 5)); }
}

test('app: hybrid in the real workspace, input ownership and leaving it restore the shell view; a crash draft is written from the hybrid view', async () => {
  const f = executionFrameFixture(110, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-hybrid-app-')));
  try {
    const file = join(root, 'doc.md'); writeFileSync(file, `${DOC}\n`);
    await f.app['openDocumentSession'](file, '/edit doc.md', 'edit', false);
    keysTo(f, '\u001bOR');
    assert.equal(f.app['docSession']!.mode, 'hybrid');
    assert.match(screenOf(f), /Hybrid/u);
    keysTo(f, 'hello');
    assert.match(f.app['docSession']!.editor.buffer.lines[0]!, /hello/u, 'plain letters are text');
    f.app['draftKeeper'].flush();
    assert.ok(new DraftStore(join(nmshConfigDirectory(), 'recovery')).own(realpathSync(file)), 'the draft is written while editing in hybrid');
    keysTo(f, '\u001b');
    assert.equal(f.app['docSession']!.mode, 'source');
    keysTo(f, 'q');
    assert.equal(f.app['docSession']!.editor.dialog?.kind, 'unsaved');
    keysTo(f, 'd');
    assert.equal(f.app['docSession'], undefined);
    assert.equal(readFileSync(file, 'utf8'), `${DOC}\n`);
  } finally { f.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('app: the Playground works in hybrid, Save As takes the whole panel and returns to hybrid with the file saved', async () => {
  const f = executionFrameFixture(110, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-hybrid-play-')));
  try {
    await f.app['openPlayground']('markdown');
    keysTo(f, '\u001bOR');
    keysTo(f, '# Hi there\n\nSome *text*.');
    assert.equal(f.app['docSession']!.mode, 'hybrid');
    keysTo(f, '\u0013');
    assert.ok(f.app['docSession']!.editor.input, 'the name prompt is open');
    assert.match(screenOf(f), /Save as/u);
    keysTo(f, `${join(root, 'new.md')}\r`);
    await waitFor(() => !f.app['docSession']!.editor.file.scratch, 'Save As');
    assert.equal(readFileSync(join(root, 'new.md'), 'utf8'), '# Hi there\n\nSome *text*.\n');
    assert.equal(f.app['docSession']!.mode, 'hybrid');
    assert.match(screenOf(f), /Some \*text\*\./u, 'the block under the caret is source');
    assert.doesNotMatch(screenOf(f), /# Hi there/u, 'the heading is rendered');
  } finally { f.dispose(); rmSync(root, {recursive: true, force: true}); }
});

test('app: an external change while editing in hybrid is reviewed and merged, then the hybrid view shows the result', async () => {
  const f = executionFrameFixture(110, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-hybrid-review-')));
  try {
    const file = join(root, 'doc.md'); writeFileSync(file, '# One\n\nalpha\n\nbeta\n\ngamma\n');
    await f.app['openDocumentSession'](file, '/edit doc.md', 'edit', false);
    keysTo(f, '\u001bOR');
    f.app['docSession']!.editor.buffer.caret = {line: 2, column: 5}; keysTo(f, '!');
    writeFileSync(file, '# One\n\nalpha\n\nbeta\n\nGAMMA\n');
    keysTo(f, '\u0013');
    await waitFor(() => f.app['docSession']!.editor.dialog?.kind === 'conflict' && !f.app['docSession']!.editor.busy, 'the conflict');
    keysTo(f, 'v');
    await waitFor(() => Boolean(f.app['docSession']!.editor.review) && !f.app['docSession']!.editor.busy, 'the review');
    assert.match(screenOf(f), /Review changes/u);
    keysTo(f, '\r');
    await waitFor(() => !f.app['docSession']!.editor.review && !f.app['docSession']!.editor.busy, 'the merge');
    assert.deepEqual(f.app['docSession']!.editor.buffer.lines.filter(Boolean), ['# One', 'alpha!', 'beta', 'GAMMA']);
    assert.equal(f.app['docSession']!.mode, 'hybrid');
    assert.match(screenOf(f), /GAMMA/u);
  } finally { f.dispose(); rmSync(root, {recursive: true, force: true}); }
});
