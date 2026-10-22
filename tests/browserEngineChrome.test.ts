import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type {BrowserPage, Frame} from '../src/browser/types.js';
import {chromeSkipReason, createLab, disposeSharedLab, Events, localSite, pidAlive, scratchDir, sharedLab, waitFor} from './support/browserFixtures.js';
import {createBrowserEngine} from '../src/browser/engine/index.js';

/**
 * These drive a real Chromium over the DevTools pipe. They skip (with the reason) when no browser is installed or it cannot start,
 * and every test shuts its browser down in `finally`.
 */
const skip = await chromeSkipReason();
const view = {width: 600, height: 400, scale: 1};
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const settled = (page: BrowserPage, url?: string): Promise<true> => waitFor(() => (url === undefined || page.url === url) && !page.loading && true, `${url ?? 'the page'} to load`);
after(disposeSharedLab);

test('launch is lazy, uses a private profile, and shutdown leaves no process behind', {skip}, async () => {
  const lab = createLab();
  try {
    assert.equal(lab.engine.stats().running, false);
    const page = await lab.engine.open({kind: 'web', viewport: view, url: 'about:blank'});
    const stats = lab.engine.stats();
    assert.equal(stats.running, true);
    assert.equal(stats.pages, 1);
    assert.ok(stats.pid && pidAlive(stats.pid));
    assert.equal(lab.engine.pages().length, 1);
    assert.equal(fs.statSync(path.join(lab.dir, 'profile')).mode & 0o777, 0o700);
    const events = new Events(page);
    await lab.engine.shutdown();
    assert.ok(events.of('closed').length === 1);
    assert.equal(lab.engine.stats().running, false);
    assert.equal(lab.engine.stats().pages, 0);
    await waitFor(() => !pidAlive(stats.pid!), 'the browser process to be gone');
    await lab.engine.shutdown(); // repeatable
  } finally {
    await lab.dispose();
  }
});

test('the browser shuts down after the idle period, a new open cancels it, and a later open relaunches', {skip}, async () => {
  const lab = createLab({idleMs: 400});
  try {
    const first = await lab.engine.open({kind: 'web', viewport: view, url: 'about:blank'});
    const pid = lab.engine.stats().pid!;
    await first.close();
    assert.equal(lab.engine.pages().length, 0);
    const second = await lab.engine.open({kind: 'web', viewport: view, url: 'about:blank'});
    await sleep(900);
    assert.equal(lab.engine.stats().pid, pid, 'an open page keeps the same browser');
    await second.close();
    await waitFor(() => !lab.engine.stats().running, 'the idle shutdown');
    await waitFor(() => !pidAlive(pid), 'the idle browser to exit');
    const third = await lab.engine.open({kind: 'web', viewport: view, url: 'about:blank'});
    assert.ok(lab.engine.stats().running);
    assert.notEqual(lab.engine.stats().pid, pid);
    await third.close();
  } finally {
    await lab.dispose();
  }
});

test('a browser that dies on its own closes every page and the next open starts a new one', {skip}, async () => {
  const lab = createLab();
  try {
    const page = await lab.engine.open({kind: 'web', viewport: view, url: 'about:blank'});
    const events = new Events(page);
    const pid = lab.engine.stats().pid!;
    process.kill(pid, 'SIGKILL');
    await events.next('closed');
    assert.equal(events.of('crashed').length, 1);
    await waitFor(() => !lab.engine.stats().running, 'the engine to notice');
    const again = await lab.engine.open({kind: 'web', viewport: view, url: 'about:blank'});
    assert.notEqual(lab.engine.stats().pid, pid);
    await again.close();
  } finally {
    await lab.dispose();
  }
});

test('a missing browser is reported in plain words and nothing is started', async () => {
  const dir = scratchDir();
  const engine = createBrowserEngine({profileDir: path.join(dir, 'p'), env: {PATH: '', NMSH_BROWSER: '/nonexistent/chrome'}});
  try {
    const availability = await engine.available();
    assert.equal(availability.ok, false);
    await assert.rejects(engine.open({kind: 'web', viewport: view, url: 'about:blank'}), /NMSH_BROWSER/);
    assert.equal(engine.stats().running, false);
  } finally {
    await engine.shutdown();
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('web pages load from a local server; navigation, back, forward and reload work', {skip}, async () => {
  const lab = sharedLab();
  const site = await localSite({'/a': '<title>Page A</title><p>a</p>', '/b': '<title>Page B</title><p>b</p>'});
  try {
    const page = await lab.engine.open({kind: 'web', viewport: view, url: `${site.origin}/a`});
    const events = new Events(page);
    await settled(page, `${site.origin}/a`);
    await waitFor(() => page.title === 'Page A', 'the title');
    await page.navigate(`${site.origin}/b`);
    await settled(page, `${site.origin}/b`);
    await waitFor(() => page.title === 'Page B', 'the second title');
    await waitFor(() => page.canGoBack, 'history');
    await page.back();
    await settled(page, `${site.origin}/a`);
    await waitFor(() => page.canGoForward, 'forward history');
    await page.forward();
    await settled(page, `${site.origin}/b`);
    const before = site.hits.length;
    await page.reload();
    await waitFor(() => site.hits.length > before, 'the reload request');
    await settled(page);
    assert.ok(events.of('navigated').length >= 3);
    assert.ok(events.of('loading').some(event => event.loading));
  } finally {
    await lab.dispose();
    await site.close();
  }
});

test('addresses that are not http, https, file or about:blank are refused and never navigated', {skip}, async () => {
  const lab = sharedLab();
  try {
    const page = await lab.engine.open({kind: 'web', viewport: view, url: 'about:blank'});
    const events = new Events(page);
    const refused = ['javascript:document.title="x"', 'data:text/html,<p>hi</p>', 'chrome://version', 'chrome-untrusted://x/', 'devtools://devtools/bundled/inspector.html',
      'view-source:http://127.0.0.1/', 'blob:http://127.0.0.1/abc', 'ftp://127.0.0.1/', 'not an address'];
    for (const address of refused) await page.navigate(address);
    assert.equal(events.of('blocked').length, refused.length);
    assert.deepEqual(events.of('blocked').map(event => event.url).slice(0, 2), [refused[0], refused[1]]);
    assert.equal(page.url, 'about:blank');
  } finally {
    await lab.dispose();
  }
});

test('a page that redirects or links to a refused scheme ends on about:blank with a blocked event', {skip}, async () => {
  const lab = sharedLab();
  const site = await localSite({'/': '<a id=l href="blob:nope" style="position:absolute;left:0;top:0;width:300px;height:60px;display:block">x</a><title>start</title>'});
  try {
    const page = await lab.engine.open({kind: 'web', viewport: view, url: site.origin + '/'});
    const events = new Events(page);
    await settled(page, site.origin + '/');
    await page.mouse({type: 'down', x: 20, y: 20, button: 'left'});
    await page.mouse({type: 'up', x: 20, y: 20, button: 'left'});
    await sleep(500);
    assert.ok(!page.url.startsWith('blob:'));
    void events;
  } finally {
    await lab.dispose();
    await site.close();
  }
});

const animation = '<style>@keyframes a{from{transform:translateX(0)}to{transform:translateX(300px)}}div{width:80px;height:80px;background:#d33;animation:a 1s linear infinite}</style><div></div>';

test('screencast frames arrive at the viewport size, advance with a CSS animation, and a slow listener skips frames', {skip}, async () => {
  const lab = sharedLab();
  try {
    const handle = await lab.preview(animation);
    const page = await lab.engine.open({kind: 'preview', viewport: {width: 320, height: 200, scale: 1}, url: handle.url});
    const frames: Frame[] = [];
    const off = page.onFrame(frame => { frames.push(frame); });
    await waitFor(() => frames.length >= 6, 'six frames');
    off();
    assert.ok(frames.every(frame => frame.width === 320 && frame.height === 200));
    assert.deepEqual(frames.map(frame => frame.sequence), frames.map((_, index) => frames[0]!.sequence + index));
    assert.ok(frames.some(frame => Buffer.compare(frame.png, frames[0]!.png) !== 0), 'the animation changes the picture');
    assert.equal(Buffer.from(frames[0]!.png.subarray(1, 4)).toString(), 'PNG');

    let fast = 0;
    const offFast = page.onFrame(() => { fast++; });
    await sleep(1000);
    offFast();
    let slow = 0;
    const offSlow = page.onFrame(async () => { slow++; await sleep(300); });
    await sleep(1500);
    offSlow();
    assert.ok(slow <= 7, `a slow listener sees few frames, not a backlog (saw ${slow})`);
    assert.ok(fast > slow * 2, `a fast listener keeps up (fast ${fast}, slow ${slow})`);

    const still = await page.capture();
    assert.equal(still.width, 320);
    const hi = await lab.engine.open({kind: 'preview', viewport: {width: 200, height: 100, scale: 2}, url: handle.url});
    const shot = await hi.capture();
    assert.deepEqual([shot.width, shot.height], [400, 200]);
    const seen: Frame[] = [];
    hi.onFrame(frame => { seen.push(frame); });
    await waitFor(() => seen.length > 0, 'a frame at scale 2');
    assert.deepEqual([seen[0]!.width, seen[0]!.height], [400, 200]);
  } finally {
    await lab.dispose();
  }
});

test('zoom keeps the frame size and is clamped', {skip}, async () => {
  const lab = sharedLab();
  try {
    const handle = await lab.preview('<h1>zoom</h1>');
    const page = await lab.engine.open({kind: 'preview', viewport: {width: 300, height: 200, scale: 1}, url: handle.url});
    for (const zoom of [1, 2, 0.5, 1.5]) {
      await page.setZoom(zoom);
      assert.equal(page.zoom, zoom);
      const frame = await page.capture();
      assert.deepEqual([frame.width, frame.height], [300, 200], `zoom ${zoom}`);
    }
    await page.setZoom(100);
    assert.equal(page.zoom, 5);
    await page.setZoom(0);
    assert.equal(page.zoom, 0.25);
    await page.setViewport({width: 150, height: 100, scale: 1});
    const frame = await page.capture();
    assert.deepEqual([frame.width, frame.height], [150, 100]);
  } finally {
    await lab.dispose();
  }
});

const form = `<body style="margin:0"><input id=f style="position:absolute;left:10px;top:10px;width:300px;height:30px">
<a href="next.html" style="position:absolute;left:10px;top:100px;width:200px;height:40px;display:block;background:#ccc">go</a>
<script>f.addEventListener('input',()=>{document.title='v:'+f.value});</script></body>`;

test('mouse and keys reach a trusted page: typing in a field, editable events, and a click on a link', {skip}, async () => {
  const lab = sharedLab();
  try {
    const handle = await lab.preview(form, {trusted: true, files: {'next.html': '<title>next</title><p>second</p>'}});
    const page = await lab.engine.open({kind: 'preview', viewport: view, url: handle.url, scripts: true});
    const events = new Events(page);
    await settled(page, handle.url);
    assert.equal(page.editable, false);
    await page.mouse({type: 'move', x: 50, y: 25});
    await page.mouse({type: 'down', x: 50, y: 25, button: 'left'});
    await page.mouse({type: 'up', x: 50, y: 25, button: 'left'});
    await waitFor(() => page.editable, 'the field to take focus');
    assert.deepEqual(events.of('editable').map(event => event.editable), [true]);
    for (const char of 'hi') {
      await page.key('down', {key: char, code: `Key${char.toUpperCase()}`, text: char});
      await page.key('up', {key: char, code: `Key${char.toUpperCase()}`});
    }
    await waitFor(() => page.title === 'v:hi', 'typed text to arrive');
    await page.insertText('!');
    await waitFor(() => page.title === 'v:hi!', 'inserted text to arrive');
    await page.key('down', {key: 'Backspace', code: 'Backspace'});
    await page.key('up', {key: 'Backspace', code: 'Backspace'});
    await waitFor(() => page.title === 'v:hi', 'backspace to delete');
    await page.mouse({type: 'down', x: 500, y: 300, button: 'left'});
    await page.mouse({type: 'up', x: 500, y: 300, button: 'left'});
    await waitFor(() => !page.editable, 'the field to lose focus');
    await page.mouse({type: 'down', x: 50, y: 120, button: 'left'});
    await page.mouse({type: 'up', x: 50, y: 120, button: 'left'});
    await settled(page, new URL('next.html', handle.url).href);
    await waitFor(() => page.title === 'next', 'the next title');
    assert.equal(events.of('blocked').length, 0);
  } finally {
    await lab.dispose();
  }
});

test('wheel events scroll the page', {skip}, async () => {
  const lab = sharedLab();
  try {
    const handle = await lab.preview('<body style="margin:0;height:3000px"><div style="height:3000px;background:linear-gradient(#fff,#000)"></div>');
    const page = await lab.engine.open({kind: 'preview', viewport: view, url: handle.url});
    await settled(page, handle.url);
    const before = await page.capture();
    await page.mouse({type: 'wheel', x: 100, y: 100, deltaX: 0, deltaY: 400});
    await sleep(300);
    const after = await page.capture();
    assert.notEqual(Buffer.compare(before.png, after.png), 0);
  } finally {
    await lab.dispose();
  }
});

test('find works on a preview with scripts off, steps and wraps, and clears', {skip}, async () => {
  const lab = sharedLab();
  try {
    const handle = await lab.preview('<p>Needle one</p><p>nothing</p><p>second needle</p><script>document.title="scripts ran"</script><p style="display:none">needle hidden</p><p>NEEDLE last</p>');
    const page = await lab.engine.open({kind: 'preview', viewport: view, url: handle.url});
    await settled(page, handle.url);
    assert.notEqual(page.title, 'scripts ran', 'page scripts are off');
    assert.deepEqual(await page.find('needle'), {matches: 3, current: 1});
    assert.deepEqual(await page.find('needle'), {matches: 3, current: 2});
    assert.deepEqual(await page.find('needle'), {matches: 3, current: 3});
    assert.deepEqual(await page.find('needle'), {matches: 3, current: 1});
    assert.deepEqual(await page.find('needle', {backwards: true}), {matches: 3, current: 3});
    assert.deepEqual(await page.find('absent'), {matches: 0, current: 0});
    await page.clearFind();
    assert.deepEqual(await page.find('needle'), {matches: 3, current: 1});
    await page.reload();
    await settled(page, handle.url);
    assert.deepEqual(await page.find('needle'), {matches: 3, current: 1});
  } finally {
    await lab.dispose();
  }
});

test('setScripts turns page scripts on and off and reloads', {skip}, async () => {
  const lab = sharedLab();
  try {
    const handle = await lab.preview('<title>before</title><script>document.title="ran"</script>', {trusted: true});
    const page = await lab.engine.open({kind: 'preview', viewport: view, url: handle.url});
    await settled(page, handle.url);
    await waitFor(() => page.title === 'before', 'the title');
    await page.setScripts(true);
    await waitFor(() => page.title === 'ran', 'the script to run');
    await page.setScripts(false);
    await waitFor(() => page.title === 'before', 'the script to stop');
  } finally {
    await lab.dispose();
  }
});

test('popups are closed and reported; dialogs are answered; downloads are refused', {skip}, async () => {
  const lab = sharedLab();
  const site = await localSite({
    '/': `<body style="margin:0"><a href="/pop" target="_blank" style="position:absolute;left:0;top:0;width:300px;height:50px;display:block">pop</a>
<a href="/file.bin" style="position:absolute;left:0;top:100px;width:300px;height:50px;display:block">get</a>
<script>alert('hello'); document.title = 'confirm:' + confirm('sure?') + ' prompt:' + prompt('name?');</script>`,
    '/pop': '<title>popup</title>',
    '/file.bin': {type: 'application/octet-stream', body: 'bytes', headers: {'Content-Disposition': 'attachment; filename=f.bin'}}
  });
  try {
    const page = await lab.engine.open({kind: 'web', viewport: view, url: site.origin + '/'});
    const events = new Events(page);
    await settled(page, site.origin + '/');
    await waitFor(() => events.of('dialog').length >= 3, 'three dialogs');
    assert.deepEqual(events.of('dialog').map(event => [event.kind, event.message]), [['alert', 'hello'], ['confirm', 'sure?'], ['prompt', 'name?']]);
    await waitFor(() => page.title === 'confirm:false prompt:null', 'the dialog answers');

    await page.mouse({type: 'down', x: 20, y: 20, button: 'left'});
    await page.mouse({type: 'up', x: 20, y: 20, button: 'left'});
    const popup = await events.next('popup');
    assert.equal(popup.url, site.origin + '/pop');
    await sleep(300);
    assert.equal(lab.engine.pages().length, 1);
    assert.equal(site.hits.filter(hit => hit === '/pop').length, 0, 'the new window never loads');

    await page.mouse({type: 'down', x: 20, y: 120, button: 'left'});
    await page.mouse({type: 'up', x: 20, y: 120, button: 'left'});
    const download = await events.next('download-blocked');
    assert.equal(download.url, site.origin + '/file.bin');
    const files = fs.readdirSync(lab.dir).concat(fs.readdirSync(path.join(lab.dir, 'profile')));
    assert.ok(!files.includes('f.bin'));
  } finally {
    await lab.dispose();
    await site.close();
  }
});

test('a preview refuses remote resources and navigation, and no request leaves the machine', {skip}, async () => {
  const lab = sharedLab();
  const remote = await localSite();
  try {
    const html = `<body style="margin:0"><img src="${remote.origin}/x.png"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
<link rel=stylesheet href="${remote.origin}/s.css"><a href="${remote.origin}/page" style="position:absolute;left:0;top:100px;width:300px;height:50px;display:block">leave</a></body>`;
    const handle = await lab.preview(html);
    const page = await lab.engine.open({kind: 'preview', viewport: view, url: handle.url});
    const events = new Events(page);
    await settled(page, handle.url);
    const img = await events.next('blocked', event => event.url === `${remote.origin}/x.png`);
    assert.match(img.reason, /outside/);
    await page.navigate(`${remote.origin}/page`);
    await events.next('blocked', event => event.url === `${remote.origin}/page`);
    await page.mouse({type: 'down', x: 20, y: 120, button: 'left'});
    await page.mouse({type: 'up', x: 20, y: 120, button: 'left'});
    await sleep(500);
    assert.equal(page.url, handle.url);
    assert.deepEqual(remote.hits, [], 'nothing reached the remote server');
    await page.navigate('http://127.0.0.1:1/');
    assert.equal(page.url, handle.url);
  } finally {
    await lab.dispose();
    await remote.close();
  }
});

test('previews share nothing with browsing: cookies set in a web page are invisible to a preview', {skip}, async () => {
  const lab = sharedLab();
  const site = await localSite({'/': {type: 'text/html', body: '<title>set</title>', headers: {'Set-Cookie': 'k=v; Path=/'}}});
  try {
    const web = await lab.engine.open({kind: 'web', viewport: view, url: site.origin + '/'});
    await settled(web, site.origin + '/');
    const handle = await lab.preview('<script>document.title = "cookie:" + document.cookie</script>', {trusted: true});
    const preview = await lab.engine.open({kind: 'preview', viewport: view, url: handle.url, scripts: true});
    await waitFor(() => preview.title.startsWith('cookie:'), 'the preview script');
    assert.equal(preview.title, 'cookie:');
  } finally {
    await lab.dispose();
    await site.close();
  }
});

test('closing a page closes its target and a preview page disposes its context', {skip}, async () => {
  const lab = sharedLab();
  try {
    const handle = await lab.preview('<p>x</p>');
    const page = await lab.engine.open({kind: 'preview', viewport: view, url: handle.url});
    const events = new Events(page);
    await page.close();
    await page.close();
    assert.equal(events.of('closed').length, 1);
    assert.equal(lab.engine.pages().length, 0);
    await assert.rejects(page.capture());
  } finally {
    await lab.dispose();
  }
});
