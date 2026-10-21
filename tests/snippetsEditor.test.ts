import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEditor, editorKey, renderEditor} from '../src/viewer/EditorPanel.js';
import {createDocumentSession, documentSessionKey} from '../src/viewer/DocumentWorkspace.js';
import {encodeLines, openForEdit} from '../src/viewer/fileEdit.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

async function open(name: string, content: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-snip-')));
  const path = join(root, name); writeFileSync(path, content);
  const opened = await openForEdit(path, '/');
  if (!opened.ok) throw new Error(opened.reason);
  return {root, file: opened.file, editor: createEditor(opened.file)};
}
type Editor = ReturnType<typeof createEditor>;
const press = (editor: Editor, bytes: string, columns = 90) => { for (const key of decodeKeys(bytes)) editorKey(editor, key, columns, 30); };
const screen = (editor: Editor, columns = 90) => renderEditor(editor, columns, 30).map(row => stripAnsi(row)).join('\n');
const F1 = '\u001bOP';

test('HTML: F1 opens the palette, typing filters, Enter inserts; Tab and Shift+Tab walk the placeholders, then Tab is an ordinary tab again', async () => {
  const {root, editor} = await open('p.html', '');
  try {
    press(editor, F1);
    assert.equal(editor.dialog?.kind, 'snippets');
    assert.match(screen(editor), /Insert · \d+ matches/u);
    press(editor, 'semantic section');
    assert.match(screen(editor), /▸ Section/u);
    press(editor, '\r');
    assert.equal(editor.dialog, undefined);
    assert.deepEqual(editor.buffer.lines, ['<section>', '  <h2>Heading</h2>', '  Content', '</section>']);
    assert.equal(editor.buffer.selectedText(), 'Heading');
    assert.ok(editor.snippet);
    press(editor, 'Title');
    press(editor, '\t');
    assert.equal(editor.buffer.selectedText(), 'Content');
    press(editor, '\u001b[Z');
    assert.equal(editor.buffer.selectedText(), 'Title');
    press(editor, '\t'); press(editor, '\t');
    assert.equal(editor.snippet, undefined, 'past the last placeholder the session ends');
    assert.deepEqual(editor.buffer.caret, {line: 3, column: '</section>'.length});
    const lines = editor.buffer.lines.length;
    press(editor, '\t');
    assert.match(editor.buffer.lines.at(-1)!, /\t$/u, 'Tab outside snippet mode inserts a tab as before');
    assert.equal(editor.buffer.lines.length, lines);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('Esc ends the placeholders without touching the text; the next Esc behaves as it always did', async () => {
  const {root, editor} = await open('p.html', '');
  try {
    press(editor, F1); press(editor, 'link'); press(editor, '\r');
    const text = [...editor.buffer.lines];
    press(editor, '\u001b');
    assert.equal(editor.snippet, undefined);
    assert.deepEqual(editor.buffer.lines, text);
    assert.match(editor.note?.text ?? '', /placeholders ended/u);
    press(editor, '\u001b');
    assert.equal(editor.dialog?.kind, 'unsaved', 'then Esc asks about the unsaved text, as it did before');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('Markdown: F1 then / opens the palette; actions and snippets are listed together; a snippet inserts as one undo step', async () => {
  const {root, editor} = await open('n.md', 'intro\n');
  try {
    editor.buffer.bufferEnd();
    press(editor, F1);
    assert.equal(editor.dialog?.kind, 'markdown');
    assert.match(screen(editor), /Snippets…/u);
    press(editor, '/');
    assert.equal(editor.dialog?.kind, 'snippets');
    press(editor, 'table');
    const view = screen(editor);
    assert.match(view, /▸ Table/u);
    press(editor, '\r');
    assert.deepEqual(editor.buffer.lines.slice(1), ['| Column | Column |', '| --- | --- |', '| Cell | Cell |']);
    assert.equal(editor.buffer.selectedText(), 'Column');
    for (let step = 0; step < 4; step += 1) press(editor, '\t');
    assert.equal(editor.snippet, undefined);
    editor.buffer.undo();
    assert.deepEqual(editor.buffer.lines, ['intro']);
    press(editor, F1); press(editor, '/'); press(editor, 'task');
    assert.match(screen(editor), /Toggle task/u, 'existing actions are searchable too');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('source templates for Mermaid and math say they are source, and the palette runs existing actions and the footnote', async () => {
  const {root, editor} = await open('n.md', 'A claim.\n');
  try {
    press(editor, F1); press(editor, '/'); press(editor, 'mermaid');
    assert.match(screen(editor), /Mermaid diagram \(source\)/u);
    assert.match(screen(editor), /not rendered by NMSh/u);
    press(editor, '\u001b');
    assert.equal(editor.dialog, undefined, 'Esc leaves the palette and changes nothing');
    assert.equal(editor.buffer.dirty, false);
    editor.buffer.caret = {line: 0, column: 8};
    press(editor, F1); press(editor, '/'); press(editor, 'footnote'); press(editor, '\r');
    assert.deepEqual(editor.buffer.lines, ['A claim.[^1]', '', '[^1]: Footnote text']);
    assert.equal(editor.buffer.selectedText(), 'Footnote text');
    press(editor, 'See the manual.');
    assert.equal(editor.buffer.lines[2], '[^1]: See the manual.');
    press(editor, '\u001b');
    editor.buffer.caret = {line: 0, column: 0}; editor.buffer.anchor = {line: 0, column: 1};
    press(editor, F1); press(editor, '/'); press(editor, 'bold'); press(editor, '\r');
    assert.equal(editor.buffer.lines[0], '**A** claim.[^1]');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('moving the caret out of the inserted text ends the session; Tab is then an ordinary tab', async () => {
  const {root, editor} = await open('p.html', 'after\n');
  try {
    editor.buffer.caret = {line: 0, column: 0};
    press(editor, F1); press(editor, 'paragraph'); press(editor, '\r');
    assert.ok(editor.snippet);
    press(editor, '\u001b[B'); press(editor, '\u001b[B');
    assert.equal(editor.snippet, undefined);
    press(editor, '\t');
    assert.match(editor.buffer.lines.join('\n'), /\t/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('other files have no palette and no hint; undo ends a session; a selection is wrapped by a wrapping snippet', async () => {
  const text = await open('n.txt', 'plain\n');
  try {
    press(text.editor, F1);
    assert.equal(text.editor.dialog, undefined);
    assert.doesNotMatch(screen(text.editor), /F1/u);
  } finally { rmSync(text.root, {recursive: true, force: true}); }
  const {root, editor} = await open('p.html', 'make me a heading\n');
  try {
    editor.buffer.caret = {line: 0, column: 17}; editor.buffer.anchor = {line: 0, column: 8};
    press(editor, F1); press(editor, 'section'); press(editor, '\r');
    assert.deepEqual(editor.buffer.lines, ['make me ', '<section>', '  <h2>Heading</h2>', '  a heading', '</section>'], 'a block starts on its own line and wraps the selection');
    press(editor, '\u001a');
    assert.equal(editor.snippet, undefined, 'undo ends the session');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('CRLF files: a snippet is inserted as lines and saved as CRLF; Unicode survives', async () => {
  const {root, editor} = await open('c.md', '日本語\r\n');
  try {
    editor.buffer.bufferEnd();
    press(editor, F1); press(editor, '/'); press(editor, 'task'); press(editor, '\r');
    assert.deepEqual(editor.buffer.lines, ['日本語', '- [ ] First task', '- [ ] Second task', '- [ ] Third task']);
    assert.equal(encodeLines(editor.file, editor.buffer.lines).toString(), '日本語\r\n- [ ] First task\r\n- [ ] Second task\r\n- [ ] Third task\r\n');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('the palette and its footer fit 30–120 columns', async () => {
  const {root, editor} = await open('p.html', '');
  try {
    press(editor, F1);
    for (const columns of [30, 50, 80, 120]) for (const row of renderEditor(editor, columns, 30)) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
    press(editor, 'zzzz');
    assert.match(screen(editor), /No match for/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('document workspace: Esc ends the placeholders instead of leaving edit mode', async () => {
  const {root, file} = await open('w.html', '');
  try {
    const session = createDocumentSession(file, 'edit');
    const key = (bytes: string) => { for (const k of decodeKeys(bytes)) documentSessionKey(session, k, 90, 26); };
    key(F1); key('link'); key('\r');
    assert.ok(session.editor.snippet);
    key('\u001b');
    assert.equal(session.mode, 'edit');
    assert.equal(session.editor.snippet, undefined);
    key('\u001b');
    assert.equal(session.mode, 'source', 'a second Esc leaves edit mode as before');
  } finally { rmSync(root, {recursive: true, force: true}); }
});
