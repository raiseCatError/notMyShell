import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {SessionPresetStore} from '../src/session/SessionPresets.js';

function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  return child.pid!;
}

function withStore(body: (store: SessionPresetStore, root: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), 'preset-lock-'));
    try { await body(new SessionPresetStore(root), root); } finally { rmSync(root, {recursive: true, force: true}); }
  };
}

test('dead-owner lock is recovered for create, acknowledge and delete', withStore((store, root) => {
  const lock = `${store.path}.lock`;
  writeFileSync(lock, `${deadPid()}\n`);
  const created = store.create({name: 'one', cwd: root, commands: ['echo hi']});
  assert.equal(existsSync(lock), false);
  writeFileSync(lock, `${deadPid()}\n`);
  store.acknowledge(created);
  writeFileSync(lock, `${deadPid()}\n`);
  store.delete('one');
  assert.deepEqual(store.list(), []);
  assert.deepEqual(readdirSync(root), ['presets.json']);
}));

test('a live owner is never displaced, however old the lock', withStore((store, root) => {
  const lock = `${store.path}.lock`;
  writeFileSync(lock, `${process.pid}\n`);
  assert.throws(() => store.create({name: 'one', cwd: root, commands: []}), (error: Error) => /busy/.test(error.message) && error.message.includes(lock));
  assert.equal(readFileSync(lock, 'utf8'), `${process.pid}\n`);
}));

test('empty or malformed ownership fails safe and names the lock path', withStore((store, root) => {
  const lock = `${store.path}.lock`;
  for (const content of ['', 'garbage', '-5\n', '0', '12abc9999999999999999']) {
    writeFileSync(lock, content);
    assert.throws(() => store.create({name: 'one', cwd: root, commands: []}), (error: Error) => /busy/.test(error.message) && error.message.includes(lock), content);
    assert.equal(readFileSync(lock, 'utf8'), content);
  }
}));

test('concurrent writer processes are serialized without losing presets', withStore(async (store, root) => {
  const script = `import {SessionPresetStore} from ${JSON.stringify(new URL('../src/session/SessionPresets.ts', import.meta.url).href)};
const store = new SessionPresetStore(process.argv[1]);
for (let i = 0; i < 6; i++) store.create({name: process.argv[2] + i, cwd: process.argv[1], commands: []});`;
  const run = (prefix: string) => new Promise<number | null>(resolve => {
    const child = spawn(process.execPath, ['--import=tsx', '--input-type=module', '-e', script, root, prefix], {stdio: 'ignore'});
    child.once('close', resolve);
  });
  assert.deepEqual(await Promise.all([run('a'), run('b'), run('c')]), [0, 0, 0]);
  assert.equal(store.list().length, 18);
  assert.equal(existsSync(`${store.path}.lock`), false);
}));
