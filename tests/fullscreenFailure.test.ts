import test from 'node:test';
import assert from 'node:assert/strict';
import {fullscreenFailure} from './helpers/fullscreenFailure.js';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

test('fullscreen failure observation reads both owned PTYs without resizing or submitting input', async () => {
  const sandbox = new LiveSandbox();
  try {
    const frontend = sandbox.launch([], {cols: 90, rows: 33});
    await frontend.waitFor(/❯/);
    await until(async () => (await sandbox.sessions())[0]?.lastExit !== undefined, 15000, 'authenticated startup');
    const {id, pid} = (await sandbox.sessions())[0]!;
    const observation = await fullscreenFailure(sandbox, id, pid, frontend);
    assert.ok('session' in observation, JSON.stringify(observation));
    assert.equal(observation.session.id, id);
    assert.equal(observation.session.pid, pid);
    assert.equal(observation.session.runningPresent, false);
    assert.ok('size' in observation.frontend, JSON.stringify(observation.frontend));
    assert.equal(observation.frontend.size.status, 0);
    assert.equal(observation.frontend.size.output, '33 90');
    assert.ok('size' in observation.backend, JSON.stringify(observation.backend));
    assert.equal(observation.backend.size.status, 0);
    assert.match(observation.backend.size.output ?? '', /^\d+ 90$/);
    assert.notEqual(observation.backend.tty, observation.frontend.tty, 'inner and outer PTYs are distinct');
    assert.ok(observation.processes.some(value => value.pid === pid));
    assert.ok(observation.children.length > 0, 'failed or empty child queries retain their status');
    const again = await fullscreenFailure(sandbox, id, pid, frontend);
    assert.ok('session' in again, JSON.stringify(again));
    assert.deepEqual(again.backend, observation.backend);
    assert.deepEqual(again.frontend, observation.frontend);
    assert.equal(again.session.runningPresent, false);
    await frontend.run('echo PROBE-UNCHANGED', /PROBE-UNCHANGED/);
  } finally {
    await sandbox.dispose();
  }
});

test('fullscreen failure observation refuses a mismatched live identity before OS probes', async () => {
  let calls = 0;
  const sandbox = {sessions: async () => { calls++; return [{id: 'owned', pid: process.pid}]; }};
  // Neither mismatch may inspect the supplied process or dereference a frontend.
  const fakeFrontend = undefined as unknown as Parameters<typeof fullscreenFailure>[3];
  assert.deepEqual(await fullscreenFailure(sandbox as unknown as LiveSandbox, 'other', process.pid, fakeFrontend),
    {unavailable: 'live session does not match the owned backend'});
  assert.deepEqual(await fullscreenFailure(sandbox as unknown as LiveSandbox, 'owned', 1, fakeFrontend),
    {unavailable: 'live session does not match the owned backend'});
  assert.equal(calls, 2);
});
