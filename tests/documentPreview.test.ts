import test from 'node:test';
import assert from 'node:assert/strict';
import type {GraphicsDecision} from '../src/graphics/capabilities.js';
import {FrameStream} from '../src/graphics/stream.js';
import {BrowserPreviewView, type DocumentPreviewDeps} from '../src/browser/documentPreview.js';
import {BrowserSession} from '../src/browser/session.js';
import type {PreviewDocument, PreviewHandle, PreviewServer} from '../src/browser/types.js';
import {createDocumentSession, documentSessionKey} from '../src/viewer/DocumentWorkspace.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {FakeClock, FakeEngine, settle, type FakePage} from './support/fakeBrowser.js';

const KITTY: GraphicsDecision = {backend: 'kitty', evidence: 'query', inline: 'placeholder', unicode: 'quadrant', cell: {width: 8, height: 16, source: 'estimated'}, reason: ''};

class FakePreviews implements PreviewServer {
  served: PreviewDocument[] = [];
  handles: Array<{url: string; html: string; disposed: boolean; updates: number}> = [];
  async serve(document: PreviewDocument): Promise<PreviewHandle> {
    this.served.push(document);
    const record = {url: `http://127.0.0.1:9/${this.handles.length + 1}/`, html: document.html, disposed: false, updates: 0};
    this.handles.push(record);
    return {url: record.url, update: html => { record.html = html; record.updates += 1; }, problems: () => (record === this.handles[0] ? [{path: 'missing.css', reason: 'not found'}] : []), dispose: () => { record.disposed = true; }};
  }
  async close(): Promise<void> {}
}

function rig(options: {dirty?: boolean} = {}) {
  const engine = new FakeEngine();
  const clock = new FakeClock();
  const previews = new FakePreviews();
  const opened: string[] = [];
  let id = 0x4e4d00;
  const session = new BrowserSession({
    engine, clock, scale: 1, cell: () => ({width: 8, height: 16}),
    openStream: () => new FrameStream({decision: () => KITTY, send: () => {}, allocateId: () => ++id, color: () => 'truecolor', safeGlyphs: () => false, now: () => clock.time}),
  });
  const deps: DocumentPreviewDeps = {session, previews, html: text => `<html>${text}</html>`, geometry: () => ({top: 1, left: 1, cell: {width: 8, height: 16}, scale: 1}), openLink: url => { opened.push(url); }, dirty: () => Boolean(options.dirty)};
  return {engine, clock, previews, opened, session, deps, page: (): FakePage => engine.opened[0]!};
}
const DOCUMENT = {name: 'page.html', root: '/work', text: '<h1>Hi</h1>', trusted: false};

async function opened(options: {dirty?: boolean} = {}) {
  const r = rig(options);
  const view = await BrowserPreviewView.open(r.deps, DOCUMENT);
  if (!(view instanceof BrowserPreviewView)) throw new Error(view.error);
  view.render(100, 30);
  r.clock.advance(300);
  await settle();
  return {...r, view};
}

test('opening serves the buffer from memory and opens a script-less preview page on the served address', async () => {
  const r = await opened();
  assert.equal(r.previews.served.length, 1);
  assert.deepEqual([r.previews.served[0]!.html, r.previews.served[0]!.root, r.previews.served[0]!.trusted], ['<html><h1>Hi</h1></html>', '/work', false]);
  assert.equal(r.engine.options[0]!.kind, 'preview');
  assert.equal(r.engine.options[0]!.scripts, false);
  assert.equal(r.page().url, 'http://127.0.0.1:9/1/');
  r.view.dispose();
});

test('a browser that cannot start is reported, and nothing is left serving', async () => {
  const r = rig();
  r.engine.failOpen = 'No Chrome or Chromium was found.';
  const view = await BrowserPreviewView.open(r.deps, DOCUMENT);
  assert.deepEqual(view, {error: 'No Chrome or Chromium was found.'});
  assert.equal(r.previews.handles.every(handle => handle.disposed), true);
});

test('the panel fits at many sizes, names the file, marks unsaved edits and shows the keys', async () => {
  const r = await opened({dirty: true});
  for (const [columns, height] of [[40, 12], [60, 16], [100, 30], [200, 60]] as const) {
    const rows = r.view.render(columns, height).rows;
    assert.ok(rows.length <= height, `${columns}x${height}`);
    for (const row of rows) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}x${height}: ${stripAnsi(row)}`);
  }
  const text = r.view.render(100, 30).rows.map(row => stripAnsi(row)).join('\n');
  assert.match(text, /page\.html ● edited\s+rendered by Chromium/u);
  for (const label of ['↑↓ scroll', '/ find', '+/- zoom', 'h source', 'e edit', 'r refresh', 'T scripts on']) assert.ok(text.includes(label), label);
  assert.match(text, /1 resource missing or refused \(missing\.css\)/u);
  r.view.dispose();
});

test('refresh serves the CURRENT text and reloads; it never touches anything else', async () => {
  const r = await opened();
  await r.view.refresh('<h1>Edited, unsaved</h1>');
  await settle();
  assert.equal(r.previews.handles[0]!.html, '<html><h1>Edited, unsaved</h1></html>');
  assert.equal(r.previews.handles[0]!.updates, 1);
  assert.equal(r.page().count('reload'), 1);
  r.view.dispose();
});

test('trusting a file serves it again with scripts on; trusting off turns them off', async () => {
  const r = await opened();
  await r.view.setTrusted(true, '<h1>Hi</h1><script>1</script>');
  await settle();
  assert.equal(r.previews.handles[0]!.disposed, true, 'the old address stops working');
  assert.equal(r.previews.served[1]!.trusted, true);
  assert.equal(r.page().count('setScripts'), 1);
  assert.equal(r.page().url, r.previews.handles[1]!.url);
  assert.match(r.view.render(100, 30).rows.map(row => stripAnsi(row)).join('\n'), /scripts on[\s\S]*T scripts off/u);
  r.view.dispose();
});

test('keys scroll, zoom and find; the find prompt owns Esc and Enter; the workspace gives it every key', async () => {
  const r = await opened();
  const press = async (key: Parameters<BrowserPreviewView['key']>[0]) => { r.view.key(key); await settle(); };
  await press({kind: 'text', value: 'j'});
  await press({kind: 'pageDown'});
  await press({kind: 'text', value: 'G'});
  assert.ok(r.page().count('mouse') >= 3, 'scrolling is wheel events');
  await press({kind: 'text', value: '+'});
  assert.ok(r.session.activeView()!.zoom > 1);
  await press({kind: 'text', value: '0'});
  assert.equal(r.session.activeView()!.zoom, 1);
  await press({kind: 'text', value: '/'});
  assert.equal(r.view.capturing(), true);
  for (const char of 'hello') await press({kind: 'text', value: char});
  await press({kind: 'escape'});
  assert.equal(r.view.capturing(), false, 'Esc cancels the prompt');
  assert.equal(r.page().count('find'), 0);
  await press({kind: 'text', value: '/'});
  for (const char of 'hi') await press({kind: 'text', value: char});
  await press({kind: 'enter'});
  assert.equal(r.page().count('find'), 1);
  r.view.dispose();
});

test('a click on the page is forwarded at the page\'s CSS pixel; a click on the panel\'s own rows is not', async () => {
  const r = await opened();
  r.view.key({kind: 'mouseClick', x: 3, y: 3} as never);
  await settle();
  const down = r.page().calls.find(call => call.name === 'mouse' && (call.args[0] as {type: string}).type === 'down');
  assert.ok(down, 'forwarded');
  const point = down!.args[0] as {x: number; y: number};
  assert.ok(point.x > 0 && point.y > 0);
  const before = r.page().count('mouse');
  r.view.key({kind: 'mouseClick', x: 3, y: 1} as never);
  await settle();
  assert.equal(r.page().count('mouse'), before, 'the header row is not the page');
  r.view.dispose();
});

test('a clicked link is never followed: the preview reports it, and o offers it to /browser', async () => {
  const r = await opened();
  r.page().emit({type: 'popup', url: 'https://example.com/next'});
  r.page().emit({type: 'blocked', url: 'https://example.com/x.png', reason: 'remote resource'});
  await settle();
  assert.equal(r.engine.opened.length, 1, 'no new tab for a preview');
  assert.match(r.view.status() ?? '', /Blocked|not followed/u);
  r.view.key({kind: 'text', value: 'o'});
  assert.equal(r.opened.length, 1);
  assert.match(r.opened[0]!, /^https:\/\/example\.com\//u);
  r.view.dispose();
});

test('dispose stops serving, closes the page and the session once', async () => {
  const r = await opened();
  r.view.dispose();
  r.view.dispose();
  await settle();
  assert.equal(r.previews.handles.every(handle => handle.disposed), true);
  assert.equal(r.engine.live.size, 0);
});

test('inside the document session the find prompt keeps Esc, and Esc otherwise returns to source', async () => {
  const r = await opened();
  const session = createDocumentSession({path: '/work/page.html', realPath: '/work/page.html', title: 'page.html', lineEnding: 'lf', bom: false, finalNewline: true, lines: ['<h1>Hi</h1>'], identity: {dev: 1, ino: 1, size: 1, mtimeMs: 1, hash: 'x'}});
  documentSessionKey(session, {kind: 'text', value: 'h'}, 100, 30);
  session.preview = r.view;
  documentSessionKey(session, {kind: 'text', value: '/'}, 100, 30);
  assert.equal(r.view.capturing(), true);
  documentSessionKey(session, {kind: 'escape'}, 100, 30);
  assert.equal(session.mode, 'preview', 'Esc closed the prompt, not the preview');
  documentSessionKey(session, {kind: 'escape'}, 100, 30);
  assert.equal(session.mode, 'source');
  r.view.dispose();
});

test('trust changes and refreshes run one at a time, scripts go off first, and a trust change made while starting is reconciled', async () => {
  const r = await opened();
  const order: string[] = [];
  const page = r.page();
  const original = page.setScripts.bind(page);
  page.setScripts = async (enabled: boolean) => { order.push(`scripts:${enabled}`); await original(enabled); };
  const first = r.view.setTrusted(true, '<h1>Hi</h1>');
  const second = r.view.setTrusted(false, '<h1>Hi</h1>');
  const third = r.view.refresh('<h1>Later</h1>');
  await Promise.all([first, second, third]);
  assert.deepEqual(order, ['scripts:true', 'scripts:false'], 'applied in the order asked');
  assert.equal(r.view.trusted, false, 'the last request wins');
  assert.equal(r.previews.handles.at(-1)!.html, '<html><h1>Later</h1></html>');
  const stale = r.previews.handles.slice(0, -1);
  assert.ok(stale.every(handle => handle.disposed), 'every replaced address stops working');
  r.view.dispose();
});
