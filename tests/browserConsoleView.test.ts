import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {GraphicsDecision} from '../src/graphics/capabilities.js';
import {FrameStream} from '../src/graphics/stream.js';
import {BrowserPreviewView, type DocumentPreviewDeps} from '../src/browser/documentPreview.js';
import {BrowserSession} from '../src/browser/session.js';
import {MAX_ENTRIES, type ConsoleEntry} from '../src/browser/console.js';
import type {PreviewDocument, PreviewHandle, PreviewServer} from '../src/browser/types.js';
import {createDocumentSession, documentSessionKey, renderDocumentSession, setDocumentMode, type DocumentSession, type DocumentSessionAction} from '../src/viewer/DocumentWorkspace.js';
import {openForEdit} from '../src/viewer/fileEdit.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {FakeClock, FakeEngine, settle, type FakePage} from './support/fakeBrowser.js';

/**
 * The document Console (#466) against a fake engine: what reaches it, what never does, the dialog's keys and rows, and that
 * opening, using and closing it changes nothing about the page's rules or the document's text, selection, dirty state or undo.
 */

const KITTY: GraphicsDecision = {backend: 'kitty', evidence: 'query', inline: 'placeholder', unicode: 'quadrant', cell: {width: 8, height: 16, source: 'estimated'}, reason: ''};

class FakePreviews implements PreviewServer {
  served: PreviewDocument[] = [];
  async serve(document: PreviewDocument): Promise<PreviewHandle> {
    this.served.push(document);
    return {url: `http://127.0.0.1:9/tok${this.served.length}tok${this.served.length}/`, update: () => {}, problems: () => [], dispose: () => {}};
  }
  async close(): Promise<void> {}
}

function rig() {
  const engine = new FakeEngine();
  const clock = new FakeClock();
  const previews = new FakePreviews();
  let id = 0x4e4d00;
  const session = new BrowserSession({
    engine, clock, scale: 1, cell: () => ({width: 8, height: 16}),
    openStream: () => new FrameStream({decision: () => KITTY, send: () => {}, allocateId: () => ++id, color: () => 'truecolor', safeGlyphs: () => false, now: () => clock.time}),
  });
  const deps: DocumentPreviewDeps = {session, previews, html: text => text, geometry: () => ({top: 1, left: 1, cell: {width: 8, height: 16}, scale: 1}), openLink: () => {}, dirty: () => false};
  return {engine, clock, previews, session, deps};
}

const HTML = ['<!doctype html>', '<title>t</title>', '<script>', '  missing();', '</script>', '<p>Hello</p>'];
const scratch = () => fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'nmsh-console-')));

async function workspace(options: {kind?: 'html' | 'markdown'; trusted?: boolean; text?: string[]} = {}) {
  const dir = scratch();
  const kind = options.kind ?? 'html';
  const file = path.join(dir, kind === 'html' ? 'page.html' : 'page.md');
  const lines = options.text ?? (kind === 'html' ? HTML : ['# Title', '', 'text']);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const opened = await openForEdit(file, '/');
  if (!opened.ok) throw new Error(opened.reason);
  const state = createDocumentSession(opened.file, 'source');
  const r = rig();
  setDocumentMode(state, 'preview');
  const view = await BrowserPreviewView.open(r.deps, {name: path.basename(file), root: dir, text: state.editor.buffer.lines.join('\n'), trusted: options.trusted === true, kind});
  if (!(view instanceof BrowserPreviewView)) throw new Error(view.error);
  state.preview = view;
  const page = r.engine.opened[0]!;
  const actions: DocumentSessionAction[] = [];
  const press = (bytes: string, columns = 100, height = 30) => { for (const key of decodeKeys(bytes)) { const action = documentSessionKey(state, key, columns, height); if (action) actions.push(action); } };
  const screen = (columns = 100, height = 30) => renderDocumentSession(state, columns, height).map(row => stripAnsi(row)).join('\n');
  return {...r, state, view, page, press, screen, actions, dir, cleanup: () => { view.dispose(); fs.rmSync(dir, {recursive: true, force: true}); }};
}

const error = (message: string, location?: ConsoleEntry['location']): ConsoleEntry => ({severity: 'error', origin: 'exception', message, ...(location ? {location} : {})});
const warn = (message: string): ConsoleEntry => ({severity: 'warning', origin: 'network', message, location: {target: 'local', label: 'missing.png'}});
const info = (message: string): ConsoleEntry => ({severity: 'info', origin: 'console', message});
const SHIFT_DOWN = '\u001b[1;2B', DEL = '\u001b[3~', CTRL_C = '\u0003', TAB = '\t', ESC = '\u001b', UP = '\u001b[A', DOWN = '\u001b[B';

test('the preview page is opened with a Console and scripts as the trust decision says; web tabs get none', async () => {
  const w = await workspace();
  try {
    assert.deepEqual(w.engine.options[0]!.console, {documentName: 'page.html'});
    assert.equal(w.engine.options[0]!.scripts, false);
    assert.ok(w.session.console());
    const browser = rig();
    await browser.session.open('https://example.com/');
    assert.equal(browser.engine.options[0]!.console, undefined);
    assert.equal(browser.session.console(), undefined);
    // A page that reports anyway (it cannot: the engine only reports for previews opened with a Console) is ignored.
    browser.engine.opened[0]!.emit({type: 'console', entry: error('from a web page')});
    assert.equal(browser.session.console(), undefined);
    browser.session.dispose();
  } finally { w.cleanup(); }
});

test('opening and using the Console never turns scripts or the network on, sends nothing to the page and keeps the document as it was', async () => {
  const w = await workspace();
  try {
    // An edit, a selection and a dirty buffer, made before the Console opens.
    setDocumentMode(w.state, 'edit');
    w.press('x');
    const buffer = w.state.editor.buffer;
    buffer.anchor = {line: 1, column: 0};
    buffer.caret = {line: 1, column: 5};
    setDocumentMode(w.state, 'preview');
    const before = {text: buffer.lines.join('\n'), caret: {...buffer.caret}, anchor: {...buffer.anchor!}, dirty: buffer.dirty};
    const calls = w.page.calls.length;
    w.page.emit({type: 'console', entry: error('Uncaught ReferenceError: missing is not defined', {target: 'document', label: 'page.html', line: 3, column: 2})});
    w.press('C');
    assert.equal(w.state.editor.dialog?.kind, 'console');
    w.press('miss'); w.press(TAB); w.press(TAB); w.press(TAB); w.press(UP); w.press(DOWN); w.press(SHIFT_DOWN); w.press(CTRL_C); w.press(ESC); w.press(DEL); w.press(ESC);
    assert.equal(w.state.editor.dialog, undefined);
    assert.equal(w.state.mode, 'preview');
    assert.equal(w.page.calls.length, calls, `the page was asked for nothing: ${JSON.stringify(w.page.calls.slice(calls))}`);
    assert.equal(w.page.count('setScripts'), 0);
    assert.equal(w.view.trusted, false);
    assert.deepEqual({text: buffer.lines.join('\n'), caret: buffer.caret, anchor: buffer.anchor, dirty: buffer.dirty}, before);
    // The edit made before is still undoable.
    assert.ok(buffer.undo());
    assert.equal(buffer.lines.join('\n'), HTML.join('\n'));
    assert.ok(!w.actions.some(action => action.kind === 'trust' || action.kind === 'preview'));
  } finally { w.cleanup(); }
});

test('keys belong to the Console while it is open: letters search, nothing reaches the page or the text', async () => {
  const w = await workspace();
  try {
    w.page.emit({type: 'console', entry: error('alpha failure')});
    w.page.emit({type: 'console', entry: warn('beta missing')});
    w.press('C');
    w.press('beta eh');
    assert.equal(w.state.editor.dialog?.console?.query, 'beta eh');
    assert.equal(w.page.count('key'), 0);
    assert.equal(w.state.editor.buffer.dirty, false);
    w.press('\u007f\u007f\u007f');
    assert.match(w.screen(), /beta missing/u);
    assert.doesNotMatch(w.screen(), /alpha failure/u);
  } finally { w.cleanup(); }
});

test('filters, search, newest first, clear and the counts in the header', async () => {
  const w = await workspace({trusted: true});
  try {
    for (const entry of [info('first log'), warn('a 404'), error('boom one'), error('boom one'), error('boom two')]) w.page.emit({type: 'console', entry});
    w.press('C');
    const screen = w.screen();
    assert.match(screen, /Console \(page runtime, scripts on\) · 3 errors · 1 warning · 1 message/u);
    const rows = screen.split('\n');
    assert.ok(rows.findIndex(row => row.includes('boom two')) < rows.findIndex(row => row.includes('first log')), 'newest first');
    assert.match(screen, /boom one ×2/u);
    w.press(TAB);
    assert.doesNotMatch(w.screen(), /first log/u);
    assert.match(w.screen(), /errors and warnings/u);
    w.press(TAB);
    assert.doesNotMatch(w.screen(), /a 404/u);
    w.press(TAB);
    w.press('two');
    assert.match(w.screen(), /boom two/u);
    assert.doesNotMatch(w.screen(), /boom one/u);
    w.press(DEL);
    assert.equal(w.session.console()!.size, 0);
    assert.match(w.screen(), /Cleared/u);
    w.page.emit({type: 'console', entry: error('after clearing')});
    w.press('\u0015');
    assert.match(w.screen(), /after clearing/u);
  } finally { w.cleanup(); }
});

test('copy shows exactly what will be copied first, marked entries in order, and Esc copies nothing', async () => {
  const w = await workspace();
  try {
    w.page.emit({type: 'console', entry: error('one')});
    w.page.emit({type: 'console', entry: error('two')});
    w.page.emit({type: 'console', entry: error('three')});
    w.press('C');
    w.press(CTRL_C);
    assert.match(w.screen(), /Copy 1 Console entry\?/u);
    w.press(ESC);
    assert.equal(w.actions.length, 0);
    assert.equal(w.state.editor.dialog?.kind, 'console', 'Esc leaves the review, not the Console');
    w.press(SHIFT_DOWN); w.press(SHIFT_DOWN);
    w.press(CTRL_C);
    const review = w.screen();
    assert.match(review, /Copy 2 Console entries\?/u);
    assert.match(review, /\[error\] exception: two/u);
    w.press('\r');
    const copy = w.actions.at(-1);
    assert.equal(copy?.kind, 'copy');
    const text = (copy as {text: string}).text;
    assert.equal(text, 'Console of page.html (NMSh browser preview, redacted)\n[error] exception: two\n[error] exception: three');
    assert.match(w.screen(), /Copied 2 entries/u);
  } finally { w.cleanup(); }
});

test('Enter goes to the source only when the place is certain, and then shows the text', async () => {
  const w = await workspace();
  try {
    w.page.emit({type: 'console', entry: error('elsewhere', {target: 'external', label: 'https://cdn.example/x.js', line: 1})});
    w.press('C');
    w.press('\r');
    assert.match(w.screen(), /No place in the text to go to: it comes from outside the document/u);
    assert.equal(w.state.mode, 'preview');
    w.press(ESC);
    w.page.emit({type: 'console', entry: error('beside', {target: 'local', label: 'app.js', line: 0})});
    w.press('C'); w.press('\r');
    assert.match(w.screen(), /it is in app\.js, not this document/u);
    w.press(ESC);
    w.page.emit({type: 'console', entry: error('Uncaught ReferenceError: missing is not defined', {target: 'document', label: 'page.html', line: 3, column: 2})});
    w.press('C'); w.press('\r');
    assert.equal(w.state.editor.dialog, undefined);
    assert.equal(w.state.mode, 'edit');
    assert.deepEqual(w.state.editor.buffer.caret, {line: 3, column: 2});
    assert.ok(w.state.editor.jumps?.length, 'Back can return');
  } finally { w.cleanup(); }
});

test('a changed text or a Markdown page is never treated as an exact place', async () => {
  const md = await workspace({kind: 'markdown'});
  try {
    md.page.emit({type: 'console', entry: error('x', {target: 'document', label: 'page.md', line: 1, column: 0})});
    md.press('C'); md.press('\r');
    assert.match(md.screen(), /generated from Markdown/u);
  } finally { md.cleanup(); }
  const html = await workspace();
  try {
    html.state.editor.buffer.insert('changed ');
    html.page.emit({type: 'console', entry: error('x', {target: 'document', label: 'page.html', line: 3, column: 0})});
    html.press('C'); html.press('\r');
    assert.match(html.screen(), /the text changed since the page loaded/u);
    assert.equal(html.state.mode, 'preview');
  } finally { html.cleanup(); }
});

test('a new document load starts the Console again; a crash is recorded; a refresh after it reopens the page', async () => {
  const w = await workspace();
  try {
    w.page.emit({type: 'console', entry: error('old load')});
    w.page.emit({type: 'document'});
    w.page.emit({type: 'console', entry: error('new load')});
    assert.deepEqual(w.session.console()!.entries().map(record => record.message), ['new load']);
    w.page.emit({type: 'crashed'});
    assert.match(w.session.console()!.entries().at(-1)!.message, /crashed/u);
    await w.view.refresh(w.state.editor.buffer.lines.join('\n'));
    await settle();
    assert.equal(w.engine.opened.length, 2, 'a new page');
    const second = w.engine.opened[1]!;
    second.emit({type: 'document'});
    second.emit({type: 'console', entry: error('from the new page')});
    assert.deepEqual(w.session.console()!.entries().map(record => record.message), ['from the new page']);
    // The crashed page's listeners are gone: it cannot add to the Console any more.
    w.page.emit({type: 'console', entry: error('ghost')});
    assert.ok(!w.session.console()!.entries().some(record => record.message === 'ghost'));
  } finally { w.cleanup(); }
});

test('two documents\' previews never see each other\'s entries, and a closed preview has no Console', async () => {
  const a = await workspace();
  const b = await workspace();
  try {
    a.page.emit({type: 'console', entry: error('only in A')});
    b.page.emit({type: 'console', entry: error('only in B')});
    assert.deepEqual(a.view.console()!.log.entries().map(record => record.message), ['only in A']);
    assert.deepEqual(b.view.console()!.log.entries().map(record => record.message), ['only in B']);
    a.view.dispose();
    assert.equal(a.view.console(), undefined);
    assert.equal(a.page.eventListeners.size, 0, 'no listener outlives the preview');
  } finally { a.cleanup(); b.cleanup(); }
});

test('repeated open and close keeps no listeners; a flood stays bounded and quick to draw', async () => {
  const w = await workspace();
  try {
    const listeners = w.page.eventListeners.size;
    for (let index = 0; index < 50; index++) { w.press('C'); w.press('x'); w.press(ESC); }
    assert.equal(w.page.eventListeners.size, listeners);
    for (let index = 0; index < 20_000; index++) w.page.emit({type: 'console', entry: error(`flood ${index} ${'z'.repeat(index % 300)}`)});
    assert.ok(w.session.console()!.size <= MAX_ENTRIES);
    w.press('C');
    const started = process.hrtime.bigint();
    for (let index = 0; index < 20; index++) w.screen();
    assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 1000);
    assert.match(w.screen(), /older dropped/u);
  } finally { w.cleanup(); }
});

test('rows fit 30, 50, 80 and 120 columns with colour, NO_COLOR and Safe Glyphs; severity is never colour alone', async () => {
  const w = await workspace();
  const saved = process.env.NO_COLOR;
  try {
    w.page.emit({type: 'console', entry: warn('Failed to load resource: the server responded with a status of 404 (Not Found)')});
    w.page.emit({type: 'console', entry: error(`Uncaught TypeError: ${'long '.repeat(60)} 日本語 😀`, {target: 'document', label: 'page.html', line: 3, column: 2})});
    w.press('C');
    for (const safe of [false, true]) {
      setIconStyle(safe ? 'safe' : 'nerd');
      for (const noColor of [false, true]) {
        if (noColor) process.env.NO_COLOR = '1'; else delete process.env.NO_COLOR;
        for (const columns of [30, 50, 80, 120]) {
          const rows = renderDocumentSession(w.state, columns, 24);
          for (const row of rows) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
          const text = rows.map(row => stripAnsi(row)).join('\n');
          assert.match(text, safe ? /E (JS|net)/u : /✖ (JS|net)/u);
          if (safe) assert.doesNotMatch(text, /[✖▲ℹ•]/u);
          if (columns >= 80) assert.match(text, /page\.html:4:3/u); else assert.match(text, /at page\.html:4:3/u);
        }
      }
    }
  } finally {
    setIconStyle('nerd');
    if (saved === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = saved;
    w.cleanup();
  }
});

test('without the browser preview the Console says why; scripts off says what still appears', async () => {
  const dir = scratch();
  try {
    const file = path.join(dir, 'p.html');
    fs.writeFileSync(file, '<p>x</p>\n');
    const opened = await openForEdit(file, '/');
    if (!opened.ok) throw new Error(opened.reason);
    const state = createDocumentSession(opened.file, 'source');
    setDocumentMode(state, 'preview');
    for (const key of decodeKeys('C')) documentSessionKey(state, key, 100, 30);
    assert.equal(state.editor.dialog, undefined);
    assert.match(state.note ?? '', /browser preview \(Chromium\)/u);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  const w = await workspace();
  try {
    w.press('C');
    assert.match(w.screen(), /Console \(page runtime, scripts off\)/u);
    assert.match(w.screen().replace(/\s+/gu, ' '), /T in the preview turns scripts on/u);
  } finally { w.cleanup(); }
});

test('the preview status line counts Console errors and names the key', async () => {
  const w = await workspace();
  try {
    w.page.emit({type: 'console', entry: error('e1')});
    w.page.emit({type: 'console', entry: warn('w1')});
    assert.match(w.view.status() ?? '', /Console: 1 error, 1 warning \(C\)/u);
  } finally { w.cleanup(); }
});
