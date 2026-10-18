import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Socket} from 'node:net';
import {writeClipboard, CLIPBOARD_MAX_BYTES} from '../src/clipboard/clipboard.js';
import {until} from './helpers/liveFrontend.js';

type FinalCallback = (error?: Error | null) => void;
type FinalSocket = Socket & {_final: (callback: FinalCallback) => void};

test('clipboard succeeds after payload delivery and backend exit even if exit suppresses finish', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-clip-final-'));
  const sink = join(root, 'copied');
  const backend = join(root, 'xclip');
  writeFileSync(backend, `#!/bin/sh\ncat > '${sink}'\n`);
  chmodSync(backend, 0o700);
  const spawn = childProcess.spawn;
  let nativeFinalCompleted = false;
  let finished = false;
  let exited: number | null | undefined;
  let closed = false;
  const hook = t.mock.method(childProcess, 'spawn', (...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    if (args[0] === backend) {
      const stream = child.stdin! as FinalSocket;
      const final = stream._final;
      stream._final = function(callback) {
        final.call(this, error => {
          if (error) { callback(error); return; }
          nativeFinalCompleted = true;
          // Actual shutdown/EOF is complete; hold only its JS callback until
          // Node destroys stdin during backend exit. No input or exit is faked.
          child.once('exit', () => callback());
        });
      };
      stream.once('finish', () => { finished = true; });
      child.once('exit', code => { exited = code; });
      child.once('close', () => { closed = true; });
    }
    return child;
  });
  syncBuiltinESMExports();
  try {
    const payload = 'héllo; $(touch pwned)\n🐈';
    await writeClipboard(payload, {platform: 'linux', env: {DISPLAY: ':0'}, resolve: () => backend});
    assert.equal(readFileSync(sink, 'utf8'), payload);
    assert.equal(nativeFinalCompleted, true, 'backend received real EOF');
    assert.equal(exited, 0, 'the real backend succeeded');
    assert.equal(finished, false, 'success cannot depend on suppressed finish');
  } finally {
    hook.mock.restore();
    syncBuiltinESMExports();
    try { await until(() => closed, 3000, 'owned clipboard child closed'); }
    finally { rmSync(root, {recursive: true, force: true}); }
  }
});

test('clipboard rejects a partial stdin read even when the backend exits zero', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-clip-partial-'));
  const sink = join(root, 'prefix');
  const backend = join(root, 'xclip');
  writeFileSync(backend, `#!/bin/sh\ndd bs=1 count=128 > '${sink}' 2>/dev/null\nexec 0<&-\nsleep 0.1\nexit 0\n`);
  chmodSync(backend, 0o700);
  try {
    await assert.rejects(writeClipboard('x'.repeat(CLIPBOARD_MAX_BYTES), {
      platform: 'linux', env: {DISPLAY: ':0'}, resolve: () => backend,
    }), /EPIPE|pipe|stdin/iu);
    assert.equal(readFileSync(sink).length, 128, 'backend consumed only a strict prefix');
  } finally { rmSync(root, {recursive: true, force: true}); }
});


test('clipboard rejects the write callback error even after backend exit zero', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-clip-callback-'));
  const backend = join(root, 'xclip');
  writeFileSync(backend, '#!/bin/sh\ncat >/dev/null\n');
  chmodSync(backend, 0o700);
  const spawn = childProcess.spawn;
  let exited: number | null | undefined;
  let closed = false;
  const hook = t.mock.method(childProcess, 'spawn', (...args: Parameters<typeof spawn>) => {
    const child = spawn(...args);
    if (args[0] === backend) {
      const stream = child.stdin!;
      const write = stream.write;
      t.mock.method(stream, 'write', (chunk: string, callback: (error?: Error | null) => void) =>
        write.call(stream, chunk, 'utf8', error => {
          if (error) { callback(error); return; }
          // Exercise callback(error) without an accompanying error event. The
          // real child still receives EOF and exits zero before this callback.
          child.once('exit', () => callback(new Error('controlled write callback error')));
        }));
      child.once('exit', code => { exited = code; });
      child.once('close', () => { closed = true; });
    }
    return child;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(writeClipboard('payload', {
      platform: 'linux', env: {DISPLAY: ':0'}, resolve: () => backend,
    }), /controlled write callback error/u);
    assert.equal(exited, 0, 'backend success cannot override a write error');
  } finally {
    hook.mock.restore();
    syncBuiltinESMExports();
    try { await until(() => closed, 3000, 'owned clipboard child closed'); }
    finally { rmSync(root, {recursive: true, force: true}); }
  }
});
