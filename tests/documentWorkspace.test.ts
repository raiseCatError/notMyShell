import test from 'node:test';
import assert from 'node:assert/strict';
import type {Key} from '../src/terminal/keys.js';
import type {EditableFile} from '../src/viewer/fileEdit.js';
import {bufferText, createDocumentSession, renderDocumentSession, setDocumentMode, documentSessionKey, type PreviewView, type DocumentSessionAction, type DocumentSession} from '../src/viewer/DocumentWorkspace.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const file = (lines: string[], path = '/work/page.html'): EditableFile => ({
  path, realPath: path, title: 'page.html', lineEnding: 'lf', bom: false, finalNewline: true, lines,
  identity: {dev: 1, ino: 2, size: 10, mtimeMs: 1000, hash: 'x'},
});
const HTML = ['<h1>Title</h1>', '<p style="color:red">Hello <b>world</b></p>', '<ul><li>one</li><li>two</li></ul>'];
const text = (value: string): Key => ({kind: 'text', value});
const W = 100;
const H = 30;
const press = (state: DocumentSession, key: Key): DocumentSessionAction | undefined => documentSessionKey(state, key, W, H);
const type = (state: DocumentSession, value: string) => { for (const char of value) press(state, text(char)); };
const screen = (state: DocumentSession) => renderDocumentSession(state, W, H).map(row => stripAnsi(row)).join('\n');

test('navigation keys act only in navigation modes; while typing, h, e and r are text', () => {
  const state = createDocumentSession(file(HTML));
  assert.equal(state.mode, 'source');
  press(state, text('e'));
  assert.equal(state.mode, 'edit');
  type(state, 'heR');
  assert.equal(state.mode, 'edit', 'typing never switches mode');
  assert.equal(state.editor.buffer.lines[0], 'heR<h1>Title</h1>');
  assert.equal(state.editor.buffer.dirty, true);
  press(state, {kind: 'escape'});
  assert.equal(state.mode, 'source', 'Esc leaves typing for navigation without closing or discarding');
  assert.equal(state.editor.buffer.lines[0], 'heR<h1>Title</h1>', 'the unsaved text is still there');
  assert.deepEqual(press(state, text('h')), {kind: 'preview', refresh: false});
  assert.equal(state.mode, 'preview');
});

test('Ctrl+O is the switch that works while typing, and returns to where the preview came from', () => {
  const state = createDocumentSession(file(HTML), 'edit');
  type(state, 'abc');
  assert.deepEqual(press(state, {kind: 'toggleDetails'}), {kind: 'preview', refresh: false});
  assert.equal(state.mode, 'preview');
  assert.equal(state.before, 'edit');
  press(state, {kind: 'toggleDetails'});
  assert.equal(state.mode, 'edit');
  assert.equal(state.editor.buffer.lines[0], 'abc<h1>Title</h1>');
  const fromSource = createDocumentSession(file(HTML));
  press(fromSource, text('h'));
  press(fromSource, {kind: 'toggleDetails'});
  assert.equal(fromSource.mode, 'source');
});

test('preview shows the current buffer, unsaved, and never saves; undo history and caret survive the round trip', () => {
  const state = createDocumentSession(file(HTML), 'edit');
  state.editor.buffer.bufferEnd();
  type(state, '<p>UNSAVED-MARK</p>');
  const before = state.editor.buffer.lines.slice();
  const actions: Array<DocumentSessionAction | undefined> = [];
  actions.push(press(state, {kind: 'toggleDetails'}));
  assert.ok(actions.every(action => action?.kind !== 'save'), 'switching to the preview does not save');
  assert.match(screen(state), /UNSAVED-MARK/u, 'the native preview draws the unsaved text');
  assert.equal(state.viewer.document.text.includes('UNSAVED-MARK'), true);
  actions.push(press(state, {kind: 'toggleDetails'}));
  assert.deepEqual(state.editor.buffer.lines, before);
  const caret = state.editor.buffer.caret;
  assert.deepEqual(caret.line, before.length - 1);
  assert.equal(state.editor.buffer.undo(), true, 'the undo history is the same buffer\'s');
  assert.notDeepEqual(state.editor.buffer.lines, before);
});

test('Esc: from preview to source; from source to close, asking first when there are unsaved changes; Keep editing returns', () => {
  const state = createDocumentSession(file(HTML));
  press(state, text('h'));
  press(state, {kind: 'escape'});
  assert.equal(state.mode, 'source');
  assert.deepEqual(press(state, {kind: 'escape'}), {kind: 'close'}, 'clean: closes at once');
  const dirty = createDocumentSession(file(HTML), 'edit');
  type(dirty, 'x');
  press(dirty, {kind: 'escape'});
  assert.equal(dirty.mode, 'source');
  assert.equal(press(dirty, {kind: 'escape'}), undefined);
  assert.equal(dirty.editor.dialog?.kind, 'unsaved');
  assert.match(screen(dirty), /unsaved changes/u);
  press(dirty, {kind: 'escape'});
  assert.equal(dirty.editor.dialog, undefined, 'Keep editing');
  assert.equal(dirty.mode, 'source');
  press(dirty, text('q'));
  assert.deepEqual(press(dirty, text('d')), {kind: 'close'}, 'Discard closes');
});

test('save is Ctrl+S in every mode; reload from disk asks first when the buffer was edited', () => {
  for (const mode of ['source', 'edit', 'preview'] as const) {
    const state = createDocumentSession(file(HTML), mode === 'preview' ? 'source' : mode);
    if (mode === 'preview') press(state, text('h'));
    assert.deepEqual(press(state, {kind: 'sendToProgram'}), {kind: 'save'}, mode);
  }
  const clean = createDocumentSession(file(HTML));
  assert.deepEqual(press(clean, text('R')), {kind: 'reload'});
  const edited = createDocumentSession(file(HTML), 'edit');
  type(edited, 'y');
  press(edited, {kind: 'escape'});
  assert.equal(press(edited, text('R')), undefined);
  assert.match(screen(edited), /Reloading from disk discards them/u);
  press(edited, {kind: 'escape'});
  assert.equal(edited.editor.dialog, undefined);
  assert.equal(edited.editor.buffer.lines[0], 'y<h1>Title</h1>', 'declining keeps the edits');
});

test('r refreshes the preview and says so in source; scroll positions are kept per mode', () => {
  const long = Array.from({length: 120}, (_, index) => `<p>line ${index}</p>`);
  const state = createDocumentSession(file(long));
  assert.equal(press(state, text('r')), undefined);
  assert.match(state.note ?? '', /preview shows the current text each time/u);
  for (let step = 0; step < 15; step += 1) press(state, {kind: 'down'});
  const sourceTop = state.viewer.top;
  assert.ok(sourceTop > 0);
  press(state, text('h'));
  assert.equal(state.viewer.top, 0, 'the preview starts at its own top');
  for (let step = 0; step < 5; step += 1) press(state, {kind: 'down'});
  const previewTop = state.viewer.top;
  assert.deepEqual(press(state, text('r')), {kind: 'preview', refresh: true});
  assert.equal(state.viewer.top, previewTop, 'refreshing keeps the place');
  press(state, text('h'));
  assert.equal(state.viewer.top, sourceTop, 'back in source, the place is found again');
});

test('a browser preview owns scrolling and zoom in preview mode; the workspace keeps its own keys', () => {
  const state = createDocumentSession(file(HTML));
  const keys: Key[] = [];
  let disposed = false;
  const preview: PreviewView = {render: (columns, height) => ({rows: Array.from({length: height}, () => ' '.repeat(columns))}), key: key => { keys.push(key); }, dispose: () => { disposed = true; }, status: () => undefined, capturing: () => false};
  press(state, text('h'));
  state.preview = preview;
  press(state, text('j'));
  press(state, text('+'));
  assert.deepEqual(keys.map(key => key.kind === 'text' ? key.value : key.kind), ['j', '+']);
  press(state, text('e'));
  assert.equal(state.mode, 'edit', 'e still edits');
  press(state, {kind: 'toggleDetails'});
  assert.equal(keys.length, 2);
  const rows = renderDocumentSession(state, W, H);
  assert.equal(rows.length, H);
  assert.equal(disposed, false);
});

test('every mode draws within the panel at many sizes', () => {
  const state = createDocumentSession(file(HTML));
  for (const mode of ['source', 'edit', 'preview'] as const) {
    setDocumentMode(state, mode);
    for (const [columns, height] of [[30, 8], [40, 12], [60, 16], [100, 30], [200, 60]] as const) {
      const rows = renderDocumentSession(state, columns, height);
      assert.ok(rows.length <= height, `${mode} ${columns}x${height}: ${rows.length} rows`);
      for (const row of rows) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${mode} ${columns}x${height}: ${stripAnsi(row)}`);
    }
  }
  assert.equal(bufferText(state.editor), HTML.join('\n'));
});

test('the workspace header marks unsaved edits and the controls name the workspace keys', () => {
  const state = createDocumentSession(file(HTML), 'edit');
  type(state, 'z');
  press(state, {kind: 'escape'});
  const text = screen(state);
  assert.match(text, /● edited/u);
  for (const label of ['h preview', 'e edit', 'Ctrl+S save', 'R reload from disk', 'Esc close']) assert.match(text, new RegExp(label.replace(/[+]/gu, '\\+'), 'u'), label);
  press(state, {kind: 'text', value: 'h'});
  const preview = screen(state);
  for (const label of ['h source', 'e edit', 'r refresh', 'Esc source']) assert.match(preview, new RegExp(label, 'u'), label);
});
