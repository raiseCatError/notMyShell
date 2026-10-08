import test from 'node:test';
import assert from 'node:assert/strict';
import {ModBroker, PortableInstance} from '../src/agents/mods/broker.js';
import {claudeInventory} from '../src/agents/mods/claudeDiscovery.js';
import {ModsController} from '../src/agents/mods/controller.js';
import {renderMods} from '../src/agents/mods/view.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';
import {capabilityFacts} from '../src/agents/targets/capabilities.js';
import {mkdtempSync, writeFileSync, existsSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverHooks} from '../src/agents/mods/inventory.js';

const descriptor = {id: 'context-meter', name: 'Context Meter', requested: ['context.status'], providers: ['claude', 'codex'], execution: 'inert'} as const;
const targets = [{id: 'a', provider: 'claude', capabilities: capabilityFacts('a', 'managed', 'claude'), context: {percent: 72, observedAt: 10}}, {id: 'b', provider: 'codex', capabilities: capabilityFacts('b', 'managed', 'codex'), context: {percent: 41, observedAt: 10}}];
targets.forEach(t => t.capabilities['context.status'].availability = 'available');

test('portable broker denies all privileges by default and never exposes provider internals', () => {
  const broker = new ModBroker(() => targets);
  const api = broker.bind(descriptor, 'a', '1', []);
  for (const permission of ['context.status', 'tool.approve', 'filesystem', 'network', 'process', 'secrets', 'targets.list']) assert.equal(api.request(permission as any).ok, false);
  assert.doesNotMatch(JSON.stringify(api), /SECRET|process.env/u);
  assert.deepEqual(Object.keys(api), ['identity', 'request']);
});

test('same mod has independent state, no other target visibility and explicit aggregation only', () => {
  const broker = new ModBroker(() => targets);
  const a = new PortableInstance(broker.bind(descriptor, 'a', '1', ['context.status']));
  const b = new PortableInstance(broker.bind(descriptor, 'b', '1', ['context.status']));
  assert.equal((a.api.request('context.status') as any).value.percent, 72);
  assert.equal((b.api.request('context.status') as any).value.percent, 41);
  a.setState({count: 1}); assert.deepEqual(b.state, {});
  assert.equal(a.api.request('targets.list').ok, false);
  const aggregate = broker.bind({...descriptor, requested: ['context.status', 'targets.aggregate']}, 'a', '2', ['targets.aggregate']);
  assert.equal((aggregate.request('targets.aggregate') as any).value.length, 2);
  a.update(() => {throw new Error('\x1b[31mfailed');});
  assert.match(a.error!, /failed/u); assert.equal(b.error, undefined);
  assert.equal(a.setState({huge: 'x'.repeat(70000)}), false);
});

test('provider approval fact never becomes portable approval authority', () => {
  targets[0]!.capabilities['tool.approve'].availability = 'available';
  const api = new ModBroker(() => targets).bind({...descriptor, requested: ['tool.approve'] as any}, 'a', '1', ['tool.approve'] as any);
  assert.equal(api.request('tool.approve' as any).ok, false);
});

test('native inventory retains scopes, provenance, enabled tri-state and collision-free identity', () => {
  const items = claudeInventory([{id: 'same', version: '1', scope: 'user', enabled: true, installPath: '/global'}, {id: 'same', scope: 'project', projectPath: '/p', enabled: false, installPath: '/project'}, {id: '\x1b[31mhostile', scope: 'user'}], '/p');
  assert.equal(items.length, 3); assert.equal(new Set(items.map(i => i.key)).size, 3);
  assert.deepEqual(items.map(i => i.enabled), ['yes', 'no', 'unknown']);
  assert.equal(items[0]!.installedBy, 'unknown');
  assert.equal(items[0]!.sandbox, 'No');
  assert.doesNotMatch(items[2]!.name, /\x1b/u);
  assert.equal(claudeInventory([{id: 'foreign', scope: 'project', projectPath: '/other'}], '/p').length, 0);
});

test('unified manager has local search, tabs, provider filters, details and deterministic selection', () => {
  const controller = new ModsController();
  controller.setInventory(claudeInventory([{id: 'alpha', scope: 'user'}, {id: 'beta', scope: 'user'}], '/p'));
  controller.dispatch({kind: 'Search'}); controller.dispatch({kind: 'TypeSearch', text: 'beta'});
  assert.equal(controller.rows[0]!.id, 'beta');
  controller.dispatch({kind: 'TypeSearch', text: 'nothing'});
  assert.equal(controller.rows.length, 0);
  controller.dispatch({kind: 'Back'}); assert.equal(controller.owner, 'PANEL');
  controller.dispatch({kind: 'SelectTab', direction: 1}); assert.equal(controller.tab, 'Portable');
  controller.setProvider('codex'); assert.equal(controller.rows.length, 0);
  controller.setProvider('claude'); controller.tab = 'All';
  controller.dispatch({kind: 'ActivateAction'}); assert.equal(controller.details, true);
});

for (const columns of [30, 40, 50, 80, 120, 200]) test(`mod risk and provenance fit ${columns} columns`, () => {
  const c = new ModsController(); c.setInventory(claudeInventory([{id: 'native-long-name-界'.repeat(5), scope: 'user', enabled: true}], '/p'));
  const lines = renderMods(c, columns, 24);
  assert.ok(lines.every(line => displayWidth(line) <= columns));
  // The selected entry's execution facts stay visible while browsing, wrapped (never cut) at narrow widths.
  const browsing = stripAnsi(lines.join('\n')).replace(/\s+/gu, ' ');
  assert.match(browsing, /runs inside Claude Code/u);
  assert.match(browsing, /no NMSh sandbox/u);
  assert.match(browsing, /not managed by NMSh/u);
});

test('refresh failure preserves inventory with stale/error state', async () => {
  const c = new ModsController(); c.setInventory(claudeInventory([{id: 'kept', scope: 'user'}], '/p'));
  await c.refresh(async () => {throw new Error('offline');});
  assert.equal(c.rows[0]!.id, 'kept'); assert.match(c.message!, /offline/u); assert.equal(c.stale, true);
});

test('passive external hook inventory never executes declarations and refuses symlinks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-mod-test-'));
  try {
    const path = join(root, 'settings.json'); const marker = join(root, 'must-not-exist');
    writeFileSync(path, JSON.stringify({hooks: {SessionStart: [{hooks: [{type: 'command', command: `touch ${marker}`}]}]}}));
    const inventory = await discoverHooks([{path, scope: 'project'}]);
    assert.equal(inventory[0]!.enabled, 'unknown'); assert.equal(inventory[0]!.managed, false);
    assert.equal(existsSync(marker), false);
    const link = join(root, 'link.json'); symlinkSync(path, link);
    await assert.rejects(discoverHooks([{path: link, scope: 'global'}]), /symbolic/u);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('long details remain keyboard scrollable', () => {
  const c = new ModsController(); c.setInventory(claudeInventory([{id: 'a', scope: 'user', installPath: 'path/'.repeat(100)}], '/p'));
  c.dispatch({kind: 'ActivateAction'});
  c.dispatch({kind: 'Scroll', rows: 12});
  assert.equal(c.scroll, 12);
  c.dispatch({kind: 'Back'}); assert.equal(c.details, false);
});
