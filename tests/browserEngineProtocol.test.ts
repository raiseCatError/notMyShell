import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {CdpClient, CdpError, type CdpEvent} from '../src/browser/engine/cdp.js';
import {candidatePaths, locateBrowser, parseChromeMajor, type LocatorHost} from '../src/browser/engine/chrome.js';
import {chromeArguments, chromeEnvironment} from '../src/browser/engine/engine.js';
import {checkWebUrl, keyParameters, pngSize} from '../src/browser/engine/page.js';
import {cleanForDisplay} from '../src/browser/engine/preview.js';

/** Chrome-independent: the pipe framing and timeouts, the browser locator, launch arguments, URL policy and key mapping. */

function pipe(options?: ConstructorParameters<typeof CdpClient>[2]) {
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  const written: string[] = [];
  toBrowser.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')));
  const client = new CdpClient(toBrowser, fromBrowser, options);
  const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
  return {client, written, fromBrowser, toBrowser, tick, reply: (message: object) => fromBrowser.write(`${JSON.stringify(message)}\0`)};
}

test('cdp: requests are JSON terminated by one NUL, with ids and an optional session', async () => {
  const {client, written, reply, tick} = pipe();
  const first = client.send('Browser.getVersion');
  const second = client.send('Page.enable', {x: 1}, {sessionId: 'S1'});
  await tick();
  const messages = written.join('').split('\0').filter(Boolean).map(text => JSON.parse(text));
  assert.deepEqual(messages, [{id: 1, method: 'Browser.getVersion', params: {}}, {id: 2, method: 'Page.enable', params: {x: 1}, sessionId: 'S1'}]);
  assert.ok(written.join('').endsWith('\0'));
  reply({id: 2, result: {ok: 2}});
  reply({id: 1, result: {product: 'x'}});
  assert.deepEqual(await first, {product: 'x'});
  assert.deepEqual(await second, {ok: 2});
  client.close();
});

test('cdp: messages split across chunks, packed into one chunk, and split inside a multibyte character', async () => {
  const {client, fromBrowser, tick} = pipe();
  const events: CdpEvent[] = [];
  client.onEvent(event => events.push(event));
  const a = Buffer.from(`${JSON.stringify({method: 'A.one', params: {text: 'héllo €'}, sessionId: 'S'})}\0${JSON.stringify({method: 'B.two'})}\0`);
  fromBrowser.write(a);
  await tick();
  assert.deepEqual(events.map(event => event.method), ['A.one', 'B.two']);
  assert.equal(events[0]!.params.text, 'héllo €');
  assert.equal(events[0]!.sessionId, 'S');
  assert.deepEqual(events[1]!.params, {});
  events.length = 0;
  const b = Buffer.from(`${JSON.stringify({method: 'C.three', params: {text: '€€€'}})}\0`);
  const cut = b.indexOf(0xe2) + 1; // inside the first euro sign
  fromBrowser.write(b.subarray(0, cut));
  await tick();
  assert.equal(events.length, 0);
  fromBrowser.write(b.subarray(cut, cut + 1));
  fromBrowser.write(b.subarray(cut + 1));
  await tick();
  assert.equal(events[0]!.params.text, '€€€');
  fromBrowser.write('\0\0'); // empty frames are ignored
  fromBrowser.write('not json\0');
  fromBrowser.write('42\0');
  fromBrowser.write('{"method":"D.four"}\0');
  await tick();
  assert.equal(events.at(-1)!.method, 'D.four');
  client.close();
});

test('cdp: an error response rejects with the protocol message and code; a throwing listener does not break the stream', async () => {
  const {client, reply, tick} = pipe();
  const seen: string[] = [];
  client.onEvent(() => { throw new Error('listener bug'); });
  client.onEvent(event => seen.push(event.method));
  const pending = client.send('Nope.nope');
  reply({id: 1, error: {code: -32601, message: "'Nope.nope' wasn't found"}});
  await assert.rejects(pending, (error: unknown) => error instanceof CdpError && error.code === -32601 && /wasn't found/u.test(error.message));
  reply({method: 'E.after'});
  await tick();
  assert.deepEqual(seen, ['E.after']);
  client.close();
});

test('cdp: a request that is not answered in time rejects, and a late answer is ignored', async () => {
  const {client, reply} = pipe({requestTimeoutMs: 40});
  await assert.rejects(client.send('Slow.thing'), /did not answer Slow.thing/u);
  reply({id: 1, result: {}}); // late
  const quick = client.send('Quick.thing', {}, {timeoutMs: 1000});
  reply({id: 2, result: {done: true}});
  assert.deepEqual(await quick, {done: true});
  client.close();
});

test('cdp: a single oversized message tears the connection down and rejects everything pending', async () => {
  const {client, fromBrowser, tick} = pipe({maxMessageBytes: 1024});
  const pending = client.send('Some.call');
  const closed: string[] = [];
  client.onClose(reason => closed.push(reason));
  fromBrowser.write('x'.repeat(600));
  await tick();
  assert.equal(client.closed, false);
  fromBrowser.write('y'.repeat(600)); // 1200 buffered without a NUL
  await assert.rejects(pending, /larger than/u);
  assert.equal(client.closed, true);
  assert.equal(closed.length, 1);
  await assert.rejects(client.send('After.close'), CdpError);
});

test('cdp: a message of exactly the limit is accepted', async () => {
  const {client, fromBrowser, tick} = pipe({maxMessageBytes: 200});
  const events: CdpEvent[] = [];
  client.onEvent(event => events.push(event));
  const filler = 'z'.repeat(200 - JSON.stringify({method: 'M.m', params: {s: ''}}).length);
  const body = JSON.stringify({method: 'M.m', params: {s: filler}});
  assert.equal(Buffer.byteLength(body), 200);
  fromBrowser.write(`${body}\0`);
  await tick();
  assert.equal(events.length, 1);
  client.close();
});

test('cdp: when the pipe closes every pending request rejects once and later sends fail', async () => {
  const {client, fromBrowser, tick} = pipe();
  const a = client.send('A.a');
  const b = client.send('B.b');
  const reasons: string[] = [];
  client.onClose(reason => reasons.push(reason));
  fromBrowser.end();
  await assert.rejects(a, /closed its connection/u);
  await assert.rejects(b, /closed its connection/u);
  await tick();
  assert.equal(reasons.length, 1);
  client.close();
  assert.equal(reasons.length, 1);
  await assert.rejects(client.send('C.c'), /closed its connection/u);
});

test('cdp: a failed write (the browser is gone) closes the client', async () => {
  const {client, toBrowser, tick} = pipe();
  const pending = client.send('A.a');
  toBrowser.destroy(new Error('EPIPE'));
  await assert.rejects(pending, /browser connection failed|closed its connection/u);
  await tick();
  assert.equal(client.closed, true);
});

// ---- locating the browser ---------------------------------------------------------------------------------------------------

function fakeHost(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, files: Record<string, string | Error>): LocatorHost & {probed: string[]} {
  const probed: string[] = [];
  return {
    platform, env, probed,
    async isExecutable(file) { return Object.hasOwn(files, file); },
    async version(file) {
      probed.push(file);
      const value = files[file];
      if (value instanceof Error) throw value;
      return value ?? '';
    }
  };
}

test('locator: macOS prefers Chrome, then Chromium, then Edge, and reads the version', async () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.deepEqual(await locateBrowser(fakeHost('darwin', {}, {[chrome]: 'Google Chrome 156.0.8078.35', [edge]: 'Microsoft Edge 150.0.1.1'})), {ok: true, executable: chrome, version: 'Google Chrome 156.0.8078.35'});
  const result = await locateBrowser(fakeHost('darwin', {}, {[edge]: 'Microsoft Edge 150.0.1.1'}));
  assert.equal(result.ok && result.executable, edge);
});

test('locator: an old Chrome is skipped for a newer one, and reported if it is all there is', async () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chromium = '/Applications/Chromium.app/Contents/MacOS/Chromium';
  const both = await locateBrowser(fakeHost('darwin', {}, {[chrome]: 'Google Chrome 100.0.1.1', [chromium]: 'Chromium 130.0.1.1'}));
  assert.equal(both.ok && both.executable, chromium);
  const old = await locateBrowser(fakeHost('darwin', {}, {[chrome]: 'Google Chrome 100.0.1.1'}));
  assert.equal(old.ok, false);
  assert.match(!old.ok ? old.reason : '', /version 100.*110 or newer/u);
});

test('locator: Linux searches PATH in the documented name order', async () => {
  const host = fakeHost('linux', {PATH: '/usr/local/bin:/usr/bin:relative/bin:/opt/bin'}, {'/usr/bin/chromium': 'Chromium 125.0.6422.60', '/opt/bin/google-chrome': 'Google Chrome 126.0.6478.55', '/usr/local/bin/chromium-browser': 'Chromium 120.0.1.1'});
  const found = await locateBrowser(host);
  assert.equal(found.ok && found.executable, '/opt/bin/google-chrome');
  const order = (await candidatePaths(host)).map(file => file.split('/').pop());
  assert.deepEqual([...new Set(order)], ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']);
  assert.ok(!(await candidatePaths(host)).some(file => file.startsWith('relative')));
});

test('locator: nothing found says what to install or set, and nothing is run', async () => {
  const host = fakeHost('linux', {PATH: '/usr/bin'}, {});
  const result = await locateBrowser(host);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : '', /No Chrome, Chromium or Edge was found.*NMSH_BROWSER/u);
  assert.deepEqual(host.probed, []);
});

test('locator: NMSH_BROWSER must be an absolute executable and is used without falling back', async () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const files = {[chrome]: 'Google Chrome 156.0.8078.35', '/opt/mine/chrome': 'Chromium 140.0.1.1', '/opt/mine/old': 'Chromium 90.0.1.1', '/opt/mine/junk': 'hello world', '/opt/mine/broken': new Error('spawn failed')};
  const ok = await locateBrowser(fakeHost('darwin', {NMSH_BROWSER: '/opt/mine/chrome'}, files));
  assert.equal(ok.ok && ok.executable, '/opt/mine/chrome');
  const relative = await locateBrowser(fakeHost('darwin', {NMSH_BROWSER: 'chrome'}, files));
  assert.match(!relative.ok ? relative.reason : '', /absolute path/u);
  const missing = await locateBrowser(fakeHost('darwin', {NMSH_BROWSER: '/opt/none'}, files));
  assert.match(!missing.ok ? missing.reason : '', /not an executable file/u);
  for (const name of ['old', 'junk', 'broken']) {
    const bad = await locateBrowser(fakeHost('darwin', {NMSH_BROWSER: `/opt/mine/${name}`}, files));
    assert.equal(bad.ok, false, name);
  }
  const overridden = await locateBrowser(fakeHost('darwin', {}, files), '/opt/mine/chrome');
  assert.equal(overridden.ok && overridden.executable, '/opt/mine/chrome');
});

test('locator: version strings', () => {
  assert.equal(parseChromeMajor('Google Chrome 156.0.8078.35'), 156);
  assert.equal(parseChromeMajor('Chromium 120.0.6099.109 snap'), 120);
  assert.equal(parseChromeMajor('Microsoft Edge 120.0.2210.91'), 120);
  assert.equal(parseChromeMajor('hello'), undefined);
});

// ---- launch --------------------------------------------------------------------------------------------------------------------

test('launch arguments: the documented hardening flags, the sandbox on, no-sandbox only on request', () => {
  const args = chromeArguments('/p/profile', {});
  for (const flag of ['--headless=new', '--remote-debugging-pipe', '--user-data-dir=/p/profile', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-component-update', '--disable-background-networking', '--disable-sync', '--disable-breakpad', '--disable-default-apps', '--mute-audio', '--renderer-process-limit=2',
    '--disable-features=Translate,MediaRouter,OptimizationHints,InterestFeedContentSuggestions', '--force-color-profile=srgb']) assert.ok(args.includes(flag), flag);
  assert.ok(!args.includes('--no-sandbox'));
  assert.ok(!args.some(arg => arg.startsWith('--remote-debugging-port')));
  assert.ok(chromeArguments('/p', {NMSH_BROWSER_NO_SANDBOX: '1'}).includes('--no-sandbox'));
  assert.ok(!chromeArguments('/p', {NMSH_BROWSER_NO_SANDBOX: '0'}).includes('--no-sandbox'));
  assert.ok(chromeArguments('/p', {}, 'darwin').includes('--use-mock-keychain'));
  assert.ok(chromeArguments('/p', {}, 'linux').includes('--password-store=basic'));
});

test('launch environment: only PATH, LANG and TMPDIR pass through and HOME is the profile', () => {
  const env = chromeEnvironment('/p/profile', {PATH: '/bin', LANG: 'en_US.UTF-8', TMPDIR: '/t', HOME: '/Users/me', GITHUB_TOKEN: 'secret', ANTHROPIC_API_KEY: 'k', NMSH_X: '1', SSH_AUTH_SOCK: '/s'});
  assert.deepEqual(env, {HOME: '/p/profile', PATH: '/bin', LANG: 'en_US.UTF-8', TMPDIR: '/t'});
  assert.deepEqual(chromeEnvironment('/p', {}), {HOME: '/p'});
});

// ---- page policy and input -----------------------------------------------------------------------------------------------------

test('url policy: http, https, file and about:blank only', () => {
  for (const address of ['http://example.com/', 'https://example.com/a?b#c', 'file:///tmp/x.html', 'about:blank', ' ABOUT:BLANK ', 'HTTP://EXAMPLE.COM']) assert.equal(checkWebUrl(address).ok, true, address);
  for (const address of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'chrome-untrusted://x', 'chrome-error://chromewebdata/', 'devtools://devtools/x', 'view-source:https://a/',
    'blob:https://a/uuid', 'ftp://a/', 'about:srcdoc', 'about:version', 'filesystem:https://a/t/f', 'ws://a/', 'mailto:a@b', '', 'example.com', 'http//x']) assert.equal(checkWebUrl(address).ok, false, address);
  const normalised = checkWebUrl('HTTP://EXAMPLE.COM');
  assert.equal(normalised.ok && normalised.url, 'http://example.com/');
});

test('key mapping: printable keys type text, others are raw keys with virtual codes, ctrl/meta make editing commands', () => {
  assert.deepEqual(keyParameters('down', {key: 'a', code: 'KeyA', text: 'a'}), {key: 'a', modifiers: 0, code: 'KeyA', windowsVirtualKeyCode: 65, type: 'keyDown', text: 'a', unmodifiedText: 'a'});
  assert.equal(keyParameters('down', {key: 'Enter'}).type, 'keyDown');
  assert.equal(keyParameters('down', {key: 'Enter'}).text, '\r');
  assert.equal(keyParameters('down', {key: 'Enter'}).windowsVirtualKeyCode, 13);
  assert.equal(keyParameters('down', {key: 'ArrowDown'}).type, 'rawKeyDown');
  assert.equal(keyParameters('down', {key: 'ArrowDown'}).windowsVirtualKeyCode, 40);
  assert.equal(keyParameters('down', {key: 'Backspace'}).windowsVirtualKeyCode, 8);
  assert.equal(keyParameters('down', {key: 'F5'}).windowsVirtualKeyCode, 116);
  assert.equal(keyParameters('down', {key: 'Escape'}).type, 'rawKeyDown');
  assert.equal(keyParameters('up', {key: 'a'}).type, 'keyUp');
  assert.deepEqual(keyParameters('char', {key: 'a', text: 'à'}).text, 'à');
  const select = keyParameters('down', {key: 'a', modifiers: 2});
  assert.equal(select.type, 'rawKeyDown');
  assert.deepEqual(select.commands, ['selectAll']);
  assert.deepEqual(keyParameters('down', {key: 'v', modifiers: 4}).commands, ['paste']);
  assert.equal(keyParameters('down', {key: 'q', modifiers: 2}).commands, undefined);
  assert.equal(keyParameters('down', {key: 'A', text: 'A', modifiers: 8}).type, 'keyDown');
  assert.equal(keyParameters('down', {key: 'a', text: 'a', modifiers: 1}).type, 'rawKeyDown', 'Alt+key is not text');
});

test('png size is read from the header; display strings lose control characters', () => {
  const png = Buffer.alloc(33);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(pngSize(png), {width: 640, height: 480});
  assert.deepEqual(pngSize(new Uint8Array(4)), {width: 0, height: 0});
  assert.equal(cleanForDisplay('a\u001b[31mb\u0007c\u0085d‮e⁦f؜g\u007fh'), 'a[31mbcdefgh');
  assert.equal(cleanForDisplay('x'.repeat(500), 10), 'x'.repeat(10));
});
