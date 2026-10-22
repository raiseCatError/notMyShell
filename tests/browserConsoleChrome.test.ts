import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import type {PageEvent} from '../src/browser/types.js';
import type {ConsoleEntry} from '../src/browser/console.js';
import type {ChromePage} from '../src/browser/engine/page.js';
import {locateMermaid} from '../src/diagrams/library.js';
import {mermaidConfig} from '../src/diagrams/mermaid.js';
import {chromeSkipReason, disposeSharedLab, Events, localSite, sharedLab, waitFor, type Lab} from './support/browserFixtures.js';

/**
 * The document Console (#466) against a real Chromium: what a page reports arrives redacted and placed; scripts stay off unless
 * trusted; NMSh's own isolated worlds, ordinary web pages and the Mermaid renderer never report into it. One browser serves
 * every test here (each closes its pages); skips with the reason when no browser can start.
 */
const skip = await chromeSkipReason();
const view = {width: 600, height: 400, scale: 1};
const lab = (): Lab => sharedLab();
after(disposeSharedLab);
const closeAll = async () => { await Promise.all(lab().engine.pages().map(page => page.close().catch(() => undefined))); };

const PAGE = [
  '<!doctype html>',
  '<title>c</title>',
  '<img src="missing.png">',
  '<script>',
  'console.warn("careful password=hunter2 now");',
  'console.error("bad %s", "thing");',
  'fetch("nope.json").catch(() => {});',
  'undefinedFunction();',
  '</script>',
  '<p>text</p>',
].join('\n');

const entries = (events: Events): ConsoleEntry[] => events.of('console').map(event => event.entry);
const open = async (html: string, trusted: boolean, files: Record<string, string> = {}) => {
  const handle = await lab().preview(html, {trusted, files});
  const page = await lab().engine.open({kind: 'preview', viewport: view, url: handle.url, scripts: trusted, console: {documentName: 'page.html'}});
  return {page, handle, events: new Events(page), token: new URL(handle.url).pathname.split('/')[1]!};
};

test('a trusted page: exception, console calls and failed loads arrive redacted, with the document\'s own lines', {skip}, async () => {
  try {
    const {events, token} = await open(PAGE, true);
    const exception = await waitFor(() => entries(events).find(entry => entry.origin === 'exception'), 'the exception');
    assert.match(exception.message, /ReferenceError: undefinedFunction is not defined/u);
    assert.equal(exception.location?.target, 'document');
    assert.equal(exception.location?.label, 'page.html');
    assert.equal(exception.location?.line, 7, 'the line in the HTML document itself (0-based)');
    assert.equal(typeof exception.location?.column, 'number');
    const error = await waitFor(() => entries(events).find(entry => entry.origin === 'console' && entry.severity === 'error'), 'console.error');
    assert.equal(error.message, 'bad thing');
    assert.equal(error.location?.line, 5);
    const warning = entries(events).find(entry => entry.origin === 'console' && entry.severity === 'warning')!;
    assert.match(warning.message, /password=‹redacted›/u);
    assert.doesNotMatch(warning.message, /hunter2/u);
    const missing = await waitFor(() => entries(events).find(entry => entry.origin === 'network' && entry.location?.label === 'missing.png'), 'the missing image');
    assert.match(missing.message, /404/u);
    await waitFor(() => entries(events).find(entry => entry.origin === 'network' && entry.location?.label === 'nope.json'), 'the failed fetch');
    for (const entry of entries(events)) assert.ok(!JSON.stringify(entry).includes(token), `the preview token leaked: ${JSON.stringify(entry)}`);
  } finally { await closeAll(); }
});

test('scripts off: nothing runs and nothing is turned on; failed loads and policy refusals still appear', {skip}, async () => {
  const remote = await localSite();
  try {
    const html = `${PAGE}\n<img src="${remote.origin}/track.png?uid=42">`;
    const {page, events} = await open(html, false);
    await waitFor(() => entries(events).find(entry => entry.origin === 'network' && entry.location?.label === 'missing.png'), 'the missing image');
    const refusal = await waitFor(() => entries(events).find(entry => (entry.origin === 'security' || entry.origin === 'policy') && entry.message.includes('track.png') || entry.location?.label?.includes('track.png')), 'the refusal of the remote image');
    assert.doesNotMatch(JSON.stringify(refusal), /uid=42/u);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(!entries(events).some(entry => entry.origin === 'exception' || entry.origin === 'console'), 'no script ran');
    assert.ok(!entries(events).some(entry => entry.location?.label === 'nope.json'), 'the script\'s fetch never happened');
    assert.equal(page.url.startsWith('http://127.0.0.1:'), true);
    assert.deepEqual(remote.hits, [], 'nothing left the machine');
  } finally { await closeAll(); await remote.close(); }
});

test('a reload starts a new document; NMSh\'s find world, web pages and the Mermaid renderer never report', {skip}, async () => {
  const site = await localSite({'/noisy': '<script>console.error("web page noise"); throw new Error("web page error")</script>'});
  try {
    const {page, events} = await open(PAGE, true);
    await waitFor(() => entries(events).find(entry => entry.origin === 'exception'), 'the first exception');
    const before = events.all.length;
    // Find runs in an isolated world: even a failing evaluation there is not the page's.
    await page.find('text');
    await (page as ChromePage).protocol('Runtime.evaluate', {expression: 'console.error("isolated noise"); throw new Error("isolated")', contextId: await isolatedWorld(page as ChromePage)}).catch(() => undefined);
    const web = await lab().engine.open({kind: 'web', viewport: view, url: `${site.origin}/noisy`});
    const webEvents = new Events(web);
    await waitFor(() => !web.loading && web.url.endsWith('/noisy') && true, 'the web page');
    await page.reload();
    await waitFor(() => events.all.slice(before).some(event => event.type === 'document'), 'a new document');
    const after = events.all.slice(events.all.findIndex((event, index) => index >= before && event.type === 'document'));
    await waitFor(() => after.length && events.all.slice(before).filter(event => event.type === 'console' && event.entry.origin === 'exception').length >= 1 && true, 'the exception again');
    const all = entries(events);
    assert.ok(!all.some(entry => /isolated noise|isolated|web page/u.test(entry.message)), JSON.stringify(all.map(entry => entry.message)));
    assert.equal(webEvents.of('console').length, 0, 'a web page reports nothing');
    const library = await locateMermaid({env: {...process.env, ...(process.env.NMSH_TEST_MERMAID ? {NMSH_MERMAID: process.env.NMSH_TEST_MERMAID} : {})}, home: os.homedir(), execPath: process.execPath});
    if (library.ok) {
      const renderer = await lab().engine.openDiagramRenderer!({source: library.source, version: library.version});
      const rendererPage = lab().engine.pages().at(-1)!;
      const rendererEvents: PageEvent[] = [];
      rendererPage.onEvent(event => rendererEvents.push(event));
      const result = await renderer.render({source: 'flowchart LR\n  A --> B\n  B --> %%{init: bad}%% C\n  click A call alert()', config: mermaidConfig({scheme: 'dark', text: '#ffffff', accent: '#aaaaff', line: '#888888'}), scale: 1, timeoutMs: 10_000});
      assert.ok(result.ok || result.code === 'syntax');
      assert.equal(rendererEvents.filter(event => event.type === 'console').length, 0, 'the diagram renderer reports nothing');
      assert.ok(!entries(events).some(entry => /mermaid/iu.test(entry.message)));
      await renderer.close();
    }
  } finally { await closeAll(); await site.close(); }
});

async function isolatedWorld(page: ChromePage): Promise<number> {
  const tree = await page.protocol<{frameTree: {frame: {id: string}}}>('Page.getFrameTree');
  return (await page.protocol<{executionContextId: number}>('Page.createIsolatedWorld', {frameId: tree.frameTree.frame.id, worldName: 'test-isolated'})).executionContextId;
}

test('a hostile page: a flood and huge messages are cut down before they are kept', {skip}, async () => {
  try {
    const html = '<script>for (let i = 0; i < 3000; i++) console.error("flood " + i); console.error("x".repeat(3000000)); console.error("\\u001b]52;c;Zm9v\\u0007\\u202eend");</script>';
    const {events} = await open(html, true);
    await waitFor(() => entries(events).some(entry => entry.message.endsWith('end')), 'the last message', 30_000);
    const all = entries(events);
    assert.ok(all.every(entry => entry.message.length <= 2000));
    assert.ok(all.every(entry => !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮]/u.test(entry.message)));
  } finally { await closeAll(); }
});

