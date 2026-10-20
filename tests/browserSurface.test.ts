import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {GraphicsDecision} from '../src/graphics/capabilities.js';
import {containsKittyBytes, PLACEHOLDER_CHAR} from '../src/graphics/kittyPlaceholder.js';
import {FrameStream, MAX_FRAME_BYTES, type StreamHost} from '../src/graphics/stream.js';
import {addressKind, displayUrl, hasCredentials, normalizeAddress, plainText, popupAddress} from '../src/browser/address.js';
import {cellToViewport, keyToInput, SHIFT, CTRL} from '../src/browser/keymap.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {pngFrame} from './support/fakeBrowser.js';

const KITTY: GraphicsDecision = {backend: 'kitty', evidence: 'query', inline: 'placeholder', unicode: 'quadrant', cell: {width: 8, height: 16, source: 'estimated'}, reason: ''};
const UNICODE: GraphicsDecision = {backend: 'unicode', evidence: 'none', inline: 'unicode', unicode: 'quadrant', cell: {width: 8, height: 16, source: 'estimated'}, reason: ''};

function stream(decision: GraphicsDecision, extra: Partial<StreamHost> = {}) {
  const sent: string[] = [];
  const clock = {time: 1000};
  let id = 0x4e4d00;
  const host: StreamHost = {decision: () => decision, send: data => { sent.push(data); }, allocateId: () => ++id, color: () => 'truecolor', safeGlyphs: () => false, now: () => clock.time, ...extra};
  return {stream: new FrameStream(host), sent, clock};
}

const png = (seed: number, size = 16) => { const f = pngFrame(size, size, seed); return {png: f.png, width: f.width, height: f.height}; };
const idsIn = (text: string, action: 't' | 'd') => [...text.matchAll(action === 't' ? /a=t,f=100,t=d,i=(\d+)/gu : /a=d,d=I,i=(\d+)/gu)].map(match => Number(match[1]));

// ---- stream: Kitty ----------------------------------------------------------------------------------------------------

test('kitty stream: uploads under alternating ids, deletes the previous one a frame later, never both live', () => {
  const {stream: s, sent, clock} = stream(KITTY);
  const box = {columns: 10, rows: 4};
  const first = s.update(png(1), box);
  assert.equal(first.kind, 'kitty-placeholder');
  assert.equal(first.skipped, false);
  assert.equal(first.lines.length, 4);
  assert.ok(first.lines[0]!.includes(PLACEHOLDER_CHAR));
  const [a] = idsIn(sent[0]!, 't');
  assert.ok(sent[0]!.includes(`a=p,U=1,i=${a},c=10,r=4`));
  clock.time += 200;
  const second = s.update(png(2), box);
  const [b] = idsIn(sent[1]!, 't');
  assert.notEqual(a, b);
  assert.deepEqual(idsIn(sent[1]!, 'd'), [], 'the previous picture is still there while the new one is painted');
  clock.time += 200;
  s.update(png(3), box);
  assert.deepEqual(idsIn(sent[2]!, 'd'), [a], 'the picture from two frames back is deleted');
  assert.deepEqual(idsIn(sent[2]!, 't'), [a], 'and its id is reused');
  assert.notEqual(second.lines[0], first.lines[0]);
  s.settle();
  assert.deepEqual(idsIn(sent[3]!, 'd'), [b], 'settle removes the last retired picture');
  assert.equal(sent.length, 4);
  s.settle();
  assert.equal(sent.length, 4, 'settle with nothing retired sends nothing');
});

test('kitty stream: identical frames and early frames upload nothing; a new box restates the placement only', () => {
  const {stream: s, sent, clock} = stream(KITTY);
  const box = {columns: 8, rows: 3};
  s.update(png(1), box);
  assert.equal(sent.length, 1);
  assert.equal(s.update(png(1), box).skipped, true);
  clock.time += 500;
  assert.equal(s.update(png(1), box).skipped, true, 'identical bytes are skipped whatever the time');
  assert.equal(sent.length, 1);
  assert.equal(s.update(png(2), box).skipped, false);
  clock.time += 10;
  const early = s.update(png(3), box);
  assert.equal(early.skipped, true, 'a frame inside the minimum interval is dropped, not queued');
  assert.equal(sent.length, 2);
  assert.ok(s.retryAfter() > 0);
  const resized = s.update(png(2), {columns: 6, rows: 2});
  assert.equal(resized.lines.length, 2);
  assert.ok(sent.at(-1)!.includes('a=p,U=1') && !sent.at(-1)!.includes('a=t'));
});

test('kitty stream: backs off while the previous write has not drained, and recovers', () => {
  let drained = false;
  const {stream: s, sent, clock} = stream(KITTY, {drained: () => drained});
  const box = {columns: 4, rows: 2};
  s.update(png(1), box);
  clock.time += 100;
  drained = false;
  assert.equal(s.update(png(2), box).skipped, true);
  assert.equal(sent.length, 1);
  const wait = s.retryAfter();
  assert.ok(wait >= 100, `interval grew (${wait})`);
  drained = true;
  clock.time += 2000;
  assert.equal(s.update(png(2), box).skipped, false);
});

test('kitty stream: oversize frames are skipped with a note, boxes are clamped, dispose deletes everything', () => {
  const {stream: s, sent, clock} = stream(KITTY);
  const big = {png: new Uint8Array(MAX_FRAME_BYTES + 1), width: 1, height: 1};
  const refused = s.update(big, {columns: 5, rows: 2});
  assert.equal(refused.skipped, true);
  assert.match(refused.note ?? '', /too large/u);
  assert.equal(sent.length, 0);
  const huge = s.update(png(1), {columns: 5000, rows: 5000});
  assert.equal(huge.lines.length, 297);
  clock.time += 200;
  s.update(png(2), {columns: 5, rows: 2});
  const before = sent.length;
  s.dispose();
  const deleted = idsIn(sent[before]!, 'd');
  assert.equal(deleted.length, 2, 'both pictures deleted');
  s.dispose();
  assert.equal(sent.length, before + 1, 'dispose is idempotent');
  assert.equal(s.update(png(5), {columns: 3, rows: 2}).skipped, true);
  assert.equal(sent.length, before + 1, 'nothing is uploaded after dispose');
});

test('kitty stream: release deletes and the next frame uploads again; forget deletes nothing', () => {
  const {stream: s, sent, clock} = stream(KITTY);
  s.update(png(1), {columns: 4, rows: 2});
  s.release();
  assert.equal(idsIn(sent.at(-1)!, 'd').length, 1);
  clock.time += 200;
  const n = sent.length;
  assert.equal(s.update(png(1), {columns: 4, rows: 2}).skipped, false);
  assert.equal(sent.length, n + 1);
  s.forget();
  assert.equal(sent.length, n + 1);
});

// ---- stream: character art --------------------------------------------------------------------------------------------

test('unicode stream: exactly the box, no kitty bytes, rate limited, resized from the cached picture', () => {
  const {stream: s, sent, clock} = stream(UNICODE);
  const box = {columns: 20, rows: 6};
  const out = s.update(png(1, 32), box);
  assert.equal(out.kind, 'character-art');
  assert.equal(out.lines.length, 6);
  for (const line of out.lines) assert.equal(displayWidth(line), 20);
  assert.ok(!out.lines.some(containsKittyBytes));
  assert.equal(sent.length, 0, 'character art writes nothing to the terminal');
  clock.time += 50;
  assert.equal(s.update(png(2, 32), box).skipped, true, 'under the 8 fps cap');
  assert.equal(s.update(png(1, 32), box).skipped, true, 'identical');
  const resized = s.update(png(1, 32), {columns: 10, rows: 3});
  assert.equal(resized.skipped, false);
  assert.equal(resized.lines.length, 3);
  for (const line of resized.lines) assert.equal(displayWidth(line), 10);
  clock.time += 200;
  assert.equal(s.update(png(2, 32), box).skipped, false);
});

test('unicode stream: a slow render pushes the next one out; bad PNG is skipped with a note; ascii when safe glyphs', () => {
  let t = 0;
  let calls = 0;
  const {stream: s} = stream(UNICODE, {now: () => { calls += 1; return t += calls % 2 === 0 ? 400 : 1; }});
  s.update(png(1), {columns: 8, rows: 3});
  assert.ok(s.retryAfter() >= 0);
  const {stream: bad} = stream(UNICODE);
  const broken = bad.update({png: new Uint8Array([1, 2, 3]), width: 1, height: 1}, {columns: 5, rows: 2});
  assert.equal(broken.skipped, true);
  assert.ok(broken.note);
  assert.equal(broken.lines.length, 2);
  const ascii = stream({...UNICODE, unicode: 'ascii'}, {safeGlyphs: () => true});
  const art = ascii.stream.update(png(4, 32), {columns: 12, rows: 4});
  for (const line of art.lines) assert.ok(/^[\x20-\x7e]*$/u.test(stripAnsi(line)), 'safe glyphs are printable ASCII');
});

test('stream: graphics off draws nothing', () => {
  const {stream: s, sent} = stream({...UNICODE, backend: 'off', inline: 'none'});
  const out = s.update(png(1), {columns: 6, rows: 2});
  assert.equal(out.skipped, true);
  assert.equal(out.lines.length, 2);
  assert.equal(sent.length, 0);
});

// ---- address ----------------------------------------------------------------------------------------------------------

function tree() {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'addr-'));
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'page.html'), '<p>');
  writeFileSync(join(dir, 'my notes.html'), '<p>');
  writeFileSync(join(dir, 'README.md'), '#');
  writeFileSync(join(dir, 'sub', 'a.html'), '<p>');
  symlinkSync(join(dir, 'page.html'), join(dir, 'link.html'));
  return {dir, done: () => rmSync(dir, {recursive: true, force: true})};
}

test('address: web addresses', () => {
  const o = {cwd: '/'};
  const ok = (input: string, url: string) => assert.deepEqual(normalizeAddress(input, o), {ok: true, url}, input);
  ok('example.com', 'https://example.com/');
  ok('  example.com/a?b=1#c ', 'https://example.com/a?b=1#c');
  ok('example.com:8443/x', 'https://example.com:8443/x');
  ok('localhost', 'http://localhost/');
  ok('localhost:3000', 'http://localhost:3000/');
  ok('localhost:3000/app', 'http://localhost:3000/app');
  ok('127.0.0.1:8080', 'http://127.0.0.1:8080/');
  ok('127.0.0.1', 'http://127.0.0.1/');
  ok('[::1]:3000', 'http://[::1]:3000/');
  ok('app.localhost', 'http://app.localhost/');
  ok('192.168.1.5', 'https://192.168.1.5/');
  ok('https://example.com/', 'https://example.com/');
  ok('HTTP://Example.com', 'http://example.com/');
  ok('http://localhost:5173', 'http://localhost:5173/');
  ok('about:blank', 'about:blank');
  ok('ABOUT:BLANK', 'about:blank');
});

test('address: refusals are plain and complete', () => {
  const o = {cwd: '/'};
  for (const input of [
    'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:1', 'data:text/html,<p>', 'chrome://settings', 'chrome-untrusted://x', 'chrome-extension://x/y', 'devtools://devtools/bundled/x',
    'view-source:https://example.com', 'blob:https://example.com/x', 'ftp://example.com', 'mailto:a@b.c', 'tel:123', 'ws://example.com', 'wss://example.com', 'filesystem:https://x/y', 'about:config', 'about:srcdoc', 'gopher://x', 'file://remote.example/etc/passwd',
  ]) {
    const result = normalizeAddress(input, o);
    assert.equal(result.ok, false, input);
    if (!result.ok) assert.ok(result.reason.length > 8 && !/[\u0000-\u001f]/u.test(result.reason), input);
  }
});

test('address: search text, single words, credentials, control characters and length are refused', () => {
  const o = {cwd: '/'};
  const search = normalizeAddress('best pizza near me', o);
  assert.equal(search.ok, false);
  if (!search.ok) assert.match(search.reason, /no search engine/iu);
  for (const input of ['', '   ', 'hello', 'nodots', 'what is rust?', 'https://user:pass@example.com/', 'https://user@example.com/', 'user:pass@example.com', 'user@example.com', 'example.com\u0000', 'exa‮mple.com', 'a‏b.com', `https://example.com/${'a'.repeat(3000)}`, 'http://']) {
    assert.equal(normalizeAddress(input, o).ok, false, JSON.stringify(input.slice(0, 40)));
  }
});

test('address: files become file URLs, Markdown is routed, non-files and symlink-to-file behave', () => {
  const t = tree();
  try {
    const o = {cwd: t.dir, home: t.dir};
    const base = `file://${t.dir}`;
    const page = normalizeAddress('page.html', o);
    assert.deepEqual(page, {ok: true, url: `${base}/page.html`});
    assert.deepEqual(normalizeAddress('./sub/a.html', o), {ok: true, url: `${base}/sub/a.html`});
    assert.deepEqual(normalizeAddress('../page.html', {...o, cwd: join(t.dir, 'sub')}), {ok: true, url: `${base}/page.html`});
    assert.deepEqual(normalizeAddress(join(t.dir, 'page.html'), {cwd: '/'}), {ok: true, url: `${base}/page.html`});
    assert.deepEqual(normalizeAddress('~/page.html', o), {ok: true, url: `${base}/page.html`});
    assert.deepEqual(normalizeAddress('my notes.html', o), {ok: true, url: `${base}/my%20notes.html`});
    assert.deepEqual(normalizeAddress(`file://${t.dir}/page.html`, {cwd: '/'}), {ok: true, url: `${base}/page.html`});
    assert.deepEqual(normalizeAddress('link.html', o), {ok: true, url: `${base}/link.html`});
    const md = normalizeAddress('README.md', o);
    assert.deepEqual(md, {ok: true, url: `${base}/README.md`, local: join(t.dir, 'README.md')});
    const mdUrl = normalizeAddress(`file://${t.dir}/README.md`, {cwd: '/'});
    assert.ok(mdUrl.ok && mdUrl.local === join(t.dir, 'README.md'));
    for (const input of ['./sub', '.', './missing.html', '/definitely/not/here.html', `file://${t.dir}/missing.html`, `file://${t.dir}/sub`, '~/missing']) assert.equal(normalizeAddress(input, o).ok, false, input);
    assert.equal(normalizeAddress('~/page.html', {cwd: t.dir}).ok, false, 'no home known');
  } finally { t.done(); }
});

test('address: display strips controls and bidi, hides passwords, classifies', () => {
  assert.equal(displayUrl('https://exa‮mple.com/\u0007x‏'), 'https://example.com/x');
  assert.equal(displayUrl('https://u:secret@example.com/'), 'https://u:***@example.com/');
  assert.ok(!displayUrl('https://u:secret@example.com/').includes('secret'));
  assert.equal(hasCredentials('https://u:p@example.com/'), true);
  assert.equal(hasCredentials('https://example.com/'), false);
  assert.equal(hasCredentials('nonsense'), false);
  assert.equal(plainText('a\u001b[31mb\n‮c  d', 20), 'a [31mb c d');
  assert.equal(plainText('x'.repeat(50), 10).length, 10);
  assert.equal(addressKind('https://a.b'), 'https');
  assert.equal(addressKind('http://a.b'), 'http');
  assert.equal(addressKind('file:///x'), 'file');
  assert.equal(addressKind('about:blank'), 'blank');
  assert.equal(addressKind('chrome://x'), 'other');
  assert.equal(popupAddress('https://a.b/c'), 'https://a.b/c');
  assert.equal(popupAddress('about:blank'), 'about:blank');
  for (const bad of ['javascript:1', 'data:text/html,x', 'file:///etc/passwd', 'https://u:p@a.b', 'nonsense']) assert.equal(popupAddress(bad), undefined, bad);
});

// ---- keymap -----------------------------------------------------------------------------------------------------------

test('keymap: text, shift, punctuation, named keys and Ctrl letters', () => {
  assert.deepEqual(keyToInput({kind: 'text', value: 'a'}), {key: 'a', code: 'KeyA', text: 'a'});
  assert.deepEqual(keyToInput({kind: 'text', value: 'A'}), {key: 'A', code: 'KeyA', text: 'A', modifiers: SHIFT});
  assert.deepEqual(keyToInput({kind: 'text', value: '7'}), {key: '7', code: 'Digit7', text: '7'});
  assert.deepEqual(keyToInput({kind: 'text', value: '&'}), {key: '&', code: 'Digit7', text: '&', modifiers: SHIFT});
  assert.deepEqual(keyToInput({kind: 'text', value: '/'}), {key: '/', code: 'Slash', text: '/'});
  assert.deepEqual(keyToInput({kind: 'text', value: '?'}), {key: '?', code: 'Slash', text: '?', modifiers: SHIFT});
  assert.deepEqual(keyToInput({kind: 'text', value: ' '}), {key: ' ', code: 'Space', text: ' '});
  assert.deepEqual(keyToInput({kind: 'text', value: 'é'}), {key: 'é', text: 'é'});
  assert.deepEqual(keyToInput({kind: 'text', value: '😀'}), {key: '😀', text: '😀'});
  assert.equal(keyToInput({kind: 'text', value: ''}), undefined);
  const named: Array<[string, string]> = [['enter', 'Enter'], ['complete', 'Tab'], ['backspace', 'Backspace'], ['delete', 'Delete'], ['left', 'ArrowLeft'], ['right', 'ArrowRight'], ['up', 'ArrowUp'], ['down', 'ArrowDown'], ['lineHome', 'Home'], ['lineEnd', 'End'], ['pageUp', 'PageUp'], ['pageDown', 'PageDown'], ['escape', 'Escape'], ['palette', 'F1']];
  for (const [kind, name] of named) assert.equal(keyToInput({kind} as never)?.key, name, kind);
  assert.deepEqual(keyToInput({kind: 'focusPrevious'}), {key: 'Tab', code: 'Tab', modifiers: SHIFT});
  assert.equal(keyToInput({kind: 'enter'})?.text, '\r');
  assert.deepEqual(keyToInput({kind: 'deleteLineBefore'}), {key: 'u', code: 'KeyU', modifiers: CTRL});
  assert.deepEqual(keyToInput({kind: 'find'}), {key: 'f', code: 'KeyF', modifiers: CTRL});
  for (const kind of ['interrupt', 'mouseClick', 'wheelUp', 'focusIn', 'paste'] as const) assert.equal(keyToInput(kind === 'paste' ? {kind, value: 'x'} : {kind}), undefined, kind);
});

test('mouse mapping: several cell sizes, origins and scales; outside is not forwarded', () => {
  const area = {row: 4, column: 1, columns: 80, rows: 20};
  const at = (x: number, y: number, cell = {width: 8, height: 16}, scale = 1, a = area) => cellToViewport({x, y}, {area: a, cell, scale});
  assert.deepEqual(at(1, 4), {x: 4, y: 8});
  assert.deepEqual(at(80, 23), {x: 636, y: 312});
  assert.equal(at(81, 4), undefined);
  assert.equal(at(1, 3), undefined, 'the address row is not the page');
  assert.equal(at(1, 24), undefined);
  assert.deepEqual(at(1, 4, {width: 16, height: 32}, 2), {x: 4, y: 8}, 'a Retina cell at scale 2 is the same CSS point');
  assert.deepEqual(at(2, 5, {width: 10, height: 20}, 1), {x: 15, y: 30});
  assert.deepEqual(at(2, 5, {width: 10, height: 20}, 1.5), {x: 10, y: 20});
  const shifted = {row: 10, column: 5, columns: 10, rows: 5};
  assert.deepEqual(at(5, 10, undefined, 1, shifted), {x: 4, y: 8});
  assert.deepEqual(at(14, 14, undefined, 1, shifted), {x: 76, y: 72});
  assert.equal(at(4, 10, undefined, 1, shifted), undefined);
  assert.deepEqual(cellToViewport({x: 500, y: 500}, {area, cell: {width: 8, height: 16}, scale: 1}, {clamp: true}), {x: 636, y: 312});
  assert.deepEqual(cellToViewport({x: 80, y: 23}, {area, cell: {width: 8, height: 16}, scale: 1, viewport: {width: 600, height: 300}}), {x: 599, y: 299}, 'kept inside the viewport');
});
