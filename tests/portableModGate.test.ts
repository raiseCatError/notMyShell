import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ModBroker, type ModPermission, type PortableDescriptor, type TargetSnapshot} from '../src/agents/mods/broker.js';
import {builtinModInventory, CONTEXT_METER} from '../src/agents/mods/model.js';

/**
 * The executable Portable Mod gate (#341, docs/design/portable-mod-isolation.md). These tests keep execution disabled
 * until enforced isolation exists: lifting the block means changing them together with the isolation, its review and
 * its adversarial suite.
 */

const MODS = join(import.meta.dirname, '..', 'src', 'agents', 'mods');
const LOADERS: ReadonlyArray<[RegExp, string]> = [
  [/\bimport\s*\(/u, 'dynamic import()'], [/\brequire\s*\(/u, 'require()'], [/\bnew\s+Function\b/u, 'new Function'], [/\beval\s*\(/u, 'eval'],
  [/['"]node:vm['"]|['"]vm['"]/u, 'node:vm'], [/worker_threads/u, 'worker threads'], [/WebAssembly\.(?:instantiate|compile|Module|Instance)/u, 'WebAssembly'],
];

test('no code-loading path exists under src/agents/mods', () => {
  const files = readdirSync(MODS).filter(name => name.endsWith('.ts'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = readFileSync(join(MODS, file), 'utf8');
    for (const [pattern, name] of LOADERS) assert.doesNotMatch(source, pattern, `${file} must not use ${name} until #341's isolation gate passes`);
    // The one process use is the provider's own plugin listing: inventory of provider-native code, never running it in NMSh.
    if (/child_process/u.test(source)) {
      assert.equal(file, 'claudeDiscovery.ts', `${file} spawns processes`);
      assert.match(source, /\['plugin', 'list', '--json'\]/u);
    }
  }
});

test('Portable descriptors are inert and the inventory says they are not executable', () => {
  const execution: PortableDescriptor['execution'] = CONTEXT_METER.execution;
  assert.equal(execution, 'inert');
  for (const entry of builtinModInventory().filter(item => item.kind === 'Portable')) {
    assert.equal(entry.sandbox, 'Not executable');
    assert.match(entry.executesInside, /inert/u);
    assert.equal(entry.enabled, 'no');
  }
});

test('the broker is read-only and deny-by-default: only requested, granted, read permissions answer', () => {
  const target: TargetSnapshot = {id: 't1', provider: 'claude', state: 'idle', context: {percent: 40, observedAt: 1},
    capabilities: {'context.status': {availability: 'available'}} as unknown as TargetSnapshot['capabilities']};
  const other: TargetSnapshot = {...target, id: 't2'};
  const broker = new ModBroker(() => [target, other]);
  const everything: ModPermission[] = ['context.status', 'session.status', 'conversation.read', 'tool.observe', 'approval.observe', 'approval.decorate', 'approval.explain', 'targets.list', 'targets.aggregate'];
  const descriptor: PortableDescriptor = {id: 'probe', name: 'Probe', requested: everything, providers: ['claude'], execution: 'inert'};
  const api = broker.bind(descriptor, 't1', 'i1', everything);
  // Writes, approvals and conversation content are never granted, whatever is requested and granted.
  for (const permission of ['conversation.read', 'tool.observe', 'approval.observe', 'approval.decorate', 'approval.explain'] as ModPermission[]) {
    assert.equal(api.request(permission).ok, false, permission);
  }
  assert.deepEqual(api.request('context.status'), {ok: true, value: {targetId: 't1', percent: 40, observedAt: 1}});
  // Not requested by the descriptor: denied even if granted.
  const narrow = broker.bind({...descriptor, requested: ['context.status']}, 't1', 'i2', everything);
  assert.equal(narrow.request('session.status').ok, false);
  // Not granted: denied even if requested.
  assert.deepEqual(broker.bind(descriptor, 't1', 'i3', []).request('context.status'), {ok: false, reason: 'Capability not granted (deny by default)'});
  // A provider the descriptor does not apply to: denied.
  assert.equal(broker.bind({...descriptor, providers: ['codex']}, 't1', 'i4', everything).request('context.status').ok, false);
  // The API carries nothing but identity and request; it cannot be extended.
  assert.deepEqual(Object.keys(api).sort(), ['identity', 'request']);
  assert.ok(Object.isFrozen(api) && Object.isFrozen(api.identity));
  assert.throws(() => { (api as unknown as Record<string, unknown>).provider = {}; });
});
