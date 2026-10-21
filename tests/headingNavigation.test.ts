import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createViewer, renderViewer, viewerKey, type ViewerState} from '../src/viewer/ViewerPanel.js';
import {createEditor, editorKey, renderEditor} from '../src/viewer/EditorPanel.js';
import {openForEdit} from '../src/viewer/fileEdit.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {decodeKeys, type Key} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {ViewDocument} from '../src/viewer/document.js';

const body = Array.from({length: 40}, (_, index) => `filler line ${index}`);
const SOURCE = ['# Intro', '', ...body.slice(0, 10), '', '## Café Menu', '', ...body.slice(10, 20), '', '## Café Menu', '', ...body.slice(20, 30), '', '### Deep End', '', 'the end'].join('\n');
const doc = (text: string): ViewDocument => ({title: 'doc.md', origin: {kind: 'file', path: '/x/doc.md', realPath: '/x/doc.md', symlink: false, bytes: text.length, mtimeMs: 0}, lines: text.split('\n'), text, format: 'markdown', language: 'markdown', notes: [], lineEnding: 'lf', complete: true});
const keys = (state: ViewerState, bytes: string, columns = 90, height = 20) => { for (const key of decodeKeys(bytes)) viewerKey(state, key, columns, height); };
const screen = (state: ViewerState, columns = 90, height = 20) => renderViewer(state, columns, height).map(row => stripAnsi(row)).join('\n');

test('viewer: # asks for a heading; typing narrows, Up/Down choose, Enter jumps (source view); Backspace returns', () => {
  const state = createViewer(doc(SOURCE));
  state.rendered = false;
  keys(state, '#');
  assert.equal(state.input?.kind, 'heading');
  assert.match(screen(state), /Heading:.*Intro/u);
  keys(state, 'cafe');
  assert.match(screen(state), /no heading/iu, 'accents are not folded: "cafe" does not match "Café"');
  keys(state, '\u007f\u007f\u007f\u007f');
  keys(state, 'café');
  assert.match(screen(state), /1\/2/u);
  keys(state, '\u001b[B');
  assert.match(screen(state), /2\/2/u);
  keys(state, '\r');
  assert.equal(state.input, undefined);
  assert.equal(state.top, SOURCE.split('\n').indexOf('## Café Menu', 15));
  keys(state, '\u007f');
  assert.equal(state.top, 0, 'Backspace goes back to where the jump started');
  keys(state, '\u007f');
  assert.match(state.note ?? '', /No earlier position/u);
});

test('viewer: the same jump in the rendered view lands on the heading\'s row at every width', () => {
  for (const columns of [30, 50, 80, 120]) {
    const state = createViewer(doc(SOURCE));
    assert.equal(state.rendered, true);
    keys(state, '#', columns); keys(state, 'deep', columns); keys(state, '\r', columns);
    const view = screen(state, columns);
    assert.match(view, /Deep End/u, `${columns}: the heading is on screen`);
    assert.ok(state.top > 0);
    keys(state, '\u007f', columns);
    assert.equal(state.top, 0);
  }
});

test('viewer: Esc cancels the prompt and changes nothing; a document without headings says so; non-Markdown files ignore #', () => {
  const state = createViewer(doc(SOURCE));
  keys(state, '#'); keys(state, '\u001b');
  assert.equal(state.input, undefined); assert.equal(state.top, 0);
  const none = createViewer(doc('just text\nmore'));
  keys(none, '#');
  assert.match(screen(none), /no headings/iu);
  const plain = createViewer({...doc('# not markdown'), format: 'text'});
  keys(plain, '#');
  assert.equal(plain.input, undefined);
});

test('viewer: a heading prompt fits 30–120 columns', () => {
  const state = createViewer(doc(SOURCE));
  keys(state, '#');
  for (const columns of [30, 50, 80, 120]) for (const row of renderViewer(state, columns, 20)) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
});

// ---- Editor -----------------------------------------------------------------------------------------------------

async function openEditor(content: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-head-')));
  const path = join(root, 'n.md'); writeFileSync(path, content);
  const opened = await openForEdit(path, '/');
  if (!opened.ok) throw new Error(opened.reason);
  return {root, editor: createEditor(opened.file)};
}
const press = (editor: ReturnType<typeof createEditor>, bytes: string) => { for (const key of decodeKeys(bytes)) editorKey(editor, key, 90, 30); };
const F1 = '\u001bOP';

test('editor: F1 h lists the headings with their depth; Enter moves the caret there without touching the text; j goes back', async () => {
  const { root, editor } = await openEditor(`${SOURCE}\n`);
  try {
    editor.buffer.caret = {line: 30, column: 4};
    press(editor, F1); press(editor, 'h');
    assert.equal(editor.dialog?.kind, 'outline');
    const view = renderEditor(editor, 90, 30).map(row => stripAnsi(row)).join('\n');
    assert.match(view, /# Intro/u); assert.match(view, /  ## Café Menu/u); assert.match(view, /    ### Deep End/u);
    press(editor, 'deep'); press(editor, '\r');
    assert.equal(editor.dialog, undefined);
    assert.equal(editor.buffer.lines[editor.buffer.caret.line], '### Deep End');
    assert.equal(editor.buffer.dirty, false);
    press(editor, F1); press(editor, 'j');
    assert.deepEqual(editor.buffer.caret, {line: 30, column: 4});
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('editor: Back still lands on the same text after edits above the starting point and after undo', async () => {
  const { root, editor } = await openEditor(`${SOURCE}\n`);
  try {
    editor.buffer.caret = {line: 30, column: 4};
    press(editor, F1); press(editor, 'h'); press(editor, 'intro'); press(editor, '\r');
    assert.equal(editor.buffer.caret.line, 0);
    editor.buffer.caret = {line: 0, column: 7};
    press(editor, '\n\n\n');
    editor.buffer.undo(); editor.buffer.undo(); editor.buffer.undo();
    editor.buffer.caret = {line: 0, column: 7};
    press(editor, '\n');
    press(editor, F1); press(editor, 'j');
    assert.deepEqual(editor.buffer.caret, {line: 31, column: 4}, 'one inserted line above moved the remembered position down by one');
    assert.equal(editor.buffer.lines[31], 'filler line 22');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('editor: the palette finds Go to heading and Back; nothing matches gives a message; the list fits 30–120 columns', async () => {
  const { root, editor } = await openEditor('no headings here\n');
  try {
    press(editor, F1); press(editor, '/'); press(editor, 'go to heading'); press(editor, '\r');
    assert.equal(editor.dialog?.kind, 'outline');
    assert.match(renderEditor(editor, 90, 30).map(row => stripAnsi(row)).join('\n'), /no headings/iu);
    for (const columns of [30, 50, 80, 120]) for (const row of renderEditor(editor, columns, 30)) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}`);
    press(editor, '\u001b');
    press(editor, F1); press(editor, 'j');
    assert.match(editor.note?.text ?? '', /No earlier position/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('/view file.md#heading parses the fragment off the path', () => {
  assert.deepEqual(parseSlashCommand('/view README.md#install'), {kind: 'view', target: 'README.md#install'});
});

// ---- /view file#heading -----------------------------------------------------------------------------------------

import {splitHeadingTarget} from '../src/viewer/document.js';
import {existsSync} from 'node:fs';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

test('splitHeadingTarget: a path#fragment is split unless a file really has that name; no fragment, no change', () => {
  const exists = (path: string) => path === 'weird#name.md';
  assert.deepEqual(splitHeadingTarget('README.md#install', exists), {path: 'README.md', fragment: 'install'});
  assert.deepEqual(splitHeadingTarget('docs/a b.md#Getting%20Started', exists), {path: 'docs/a b.md', fragment: 'Getting%20Started'});
  assert.deepEqual(splitHeadingTarget('weird#name.md', exists), {path: 'weird#name.md'});
  assert.deepEqual(splitHeadingTarget('plain.md', exists), {path: 'plain.md'});
  assert.deepEqual(splitHeadingTarget('x.md#', exists), {path: 'x.md'});
  assert.deepEqual(splitHeadingTarget('3', exists), {path: '3'});
});

test('app: /view file.md#heading opens the file at that heading; an unknown heading opens at the top and says so', async () => {
  const f = executionFrameFixture(110, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-viewfrag-')));
  try {
    const file = join(root, 'doc.md');
    writeFileSync(file, `${SOURCE}\n`);
    f.app['openViewer'](`${file}#deep-end`, '/view doc.md#deep-end');
    const deadline = process.hrtime.bigint() + 5_000_000_000n;
    while (!f.app['docSession']) { if (process.hrtime.bigint() > deadline) throw new Error('no session'); await new Promise(done => setTimeout(done, 5)); }
    const session = f.app['docSession']!;
    assert.match(f.capture().frame.rows.map(row => stripAnsi(row)).join('\n'), /### Deep End/u, 'the heading is on screen (the view is clamped to the last page)');
    assert.ok(session.viewer.top > 0);
    assert.ok(existsSync(file));
    f.app['docSession'] = undefined;
    f.app['openViewer'](`${file}#no-such`, '/view doc.md#no-such');
    while (!f.app['docSession']) { if (process.hrtime.bigint() > deadline) throw new Error('no session 2'); await new Promise(done => setTimeout(done, 5)); }
    assert.equal(f.app['docSession']!.viewer.top, 0);
    assert.match(f.app['docSession']!.note ?? '', /No heading “no-such”/u);
  } finally { f.dispose(); rmSync(root, {recursive: true, force: true}); }
});
