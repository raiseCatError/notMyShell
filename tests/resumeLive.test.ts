import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createResumeBrowser, describeLiveSession, resumeRowCount, resumeSelection, visibleResumeSessions} from '../src/sessions/ResumeBrowser.js';
import {archiveLiveSession} from '../src/sessions/archiveLive.js';
import {TranscriptStore, type TranscriptSummary} from '../src/sessions/TranscriptStore.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import type {SessionInfo} from '../src/session/SessionProtocol.js';

const info = (id: string, state: SessionInfo['state'], extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({id, pid: 100, state, cwd: `/w/${id}`, createdAt: 1_000, ...extra});

function summary(id: string, createdAt: string): TranscriptSummary {
  return {id, createdAt, commandCount: 1, startCwd: '/w', finalCwd: '/w', project: 'p', pinned: false, journaled: true, endedAt: createdAt};
}

test('/resume lists LIVE before ARCHIVED, never both for one session, and stays cheap at 1000 archives', () => {
  const now = new Date();
  const archives = Array.from({length: 1000}, (_, index) => summary(`j${index}`, new Date(now.getTime() - index * 60_000).toISOString()));
  const live = [info('s1', 'detached', {journalId: 'j0'}), info('s2', 'attached')];
  const started = performance.now();
  const browser = createResumeBrowser(archives, live, new Set(['j0']));
  assert.equal(browser.sessions.some(session => session.id === 'j0'), false, 'the live session is not also archived');
  assert.deepEqual(resumeSelection(browser), {kind: 'live', session: live[0]});
  browser.selectedIndex = 2;
  assert.equal(resumeSelection(browser)?.kind, 'archived');
  for (let index = 0; index < 200; index += 1) { resumeRowCount(browser); resumeSelection(browser); visibleResumeSessions(browser); }
  assert.ok(performance.now() - started < 2000, 'selection and filtering stay proportional to the list');
  browser.query = 's2';
  assert.deepEqual(resumeSelection({...browser, selectedIndex: 0}), {kind: 'live', session: live[1]}, 'search filters LIVE rows too');
  assert.match(describeLiveSession(live[1]!, 2_000), /attached in another window · idle/);
});

test('Kill Session archive: last journal plus unseen events, nothing claimed to still run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-archive-'));
  try {
    const store = new TranscriptStore(dir);
    const output = new OutputBuffer();
    output.beginCommand('echo one', ['❯ echo one']);
    output.write('one\r\n');
    output.complete(0);
    const startId = output.beginCommand('make', ['❯ make']);
    output.write('building\r\n');
    const outputStartId = output.activeOutputStartId!;
    const journal = store.create({startCwd: '/w', finalCwd: '/w', journaled: true, transcript: output.transcript(),
      live: {sessionId: 'live-1', seq: 5, running: {command: 'make', startedAt: 1_000, cwd: '/w', startId, outputStartId}}});
    await store.save(journal);

    const archived = await archiveLiveSession({store, journalId: journal.id, sessionId: 'live-1', cwd: '/w', now: 9_000,
      note: 'Session killed from /resume; its shell has ended.',
      spool: {ackedSeq: 5, truncatedBytes: 0, events: [
        {kind: 'output', seq: 5, at: 1_500, data: 'already journaled\r\n'},
        {kind: 'output', seq: 6, at: 2_000, data: 'linked\r\n'},
        {kind: 'prompt', seq: 7, at: 3_000, exitCode: 0, cwd: '/w/sub'},
        {kind: 'exec', seq: 8, at: 4_000, command: 'sleep 999'},
      ], exit: {exitCode: 129, at: 8_000}}});
    const loaded = await store.load(archived.id);
    assert.equal(loaded.id, journal.id, 'the same journal becomes the archive');
    assert.equal(loaded.live, undefined);
    assert.ok(loaded.endedAt);
    const records = [...loaded.transcript.records].reverse();
    assert.deepEqual(records.map(record => [record.command, record.exitCode]), [['echo one', 0], ['make', 0], ['sleep 999', 129]]);
    assert.match(records[1]!.output, /building[\s\S]*linked/);
    assert.doesNotMatch(records[1]!.output, /already journaled/);
    assert.equal(loaded.finalCwd, '/w/sub');
    assert.ok(loaded.transcript.lines.some(line => line.map(cell => (cell && 'text' in cell ? cell.text : '')).join('').includes('Session killed')));
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
