import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {detectAgentCommand, detectAgentProcess} from '../src/agents/agents.js';
import {addRun, AgentActivityStore, dayKey, emptyActivity, MAX_DAYS, MAX_RECENT, migrateActivity} from '../src/agents/AgentActivityStore.js';
import {agentCompletionText, heatLevel, renderAgentStats, renderHeatmap} from '../src/agents/AgentStatsView.js';
import {describeArchivedRow, describeLiveRow, liveRowAgent, liveRowState} from '../src/sessions/ResumeBrowser.js';
import {stripAnsi} from '../src/util/text.js';
import type {SessionInfo} from '../src/session/SessionProtocol.js';

test('detection: only program identity and bounded runner patterns identify Claude Code and Codex', () => {
  const id = (command: string) => detectAgentCommand(command)?.id;
  assert.equal(id('claude'), 'claude');
  assert.equal(id('/opt/homebrew/bin/claude --continue'), 'claude');
  assert.equal(id('FOO=1 BAR=2 claude -p "fix the bug"'), 'claude');
  assert.equal(id('command claude'), 'claude');
  assert.equal(id('time codex exec --full-auto'), 'codex');
  assert.equal(id('npx @openai/codex@latest'), 'codex');
  assert.equal(id('npx -y @anthropic-ai/claude-code'), 'claude');
  assert.equal(id('pnpm dlx @openai/codex'), 'codex');
  assert.equal(id('npm exec @anthropic-ai/claude-code'), 'claude');
  assert.equal(id('bunx @openai/codex'), 'codex');
  for (const negative of ['echo claude', 'git commit -m codex', 'claudes', 'cat claude.md', 'npx cowsay claude', 'grep -r codex .', 'ls | claude', 'npx -- claude']) {
    assert.equal(id(negative), undefined, negative);
  }
  assert.equal(detectAgentProcess('/usr/local/bin/codex')?.id, 'codex');
  assert.equal(detectAgentProcess('node'), undefined, 'a generic runtime is never guessed to be an agent');
});

function scratch(): string { return mkdtempSync(join(tmpdir(), 'nmsh-agents-')); }

test('store: local schema, dedupe, bounded storage, and no content fields', () => {
  const data = emptyActivity();
  const day = Date.UTC(2026, 0, 10, 12);
  assert.equal(addRun(data, {agent: 'claude', startedAt: day, durationMs: 60_000, exitCode: 0}, 's:1'), true);
  assert.equal(addRun(data, {agent: 'claude', startedAt: day, durationMs: 60_000, exitCode: 0}, 's:1'), false, 'a replayed completion is counted once');
  assert.equal(data.agents.claude?.runs, 1);
  for (let index = 0; index < MAX_DAYS + 30; index += 1) addRun(data, {agent: 'codex', startedAt: day + index * 86_400_000, durationMs: 1000}, `c:${index}`);
  assert.equal(Object.keys(data.agents.codex!.days).length, MAX_DAYS);
  assert.equal(data.recent.length, MAX_RECENT);
  assert.ok(data.seen.length <= MAX_RECENT * 2);
  const allowed = new Set(['version', 'agents', 'recent', 'seen', 'claude', 'codex', 'durationMs', 'runs', 'days', 'lastUsedAt', 'agent', 'startedAt', 'exitCode']);
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(key) && !/^\d+$/u.test(key)) assert.ok(allowed.has(key), `unexpected stored field ${key}`);
      walk(child);
    }
  };
  walk(data);
});

test('store: migration keeps valid data, drops invalid fields, refuses newer schemas, recovers corruption, and resets', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'agent-activity.json');
    const migrated = migrateActivity({version: 1, agents: {claude: {durationMs: 5, runs: 1, days: {'2026-01-01': 5, bogus: 3}}, gpt: {}},
      recent: [{agent: 'claude', startedAt: 1, durationMs: 5, prompt: 'never kept'}], seen: ['k']});
    assert.ok(migrated && migrated !== 'newer');
    assert.deepEqual(migrated.agents.claude?.days, {'2026-01-01': 5});
    assert.equal('gpt' in migrated.agents, false);
    assert.deepEqual(migrated.recent[0], {agent: 'claude', startedAt: 1, durationMs: 5});

    writeFileSync(path, JSON.stringify({version: 99, agents: {}}));
    const store = new AgentActivityStore(path);
    assert.equal(store.record({agent: 'claude', startedAt: 1, durationMs: 1}, 'x'), false);
    assert.equal(store.state, 'newer-version');
    assert.match(readFileSync(path, 'utf8'), /"version":99/u, 'a newer file is never overwritten');

    writeFileSync(path, '{not json');
    assert.equal(store.record({agent: 'codex', startedAt: 1, durationMs: 1}, 'y'), true);
    assert.ok(readdirSync(dir).some(name => name.startsWith('agent-activity.json.corrupt-')), 'unreadable data is kept for inspection');
    assert.equal(store.load().agents.codex?.runs, 1);

    store.reset();
    assert.equal(existsSync(path), false);
    assert.equal(store.load().agents.codex, undefined);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('views: heatmap levels are deterministic, NO_COLOR keeps density glyphs, completion wording uses status vocabulary', () => {
  assert.deepEqual([0, 1, 25, 26, 50, 100].map(ms => heatLevel(ms, 100)), [0, 1, 1, 2, 2, 4]);
  const now = new Date(2026, 9, 3, 12).getTime();
  const days = new Map([[dayKey(now), 100], [dayKey(now - 86_400_000), 30]]);
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const grid = renderHeatmap(days, now, 8, {red: 1, green: 2, blue: 3});
    assert.equal(grid.length, 7);
    assert.ok(grid.every(row => !row.includes('\u001b[38')), 'no color escapes under NO_COLOR');
    assert.ok(grid.join('').includes('█') && grid.join('').includes('▒'));
    const data = emptyActivity();
    addRun(data, {agent: 'claude', startedAt: now - 3_600_000, durationMs: 18 * 60_000 + 42_000, exitCode: 0}, 'a');
    const view = renderAgentStats(data, {now, columns: 80, enabled: true, loadState: 'ok'}).map(stripAnsi).join('\n');
    assert.match(view, /Claude Code\s+18m 42s\s+1 run · 1 day used/u);
    assert.match(view, /local only/u);
    assert.match(view, /\/agents reset/u);
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = previous;
  }
  assert.equal(agentCompletionText('claude', 18 * 60_000 + 42_000, 0, false), 'Worked with Claude for 18m 42s');
  assert.equal(agentCompletionText('codex', 7 * 60_000 + 11_000, 1, false), 'Codex exited 1 after 7m 11s');
  assert.equal(agentCompletionText('codex', 5000, 130, true), 'Stopped Codex after 5.0s');
});

test('/resume rows: factual state, agent only when proven, archived duration', () => {
  const now = 1_000_000;
  const base: SessionInfo = {id: 'a', pid: 1, state: 'detached', cwd: '/w/project', createdAt: now - 3_600_000};
  assert.equal(liveRowState({...base, running: 'claude', runningSince: now - 60_000, attentionSince: now - 1000}, now), 'attention');
  assert.equal(liveRowState({...base, running: 'make', runningSince: now - 60_000, lastOutputAt: now - 500}, now), 'active');
  assert.equal(liveRowState({...base, running: 'make', runningSince: now - 60_000, lastOutputAt: now - 60_000}, now), 'running');
  assert.equal(liveRowState({...base, idleSince: now, lastExit: 2}, now), 'failed');
  assert.equal(liveRowState({...base, idleSince: now, lastExit: 0, notice: {sessionId: 'a', kind: 'completed', at: now}}, now), 'completed');
  assert.equal(liveRowState({...base, idleSince: now, lastExit: 130}, now), 'idle', 'Ctrl+C is not a failure');
  assert.equal(liveRowAgent({...base, running: 'claude --resume'})?.id, 'claude');
  assert.equal(liveRowAgent({...base, running: 'node app.js', process: 'node'}), undefined);
  assert.match(describeLiveRow({...base, running: 'npm test', runningSince: now - 120_000}, now), /^\/w\/project · npm test · 2m · detached · age 1h/u);
  assert.match(describeArchivedRow({id: 'j', createdAt: new Date(now - 7_200_000).toISOString(), endedAt: new Date(now - 3_600_000).toISOString(),
    commandCount: 1, startCwd: '/w', finalCwd: '/w', project: 'p', pinned: false, journaled: true}, now), /^p · \/w · 1 command · ran 1h/u);
});
