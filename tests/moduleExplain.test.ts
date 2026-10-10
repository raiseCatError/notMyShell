import test from 'node:test';
import assert from 'node:assert/strict';
import {contextEngineCheck} from '../src/doctor/doctor.js';
import {whyText} from '../src/prompt/ModulesPanel.js';

const module = (overrides: Record<string, unknown> = {}) => ({id: 'x', visible: true, condition: 'always', ...overrides}) as Parameters<typeof whyText>[0];

test('"Why" says in one sentence why a module is or is not on screen', () => {
  assert.match(whyText(module({visible: false}), 'contextRail', []), /turned off/u);
  assert.match(whyText(module(), 'hidden', []), /routed to Hidden/u);
  assert.match(whyText(module(), 'contextRail', [{state: 'timeout'}]), /timed out/u);
  assert.match(whyText(module(), 'contextRail', [{state: 'failed', error: 'denied'}]), /could not be read \(denied\)/u);
  assert.match(whyText(module(), 'contextRail', [{state: 'absent'}, {state: 'absent'}]), /nothing for it to show/u);
  assert.match(whyText(module({condition: 'onCommand'}), 'contextRail', [{state: 'idle'}], ['go', 'gofmt']), /after a command that uses it \(go, gofmt…\)/u);
  assert.match(whyText(module(), 'contextRail', [{state: 'pending'}]), /being collected/u);
  assert.match(whyText(module(), 'contextRail', [{state: 'fresh'}]), /conditions are met/u);
});

test('/doctor reports prompt-data health from the engine counters, and only complains with enough evidence', () => {
  const quiet = {started: 0, completed: 0, cancelled: 0, timedOut: 0, failed: 0, cacheHits: 0, coalesced: 0};
  assert.equal(contextEngineCheck(quiet).state, 'info');
  assert.equal(contextEngineCheck({...quiet, started: 30, completed: 29, timedOut: 1, cacheHits: 80}).state, 'ok');
  assert.equal(contextEngineCheck({...quiet, started: 4, completed: 1, timedOut: 3}).state, 'ok', 'a few samples prove nothing');
  const bad = contextEngineCheck({...quiet, started: 40, completed: 20, timedOut: 15, failed: 5});
  assert.equal(bad.state, 'attention');
  assert.match(bad.detail ?? '', /15 timed out · 5 failed/u);
});
