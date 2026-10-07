import test from 'node:test';
import assert from 'node:assert/strict';
import {capabilityFacts, updateCapabilities} from '../src/agents/targets/capabilities.js';
import {providerRoute, bareProviderRoute} from '../src/agents/targets/commandRouting.js';

test('target capabilities are distinct from relationship and isolated by target', () => {
  const a = capabilityFacts('a', 'managed', 'claude');
  const b = capabilityFacts('b', 'managed', 'codex');
  assert.equal(a['message.send'].availability, 'unknown');
  assert.match(b['message.send'].reason!, /adapter/u);
  updateCapabilities(a, {kind: 'started', harnessSessionId: 's'}, 10);
  assert.equal(a['message.send'].availability, 'available');
  assert.equal(b['message.send'].availability, 'unavailable');
  assert.equal(a['context.status'].availability, 'unknown');
  assert.equal(a['tool.approve'].availability, 'unknown');
  assert.equal(a['message.send'].targetId, 'a');
});

for (const level of ['observed', 'attachable'] as const) test(`${level} has no inferred control capabilities`, () => {
  const facts = capabilityFacts('x', level, 'claude');
  updateCapabilities(facts, {kind: 'assistant', text: 'unexpected'}, 1);
  assert.equal(facts['conversation.read'].availability, 'unavailable');
  assert.equal(facts['message.send'].availability, 'unavailable');
  assert.ok(facts['message.send'].reason);
});

test('provider routing focuses one, picks many, and forces fresh new', () => {
  const sessions = [{id: 'a', harness: 'claude', cwd: '/p', level: 'managed', state: 'waiting'}, {id: 'b', harness: 'claude', cwd: '/q', level: 'managed', state: 'working'}] as any;
  assert.deepEqual(providerRoute('claude', 'open', '/p', sessions), {kind: 'focus', targetId: 'a'});
  assert.deepEqual(providerRoute('claude', 'new', '/p', sessions), {kind: 'launch', provider: 'claude'});
  assert.deepEqual(providerRoute('claude', 'mods', '/p', sessions), {kind: 'mods', provider: 'claude'});
  assert.equal(providerRoute('claude', 'open', '/p', [...sessions, {...sessions[0], id: 'c'}]).kind, 'picker');
  assert.equal(providerRoute('codex', 'open', '/p', sessions).kind, 'launch');
});

test('bare routing fails closed on arguments, wrappers, aliases and unprobed providers', () => {
  assert.equal(bareProviderRoute('claude', {claude: 'executable'}, true), 'claude');
  for (const command of ['claude -p hi', 'codex', 'command claude', 'claude | cat', 'claude > out', 'X=1 claude', '/bin/claude', '"claude"']) assert.equal(bareProviderRoute(command, {claude: 'executable'}, true), undefined);
  assert.equal(bareProviderRoute('claude', {claude: 'alias'}, true), undefined);
  assert.equal(bareProviderRoute('claude', {}, true), undefined);
  assert.equal(bareProviderRoute('claude', {claude: 'executable'}, false), undefined);
});
