import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {GraphicsDecision} from '../src/graphics/capabilities.js';
import {PLACEHOLDER_CHAR} from '../src/graphics/kittyPlaceholder.js';
import {FrameStream} from '../src/graphics/stream.js';
import {browserPanelKey, createBrowserPanel, renderBrowserPanel, type BrowserPanelAction, type PanelGeometry} from '../src/browser/BrowserPanel.js';
import {BrowserSession, CHANGE_INTERVAL_MS, MAX_TABS, ZOOM_STEPS} from '../src/browser/session.js';
import type {Key} from '../src/terminal/keys.js';
import {stripAnsi} from '../src/util/text.js';
import {FakeClock, FakeEngine, pngFrame, settle, type FakePage} from './support/fakeBrowser.js';

const KITTY: GraphicsDecision = {backend: 'kitty', evidence: 'query', inline: 'placeholder', unicode: 'quadrant', cell: {width: 8, height: 16, source: 'estimated'}, reason: ''};
const GEO: PanelGeometry = {top: 1, cell: {width: 8, height: 16}, scale: 1};

function rig(options: {decision?: GraphicsDecision; cwd?: string; scale?: number | 'auto'} = {}) {
  const engine = new FakeEngine();
  const clock = new FakeClock();
  const sent: string[] = [];
  const streams: FrameStream[] = [];
  let id = 0x4e4d00;
  const session = new BrowserSession({
    engine, clock, scale: options.scale ?? 1, cell: () => ({width: 8, height: 16}),
    openStream: () => {
      const s = new FrameStream({decision: () => options.decision ?? KITTY, send: data => { sent.push(data); }, allocateId: () => ++id, color: () => 'truecolor', safeGlyphs: () => false, now: () => clock.time});
      streams.push(s);
      return s;
    },
  });
  const panel = createBrowserPanel(session, {cwd: options.cwd ?? '/'});
  const page = (n = 0): FakePage => engine.opened[n]!;
  const key = async (k: Key): Promise<BrowserPanelAction | undefined> => { const out = browserPanelKey(panel, k, GEO); await settle(); return out; };
  const text = (value: string) => key({kind: 'text', value});
  const render = (columns = 80, height = 24) => renderBrowserPanel(panel, columns, height);
  const start = async (url = 'https://example.com/') => { await session.open(url); render(); clock.advance(200); await settle(); };
  return {engine, clock, sent, streams, session, panel, page, key, text, render, start};
}

const pageCalls = (r: ReturnType<typeof rig>, name: string) => r.engine.opened.reduce((n, page) => n + page.count(name), 0);

// ---- focus model ------------------------------------------------------------------------------------------------------

const PRINTABLE = Array.from({length: 95}, (_, i) => String.fromCharCode(32 + i));
const KINDS = ['enter', 'newline', 'complete', 'focusPrevious', 'backspace', 'delete', 'left', 'right', 'up', 'down', 'lineHome', 'lineEnd', 'pageUp', 'pageDown', 'deleteWord', 'deleteLineBefore', 'deleteLineAfter', 'historySearch', 'find', 'toggleDetails', 'queueCommand', 'sendToProgram', 'redo', 'suggestNext', 'suggestPrevious', 'historyDelete', 'latest', 'eof', 'suspend', 'palette', 'selectAll', 'wordLeft', 'wordRight', 'bufferHome', 'bufferEnd'] as const;

test('focus: a new browser starts in chrome', async () => {
  const r = rig();
  assert.equal(r.panel.focus, 'chrome');
});

test('focus: in chrome no key of any class reaches the page', async () => {
  const r = rig();
  await r.start();
  const keys: Key[] = [...PRINTABLE.map(value => ({kind: 'text', value}) as Key), ...KINDS.map(kind => ({kind}) as Key), {kind: 'paste', value: 'pasted'}, {kind: 'wheelUp'}, {kind: 'wheelDown'}];
  for (const k of keys) {
    r.panel.focus = 'chrome';
    const action = await r.key(k);
    if (action?.kind === 'close') r.panel.focus = 'chrome';
    if (r.engine.opened.length > 1) for (const extra of r.engine.opened.slice(1)) await extra.close();
  }
  assert.equal(pageCalls(r, 'key'), 0, 'no key event');
  assert.equal(pageCalls(r, 'insertText'), 0, 'no inserted text');
  r.session.dispose();
});

test('focus: chrome commands do what they say', async () => {
  const r = rig();
  await r.start();
  const p = r.page();
  await r.text('j'); await r.text('k'); await r.text(' '); await r.text('b'); await r.text('g'); await r.text('G');
  const wheels = p.calls.filter(c => c.name === 'mouse').map(c => (c.args[0] as {deltaY: number}).deltaY);
  assert.equal(wheels.length, 6);
  assert.ok(wheels[0]! > 0 && wheels[1]! < 0 && wheels[2]! > 0 && wheels[3]! < 0 && wheels[4]! < 0 && wheels[5]! > 0);
  await r.text('['); await r.text(']'); await r.text('H'); await r.text('L');
  assert.equal(p.count('back'), 2); assert.equal(p.count('forward'), 2);
  await r.text('r'); await r.text('R'); await r.text('s');
  assert.deepEqual(p.calls.filter(c => c.name === 'reload').map(c => c.args[0]), [false, true]);
  assert.equal(p.count('stop'), 1);
  await r.text('+'); assert.equal(p.zoom, 1.1);
  await r.text('-'); await r.text('-'); assert.equal(p.zoom, 0.9);
  await r.text('0'); assert.equal(p.zoom, 1);
  assert.deepEqual(await r.text('c'), {kind: 'copy', text: 'https://example.com/', label: 'Copied the page address'});
  await r.text('o'); assert.equal(r.panel.focus, 'address'); assert.equal(r.panel.draft, 'https://example.com/');
  await r.key({kind: 'escape'}); assert.equal(r.panel.focus, 'chrome');
  await r.text('/'); assert.equal(r.panel.focus, 'find'); await r.key({kind: 'escape'});
  await r.text('i'); assert.equal(r.panel.focus, 'page'); await r.key({kind: 'escape'});
  await r.key({kind: 'enter'}); assert.equal(r.panel.focus, 'page'); await r.key({kind: 'escape'});
  assert.deepEqual(await r.key({kind: 'escape'}), {kind: 'close'}, 'Esc in chrome leaves the browser');
  assert.deepEqual(await r.text('x'), {kind: 'close'}, 'closing the only tab leaves the browser');
  assert.equal(pageCalls(r, 'key'), 0);
  r.session.dispose();
});

test('focus: tabs switch with Tab, Shift+Tab and digits; t opens, x closes', async () => {
  const r = rig();
  await r.start();
  await r.text('t'); await settle();
  assert.equal(r.session.count, 2); assert.equal(r.panel.focus, 'address'); assert.equal(r.session.activeIndex, 1);
  await r.key({kind: 'escape'});
  await r.text('1'); assert.equal(r.session.activeIndex, 0);
  await r.key({kind: 'complete'}); assert.equal(r.session.activeIndex, 1);
  await r.key({kind: 'focusPrevious'}); assert.equal(r.session.activeIndex, 0);
  await r.text('9'); assert.equal(r.session.activeIndex, 0, 'a tab that does not exist is ignored');
  await r.text('x'); assert.equal(r.session.count, 1);
  assert.equal(r.page(0).closed, true, 'the active tab was the first');
  assert.equal(r.page(1).closed, false);
  r.session.dispose();
});

test('focus: in page every key but Esc is forwarded; Esc returns to chrome; Ctrl+C closes', async () => {
  const r = rig();
  await r.start();
  r.panel.focus = 'page';
  let forwarded = 0;
  for (const value of PRINTABLE) { await r.text(value); forwarded += 1; }
  for (const kind of KINDS) {
    const before = pageCalls(r, 'key');
    await r.key({kind} as Key);
    assert.equal(pageCalls(r, 'key') - before, 2, `${kind} is a press and a release`);
    forwarded += 1;
    assert.equal(r.panel.focus, 'page', `${kind} does not change focus`);
  }
  assert.equal(pageCalls(r, 'key'), forwarded * 2);
  const downs = r.page().calls.filter(c => c.name === 'key' && c.args[0] === 'down').map(c => (c.args[1] as {key: string}).key);
  assert.equal(downs[0], ' '); assert.ok(downs.includes('q') && downs.includes('/') && downs.includes('j'), 'command letters are typed into the page');
  const before = pageCalls(r, 'key');
  assert.equal(await r.key({kind: 'escape'}), undefined);
  assert.equal(r.panel.focus, 'chrome');
  assert.equal(pageCalls(r, 'key'), before, 'Esc is not forwarded');
  r.panel.focus = 'page';
  assert.deepEqual(await r.key({kind: 'interrupt'}), {kind: 'close'});
  assert.equal(pageCalls(r, 'key'), before, 'Ctrl+C is not forwarded');
  for (const focus of ['chrome', 'address', 'find'] as const) { r.panel.focus = focus; assert.deepEqual(await r.key({kind: 'interrupt'}), {kind: 'close'}, focus); }
  r.session.dispose();
});

test('focus: paste goes to the page only in page focus', async () => {
  const r = rig();
  await r.start();
  await r.key({kind: 'paste', value: 'x'});
  assert.equal(pageCalls(r, 'insertText'), 0);
  r.panel.focus = 'page';
  await r.key({kind: 'paste', value: 'hello\nworld'});
  assert.deepEqual(r.page().calls.find(c => c.name === 'insertText')?.args, ['hello\nworld']);
  r.session.dispose();
});

test('focus: address editing, navigation, refusals and Markdown routing', async () => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'bp-'));
  try {
    writeFileSync(join(dir, 'a.md'), '#');
    const r = rig({cwd: dir});
    await r.start();
    await r.text('o');
    for (let i = 0; i < 30; i += 1) await r.key({kind: 'backspace'});
    assert.equal(r.panel.draft, '');
    for (const ch of 'example.org') await r.text(ch);
    await r.key({kind: 'enter'});
    assert.deepEqual(r.page().calls.find(c => c.name === 'navigate')?.args, ['https://example.org/']);
    assert.equal(r.panel.focus, 'chrome');
    await r.text('o'); await r.key({kind: 'deleteWord'});
    for (const ch of 'javascript:alert(1)') await r.text(ch);
    await r.key({kind: 'enter'});
    assert.equal(r.panel.focus, 'address', 'a refused address stays in the editor');
    assert.match(r.session.notice() ?? '', /never run/u);
    assert.equal(r.page().count('navigate'), 1);
    await r.key({kind: 'deleteWord'});
    await r.key({kind: 'paste', value: 'a.md\n'});
    assert.deepEqual(await r.key({kind: 'enter'}), {kind: 'open-document', path: join(dir, 'a.md')});
    assert.equal(r.page().count('navigate'), 1, 'a Markdown file is not loaded in the browser');
    r.session.dispose();
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('focus: find edits a query, Enter searches then steps, n and N step, an empty query clears', async () => {
  const r = rig();
  await r.start();
  await r.text('/');
  for (const ch of 'cat') await r.text(ch);
  await r.key({kind: 'enter'});
  assert.deepEqual(r.page().calls.find(c => c.name === 'find')?.args, ['cat', false]);
  assert.deepEqual(r.session.activeView()?.find, {query: 'cat', matches: 3, current: 1});
  await r.key({kind: 'enter'});
  assert.equal(r.page().count('find'), 2);
  await r.key({kind: 'escape'});
  assert.equal(r.panel.focus, 'chrome');
  await r.text('N');
  assert.deepEqual(r.page().calls.filter(c => c.name === 'find').at(-1)?.args, ['cat', true]);
  await r.text('/'); assert.equal(r.panel.findDraft, 'cat');
  for (let i = 0; i < 3; i += 1) await r.key({kind: 'backspace'});
  await r.key({kind: 'enter'});
  assert.equal(r.page().count('clearFind'), 1);
  assert.equal(r.session.activeView()?.find, undefined);
  r.session.dispose();
});

// ---- mouse ------------------------------------------------------------------------------------------------------------

test('mouse: a click on the page focuses it and is forwarded in CSS pixels; release and drag follow; outside is not forwarded', async () => {
  const r = rig();
  await r.start();
  const area = r.render().pageArea;
  assert.equal(r.panel.focus, 'chrome');
  await r.key({kind: 'mouseClick', x: 1, y: GEO.top + area.row});
  assert.equal(r.panel.focus, 'page');
  const down = r.page().calls.find(c => c.name === 'mouse')?.args[0] as {type: string; x: number; y: number};
  assert.deepEqual([down.type, down.x, down.y], ['down', 4, 8]);
  await r.key({kind: 'mouseDrag', x: 5, y: GEO.top + area.row + 2});
  await r.key({kind: 'mouseRelease', x: 5, y: GEO.top + area.row + 2});
  const types = r.page().calls.filter(c => c.name === 'mouse').map(c => (c.args[0] as {type: string}).type);
  assert.deepEqual(types, ['down', 'move', 'up']);
  r.panel.focus = 'chrome';
  const n = r.page().count('mouse');
  await r.key({kind: 'mouseMove', x: 3, y: GEO.top + area.row});
  await r.key({kind: 'mouseRelease', x: 3, y: GEO.top + area.row});
  assert.equal(r.page().count('mouse'), n, 'hover in chrome and a stray release are not forwarded');
  await r.key({kind: 'wheelDown'});
  assert.equal(r.page().count('mouse'), n + 1, 'the wheel scrolls in either focus');
  r.session.dispose();
});

test('mouse: clicks on the tab strip and the address row are browser clicks, not page clicks', async () => {
  const r = rig();
  await r.start();
  await r.text('t'); await settle(); await r.key({kind: 'escape'});
  r.render();
  const layout = r.panel.layout!;
  assert.equal(r.session.activeIndex, 1);
  await r.key({kind: 'mouseClick', x: layout.tabHits[0]!.start + 2, y: GEO.top + layout.tabRow});
  assert.equal(r.session.activeIndex, 0);
  await r.key({kind: 'mouseClick', x: 10, y: GEO.top + layout.addressRow});
  assert.equal(r.panel.focus, 'address');
  assert.equal(pageCalls(r, 'mouse'), 0);
  r.session.dispose();
});

// ---- session ----------------------------------------------------------------------------------------------------------

test('session: tab lifecycle cleans up subscriptions, streams and uploads', async () => {
  const r = rig();
  await r.start();
  await r.page().push(pngFrame(640, 400, 1));
  await r.session.open('https://b.example/');
  const second = r.page(1);
  assert.equal(second.frameListeners.size, 1); assert.equal(second.eventListeners.size, 1);
  r.clock.advance(200);
  await second.push(pngFrame(640, 400, 2));
  const uploadsBefore = r.sent.length;
  r.session.closeTab(1);
  assert.equal(second.frameListeners.size, 0); assert.equal(second.eventListeners.size, 0);
  assert.equal(second.closed, true);
  assert.ok(r.sent.slice(uploadsBefore).some(s => s.includes('a=d,d=I')), 'its picture is deleted from the terminal');
  assert.equal(r.session.count, 1);
  const first = r.page();
  r.session.dispose();
  assert.equal(first.frameListeners.size, 0); assert.equal(first.eventListeners.size, 0); assert.equal(first.closed, true);
  const after = r.sent.length;
  first.emit({type: 'title', title: 'late'});
  await first.push(pngFrame(10, 10, 3));
  assert.equal(r.sent.length, after, 'nothing happens after dispose');
  r.session.dispose();
});

test('session: switching tabs releases the hidden tab picture and draws the shown one again', async () => {
  const r = rig();
  await r.start();
  await r.page().push(pngFrame(640, 400, 1));
  assert.ok(r.session.hasPicture());
  await r.session.open('https://b.example/');
  assert.ok(r.sent.some(s => s.includes('a=d,d=I')), 'the first tab picture was deleted when it was hidden');
  r.session.activate(0);
  assert.ok(r.session.hasPicture(), 'drawn again from its latest frame');
  assert.ok(r.session.pageLines().every(line => line.includes(PLACEHOLDER_CHAR)));
  r.session.dispose();
});

test('session: popups open as tabs up to twelve; the 13th and bad addresses are refused with a notice', async () => {
  const r = rig();
  await r.start();
  const first = r.page();
  for (let i = 0; i < MAX_TABS - 1; i += 1) { first.emit({type: 'popup', url: `https://p${i}.example/`}); await settle(); }
  assert.equal(r.session.count, MAX_TABS);
  first.emit({type: 'popup', url: 'https://one-too-many.example/'}); await settle();
  assert.equal(r.session.count, MAX_TABS);
  assert.match(r.session.notice() ?? '', /blocked/u);
  const refused = await r.session.open('https://x.example/');
  assert.equal(refused.ok, false);
  r.session.closeTab(5);
  first.emit({type: 'popup', url: 'javascript:alert(1)'}); await settle();
  assert.equal(r.session.count, MAX_TABS - 1);
  assert.match(r.session.notice() ?? '', /cannot open/u);
  r.session.dispose();
});

test('session: blocked, dialog and download events become short notices; page text is made inert', async () => {
  const r = rig();
  await r.start();
  const p = r.page();
  p.emit({type: 'blocked', url: 'https://tracker.example/', reason: 'remote\u001b[31m resource'});
  assert.match(r.session.notice()!, /^Blocked: remote/u);
  assert.ok(!r.session.notice()!.includes('\u001b'));
  p.emit({type: 'dialog', kind: 'alert', message: 'Hello‮'});
  assert.match(r.session.notice()!, /alert: Hello/u);
  p.emit({type: 'download-blocked', url: 'https://x/y.zip'});
  assert.match(r.session.notice()!, /download was blocked/u);
  p.emit({type: 'title', title: 'T\u001b]0;evil\u0007itle'});
  assert.ok(!r.session.activeView()!.title.includes('\u001b'));
  r.clock.advance(6000);
  assert.equal(r.session.notice(), undefined, 'notices expire');
  r.session.dispose();
});

test('session: resize sets the viewport from the cell size once, debounced; frames are requested again', async () => {
  const r = rig({scale: 'auto'});
  await r.session.open('https://example.com/');
  const p = r.page();
  r.session.resize({columns: 100, rows: 30});
  r.session.resize({columns: 90, rows: 28});
  r.session.resize({columns: 80, rows: 20});
  assert.equal(p.count('setViewport'), 0, 'nothing until the size settles');
  r.clock.advance(100);
  r.session.resize({columns: 82, rows: 20});
  r.clock.advance(100);
  assert.equal(p.count('setViewport'), 0, 'a later change restarts the wait');
  r.clock.advance(100);
  await settle();
  assert.equal(p.count('setViewport'), 1);
  assert.deepEqual(p.calls.find(c => c.name === 'setViewport')?.args[0], {width: 656, height: 320, scale: 1});
  assert.equal(p.count('capture'), 1);
  r.session.resize({columns: 82, rows: 20});
  r.clock.advance(500);
  assert.equal(p.count('setViewport'), 1, 'the same size does nothing');
  r.session.resize({columns: 40, rows: 10}, {width: 16, height: 32});
  r.clock.advance(200); await settle();
  assert.deepEqual(p.calls.filter(c => c.name === 'setViewport').at(-1)?.args[0], {width: 320, height: 160, scale: 2}, 'cell size 16x32 gives scale 2 and CSS pixels = terminal pixels / 2' );
  r.session.dispose();
});

test('session: zoom steps through 25% to 500%', async () => {
  const r = rig();
  await r.start();
  assert.deepEqual([...ZOOM_STEPS], [0.25, 0.33, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]);
  for (let i = 0; i < 30; i += 1) await r.session.zoomBy(1);
  assert.equal(r.page().zoom, 5);
  for (let i = 0; i < 30; i += 1) await r.session.zoomBy(-1);
  assert.equal(r.page().zoom, 0.25);
  r.session.dispose();
});

test('session: a frame flood notifies at most every 33 ms; a slow listener makes the page skip frames', async () => {
  const r = rig();
  await r.start();
  let changes = 0;
  r.session.onChange(() => { changes += 1; });
  const p = r.page();
  const started = r.clock.time;
  for (let ms = 0; ms < 1000; ms += 5) {
    await p.push(pngFrame(64, 64, ms));
    r.clock.advance(5);
    await settle(1);
  }
  const elapsed = r.clock.time - started;
  assert.ok(changes <= Math.ceil(elapsed / CHANGE_INTERVAL_MS) + 1, `${changes} changes in ${elapsed} ms`);
  assert.ok(changes > 5);
  assert.ok(p.droppedFrames > 0, 'the engine skipped frames while the listener was busy');
  r.session.dispose();
  const after = changes;
  r.clock.advance(1000);
  assert.equal(changes, after, 'no notification after dispose');
});

test('session: the newest frame is drawn once the rate limit allows (the last picture is not lost)', async () => {
  const r = rig();
  await r.start();
  const p = r.page();
  await p.push(pngFrame(64, 64, 1));
  const uploads = () => r.sent.filter(s => s.includes('a=t')).length;
  assert.equal(uploads(), 1);
  r.clock.advance(10);
  await p.push(pngFrame(64, 64, 2));
  assert.equal(uploads(), 1, 'held back');
  r.clock.advance(200);
  await settle();
  assert.equal(uploads(), 2, 'drawn when due');
  r.session.dispose();
});

test('session: a crashed or closed tab shows an error and reloads into a new page', async () => {
  const r = rig();
  await r.start();
  const p = r.page();
  p.emit({type: 'crashed'});
  assert.match(r.session.activeView()!.error!, /crashed/u);
  assert.equal(p.frameListeners.size, 0);
  const rows = r.render().rows.map(stripAnsi).join('\n');
  assert.match(rows, /The page crashed\. Press r to reload\./u);
  await r.text('r');
  assert.equal(r.engine.opened.length, 2);
  assert.equal(r.page(1).url, 'https://example.com/');
  assert.equal(r.session.activeView()!.error, undefined);
  r.page(1).emit({type: 'closed'});
  assert.match(r.session.activeView()!.error!, /closed/u);
  r.session.dispose();
});

test('session: no browser available shows the engine message and leaves the tab with an error', async () => {
  const r = rig();
  r.engine.failOpen = 'No Chromium browser was found.';
  const result = await r.session.open('https://example.com/');
  assert.deepEqual(result, {ok: false, reason: 'No Chromium browser was found.'});
  assert.equal(r.session.activeView()!.error, 'No Chromium browser was found.');
  r.engine.failOpen = undefined;
  await r.text('r');
  assert.equal(r.session.activeView()!.error, undefined);
  r.session.dispose();
});

// ---- rendering --------------------------------------------------------------------------------------------------------

test('render: layout rows, page area, picture rows and the address from the real URL', async () => {
  const r = rig();
  await r.start();
  r.page().emit({type: 'title', title: 'Example Domain'});
  await r.page().push(pngFrame(640, 400, 1));
  const out = r.render(80, 24);
  assert.equal(out.rows.length, 24);
  assert.equal(out.pageArea.columns, 80);
  const text = out.rows.map(stripAnsi);
  assert.match(text[1]!, /Example Domain/u);
  assert.match(text[2]!, /https:\/\/example\.com\//u);
  const page = out.rows.slice(out.pageArea.row, out.pageArea.row + out.pageArea.rows);
  assert.equal(page.length, out.pageArea.rows);
  assert.ok(page.every(row => row.includes(PLACEHOLDER_CHAR)));
  assert.match(text.at(-2)!, /Esc/u);
  assert.match(text[out.pageArea.row + out.pageArea.rows]!, /Example Domain/u, 'the status row shows the title');
  r.page().emit({type: 'navigated', url: 'https://evil.example/‮gpj.exe'});
  assert.ok(!r.render().rows.map(stripAnsi).join('').includes('‮'));
  r.session.dispose();
});

test('render: typing hint, zoom, find count, http warning and loading marker', async () => {
  const r = rig();
  await r.start('http://example.com/');
  const status = () => { const out = r.render(); return stripAnsi(out.rows[out.pageArea.row + out.pageArea.rows]!); };
  assert.match(status(), /not secure/u);
  await r.text('+');
  assert.match(status(), /110%/u);
  r.clock.advance(6000);
  r.page().emit({type: 'editable', editable: true});
  r.panel.focus = 'page';
  assert.match(status(), /typing in the page · Esc for browser commands/u);
  assert.match(stripAnsi(r.render().rows.at(-2)!), /Esc browser commands/u);
  r.panel.focus = 'chrome';
  await r.text('/'); for (const ch of 'a') await r.text(ch); await r.key({kind: 'enter'});
  assert.match(stripAnsi(r.render().rows.at(-2)!), /Enter find/u);
  await r.key({kind: 'escape'});
  assert.match(status(), /1 of 3/u);
  r.page().emit({type: 'loading', loading: true});
  assert.match(stripAnsi(r.render().rows[1]!), /…/u);
  r.session.dispose();
});

test('render: NO_COLOR draws no color and keeps the active tab and address editor visible', async () => {
  const previous = process.env.NMSH_COLOR;
  process.env.NMSH_COLOR = '0';
  try {
    const r = rig();
    await r.start();
    await r.text('o');
    const out = r.render();
    const joined = out.rows.filter(row => !row.includes(PLACEHOLDER_CHAR)).join('\n');
    assert.ok(!/\u001b\[(?:38|48)[;:]/u.test(joined), 'no color escapes outside the picture');
    assert.ok(out.rows[1]!.includes('\u001b[7m'), 'the active tab is reverse video');
    assert.ok(out.rows[2]!.includes('\u001b[7m'), 'the address editor and caret are reverse video');
    r.session.dispose();
  } finally { if (previous === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = previous; }
});

test('render: Safe Glyphs use ASCII for the browser chrome', async () => {
  const previous = process.env.NMSH_ICONS;
  process.env.NMSH_ICONS = 'safe';
  try {
    const r = rig();
    await r.start();
    r.page().emit({type: 'loading', loading: true});
    const out = r.render();
    for (const index of [1, 2]) assert.ok(/^[\x20-\x7e]*$/u.test(stripAnsi(out.rows[index]!)), `row ${index}: ${stripAnsi(out.rows[index]!)}`);
    r.session.dispose();
  } finally { if (previous === undefined) delete process.env.NMSH_ICONS; else process.env.NMSH_ICONS = previous; }
});

test('render: narrow terminals show a tab count and wrap controls; tiny ones say what they need', async () => {
  const r = rig();
  await r.start();
  await r.session.open('https://b.example/');
  const narrow = r.render(40, 24);
  assert.equal(narrow.rows.length, 24);
  assert.match(stripAnsi(narrow.rows[1]!), /tab 2 of 2/u);
  const wide = r.render(120, 24);
  assert.match(stripAnsi(wide.rows[1]!), /example\.com/u);
  const tiny = r.render(20, 8);
  assert.equal(tiny.rows.length, 8);
  assert.match(tiny.rows.map(stripAnsi).join('\n'), /Needs at least 32x10/u);
  assert.equal(tiny.pageArea.rows, 0);
  const short = r.render(80, 9);
  assert.match(short.rows.map(stripAnsi).join('\n'), /Needs at least/u);
  const small = r.render(32, 10);
  assert.equal(small.rows.length, 10);
  assert.ok(small.pageArea.rows >= 3);
  r.session.dispose();
});

test('render: the page area follows the terminal and the viewport is requested for it', async () => {
  const r = rig();
  await r.start();
  const a = r.render(100, 30).pageArea;
  r.clock.advance(300); await settle();
  assert.deepEqual(r.page().calls.filter(c => c.name === 'setViewport').at(-1)?.args[0], {width: 100 * 8, height: a.rows * 16, scale: 1});
  r.session.dispose();
});
