import test from 'node:test';
import assert from 'node:assert/strict';
import {initialSelection, launcherRows, targetStatus} from '../src/agents/launcher.js';

test('resumability is advertised only with provider evidence; ended targets never look live', () => {
  const base = {id: 'a', harness: 'claude', level: 'managed', title: 'Parser QA', cwd: '/p', startedAt: 0, events: [], attention: false, updatedAt: 0} as any;
  assert.deepEqual(targetStatus({...base, state: 'exited', reconnectable: true, harnessSessionId: 's'}), {label: 'Ended · resume available', live: false, resumable: true});
  assert.deepEqual(targetStatus({...base, state: 'exited', reconnectable: true}), {label: 'Ended · cannot resume', live: false, resumable: false}, 'no provider session id: no resume');
  assert.deepEqual(targetStatus({...base, state: 'failed'}), {label: 'Failed · cannot resume', live: false, resumable: false});
  assert.equal(targetStatus({...base, state: 'waiting'}).label, 'Waiting for you');
  assert.equal(targetStatus({...base, level: 'observed', state: 'running'}).label, 'Observed only');
  // /claude starts on the resumable target; /claude new on a fresh one, with the resumable target still listed.
  const ended = {...base, state: 'exited', reconnectable: true, harnessSessionId: 's'};
  const rows = launcherRows({provider: 'claude', selected: 0}, [ended], []);
  assert.equal(rows[initialSelection(rows, 'open')]?.kind, 'target');
  assert.equal(rows[initialSelection(rows, 'new')]?.kind, 'new');
  assert.ok(rows.some(row => row.kind === 'target'), '/claude new does not hide existing work');
});
