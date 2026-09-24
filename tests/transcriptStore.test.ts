import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TranscriptStore, TRANSCRIPT_SCHEMA_VERSION} from '../src/sessions/TranscriptStore.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {TapActivityObserver} from '../src/output/TapActivityObserver.js';

test('transcript store writes private, versioned local archives with deterministic metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-session-test-'));
  try {
    const output = new OutputBuffer();
    output.beginCommand('pwd', ['❯ pwd'], undefined, {cwd: '/tmp', branch: 'dev'});
    output.write('/tmp/project\n');
    output.complete(0);
    const store = new TranscriptStore(directory);
    const archived = await store.archive({
      startCwd: '/tmp',
      finalCwd: '/tmp/project',
      transcript: output.transcript(),
    });

    assert.equal(archived.commandCount, 1);
    assert.equal(archived.startCwd, '/tmp');
    assert.equal(archived.finalCwd, '/tmp/project');
    assert.equal(archived.preview, 'pwd');
    assert.ok(Number.isFinite(Date.parse(archived.createdAt)));

    const files = await store.list();
    assert.equal(files.length, 1);
    assert.equal(files[0]?.id, archived.id);
    assert.equal(files[0]?.transcript.records[0]?.output, '/tmp/project');
    assert.deepEqual(files[0]?.transcript.records[0]?.historicalContext, {cwd: '/tmp', branch: 'dev'});
    const raw = JSON.parse(await readFile(join(directory, `${archived.id}.json`), 'utf8')) as {schemaVersion: number};
    assert.equal(raw.schemaVersion, TRANSCRIPT_SCHEMA_VERSION);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, `${archived.id}.json`))).mode & 0o777, 0o600);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('transcript picker ignores corrupt and unsupported archives without pruning them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-session-test-'));
  try {
    await writeFile(join(directory, 'corrupt.json'), '{');
    await writeFile(join(directory, 'future.json'), JSON.stringify({schemaVersion: 99}));
    const store = new TranscriptStore(directory);
    assert.deepEqual(await store.list(), []);
    assert.equal(await readFile(join(directory, 'corrupt.json'), 'utf8'), '{');
    assert.equal(JSON.parse(await readFile(join(directory, 'future.json'), 'utf8')).schemaVersion, 99);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('local transcript persistence stores semantic activity ranges without ANSI activity presentation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-session-test-'));
  try {
    const output = new OutputBuffer();
    const observer = new TapActivityObserver();
    output.beginCommand('npm test', ['❯ npm test']);
    observer.reset(output.activeOutputStartId!);
    const first = 'TAP version 13\n# tests 1\n# pass 1\n# fail 0\n';
    output.write(first);
    output.setActiveActivities(observer.push(first, 1000));
    const last = '# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 8\n';
    output.write(last);
    output.setActiveActivities(observer.push(last, 1100));
    output.setActiveActivities(observer.finish(1200));
    output.complete(0);

    const store = new TranscriptStore(directory);
    const archive = await store.archive({startCwd: '/tmp', finalCwd: '/tmp', transcript: output.transcript()});
    const restored = (await store.list())[0];
    assert.deepEqual(restored?.transcript.records[0]?.activities, archive.transcript.records[0]?.activities);
    const raw = JSON.parse(await readFile(join(directory, `${archive.id}.json`), 'utf8')) as {
      transcript: {records: Array<{activities?: Array<Record<string, unknown>>}>};
    };
    assert.ok(raw.transcript.records[0]?.activities?.length);
    assert.equal('ansi' in (raw.transcript.records[0]?.activities?.[0] ?? {}), false);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
