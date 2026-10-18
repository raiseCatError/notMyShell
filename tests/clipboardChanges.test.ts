import test from 'node:test';
import assert from 'node:assert/strict';
import {ClipboardChangeWatch, parseClipboardCounter} from '../src/clipboard/ClipboardChanges.js';

test('counter parsing accepts bounded nonnegative metadata only', () => {
  assert.equal(parseClipboardCounter('42\n'), 42);
  for (const raw of ['-1', 'secret contents', '12\n34', '9'.repeat(200), '9007199254740992'])
    assert.throws(() => parseClipboardCounter(raw));
});

test('suggestions are off by default, sample only when idle, and never request clipboard text', async () => {
  let count = 3, reads = 0, changes = 0, idle = true;
  let next: (() => void) | undefined;
  const watch = new ClipboardChangeWatch({counter: async () => { reads++; return count; }, idle: () => idle,
    changed: () => { changes++; }, failed: () => assert.fail('unexpected failure'),
    schedule: callback => { next = callback; return () => { next = undefined; }; }});
  const settle = async () => { await new Promise(done => setImmediate(done)); };
  assert.equal(watch.enabled, false);
  assert.equal(reads, 0);
  watch.start(); await settle();
  assert.equal(reads, 1);
  assert.equal(changes, 0, 'initial metadata is a baseline');
  idle = false; count++;
  next!(); await settle();
  assert.equal(reads, 1, 'foreground input ownership prevents even metadata probing');
  idle = true;
  next!(); await settle();
  assert.equal(changes, 1);
  watch.stop();
  assert.equal(watch.enabled, false);
  assert.equal(next, undefined);
});

test('failures disable suggestions; a response after stop cannot raise a suggestion', async () => {
  let failed = 0, changes = 0;
  let resolve!: (count: number) => void;
  const watch = new ClipboardChangeWatch({counter: () => new Promise(done => { resolve = done; }), idle: () => true,
    changed: () => { changes++; }, failed: () => { failed++; }});
  watch.start(); watch.stop(); resolve(1);
  await new Promise(done => setImmediate(done));
  assert.equal(changes, 0);
  assert.equal(watch.enabled, false);
  const broken = new ClipboardChangeWatch({counter: async () => { throw new Error('unavailable'); }, idle: () => true,
    changed: () => { changes++; }, failed: () => { failed++; }});
  broken.start();
  await new Promise(done => setImmediate(done));
  assert.equal(broken.enabled, false);
  assert.equal(failed, 1);
});
