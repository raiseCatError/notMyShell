import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

const settle = async (until: () => boolean) => { for (let i = 0; i < 300 && !until(); i += 1) await new Promise(done => setTimeout(done, 10)); };

function fixture() {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'browser-app-'));
  const frame = executionFrameFixture(110, 36);
  const app = frame.app;
  app['shellCwd'] = dir;
  const previous = process.env.NMSH_BROWSER;
  // No browser can be found: the tests exercise NMSh's own handling, never a real Chromium.
  process.env.NMSH_BROWSER = join(dir, 'no-such-browser');
  const screen = () => frame.capture().frame.rows.map(row => stripAnsi(row)).join('\n');
  return {dir, app, frame, screen, done: () => { frame.dispose(); rmSync(dir, {recursive: true, force: true}); if (previous === undefined) delete process.env.NMSH_BROWSER; else process.env.NMSH_BROWSER = previous; }};
}

test('/browser with no usable browser says so, downloads nothing, and leaves the shell and the native viewer working', async () => {
  const f = fixture();
  try {
    await f.app['runSlash']('/browser', {kind: 'browser', target: ''});
    assert.equal(f.app['browserPanel'], undefined);
    const text = f.screen().replace(/\s+/gu, ' ');
    assert.match(text, /NMSH_BROWSER points to .* not an executable file/u);
    assert.match(text, /does not download a browser/u);
    assert.equal(f.app['browserHost']?.running ?? false, false, 'nothing was started');
  } finally { f.done(); }
});

test('/browser is refused while a command runs, when the setting is off, and for addresses it will not open', async () => {
  const f = fixture();
  try {
    f.frame.begin('sleep 5');
    await f.app['runSlash']('/browser https://example.com', {kind: 'browser', target: 'https://example.com'});
    assert.equal(f.app['browserPanel'], undefined);
    assert.match(f.screen(), /let the running command finish first/u);
    f.frame.complete(0);
    f.app['promptConfiguration'].browser = 'off';
    await f.app['runSlash']('/browser', {kind: 'browser', target: ''});
    assert.match(f.screen(), /The real browser is off/u);
    f.app['promptConfiguration'].browser = 'auto';
    for (const target of ['javascript:alert(1)', 'chrome://settings', 'data:text/html,hi', 'search for cats']) {
      await f.app['runSlash'](`/browser ${target}`, {kind: 'browser', target});
      assert.equal(f.app['browserPanel'], undefined, target);
    }
    assert.match(f.screen(), /cannot be opened|not open|refus|NMSh/iu);
  } finally { f.done(); }
});

test('the browser setting off keeps the document preview on NMSh\'s own renderer, with no browser started', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'page.html'), '<h1>Hello</h1>\n<p>world</p>\n');
    f.app['promptConfiguration'].browser = 'off';
    f.app['openViewer']('page.html', '/view page.html');
    await settle(() => Boolean(f.app['docSession']));
    f.app['handleKey']({kind: 'text', value: 'h'});
    await new Promise(done => setTimeout(done, 50));
    assert.equal(f.app['docSession'].mode, 'preview');
    assert.equal(f.app['docSession'].preview, undefined);
    assert.equal(f.app['browserHost'], undefined, 'no browser host was even created');
    assert.match(f.screen(), /Hello/u);
  } finally { f.done(); }
});

test('with no browser installed the workspace preview falls back to NMSh\'s own renderer and says why', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'page.md'), '# Title\n\nbody\n');
    f.app['openViewer']('page.md', '/view page.md');
    await settle(() => Boolean(f.app['docSession']));
    f.app['handleKey']({kind: 'text', value: 'h'});
    await settle(() => Boolean(f.app['docSession'].note));
    assert.equal(f.app['docSession'].preview, undefined);
    assert.match(f.app['docSession'].note, /Showing NMSh's own preview/u);
    assert.match(f.screen(), /Title/u);
    f.app['handleKey']({kind: 'text', value: 'e'});
    assert.equal(f.app['docSession'].mode, 'edit', 'editing is unaffected');
  } finally { f.done(); }
});

test('/browser notes.md routes a Markdown file to the document preview, not a web page', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'notes.md'), '# Notes\n');
    await f.app['runSlash']('/browser notes.md', {kind: 'browser', target: 'notes.md'});
    await settle(() => Boolean(f.app['docSession']));
    assert.ok(f.app['docSession']);
    assert.equal(f.app['browserPanel'], undefined);
    assert.equal(f.app['docSession'].mode, 'preview');
  } finally { f.done(); }
});
