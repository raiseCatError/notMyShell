import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {createPreviewServer, HTML_CSP, MAX_ASSET_BYTES, MAX_PROBLEMS, TRUSTED_HTML_CSP} from '../src/browser/engine/preview.js';
import type {PreviewHandle} from '../src/browser/types.js';
import {scratchDir} from './support/browserFixtures.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function request(handle: PreviewHandle, rest: string, options: {method?: string; headers?: Record<string, string>; host?: string | null; token?: string} = {}): Promise<Reply> {
  const url = new URL(handle.url);
  const token = options.token ?? url.pathname.split('/')[1]!;
  const headers: Record<string, string> = {...(options.headers ?? {})};
  if (options.host !== null) headers.Host = options.host ?? url.host;
  return new Promise((resolve, reject) => {
    const req = http.request({host: '127.0.0.1', port: url.port, method: options.method ?? 'GET', path: `/${token}/${rest}`, headers, agent: false}, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks)}));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(files: Record<string, string | Buffer>, run: (context: {server: ReturnType<typeof createPreviewServer>; root: string; outside: string; open(trusted?: boolean): Promise<PreviewHandle>}) => Promise<void>): Promise<void> {
  const dir = scratchDir('nmsh-preview-');
  const root = path.join(dir, 'doc');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.png'), 'SECRET');
  fs.writeFileSync(path.join(dir, 'secret.png'), 'SECRET');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
    fs.writeFileSync(path.join(root, name), content);
  }
  const server = createPreviewServer();
  try {
    await run({server, root, outside, open: trusted => server.serve({html: '<h1>doc</h1>', root, trusted: trusted === true, name: 'doc.html'})});
  } finally {
    await server.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

const BASE_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'cross-origin-resource-policy': 'same-origin'
};
function assertHardened(reply: Reply): void {
  for (const [name, value] of Object.entries(BASE_HEADERS)) assert.equal(reply.headers[name], value, name);
}

test('the document is served at the token root with the exact CSP and hardening headers; update swaps it', async () => {
  await withServer({}, async ({open}) => {
    const handle = await open();
    assert.match(handle.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/u);
    const reply = await request(handle, '');
    assert.equal(reply.status, 200);
    assert.equal(reply.body.toString(), '<h1>doc</h1>');
    assert.equal(reply.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(reply.headers['content-security-policy'], "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
    assert.equal(reply.headers['content-security-policy'], HTML_CSP);
    assertHardened(reply);
    handle.update('<h1>new</h1>');
    assert.equal((await request(handle, '')).body.toString(), '<h1>new</h1>');
    const withQuery = await request(handle, '?x=1#y');
    assert.equal(withQuery.body.toString(), '<h1>new</h1>');
    const head = await request(handle, '', {method: 'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(head.headers['content-length'], String(Buffer.byteLength('<h1>new</h1>')));
  });
});

test('a trusted document may run its own scripts but still reaches nothing remote', async () => {
  await withServer({}, async ({open}) => {
    const reply = await request(await open(true), '');
    assert.equal(reply.headers['content-security-policy'], TRUSTED_HTML_CSP);
    assert.match(TRUSTED_HTML_CSP, /script-src 'self' 'unsafe-inline'; connect-src 'self'/u);
    assert.doesNotMatch(TRUSTED_HTML_CSP, /https?:|\*/u);
  });
});

test('the bare token redirects to the slash form; other tokens, expired tokens and unknown paths are 404', async () => {
  await withServer({}, async ({open, server}) => {
    const handle = await open();
    const token = new URL(handle.url).pathname.split('/')[1]!;
    const bare = await new Promise<Reply>((resolve, reject) => {
      const url = new URL(handle.url);
      http.get({host: '127.0.0.1', port: url.port, path: `/${token}`, headers: {Host: url.host}, agent: false}, res => { res.resume(); resolve({status: res.statusCode!, headers: res.headers, body: Buffer.alloc(0)}); }).on('error', reject);
    });
    assert.equal(bare.status, 308);
    assert.equal(bare.headers.location, `/${token}/`);
    assert.equal((await request(handle, '', {token: '0'.repeat(32)})).status, 404);
    assert.equal((await request(handle, '', {token: token.slice(0, 31)})).status, 404);
    assert.equal((await request(handle, '', {token: token.toUpperCase()})).status, 404);
    const other = await open();
    assert.notEqual(other.url, handle.url);
    assert.equal((await request(other, '')).status, 200);
    handle.dispose();
    assert.equal((await request(handle, '')).status, 404);
    assert.equal((await request(handle, 'a.png')).status, 404);
    assert.equal((await request(other, '')).status, 200, 'other handles are unaffected');
    await server.close();
    await assert.rejects(request(other, ''));
  });
});

test('only GET and HEAD are accepted', async () => {
  await withServer({'a.png': PNG}, async ({open}) => {
    const handle = await open();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      const reply = await request(handle, 'a.png', {method});
      assert.equal(reply.status, 405, method);
      assert.equal(reply.headers.allow, 'GET, HEAD');
    }
    assert.equal((await request(handle, 'a.png', {method: 'HEAD'})).status, 200);
  });
});

test('the Host header must be this loopback server (DNS rebinding defence) and cross-site requests are refused', async () => {
  await withServer({'a.png': PNG}, async ({open}) => {
    const handle = await open();
    const {port} = new URL(handle.url);
    for (const host of ['evil.example', `evil.example:${port}`, '127.0.0.1', `127.0.0.1:${Number(port) + 1}`, `[::1]:${port}`, `127.0.0.1.evil.example:${port}`]) {
      assert.equal((await request(handle, '', {host})).status, 421, host);
    }
    assert.equal((await request(handle, '', {host: `localhost:${port}`})).status, 200);
    assert.equal((await request(handle, '', {host: `LOCALHOST:${port}`})).status, 200);
    assert.equal((await request(handle, 'a.png', {headers: {'Sec-Fetch-Site': 'cross-site'}})).status, 403);
    assert.equal((await request(handle, '', {headers: {'Sec-Fetch-Site': 'cross-site'}})).status, 403);
    for (const site of ['same-origin', 'none', 'same-site']) assert.equal((await request(handle, 'a.png', {headers: {'Sec-Fetch-Site': site}})).status, 200, site);
  });
});

test('assets are served from the document folder with the right type and headers', async () => {
  await withServer({
    'a.png': PNG, 'sub/b.jpg': 'jpg', 'style.css': 'p{color:red}', 'f.woff2': 'font', 'page.html': '<p>other</p>', 'x/y/deep.gif': 'gif',
    'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>', 'ünï.png': PNG, 'sp ace.webp': 'w', 'UPPER.PNG': PNG
  }, async ({open}) => {
    const handle = await open();
    const png = await request(handle, 'a.png');
    assert.equal(png.status, 200);
    assert.equal(png.headers['content-type'], 'image/png');
    assert.deepEqual(png.body, PNG);
    assertHardened(png);
    assert.equal(png.headers['content-security-policy'], undefined);
    assert.equal((await request(handle, 'sub/b.jpg')).headers['content-type'], 'image/jpeg');
    assert.equal((await request(handle, 'style.css')).headers['content-type'], 'text/css; charset=utf-8');
    assert.equal((await request(handle, 'f.woff2')).headers['content-type'], 'font/woff2');
    assert.equal((await request(handle, 'x/y/deep.gif')).status, 200);
    assert.equal((await request(handle, '%C3%BCn%C3%AF.png')).status, 200);
    assert.equal((await request(handle, 'sp%20ace.webp')).status, 200);
    assert.equal((await request(handle, 'UPPER.PNG')).headers['content-type'], 'image/png');
    const svg = await request(handle, 'logo.svg');
    assert.equal(svg.headers['content-type'], 'image/svg+xml');
    assert.equal(svg.headers['content-security-policy'], 'sandbox');
    assert.equal(svg.headers['content-disposition'], 'inline');
    const html = await request(handle, 'page.html');
    assert.equal(html.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(html.headers['content-security-policy'], HTML_CSP);
    assert.equal((await request(handle, 'a.png', {method: 'HEAD'})).headers['content-length'], String(PNG.length));
    assert.equal((await request(handle, 'index.html')).status, 404, 'index.html is just a file, not the document');
  });
});

test('path traversal in every spelling is refused and never reads outside the folder', async () => {
  await withServer({'a.png': PNG}, async ({open}) => {
    const handle = await open();
    const attempts = ['../secret.png', '..%2fsecret.png', '%2e%2e/secret.png', '%2e%2e%2fsecret.png', '%2E%2E%2Fsecret.png', 'a/../../secret.png', 'a.png/../../secret.png',
      '../outside/secret.png', '.%2e/secret.png', '..\\secret.png', '..%5csecret.png', '%5c..%5csecret.png', '/etc/passwd', '%2fetc%2fpasswd', './a.png', 'a.png/.', '%00',
      'a.png%00.txt', 'a%00.png', '....//secret.png', '%252e%252e/secret.png', '', '/'];
    for (const attempt of attempts) {
      const reply = await request(handle, attempt);
      if (attempt === '' || attempt === '/') continue;
      assert.ok([400, 403, 404].includes(reply.status), `${attempt} -> ${reply.status}`);
      assert.doesNotMatch(reply.body.toString(), /SECRET/u, attempt);
    }
    assert.equal((await request(handle, '%252e%252e/secret.png')).status, 404, 'a double-encoded name is just a literal file name');
  });
});

test('dotfiles and dot-directories are never served', async () => {
  await withServer({'.hidden.png': PNG, '.git/config.png': PNG, 'ok/.env.png': PNG, 'a.png': PNG}, async ({open}) => {
    const handle = await open();
    for (const name of ['.hidden.png', '.git/config.png', 'ok/.env.png', '%2ehidden.png', '.git%2fconfig.png']) assert.equal((await request(handle, name)).status, 403, name);
    assert.equal((await request(handle, 'a.png')).status, 200);
  });
});

test('symlinks that leave the folder are refused; symlinks that stay inside work; a link to a hidden or disallowed target is refused', async () => {
  await withServer({'real.png': PNG, 'secret.txt': 'x', '.hidden/h.png': PNG}, async ({open, root, outside}) => {
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(root, 'escape.png'));
    fs.symlinkSync(outside, path.join(root, 'linkdir'));
    fs.symlinkSync(path.join(root, 'real.png'), path.join(root, 'inside.png'));
    fs.symlinkSync(path.join(root, 'secret.txt'), path.join(root, 'sneaky.png'));
    fs.symlinkSync(path.join(root, '.hidden', 'h.png'), path.join(root, 'tohidden.png'));
    const handle = await open();
    const escaped = await request(handle, 'escape.png');
    assert.equal(escaped.status, 403);
    assert.doesNotMatch(escaped.body.toString(), /SECRET/u);
    assert.equal((await request(handle, 'linkdir/secret.png')).status, 403);
    assert.equal((await request(handle, 'inside.png')).status, 200);
    assert.equal((await request(handle, 'sneaky.png')).status, 403);
    assert.equal((await request(handle, 'tohidden.png')).status, 403);
  });
});

test('only regular files of a sane size are served: directories, FIFOs and huge files are refused without hanging', async () => {
  await withServer({'dir.png/inner.txt': 'x', 'ok.png': PNG}, async ({open, root}) => {
    execFileSync('mkfifo', [path.join(root, 'pipe.png')]);
    const big = fs.openSync(path.join(root, 'huge.png'), 'w');
    fs.ftruncateSync(big, MAX_ASSET_BYTES + 1);
    fs.closeSync(big);
    const edge = fs.openSync(path.join(root, 'edge.png'), 'w');
    fs.ftruncateSync(edge, MAX_ASSET_BYTES);
    fs.closeSync(edge);
    fs.mkdirSync(path.join(root, 'folder'));
    fs.writeFileSync(path.join(root, 'empty.png'), '');
    const handle = await open();
    assert.equal((await request(handle, 'dir.png')).status, 403);
    assert.equal((await request(handle, 'pipe.png')).status, 403);
    assert.equal((await request(handle, 'huge.png')).status, 403);
    assert.equal((await request(handle, 'folder')).status, 403);
    assert.equal((await request(handle, 'folder/')).status, 403);
    assert.equal((await request(handle, 'dir.png/')).status, 403);
    const empty = await request(handle, 'empty.png');
    assert.equal(empty.status, 200);
    assert.equal(empty.body.length, 0);
    assert.equal((await request(handle, 'ok.png')).status, 200);
    const edgeHead = await request(handle, 'edge.png', {method: 'HEAD'});
    assert.equal(edgeHead.status, 200, 'exactly the limit is allowed');
  });
});

test('only allow-listed extensions are served; scripts and JSON need a trusted document', async () => {
  const files: Record<string, string> = {'app.js': 'x', 'mod.mjs': 'x', 'data.json': '{}', 'note.txt': 'x', 'run.php': 'x', 'tool.exe': 'x', 'noext': 'x', 'ok.css': 'x', 'arch.zip': 'x', 'cfg.xml': 'x', 'v.mp4': 'x', 'p.pdf': 'x', 'a.wasm': 'x', 'm.map': 'x'};
  await withServer(files, async ({open}) => {
    const plain = await open(false);
    for (const name of ['note.txt', 'run.php', 'tool.exe', 'noext', 'arch.zip', 'cfg.xml', 'v.mp4', 'p.pdf', 'a.wasm', 'm.map']) assert.equal((await request(plain, name)).status, 403, name);
    for (const name of ['app.js', 'mod.mjs', 'data.json']) {
      const reply = await request(plain, name);
      assert.equal(reply.status, 403, name);
      assert.doesNotMatch(reply.body.toString(), /^x$/u);
    }
    assert.ok(plain.problems().some(problem => problem.path === 'app.js' && problem.reason === 'scripts are off'));
    assert.equal((await request(plain, 'ok.css')).status, 200);
    const trusted = await open(true);
    assert.equal((await request(trusted, 'app.js')).headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal((await request(trusted, 'mod.mjs')).status, 200);
    assert.equal((await request(trusted, 'data.json')).headers['content-type'], 'application/json; charset=utf-8');
    assert.equal((await request(trusted, 'note.txt')).status, 403);
  });
});

test('refused and missing assets are recorded newest last, bounded, with control characters stripped', async () => {
  await withServer({'a.png': PNG}, async ({open}) => {
    const handle = await open();
    await request(handle, 'missing.png');
    await request(handle, 'a.exe');
    await request(handle, '..%2fsecret.png');
    assert.deepEqual(handle.problems().map(problem => [problem.path, problem.reason]), [
      ['missing.png', 'not found'], ['a.exe', 'this kind of file is not served'], ['../secret.png', 'path is not allowed']
    ]);
    await request(handle, 'a.png');
    assert.equal(handle.problems().length, 3, 'served files are not problems');
    await request(handle, '%1b%5b2J%e2%80%aeevil%0d%0a%c2%85x.png');
    const last = handle.problems().at(-1)!;
    assert.equal(last.path, '[2Jevilx.png');
    assert.doesNotMatch(last.path + last.reason, /[\u0000-\u001f\u007f-\u009f‪-‮]/u);
    for (let index = 0; index < MAX_PROBLEMS + 20; index++) await request(handle, `gone-${index}.png`);
    const problems = handle.problems();
    assert.equal(problems.length, MAX_PROBLEMS);
    assert.equal(problems.at(-1)!.path, `gone-${MAX_PROBLEMS + 19}.png`);
    assert.equal(problems[0]!.path, `gone-${20}.png`);
    const long = await request(handle, `${'x'.repeat(5000)}.png`);
    assert.equal(long.status, 404);
    assert.ok(handle.problems().at(-1)!.path.length <= 200);
    problems.pop();
    assert.equal(handle.problems().length, MAX_PROBLEMS, 'the returned list is a copy');
  });
});

test('every response, including errors, carries the hardening headers; handles keep separate problem logs', async () => {
  await withServer({'a.png': PNG}, async ({open}) => {
    const one = await open();
    const two = await open();
    for (const reply of [await request(one, 'a.png'), await request(one, 'nope.png'), await request(one, 'x.exe'), await request(one, '', {method: 'POST'}), await request(one, '', {host: 'evil'}),
      await request(one, '', {token: 'f'.repeat(32)}), await request(one, '..%2fa.png')]) assertHardened(reply);
    assert.equal(two.problems().length, 0);
    assert.equal(one.problems().length, 3);
  });
});

test('a document root that no longer exists yields 404, not an error', async () => {
  await withServer({'a.png': PNG}, async ({open, root}) => {
    const handle = await open();
    fs.rmSync(root, {recursive: true, force: true});
    assert.equal((await request(handle, 'a.png')).status, 404);
    assert.equal((await request(handle, '')).status, 200);
  });
});

test('the server limits concurrent connections', async () => {
  await withServer({}, async ({open}) => {
    const handle = await open();
    const {port} = new URL(handle.url);
    const sockets = Array.from({length: 48}, () => net.connect(Number(port), '127.0.0.1'));
    let closed = 0;
    for (const socket of sockets) {
      socket.on('close', () => { closed++; });
      socket.on('error', () => undefined);
    }
    await new Promise(resolve => setTimeout(resolve, 600));
    sockets.forEach(socket => socket.destroy());
    assert.ok(closed >= 8, `excess connections are dropped (closed ${closed})`);
  });
});
