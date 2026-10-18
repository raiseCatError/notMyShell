import test from 'node:test';
import assert from 'node:assert/strict';
import {explainModules, moduleTimings} from '../src/prompt/moduleReport.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';

test('/modules explain and /modules timings parse as reports; plain /modules opens the manager', () => {
  assert.deepEqual(parseSlashCommand('/modules explain'), {kind: 'modules', report: 'explain'});
  assert.deepEqual(parseSlashCommand('/modules timings'), {kind: 'modules', report: 'timings'});
  assert.deepEqual(parseSlashCommand('/modules'), {kind: 'modules'});
  assert.notEqual(parseSlashCommand('/modules nonsense')?.kind, 'modules');
});

test('explain: where each module goes, whether it shows and why, and its sources\' states; reading snapshots only', () => {
  const configuration = normalizePromptConfiguration({});
  const asked: string[] = [];
  const now = 100_000;
  const rows = explainModules(configuration.modules, {
    status: id => { asked.push(id); return id === 'runtime.deno' ? {state: 'fresh', collectedAt: now - 3000, durationMs: 4.2, evidence: '.dvmrc\u001b[2J'} : {state: 'idle'}; },
    conditionMet: () => true,
  }, configuration, now);
  const text = rows.join('\n');
  assert.ok(rows.length > configuration.modules.length / 2, 'one or two rows per module');
  assert.match(text, /\(gitBranch\) · Main Prompt · /u);
  assert.match(text, /\(nmsh\.project:deno\) · Hidden · turned off in Modules\n  reads runtime\.deno fresh 3s ago, took 4 ms \(\.dvmrc \[2J\)/u, 'evidence is drawn inert');
  assert.match(text, /\(nmsh\.project:bun\) · Hidden · turned off in Modules\n  reads runtime\.bun not collected/u);
  assert.doesNotMatch(text, /\u001b/u);
  assert.match(rows.at(-1)!, /collected nothing/u);
  assert.ok(asked.length > 0 && asked.every(id => /^[a-z]/u.test(id)), 'only the status snapshot was consulted');
  const off = explainModules([{...configuration.modules[0]!, visible: false}], {}, configuration, now);
  assert.match(off[0]!, /turned off in Modules/u);
  assert.match(explainModules([{...configuration.modules[0]!, id: 'not.installed' as never}], {}, configuration)[0]!, /its Context Pack is not installed/u);
});

test('timings: the slowest last collections first, bounded, honest when nothing was measured', () => {
  assert.deepEqual(moduleTimings(() => undefined), ['No module data has been collected in this window yet.']);
  const durations: Record<string, number> = {'runtime.node': 40, 'vcs.git': 3, 'cloud.aws': 120, 'system.os': 0.4};
  const rows = moduleTimings(id => durations[id] === undefined ? {state: 'idle'} : {state: 'fresh', collectedAt: 0, durationMs: durations[id]!}, 5000, 3);
  assert.match(rows[0]!, /^ +120 ms  cloud\.aws · fresh 5s ago$/u);
  assert.match(rows[1]!, /^ +40 ms  runtime\.node/u);
  assert.match(rows[2]!, /^ +3 ms  vcs\.git/u);
  assert.match(rows[3]!, /^… 1 faster ones not listed$/u);
  assert.match(rows.at(-1)!, /excluding time queued; nothing was collected/u);
});
