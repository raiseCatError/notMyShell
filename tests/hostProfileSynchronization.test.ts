import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Run the real profile test with an event-driven completion gate. Without its STATE
// completion wait, SIZE is correctly held for approval and the child test fails.
test('host profile probes wait for frontend completion and verify their own journal geometry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'host-sync-'));
  const tracePath = join(root, 'trace.jsonl');
  const previous = process.env.NMSH_HOST_COMPLETION_TRACE;
  process.env.NMSH_HOST_COMPLETION_TRACE = tracePath;
  try {
    const {runTestFiles} = await import(new URL('../scripts/test.mjs', import.meta.url).href);
    const result = await runTestFiles(['tests/hostProfiles.test.ts'], [
      '--import=./tests/fixtures/hostProfileCompletionGate.mjs',
      '--test-name-pattern=reattaching across profiles',
      // Keep teardown margin below the outer canonical test's existing 120-second budget.
      '--test-timeout=60000',
    ]);
    assert.equal(result.code, 0, 'the real profile test passes with delayed completion delivery');
    const rows = (await readFile(tracePath, 'utf8')).trim().split('\n')
      .map(line => JSON.parse(line) as {event: string; profile?: string});
    assert.deepEqual(rows.filter(row => row.event === 'attachment').map(row => row.profile),
      ['ghostty', 'Apple_Terminal', 'kitty', 'iTerm.app', 'WezTerm', 'zed']);
    assert.equal(rows.filter(row => row.event === 'prompt.held').length, 5, 'each reattachment exercised the gate');
    assert.equal(rows.filter(row => row.event === 'completion-batch.released').length, 5);
    assert.equal(rows.some(row => row.event === 'size.entered.before.completion'), false,
      'no geometry probe was submitted before the prior frontend completion');
  } catch (error) {
    // Preserve only fixture event metadata in hosted logs before removing our private trace.
    console.error('Host completion gate trace:\n' + await readFile(tracePath, 'utf8').catch(() => '(unavailable)'));
    throw error;
  } finally {
    if (previous === undefined) delete process.env.NMSH_HOST_COMPLETION_TRACE;
    else process.env.NMSH_HOST_COMPLETION_TRACE = previous;
    await rm(root, {recursive: true, force: true});
  }
});
