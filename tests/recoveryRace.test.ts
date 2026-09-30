import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recoverEndedSessions} from '../src/session/recovery.js';
import {spoolPathFor} from '../src/session/runtimeDir.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {TranscriptStore, type TranscriptSession} from '../src/sessions/TranscriptStore.js';

const text = (session: TranscriptSession) => [
  ...session.transcript.records.map(record => record.output),
  ...session.transcript.lines.map(line => line.map(cell => (cell && 'text' in cell ? cell.text : '')).join('')),
].join('\n');

/** A journal left open by a frontend that detached from live session `sessionId`, plus that session's spool. */
async function detachedSession(store: TranscriptStore, runtimeDir: string, sessionId: string, spoolJournal?: string) {
  const output = new OutputBuffer();
  output.beginCommand('echo journaled', ['❯ echo journaled']);
  output.write('JOURNALED\r\n');
  output.complete(0);
  const journal = store.create({startCwd: '/w', finalCwd: '/w', journaled: true, transcript: output.transcript(),
    live: {sessionId, seq: 2}});
  await store.save(journal);
  const spool = spoolPathFor(runtimeDir, sessionId);
  mkdirSync(join(runtimeDir, 'spool'), {recursive: true, mode: 0o700});
  writeFileSync(spool, [
    {kind: 'ack', seq: 2, journalId: spoolJournal ?? journal.id},
    {kind: 'exec', seq: 3, at: 1_000, command: 'echo detached'},
    {kind: 'output', seq: 4, at: 1_100, data: 'DETACHED-OUTPUT\r\n'},
    {kind: 'prompt', seq: 5, at: 1_200, exitCode: 0, cwd: '/w'},
    {kind: 'exit', exitCode: 3, at: 1_300},
  ].map(record => `${JSON.stringify(record)}\n`).join(''), {mode: 0o600});
  return {journal, spool};
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-race-'));
  const runtimeDir = join(root, 'r');
  mkdirSync(runtimeDir, {mode: 0o700});
  return {root, runtimeDir, sessions: join(root, 's')};
}

/**
 * Forces the worst ordering: any save that lacks the detached output waits
 * until the complete archive has been written. Without an ownership boundary a
 * second launch's journal-only archive then overwrites the complete one.
 */
class WorstOrderStore extends TranscriptStore {
  static fullSaved: Promise<void>;
  static markFull: () => void;
  static reset() { WorstOrderStore.fullSaved = new Promise(resolve => { WorstOrderStore.markFull = resolve; }); }
  override async save(session: TranscriptSession, retention: number | null = null): Promise<void> {
    const full = text(session).includes('DETACHED-OUTPUT');
    if (!full && session.endedAt) await Promise.race([WorstOrderStore.fullSaved, new Promise(resolve => setTimeout(resolve, 2000))]);
    await super.save(session, retention);
    if (full) WorstOrderStore.markFull();
  }
}

test('two launches recovering the same detached session archive it exactly once, completely', async () => {
  const {root, runtimeDir, sessions} = sandbox();
  try {
    WorstOrderStore.reset();
    const {journal, spool} = await detachedSession(new TranscriptStore(sessions), runtimeDir, 'live-race');
    const results = await Promise.all([
      recoverEndedSessions(runtimeDir, new WorstOrderStore(sessions)),
      recoverEndedSessions(runtimeDir, new WorstOrderStore(sessions)),
    ]);
    assert.equal(results.flatMap(result => result.archived).length, 1, 'exactly one launch archives it');
    const archived = await new TranscriptStore(sessions).load(journal.id);
    assert.ok(archived.endedAt);
    assert.equal(archived.live, undefined);
    assert.match(text(archived), /JOURNALED/);
    assert.match(text(archived), /DETACHED-OUTPUT/, 'detached output survives');
    assert.match(text(archived), /exit code 3/, 'the real shell exit is recorded');
    assert.equal(existsSync(spool), false);
    assert.deepEqual(readdirSync(join(runtimeDir, 'spool')), [], 'no claimed spool left behind');
    assert.ok(!readdirSync(sessions).some(name => name.includes('.lock')), 'no lock left behind');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('a leftover spool never replays over a transcript that is already finalized', async () => {
  const {root, runtimeDir, sessions} = sandbox();
  try {
    const store = new TranscriptStore(sessions);
    const {journal, spool} = await detachedSession(store, runtimeDir, 'live-ended');
    // Finalized elsewhere (e.g. Kill Session crashed after saving, before removing the spool).
    const {live: _live, ...rest} = journal;
    await store.save({...rest, endedAt: new Date(5_000).toISOString()});
    const before = await store.load(journal.id);

    const result = await recoverEndedSessions(runtimeDir, store);
    assert.deepEqual(result.archived, []);
    assert.deepEqual(await store.load(journal.id), before, 'the finalized transcript is untouched');
    assert.equal(existsSync(spool), false, 'the stale spool is dropped');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('a spool claimed by a launch that crashed is restored and archived by the next one', async () => {
  const {root, runtimeDir, sessions} = sandbox();
  try {
    const store = new TranscriptStore(sessions);
    const {journal, spool} = await detachedSession(store, runtimeDir, 'live-crash');
    const deadPid = 2 ** 22 + 12345; // above any pid macOS or Linux assigns by default
    // Simulate the crash: the spool was renamed to its claim and never put back.
    renameSync(spool, `${spool}.${deadPid}.recovering`);

    const result = await recoverEndedSessions(runtimeDir, store);
    assert.deepEqual(result.archived, [journal.id]);
    assert.match(text(await store.load(journal.id)), /DETACHED-OUTPUT/);
    assert.deepEqual(readdirSync(join(runtimeDir, 'spool')), []);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('a linked journal with no spool at all is still archived', async () => {
  const {root, runtimeDir, sessions} = sandbox();
  try {
    const store = new TranscriptStore(sessions);
    const {journal, spool} = await detachedSession(store, runtimeDir, 'live-nospool');
    rmSync(spool);
    const result = await recoverEndedSessions(runtimeDir, store);
    assert.deepEqual(result.archived, [journal.id]);
    const archived = await store.load(journal.id);
    assert.ok(archived.endedAt);
    assert.match(text(archived), /JOURNALED/);
    assert.match(text(archived), /session service stopped/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('a transcript lock held by a live process blocks other writers; a dead owner\'s lock is taken over', async () => {
  const {root, sessions} = sandbox();
  try {
    const store = new TranscriptStore(sessions);
    let release!: () => void;
    let acquired!: () => void;
    const holding = new Promise<void>(resolve => { acquired = resolve; });
    const held = store.withLock('journal-x', () => new Promise<void>(resolve => { release = resolve; acquired(); }));
    await holding;
    await assert.rejects(store.withLock('journal-x', async () => 'second', 50), /another NMSh process/);
    release();
    await held;
    assert.equal(await store.withLock('journal-x', async () => 'after'), 'after');

    writeFileSync(join(sessions, 'journal-y.lock'), `${2 ** 22 + 12345}\n`);
    assert.equal(await store.withLock('journal-y', async () => 'taken over'), 'taken over');
    assert.ok(!readdirSync(sessions).some(name => name.includes('.lock')));
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
