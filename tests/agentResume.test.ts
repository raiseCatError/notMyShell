import test from 'node:test';
import assert from 'node:assert/strict';
import {providerRoute} from '../src/agents/targets/commandRouting.js';
test('reconnectable ended managed targets route to their stable identity', () => {
  const target = {id: 'a', harness: 'claude', level: 'managed', state: 'exited', cwd: '/p', reconnectable: true, harnessSessionId: 'provider-session', profileId: 'profile-2'} as any;
  assert.deepEqual(providerRoute('claude', 'open', '/p', [target]), {kind: 'focus', targetId: 'a'});
  assert.deepEqual(providerRoute('claude', 'new', '/p', [target]), {kind: 'launch', provider: 'claude'});
});
