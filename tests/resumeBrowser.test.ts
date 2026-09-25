import test from 'node:test';
import assert from 'node:assert/strict';
import {createResumeBrowser, navigateResume, visibleResumeSessions} from '../src/sessions/ResumeBrowser.js';
import type {TranscriptSummary} from '../src/sessions/TranscriptStore.js';

function session(id: string, createdAt: string, commandCount = 1): TranscriptSummary {
  return {id, createdAt, commandCount, startCwd: `/projects/${id}`, finalCwd: `/projects/${id}`,
    project: id, pinned: false};
}

test('resume search covers all retained weeks and command text', () => {
  const state = createResumeBrowser([
    session('recent', '2026-09-24T09:00:00Z'), session('old', '2026-08-05T09:00:00Z'),
  ]);
  assert.deepEqual(visibleResumeSessions(state).map(item => item.id), ['recent']);
  state.commandText.set('old', 'rg --hidden secret-pattern');
  state.query = 'hidden';
  assert.deepEqual(visibleResumeSessions(state).map(item => item.id), ['old']);
  state.query = '2026-08-05';
  assert.deepEqual(visibleResumeSessions(state).map(item => item.id), ['old']);
  state.query = '/projects/old';
  assert.deepEqual(visibleResumeSessions(state).map(item => item.id), ['old']);
});

test('resume navigation skips empty weeks and months and refuses missing directions', () => {
  const state = createResumeBrowser([
    session('new', '2026-09-24T09:00:00Z'), session('old', '2026-07-05T09:00:00Z'),
  ]);
  assert.equal(navigateResume(state, 'week', 1), false);
  assert.equal(navigateResume(state, 'week', -1), true);
  assert.deepEqual(visibleResumeSessions(state).map(item => item.id), ['old']);
  assert.equal(navigateResume(state, 'month', -1), false);
  assert.equal(navigateResume(state, 'month', 1), true);
  assert.deepEqual(visibleResumeSessions(state).map(item => item.id), ['new']);
});
