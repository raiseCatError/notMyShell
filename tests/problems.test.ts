import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProblemsRunner} from '../src/viewer/problems.js';
import {createEditor, editorKey, renderEditor, type EditorState} from '../src/viewer/EditorPanel.js';
import {createDocumentSession, documentSessionKey, renderDocumentSession, type DocumentSession} from '../src/viewer/DocumentWorkspace.js';
import {createLocalFs, type LocalFs} from '../src/markdown/diagnostics.js';
import {createScratchFile, openForEdit} from '../src/viewer/fileEdit.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const F1 = '\u001bOP', F3 = '\u001bOR', F2 = '\u001bOQ';
function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-problems-')));
  mkdirSync(join(root, '.git')); mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'other.md'), '# Other\n');
  const write = (name: string, text: string) => { const path = join(root, 'docs', name); writeFileSync(path, text); return path; };
  return {root, write, cleanup: () => rmSync(root, {recursive: true, force: true})};
}
async function editorOn(path: string): Promise<EditorState> {
  const opened = await openForEdit(path, '/');
  if (!opened.ok) throw new Error(opened.reason);
  return createEditor(opened.file);
}
const press = (editor: EditorState, bytes: string, columns = 100, height = 30) => { for (const key of decodeKeys(bytes)) editorKey(editor, key, columns, height); };
const screen = (editor: EditorState, columns = 100, height = 30) => renderEditor(editor, columns, height).map(row => stripAnsi(row)).join('\n');
const settle = async (check: () => boolean, what: string) => { const deadline = process.hrtime.bigint() + 5_000_000_000n; while (!check()) { if (process.hrtime.bigint() > deadline) throw new Error(`timed out waiting for ${what}`); await new Promise(done => setTimeout(done, 5)); } };
const DOC = '# Title\n\n[good](other.md) [bad](nope.md) [frag](#missing)\n\n![](other.md)\n';

test('runner: the first run reports, an edit re-runs after the debounce, undo and redo update, and nothing stale replaces newer results', async () => {
  const p = project();
  try {
    const editor = await editorOn(p.write('a.md', DOC));
    let slow = false;
    const delayed = (inner: LocalFs): LocalFs => ({stat: async path => { if (slow) await new Promise(done => setTimeout(done, 80)); return inner.stat(path); }, readText: (path, max) => inner.readText(path, max)});
    const runner = new ProblemsRunner(editor, {debounceMs: 10, makeFs: async () => delayed(createLocalFs(join(p.root, 'docs'), p.root))});
    editor.problems = runner;
    runner.enable();
    await settle(() => Boolean(runner.report), 'the first report');
    assert.deepEqual(runner.report!.diagnostics.map(item => item.code).sort(), ['broken-fragment', 'image-alt', 'missing-file']);
    editor.buffer.caret = {line: 2, column: 0}; editor.buffer.insert('[x](gone.md) ');
    await settle(() => runner.report!.diagnostics.filter(item => item.code === 'missing-file').length === 2, 'the re-run');
    editor.buffer.undo();
    await settle(() => runner.report!.diagnostics.filter(item => item.code === 'missing-file').length === 1, 'the undo');
    editor.buffer.redo();
    await settle(() => runner.report!.diagnostics.filter(item => item.code === 'missing-file').length === 2, 'the redo');
    // A slow run for an old version must not overwrite the newer result.
    slow = true;
    editor.buffer.caret = {line: 0, column: 0}; editor.buffer.insert('[a](stale1.md) ');
    await new Promise(done => setTimeout(done, 40));
    slow = false;
    editor.buffer.undo(); editor.buffer.undo();
    await settle(() => !runner.busy, 'the runs to finish');
    assert.equal(runner.report!.diagnostics.filter(item => item.code === 'missing-file').length, 1, 'the report is for the text as it is now');
    assert.ok(!runner.report!.diagnostics.some(item => /stale1/u.test(item.message)));
    runner.dispose();
  } finally { p.cleanup(); }
});

test('runner: dispose stops everything (no timer, no later result); a disabled runner never runs; typing in an unopened document costs nothing', async () => {
  const p = project();
  try {
    const editor = await editorOn(p.write('a.md', DOC));
    let runs = 0;
    const runner = new ProblemsRunner(editor, {debounceMs: 5, makeFs: async () => { runs += 1; return createLocalFs(join(p.root, 'docs'), p.root); }});
    editor.buffer.insert('x');
    await new Promise(done => setTimeout(done, 30));
    assert.equal(runs, 0, 'not enabled: no work');
    runner.enable();
    await settle(() => Boolean(runner.report), 'a report');
    runner.dispose();
    const before = runs;
    editor.buffer.insert('y');
    await new Promise(done => setTimeout(done, 40));
    assert.equal(runs, before);
    assert.equal(runner.disposed, true);
  } finally { p.cleanup(); }
});

test('a Playground document has no folder: relative references are unverified, and Save As makes them checkable after a refresh', async () => {
  const p = project();
  try {
    const editor = createEditor(createScratchFile('markdown'));
    editor.buffer.insert('[x](other.md) [y](#nope)');
    const runner = new ProblemsRunner(editor, {debounceMs: 5});
    editor.problems = runner; runner.enable();
    await settle(() => Boolean(runner.report), 'report');
    assert.deepEqual(runner.report!.diagnostics.map(item => `${item.code}:${item.severity}`).sort(), ['broken-fragment:error', 'unverified-local:unverified']);
    runner.dispose();
  } finally { p.cleanup(); }
});

// ---- The surface ------------------------------------------------------------------------------------------------

test('F1 e opens Problems with counts and the findings; Tab filters, typing searches, Enter selects the exact text and Back returns; nothing is written or changed', async () => {
  const p = project();
  try {
    const path = p.write('a.md', DOC);
    const editor = await editorOn(path);
    editor.problems = new ProblemsRunner(editor, {debounceMs: 5});
    editor.buffer.caret = {line: 4, column: 3};
    press(editor, F1); press(editor, 'e');
    assert.equal(editor.dialog?.kind, 'problems');
    await settle(() => Boolean(editor.problems!.report), 'report');
    const view = screen(editor);
    assert.match(view, /Problems/u); assert.match(view, /2 errors/u); assert.match(view, /1 warning/u);
    assert.match(view, /No such file: nope\.md/u); assert.match(view, /No heading or id “missing”/u);
    press(editor, 'nope');
    assert.doesNotMatch(screen(editor), /image/iu);
    press(editor, '\r');
    assert.equal(editor.dialog, undefined);
    assert.equal(editor.buffer.selectedText(), 'nope.md', 'the exact destination is selected');
    assert.equal(editor.buffer.dirty, false);
    assert.equal(readFileSync(path, 'utf8'), DOC);
    press(editor, F1); press(editor, 'j');
    assert.deepEqual(editor.buffer.caret, {line: 4, column: 3});
    press(editor, F1); press(editor, 'e');
    await settle(() => !editor.problems!.busy, 'refresh');
    press(editor, '\t');
    assert.match(screen(editor), /errors/u);
    press(editor, '\t'); press(editor, '\t');
    press(editor, '\u001b');
    assert.equal(editor.dialog, undefined);
    editor.problems!.dispose();
  } finally { p.cleanup(); }
});

test('a dismissed finding stays hidden until the text changes; Ctrl+R checks again; a clean document says so', async () => {
  const p = project();
  try {
    const editor = await editorOn(p.write('a.md', '[bad](nope.md)\n'));
    editor.problems = new ProblemsRunner(editor, {debounceMs: 5});
    press(editor, F1); press(editor, 'e');
    await settle(() => Boolean(editor.problems!.report), 'report');
    assert.match(screen(editor), /nope\.md/u);
    press(editor, '\u001b[3~');
    assert.doesNotMatch(screen(editor), /No such file/u);
    press(editor, '\u0012');
    await settle(() => !editor.problems!.busy, 'refresh');
    assert.match(screen(editor), /No such file/u, 'a refresh shows it again');
    editor.dialog = undefined;
    editor.buffer.caret = {line: 0, column: 0}; editor.buffer.delete();
    const clean = await editorOn(p.write('b.md', '# Fine\n\nNothing wrong here.\n'));
    clean.problems = new ProblemsRunner(clean, {debounceMs: 5});
    press(clean, F1); press(clean, 'e');
    await settle(() => Boolean(clean.problems!.report), 'clean report');
    assert.match(screen(clean), /No problems found/u);
    editor.problems!.dispose(); clean.problems!.dispose();
  } finally { p.cleanup(); }
});

test('HTML files list Problems in the palette; CSS files open it with F1; the status row shows the counts once checking is on', async () => {
  const p = project();
  try {
    const html = await editorOn(p.write('p.html', '<img src="gone.png">\n'));
    html.problems = new ProblemsRunner(html, {debounceMs: 5});
    press(html, F1); press(html, 'problems'); press(html, '\r');
    assert.equal(html.dialog?.kind, 'problems');
    await settle(() => Boolean(html.problems!.report), 'html report');
    assert.match(screen(html), /gone\.png/u);
    press(html, '\u001b');
    assert.match(screen(html), /✖\s*1/u, 'counts in the status row');
    const css = await editorOn(p.write('s.css', 'a { background: url(gone.png) }\n'));
    css.problems = new ProblemsRunner(css, {debounceMs: 5});
    press(css, F1);
    assert.equal(css.dialog?.kind, 'problems');
    await settle(() => Boolean(css.problems!.report), 'css report');
    assert.match(screen(css), /gone\.png/u);
    html.problems!.dispose(); css.problems!.dispose();
  } finally { p.cleanup(); }
});

test('rows fit 30–120 columns with colour, NO_COLOR and Safe Glyphs; severity never depends on colour alone', async () => {
  const p = project();
  const saved = process.env.NO_COLOR;
  try {
    const editor = await editorOn(p.write('a.md', `${DOC}\n[very long](${'dir/'.repeat(30)}file.md) 日本語 😀\n`));
    editor.problems = new ProblemsRunner(editor, {debounceMs: 5});
    press(editor, F1); press(editor, 'e');
    await settle(() => Boolean(editor.problems!.report), 'report');
    for (const noColor of [false, true]) {
      if (noColor) process.env.NO_COLOR = '1'; else delete process.env.NO_COLOR;
      for (const columns of [30, 50, 80, 120]) for (const row of renderEditor(editor, columns, 24)) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
    }
    assert.match(screen(editor, 100), /[✖E]\s/u);
    editor.problems!.dispose();
  } finally { if (saved === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = saved; p.cleanup(); }
});

// ---- Every mode -------------------------------------------------------------------------------------------------

async function session(path: string): Promise<DocumentSession> {
  const opened = await openForEdit(path, '/');
  if (!opened.ok) throw new Error(opened.reason);
  const state = createDocumentSession(opened.file, 'edit');
  state.editor.problems = new ProblemsRunner(state.editor, {debounceMs: 5});
  return state;
}
const key = (state: DocumentSession, bytes: string, columns = 120, height = 30) => { for (const k of decodeKeys(bytes)) documentSessionKey(state, k, columns, height); };
const LONG = ['# Top', '', ...Array.from({length: 40}, (_, index) => `filler ${index}`), '', '[bad](nope.md) here', '', '## End'].join('\n') + '\n';

test('Problems works in source, preview, hybrid and split: P (or F1 e) opens it and a jump lands on the exact source and shows it', async () => {
  const p = project();
  try {
    const target = LONG.split('\n').findIndex(line => line.includes('nope.md'));
    for (const mode of ['source', 'preview', 'hybrid', 'split-preview', 'split-source', 'edit'] as const) {
      const state = await session(p.write(`m-${mode}.md`, LONG));
      state.editor.problems = new ProblemsRunner(state.editor, {debounceMs: 5});
      if (mode === 'source') key(state, '\u001b');
      else if (mode === 'preview') { key(state, '\u000f'); }
      else if (mode === 'hybrid') key(state, F3);
      else if (mode === 'split-preview') { key(state, F2); key(state, '\u000f'); }
      else if (mode === 'split-source') key(state, F2);
      if (mode === 'edit' || mode === 'hybrid' || mode === 'split-source') key(state, F1 + 'e'); else key(state, 'P');
      assert.equal(state.editor.dialog?.kind, 'problems', mode);
      await settle(() => Boolean(state.editor.problems!.report), `${mode} report`);
      assert.match(renderDocumentSession(state, 120, 24).map(row => stripAnsi(row)).join('\n'), /No such file: nope\.md/u, mode);
      key(state, '\r', 120, 24);
      assert.equal(state.editor.dialog, undefined, mode);
      assert.equal(state.editor.buffer.caret.line, target, `${mode}: the caret is on the finding`);
      assert.equal(state.editor.buffer.selectedText(), 'nope.md', mode);
      const view = renderDocumentSession(state, 120, 24).map(row => stripAnsi(row)).join('\n');
      assert.match(view, /nope\.md|bad/u, `${mode}: the place is on screen`);
      assert.equal(state.editor.buffer.dirty, false, mode);
      state.editor.problems!.dispose();
    }
  } finally { p.cleanup(); }
});

test('review 6, 7, 13: a failing filesystem factory is not an unhandled rejection; the focus stays on a row when the list shrinks', async () => {
  const p = project();
  try {
    const editor = await editorOn(p.write('a.md', '[a](nope.md) [b](nope2.md) [c](nope3.md)\n'));
    const rejections: unknown[] = [];
    const listener = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', listener);
    const broken = new ProblemsRunner(editor, {debounceMs: 5, makeFs: async () => { throw new Error('boom'); }});
    broken.enable();
    await new Promise(done => setTimeout(done, 40));
    process.off('unhandledRejection', listener);
    assert.deepEqual(rejections, []);
    broken.dispose();
    editor.problems = new ProblemsRunner(editor, {debounceMs: 5});
    press(editor, F1); press(editor, 'e');
    await settle(() => Boolean(editor.problems!.report), 'report');
    press(editor, '\u001b[B'); press(editor, '\u001b[B');
    editor.buffer.caret = {line: 0, column: 0}; editor.buffer.delete(); editor.buffer.delete();
    for (let step = 0; step < 24; step += 1) editor.buffer.delete();
    await settle(() => editor.problems!.visible().length < 3 && !editor.problems!.busy, 'a shorter report');
    assert.match(screen(editor), /▸/u, 'a row is still selected');
    editor.problems!.dispose();
  } finally { p.cleanup(); }
});
