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

import {newFitReport} from '../src/prompt/fitReport.js';
import {buildContextRail} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, DEFAULT_STATUS_STRIP} from '../src/prompt/configuration.js';
import {renderStatusStrip} from '../src/status/StatusStrip.js';

test('the Status Strip reports which routed modules its width fitting shortened or left out', () => {
  const settings = {...DEFAULT_STATUS_STRIP, enabled: true, clock: false, cpu: false, ram: false, uptime: false, battery: false};
  const modules = [
    {id: 'gitBranch', text: 'feature/a-rather-long-branch-name', priority: 90, compact: ['feature/a-r…']},
    {id: 'nodeVersion', text: 'node 22.11.0', priority: 40},
    {id: 'time', text: '06:44:12 local time', priority: 10},
  ];
  const wide = newFitReport();
  renderStatusStrip(settings, {}, 160, undefined, undefined, modules, wide);
  assert.deepEqual([...wide.dropped, ...wide.compacted], [], 'everything fits: nothing to explain');
  const narrow = newFitReport();
  renderStatusStrip(settings, {}, 36, undefined, undefined, modules, narrow);
  assert.ok(narrow.dropped.has('time') && !narrow.dropped.has('gitBranch'), 'the lowest priority goes first');
  assert.ok(narrow.compacted.has('gitBranch'), 'a narrower form is used before anything with a higher priority drops');
  const tiny = newFitReport();
  renderStatusStrip(settings, {}, 10, undefined, undefined, modules, tiny);
  assert.deepEqual([...tiny.dropped].sort(), ['gitBranch', 'nodeVersion', 'time'], 'a strip too narrow to show shows none of them');
});

test('the Context Rail reports the modules its priority fitting left out; explain says so in words', () => {
  const configuration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  configuration.contextRail.mode = 'always';
  configuration.modules = [{id: 'project', visible: true, condition: 'always', surface: 'contextRail'},
    {id: 'exitStatus', visible: true, condition: 'always', surface: 'contextRail'}];
  const context = {cwd: '/qa', project: 'A-project-name-that-is-long', exitStatus: 42};
  const wide = newFitReport();
  buildContextRail(context, 120, configuration, 0, wide);
  assert.equal(wide.dropped.size, 0);
  const narrow = newFitReport();
  buildContextRail(context, 12, configuration, 0, narrow);
  assert.ok(narrow.dropped.size + narrow.compacted.size > 0, 'something had to give at 12 columns');
  const fit = (id: string) => narrow.dropped.has(id) ? 'dropped' as const : narrow.compacted.has(id) ? 'compacted' as const : undefined;
  const rows = explainModules(configuration.modules, {conditionMet: () => true}, configuration, 0, fit).join('\n');
  for (const id of narrow.dropped) assert.match(rows, new RegExp(`\\(${id}\\) · Context Rail · .* · left out for width in the last frame`, 'u'));
  for (const id of narrow.compacted) assert.match(rows, new RegExp(`\\(${id}\\) · Context Rail · .* · shortened to fit the width in the last frame`, 'u'));
  const off = explainModules([{...configuration.modules[0]!, visible: false}], {}, configuration, 0, () => 'dropped');
  assert.doesNotMatch(off[0]!, /left out for width/u, 'a module turned off is explained as off, not as cut for width');
});
