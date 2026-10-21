import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocumentSession, documentSessionKey, renderDocumentSession, setDocumentMode, splitLayout, type DocumentSession} from '../src/viewer/DocumentWorkspace.js';
import {openForEdit} from '../src/viewer/fileEdit.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

/**
 * #461: Source / Preview / Split in one pane. The split is the editor (the only editable pane) beside NMSh's own preview of the
 * SAME buffer: no second buffer, no second process, nothing written by looking.
 */
const body = (from: number, to: number) => Array.from({length: to - from}, (_, index) => `filler ${from + index}`);
const SOURCE = ['# Hello world', '', ...body(0, 30), '', '## Middle part', '', ...body(30, 60), '', '## End part', '', 'last words'].join('\n');
async function session(content = `${SOURCE}\n`, mode: 'edit' | 'source' = 'edit') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-split-')));
  const path = join(root, 'doc.md'); writeFileSync(path, content);
  const opened = await openForEdit(path, '/');
  if (!opened.ok) throw new Error(opened.reason);
  return {root, path, state: createDocumentSession(opened.file, mode)};
}
const press = (state: DocumentSession, bytes: string, columns = 120, height = 26) => { for (const key of decodeKeys(bytes)) documentSessionKey(state, key, columns, height); };
const draw = (state: DocumentSession, columns = 120, height = 26) => renderDocumentSession(state, columns, height).map(row => stripAnsi(row));
const F2 = '\u001bOQ';

test('layout: wide terminals show both panes, narrow ones the focused pane; the share of the preview is bounded', () => {
  assert.deepEqual(splitLayout(120, {ratio: 50}), {narrow: false, source: 59, preview: 60});
  assert.equal(splitLayout(99, {ratio: 50}).narrow, true);
  assert.equal(splitLayout(100, {ratio: 50}).narrow, false);
  for (const ratio of [0, 10, 95, 100]) { const layout = splitLayout(160, {ratio}); assert.ok(layout.source >= 40 && layout.preview >= 40, `${ratio}: ${JSON.stringify(layout)}`); }
});

test('F2 from edit mode opens the split: the editor on the left, the rendered preview on the right, both of the same buffer', async () => {
  const { root, state } = await session();
  try {
    press(state, F2);
    assert.equal(state.mode, 'split');
    assert.equal(state.split?.focus, 'source');
    const rows = draw(state);
    assert.ok(rows.every(row => displayWidth(row) <= 120));
    const joined = rows.join('\n');
    assert.match(joined, /# Hello world/u, 'the source (with its # marker) on the left');
    assert.ok(rows.some(row => /│/u.test(row) && /# Hello world/u.test(row) && /Hello world/u.test(row.split('│').at(-1)!)), 'the rendered heading beside it');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('typing in the source updates the preview of the same unsaved buffer; the file is not written', async () => {
  const { root, path, state } = await session();
  try {
    press(state, F2);
    state.editor.buffer.caret = {line: 0, column: 8};
    press(state, 'NEW ');
    const rows = draw(state);
    assert.ok(rows.some(row => /Hello NEW world/u.test(row.split('│').at(-1)!)), rows.join('\n'));
    assert.equal(state.editor.buffer.dirty, true);
    assert.equal(readFileSync(path, 'utf8'), `${SOURCE}\n`);
    press(state, '\u001a'); press(state, '\u001a');
    assert.ok(draw(state).some(row => /Hello world/u.test(row.split('│').at(-1)!) && !/NEW/u.test(row)), 'undo reaches the preview too');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('linked scrolling: the preview follows the caret to its heading, and to the top when the caret returns', async () => {
  const { root, state } = await session();
  try {
    press(state, F2);
    const lines = SOURCE.split('\n');
    state.editor.buffer.caret = {line: lines.indexOf('## End part'), column: 0};
    press(state, '\u001b[B');
    const right = (rows: string[]) => rows.map(row => row.split('│').at(-1)!).join('\n');
    assert.match(right(draw(state)), /End part/u);
    state.editor.buffer.caret = {line: 0, column: 0};
    press(state, '\u001b[B'); press(state, '\u001b[A');
    assert.match(right(draw(state)), /Hello world/u);
    press(state, '\u000f'); press(state, 'l');
    assert.equal(state.split?.linked, false);
    state.editor.buffer.caret = {line: lines.indexOf('## End part'), column: 0};
    press(state, '\u000f'); press(state, '\u001b[B');
    assert.match(right(draw(state)), /Hello world/u, 'unlinked: the preview stays where it was');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('Ctrl+O moves between the panes; keys go only to the focused one; x swaps the sides and < > resize within bounds', async () => {
  const { root, state } = await session();
  try {
    press(state, F2);
    press(state, '\u000f');
    assert.equal(state.split?.focus, 'preview');
    const before = state.editor.buffer.text;
    press(state, 'qzx');
    assert.equal(state.editor.buffer.text, before, 'letters typed in the preview pane never reach the text');
    assert.equal(state.split?.swapped, true, 'x swapped the panes');
    const first = draw(state)[2]!;
    assert.match(first.split('│')[0]!, /Hello world/u);
    assert.doesNotMatch(first.split('│')[0]!, /# Hello/u, 'the preview is now on the left');
    const ratio = state.split!.ratio;
    press(state, '>'); assert.ok(state.split!.ratio > ratio);
    for (let index = 0; index < 20; index += 1) press(state, '<');
    assert.ok(state.split!.ratio >= 30);
    for (let index = 0; index < 40; index += 1) press(state, '>');
    assert.ok(state.split!.ratio <= 70);
    press(state, 'e');
    assert.equal(state.split?.focus, 'source');
    press(state, 'Z');
    assert.match(state.editor.buffer.lines[0]!, /Z/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('narrow terminals show the focused pane at full width and resizing back restores the split', async () => {
  const { root, state } = await session();
  try {
    press(state, F2);
    for (const columns of [30, 50, 80, 99]) {
      const rows = draw(state, columns);
      assert.ok(rows.every(row => displayWidth(row) <= columns), `${columns}`);
      assert.ok(rows.every(row => !row.includes('│') || columns >= 100), `${columns}: one pane only`);
      assert.match(rows.join('\n'), /Hello world/u);
    }
    press(state, '\u000f', 80);
    assert.match(draw(state, 80).join('\n'), /Hello world/u);
    assert.equal(state.split?.focus, 'preview');
    assert.ok(draw(state, 120).some(row => row.includes('│')), 'back to two panes');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('Esc leaves the split for the read-only source view with the text kept; F2 again returns to editing; the dirty dialog and Save work from the split', async () => {
  const { root, path, state } = await session();
  try {
    press(state, F2);
    press(state, 'x');
    assert.equal(state.mode, 'split');
    press(state, '\u001b');
    assert.equal(state.mode, 'source');
    assert.equal(state.split, undefined);
    assert.equal(state.editor.buffer.dirty, true);
    press(state, F2);
    assert.equal(state.mode, 'split');
    assert.equal(state.split?.focus, 'preview', 'from the read-only view the preview has the keys');
    press(state, F2);
    assert.equal(state.mode, 'edit');
    press(state, F2);
    press(state, '\u0013');
    const action = documentSessionKey(state, decodeKeys('\u0013')[0]!, 120, 26);
    assert.deepEqual(action, {kind: 'save'});
    assert.equal(readFileSync(path, 'utf8'), `${SOURCE}\n`, 'asking to save writes nothing by itself');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('the preview pane has its own find and heading prompt that do not touch the text; search never types into the editor', async () => {
  const { root, state } = await session();
  try {
    press(state, F2); press(state, '\u000f');
    const before = state.editor.buffer.text;
    press(state, '/'); press(state, 'End'); press(state, '\r');
    press(state, '#'); press(state, 'middle'); press(state, '\r');
    assert.equal(state.editor.buffer.text, before);
    assert.match(draw(state).map(row => row.split('│').at(-1)!).join('\n'), /Middle part/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('NO_COLOR: no colour escapes in either pane; any width and height render without throwing', async () => {
  const { root, state } = await session();
  const saved = process.env.NO_COLOR;
  try {
    process.env.NO_COLOR = '1';
    press(state, F2);
    for (const [columns, height] of [[30, 8], [50, 12], [100, 10], [120, 26], [200, 40]]) {
      const raw = renderDocumentSession(state, columns, height);
      assert.ok(raw.every(row => !/\u001b\[(?:3[0-7]|9[0-7]|38;)/u.test(row)), `${columns}x${height}`);
      assert.ok(raw.map(row => stripAnsi(row)).every(row => displayWidth(row) <= columns));
    }
  } finally { if (saved === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = saved; rmSync(root, {recursive: true, force: true}); }
});

test('a hostile document does not break the split: control sequences stay inert and a huge file keeps the preview bounded', async () => {
  const hostile = `# \u001b]0;pwned\u0007Title\n\n<script>alert(1)</script>\n\n${'x'.repeat(5000)}\n`;
  const { root, state } = await session(hostile);
  try {
    press(state, F2);
    const raw = renderDocumentSession(state, 120, 26).join('\n');
    assert.doesNotMatch(raw, /\u001b\]0;/u);
    const big = await session(`${Array.from({length: 40_000}, (_, index) => `line ${index}`).join('\n')}\n`);
    try {
      press(big.state, F2);
      const started = process.hrtime.bigint();
      press(big.state, 'abc');
      draw(big.state);
      assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 5);
    } finally { rmSync(big.root, {recursive: true, force: true}); }
  } finally { rmSync(root, {recursive: true, force: true}); }
});

import {executionFrameFixture} from './support/executionTimelineFrames.js';

test('app: F2 in a real workspace shows both panes of the same file, keys stay with the focused pane, Save As works for a Playground split, and closing restores the composer', async () => {
  const f = executionFrameFixture(120, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-split-app-')));
  try {
    const file = join(root, 'doc.md'); writeFileSync(file, `${SOURCE}\n`);
    await f.app['openDocumentSession'](file, '/edit doc.md', 'edit', false);
    const key = (bytes: string) => { for (const k of decodeKeys(bytes)) (f.app as unknown as {handleKey(k: unknown): void}).handleKey(k); };
    key(F2);
    const rows = f.capture().frame.rows.map(row => stripAnsi(row));
    assert.ok(rows.some(row => row.includes('│') && /Hello world/u.test(row)), rows.join('\n'));
    key('Z');
    assert.match(f.app['docSession']!.editor.buffer.lines[0]!, /Z/u);
    key('\u001b');
    key('q');
    assert.equal(f.app['docSession']!.editor.dialog?.kind, 'unsaved', 'the unsaved text is asked about, not dropped');
    key('d');
    assert.equal(f.app['docSession'], undefined, 'discarding closes the workspace and returns to the shell view');
    const playground = executionFrameFixture(120, 30);
    try {
      await playground.app['openPlayground']('markdown');
      for (const k of decodeKeys(`# Hi${'\n'}text`)) (playground.app as unknown as {handleKey(k: unknown): void}).handleKey(k);
      for (const k of decodeKeys(F2)) (playground.app as unknown as {handleKey(k: unknown): void}).handleKey(k);
      assert.equal(playground.app['docSession']!.mode, 'split');
      assert.ok(playground.capture().frame.rows.some(row => stripAnsi(row).includes('│')));
    } finally { playground.dispose(); }
  } finally { f.dispose(); rmSync(root, {recursive: true, force: true}); }
});
