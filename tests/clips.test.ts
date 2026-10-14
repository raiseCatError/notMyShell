import test from 'node:test';
import assert from 'node:assert/strict';
import {ClipStore, CLIP_MAX_BYTES, CLIP_LIMIT} from '../src/clipboard/ClipStore.js';

test('clips retain exact text and provenance in memory; remove and clear never write anything', () => {
  const store = new ClipStore();
  const added = store.add('echo "$(not executed)"\n', {source: 'history', cwd: '/old', session: 'source-session'});
  assert.ok(added.ok);
  if (!added.ok) return;
  assert.deepEqual(store.get(added.clip.id), added.clip);
  assert.equal(added.clip.text, 'echo "$(not executed)"\n');
  assert.equal(added.clip.cwd, '/old');
  assert.equal(added.clip.session, 'source-session');
  assert.equal(new ClipStore().list().length, 0, 'no persistence or global state');
  assert.equal(store.remove(added.clip.id), true);
  assert.equal(store.get(added.clip.id), undefined);
  store.add('echo next', {source: 'composer'});
  store.clear();
  assert.deepEqual(store.list(), []);
});

test('clips bound both bytes and count, reject empty/oversized text, and evict oldest first', () => {
  const store = new ClipStore();
  assert.equal(store.add(' \n', {source: 'paste'}).ok, false);
  assert.equal(store.add('é'.repeat(CLIP_MAX_BYTES), {source: 'paste'}).ok, false);
  for (let index = 0; index <= CLIP_LIMIT; index++) store.add(`echo ${index}`, {source: 'composer'});
  assert.equal(store.list().length, CLIP_LIMIT);
  assert.equal(store.list().at(-1)?.text, 'echo 1');
  const large = store.add('a'.repeat(CLIP_MAX_BYTES), {source: 'output'});
  assert.ok(large.ok);
  assert.equal(store.list().length, 1, 'the total memory budget is also bounded');
});
