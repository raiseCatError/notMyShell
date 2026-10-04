import test from 'node:test';
import assert from 'node:assert/strict';
import {assignSignature, sessionDisplayName, signatureAccent, SIGNATURES} from '../src/session/signatures.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {describeLiveRow} from '../src/sessions/ResumeBrowser.js';
import {AgentSessions} from '../src/agents/sessions/manager.js';
import {signatureChip} from '../src/agents/sessions/AgentViews.js';
import {stripAnsi} from '../src/util/text.js';

test('vocabulary: small, familiar, and colors never the only cue', () => {
  assert.ok(SIGNATURES.length >= 16 && SIGNATURES.length <= 32);
  assert.ok(SIGNATURES.every(item => /^[A-Z][a-z]+$/u.test(item.name)), 'single familiar words');
  assert.ok(SIGNATURES.some(item => item.name === 'Mango') && SIGNATURES.some(item => item.name === 'Autumn'));
});

test('assignment: deterministic per session, unique among live sessions, suffix only when exhausted', () => {
  assert.equal(assignSignature('session-a', []), assignSignature('session-a', []));
  const taken: string[] = [];
  for (let index = 0; index < SIGNATURES.length; index += 1) taken.push(assignSignature(`id-${index}`, taken));
  assert.equal(new Set(taken).size, SIGNATURES.length, 'every live session distinct');
  const overflow = assignSignature('id-overflow', taken);
  assert.match(overflow, /^[A-Z][a-z]+ 2$/u, 'a small suffix, never a random tag');
  assert.deepEqual(signatureAccent(overflow), signatureAccent(overflow.replace(/ 2$/u, '')));
});

test('display: a renamed session keeps its name; the signature is secondary; /rename parses', () => {
  assert.equal(sessionDisplayName({name: 'API work', signature: 'Plum'}, 'Session 1'), 'API work');
  assert.equal(sessionDisplayName({signature: 'Plum'}, 'Session 1'), 'Plum');
  assert.equal(sessionDisplayName({}, 'Session 1'), 'Session 1');
  assert.deepEqual(parseSlashCommand('/rename API work'), {kind: 'rename', name: 'API work'});
  assert.deepEqual(parseSlashCommand('/rename'), {kind: 'rename', name: ''});
  const row = describeLiveRow({id: 'x', pid: 1, state: 'detached', cwd: '/tmp', createdAt: 0, signature: 'Mango'}, 1000);
  assert.match(row, /^Mango · /u);
});

test('agent sessions get distinct signatures; the chip degrades to the plain name', () => {
  const agents = new AgentSessions({resolve: () => undefined, scan: async () => [{pid: 11, harness: 'claude', startedAt: 0}, {pid: 12, harness: 'claude', startedAt: 0}], now: () => 0});
  return agents.discover().then(() => {
    const names = agents.sessions.map(session => session.signature);
    assert.equal(names.length, 2);
    assert.ok(names.every(Boolean) && names[0] !== names[1]);
    assert.equal(stripAnsi(signatureChip('Plum')), 'Plum ');
    assert.equal(signatureChip(undefined), '');
  });
});
