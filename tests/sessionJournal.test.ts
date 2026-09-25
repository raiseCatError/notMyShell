import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {TranscriptStore} from '../src/sessions/TranscriptStore.js';
import {SessionJournal} from '../src/sessions/SessionJournal.js';

test('journal checkpoints incrementally under one id and records normal close', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-journal-test-'));
  try {
    const output = new OutputBuffer();
    const store = new TranscriptStore(directory);
    const errors: unknown[] = [];
    const journal = new SessionJournal(store, 1000,
      () => ({startCwd: '/tmp', finalCwd: '/tmp', transcript: output.transcript()}),
      error => errors.push(error));
    await journal.start();
    const id = (await store.listSummaries())[0]?.id;
    assert.ok(id);
    assert.equal((await store.load(id)).journaled, true);
    assert.equal((await store.load(id)).endedAt, undefined, 'an interrupted process leaves a recoverable open session');
    output.beginCommand('pwd', ['> pwd']);
    output.write('/tmp\n');
    output.complete(0);
    await journal.flush();
    assert.equal((await store.load(id)).transcript.records[0]?.command, 'pwd');
    assert.equal((await store.listSummaries()).length, 1);
    await journal.close();
    assert.ok((await store.load(id)).endedAt);
    assert.deepEqual(errors, []);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
