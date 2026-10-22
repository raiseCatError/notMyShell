import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {libraryCandidates, locateMermaid, MAX_LIBRARY_BYTES} from '../src/diagrams/library.js';

function scratch(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'nmsh-mermaid-lib-')));
}

/** A package laid out the way npm installs it: <dir>/package.json and <dir>/dist/mermaid.min.js. */
function fakePackage(root: string, options: {name?: string; version?: string; body?: string} = {}): string {
  const dir = path.join(root, 'mermaid');
  fs.mkdirSync(path.join(dir, 'dist'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: options.name ?? 'mermaid', version: options.version ?? '12.2.0'}));
  fs.writeFileSync(path.join(dir, 'dist', 'mermaid.min.js'), options.body ?? 'globalThis.mermaid = {};');
  return dir;
}

test('the person\'s NMSH_MERMAID comes first: a package folder or the bundle itself', async () => {
  const root = scratch();
  try {
    const dir = fakePackage(root);
    const fromDir = await locateMermaid({env: {NMSH_MERMAID: dir}, home: root, execPath: '/nonexistent/bin/node'});
    assert.equal(fromDir.ok, true);
    assert.equal(fromDir.ok && fromDir.version, '12.2.0');
    assert.equal(fromDir.ok && fromDir.source, 'globalThis.mermaid = {};');
    const fromFile = await locateMermaid({env: {NMSH_MERMAID: path.join(dir, 'dist', 'mermaid.min.js')}, home: root, execPath: '/nonexistent/bin/node'});
    assert.equal(fromFile.ok && fromFile.path, path.join(dir, 'dist', 'mermaid.min.js'));
    // A relative or missing NMSH_MERMAID is an error that names the variable; it is never silently replaced by another install.
    const relative = await locateMermaid({env: {NMSH_MERMAID: 'mermaid.min.js'}, home: root, execPath: '/nonexistent/bin/node'});
    assert.equal(relative.ok, false);
    assert.match(!relative.ok ? relative.reason : '', /NMSH_MERMAID/u);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('global npm installs are found next to the running Node and in the usual prefixes; nothing is downloaded', async () => {
  const root = scratch();
  try {
    const prefix = path.join(root, 'prefix');
    fs.mkdirSync(path.join(prefix, 'bin'), {recursive: true});
    fakePackage(path.join(prefix, 'lib', 'node_modules'), {version: '11.4.0'});
    const found = await locateMermaid({env: {}, home: root, execPath: path.join(prefix, 'bin', 'node')});
    assert.equal(found.ok && found.version, '11.4.0');
    assert.ok(libraryCandidates({env: {}, home: '/h', execPath: '/p/bin/node'}).some(candidate => candidate === '/opt/homebrew/lib/node_modules/mermaid'));
    const none = await locateMermaid({env: {}, home: root, execPath: path.join(root, 'nowhere', 'bin', 'node'), candidates: [path.join(root, 'missing')]});
    assert.equal(none.ok, false);
    assert.match(!none.ok ? none.reason : '', /npm install -g mermaid/u);
    assert.match(!none.ok ? none.reason : '', /does not download/u);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('a package that is not Mermaid, too old, too large, world-writable or not a regular file is refused with a reason', async () => {
  const root = scratch();
  const at = (dir: string) => locateMermaid({env: {NMSH_MERMAID: dir}, home: root, execPath: '/nonexistent/bin/node'});
  try {
    const other = fakePackage(path.join(root, 'a'), {name: 'not-mermaid'});
    assert.match(((await at(other)) as {reason: string}).reason, /not the mermaid package/u);
    const old = fakePackage(path.join(root, 'b'), {version: '9.4.3'});
    assert.match(((await at(old)) as {reason: string}).reason, /10 or newer/u);
    const big = fakePackage(path.join(root, 'c'));
    fs.truncateSync(path.join(big, 'dist', 'mermaid.min.js'), MAX_LIBRARY_BYTES + 1);
    assert.match(((await at(big)) as {reason: string}).reason, /too large/u);
    const open = fakePackage(path.join(root, 'd'));
    fs.chmodSync(path.join(open, 'dist', 'mermaid.min.js'), 0o666);
    assert.match(((await at(open)) as {reason: string}).reason, /changed by anyone/u);
    const fifo = path.join(root, 'e', 'mermaid');
    fs.mkdirSync(path.join(fifo, 'dist'), {recursive: true});
    fs.writeFileSync(path.join(fifo, 'package.json'), JSON.stringify({name: 'mermaid', version: '12.0.0'}));
    fs.mkdirSync(path.join(fifo, 'dist', 'mermaid.min.js'));
    assert.match(((await at(fifo)) as {reason: string}).reason, /not a regular file/u);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
