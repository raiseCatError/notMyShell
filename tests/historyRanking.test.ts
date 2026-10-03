import test from 'node:test';
import assert from 'node:assert/strict';
import {HistoryIndex, historyId, historyPredicate, journalHistory, rankHistory, type HistoryEntry} from '../src/shell/HistoryIndex.js';
import type {CompletedCommand} from '../src/output/OutputBuffer.js';

const DAY = 86_400_000;
const now = 100 * DAY;
let serial = 0;
const entry = (command: string, extra: Partial<HistoryEntry> = {}): HistoryEntry =>
  ({id: historyId('nmsh', String(serial++)), source: 'nmsh', command, at: now - DAY, ...extra});

test('ranking prefers this directory, project and session, then frequency and recency; failures sink', () => {
  const entries = [
    entry('make deploy', {cwd: '/elsewhere', at: now - 1000}),
    entry('make test', {cwd: '/repo', project: 'repo', at: now - 5 * DAY}),
    entry('make lint', {cwd: '/other', project: 'repo', at: now - 5 * DAY}),
    entry('make broken', {cwd: '/repo', exitCode: 2, at: now - 5 * DAY}),
    entry('make broken', {cwd: '/repo', exitCode: 2, at: now - 5 * DAY}),
  ];
  const ranked = rankHistory(entries, 'make', {cwd: '/repo', project: 'repo', now});
  assert.equal(ranked[0]!.command, 'make test', 'same directory and project, and it succeeded');
  assert.ok(ranked.findIndex(item => item.command === 'make broken') > 0, 'repeated failures do not win on frequency alone');
  assert.equal(ranked.filter(item => item.command === 'make broken').length, 1, 'identical commands collapse');
  assert.equal(ranked.find(item => item.command === 'make broken')!.count, 2);
  // Deterministic: same input, same order.
  assert.deepEqual(rankHistory(entries, 'make', {cwd: '/repo', project: 'repo', now}).map(item => item.command), ranked.map(item => item.command));
  const session = rankHistory([entry('ls -la', {session: 'a', at: now - DAY}), entry('ls -lh', {session: 'b', at: now - DAY})], 'ls', {session: 'b', now});
  assert.equal(session[0]!.command, 'ls -lh');
  const prefix = rankHistory([entry('git status', {at: now - 2 * DAY}), entry('tig status', {at: now - DAY})], 'git', {now});
  assert.equal(prefix[0]!.command, 'git status', 'a prefix match outranks a slightly newer substring match');
});

test('ranked search keeps privacy rules, deletions and agent/source filters', async () => {
  const index = new HistoryIndex();
  index.add(entry(' secret-leading-space'));
  index.add(entry('claude --resume', {agent: 'claude'}));
  index.add(entry('npx @openai/codex'));
  index.add(entry('echo zsh-only', {source: 'zsh'}));
  const doomed = entry('rm -rf build');
  index.add(doomed);
  await index.delete(doomed.id);
  const all = await index.searchRanked('', {now});
  assert.ok(!all.some(item => item.command.includes('secret')), 'private commands never enter the index');
  assert.ok(!all.some(item => item.command === 'rm -rf build'), 'deleted commands stay deleted');
  assert.deepEqual((await index.searchRanked('agent:codex', {now})).map(item => item.command), ['npx @openai/codex'], 'agent identity from the program word');
  assert.deepEqual((await index.searchRanked('source:zsh', {now})).map(item => item.command), ['echo zsh-only']);
  assert.equal(historyPredicate('agent:')(entry('claude')), false, 'empty filters match nothing');
});

test('journal entries carry factual agent identity and never private commands', () => {
  const record = {command: 'claude -p "do the thing"', startId: 1, historyEligible: true, exitCode: 0, startedAt: 1, durationMs: 5} as unknown as CompletedCommand;
  assert.equal(journalHistory(record, 's')?.agent, 'claude');
  assert.equal(journalHistory({...record, historyEligible: false} as CompletedCommand, 's'), undefined);
});

test('ranked search stays interactive on a 100k-entry history', async () => {
  const index = new HistoryIndex();
  for (let position = 0; position < 100_000; position += 1) {
    index.add({id: historyId('zsh', String(position)), source: 'zsh', command: `cmd-${position % 3000} --flag ${position % 7}`, at: position * 1000,
      cwd: position % 2 ? '/a' : '/b'});
  }
  index.all();
  const started = performance.now();
  for (let round = 0; round < 10; round += 1) await index.searchRanked(`cmd-${round}`, {cwd: '/a', now: 1e9});
  const perQuery = (performance.now() - started) / 10;
  assert.ok(perQuery < 250, `ranked query took ${perQuery.toFixed(1)} ms`);
});
