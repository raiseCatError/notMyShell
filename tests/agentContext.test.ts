import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {agentScope, agentStatusDirectory, parseClaudeStatus, readAgentStatus, validAgentStatus, writeAgentStatus} from '../src/agents/agentStatus.js';
import {applyClaudeBridge, applyClaudeBridgeRemoval, inspectClaudeBridge, isBridgeValue, planClaudeBridge, planClaudeBridgeRemoval} from '../src/agents/claudeStatusLine.js';
import {runAgentStatusCommand} from '../src/cli/agentStatus.js';
import {claudeAgent} from '../src/context/capabilities/agents.js';
import {EMPTY_SHELL_ENVIRONMENT} from '../src/context/shellEnvironment.js';

/** The documented Claude Code status-line input (code.claude.com/docs/en/statusline), with hostile additions. */
const DOCUMENTED = {
  cwd: '/current/working/directory', session_id: 'abc123...', session_name: 'my-session', prompt_id: '550e8400-e29b-41d4-a716-446655440000',
  transcript_path: '/path/to/transcript.jsonl', model: {id: 'claude-opus-5-5', display_name: 'Opus'},
  workspace: {current_dir: '/current/working/directory', project_dir: '/original/project/directory', added_dirs: [], git_worktree: 'feature-xyz',
    repo: {host: 'github.com', owner: 'anthropics', name: 'claude-code'}},
  version: '2.1.90', output_style: {name: 'default'},
  cost: {total_cost_usd: 0.01234, total_duration_ms: 45000, total_api_duration_ms: 2300, total_lines_added: 156, total_lines_removed: 23},
  context_window: {total_input_tokens: 15500, total_output_tokens: 1200, context_window_size: 200000, used_percentage: 8, remaining_percentage: 92,
    current_usage: {input_tokens: 8500, output_tokens: 1200, cache_creation_input_tokens: 5000, cache_read_input_tokens: 2000}},
  exceeds_200k_tokens: false, fast_mode: false, effort: {level: 'high'}, thinking: {enabled: true},
  rate_limits: {five_hour: {used_percentage: 23.5, resets_at: 1738425600}, seven_day: {used_percentage: 41.2, resets_at: 1738857600},
    spend_limit: {used_percentage: 62.8, resets_at: 1740787200, used_usd: 314.12, limit_usd: 500, period: 'monthly'}},
  vim: {mode: 'NORMAL'}, agent: {name: 'security-reviewer'},
  pr: {number: 1234, url: 'https://github.com/anthropics/claude-code/pull/1234', review_state: 'pending'},
};

test('the bridge keeps an allowlisted, bounded record of Claude Code\'s documented status input', () => {
  const record = parseClaudeStatus(DOCUMENTED, 1_000)!;
  assert.deepEqual(record, {schema: 1, harness: 'claude', updatedAt: 1_000, session: record.session, model: 'Opus', modelId: 'claude-opus-5-5', effort: 'high', fast: false,
    contextPercent: 8, contextWindow: 200000, inputTokens: 15500, outputTokens: 1200, cacheReadTokens: 2000, cacheWriteTokens: 5000,
    fiveHourPercent: 23.5, fiveHourResetsAt: 1738425600000, sevenDayPercent: 41.2, sevenDayResetsAt: 1738857600000, spendPercent: 62.8, spendResetsAt: 1740787200000,
    durationMs: 45000, costUsd: 0.01234, linesAdded: 156, linesRemoved: 23, repo: 'anthropics/claude-code', worktree: 'feature-xyz', pr: 1234, prReview: 'pending',
    sessionName: 'my-session', agentName: 'security-reviewer', version: '2.1.90'});
  assert.match(record.session!, /^[a-f0-9]{12}$/u);
  const serialized = JSON.stringify(record);
  for (const absent of ['transcript', '/path/to', 'abc123', '550e8400', 'current/working', 'used_usd', '314.12', 'NORMAL']) assert.ok(!serialized.includes(absent), absent);
  const hostile = parseClaudeStatus({model: {display_name: 'Opus\u001b]0;pwned\u0007'}, effort: {level: 'x'.repeat(500)}, context_window: {used_percentage: 'NaN'},
    rate_limits: {five_hour: {used_percentage: Infinity, resets_at: -5}}, pr: {number: 1.5e99, review_state: 'merged; rm -rf /'}, version: ['2']}, 1)!;
  assert.deepEqual(hostile, {schema: 1, harness: 'claude', updatedAt: 1}, 'malformed and hostile fields are dropped individually');
  assert.equal(parseClaudeStatus('not an object'), undefined);
  assert.equal(validAgentStatus({...record, schema: 2}), undefined);
  assert.equal(agentScope({NMSH_SESSION_ID: 'abc-123'}), 'abc-123');
  assert.equal(agentScope({NMSH_SESSION_ID: '../../etc'}), 'external');
});

test('records are private files; this session wins, otherwise the latest report; unsafe files are ignored', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nmsh-agent-')));
  try {
    const directory = agentStatusDirectory({NMSH_RUNTIME_DIR: root});
    assert.equal(directory, join(root, 'agent-context'));
    await writeAgentStatus(directory, 'other', {...parseClaudeStatus(DOCUMENTED, 2_000)!, model: 'Sonnet'});
    let found = await readAgentStatus(directory, 'mine');
    assert.equal(found?.own, false, 'another session\'s report stands in (account-level limits)');
    assert.equal(found?.record.model, 'Sonnet');
    await writeAgentStatus(directory, 'mine', parseClaudeStatus(DOCUMENTED, 1_000)!);
    found = await readAgentStatus(directory, 'mine');
    assert.equal(found?.own, true);
    assert.equal(found?.record.model, 'Opus');
    const {stat} = await import('node:fs/promises');
    assert.equal((await stat(join(directory, 'claude-mine.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    await chmod(join(directory, 'claude-mine.json'), 0o666);
    assert.equal((await readAgentStatus(directory, 'mine'))?.own, false, 'a group/world-writable record is not trusted');
    await writeFile(join(directory, 'claude-mine.json'), '{not json', {mode: 0o600});
    await chmod(join(directory, 'claude-mine.json'), 0o600);
    assert.equal((await readAgentStatus(directory, 'mine'))?.own, false);
    const previous = process.env.NMSH_RUNTIME_DIR;
    process.env.NMSH_RUNTIME_DIR = root;
    try {
      await writeAgentStatus(directory, 'mine', parseClaudeStatus(DOCUMENTED, 3_000)!);
      const fact = await claudeAgent.resolve({cwd: '/', home: '/', session: 'mine', env: EMPTY_SHELL_ENVIRONMENT, fields: new Set(claudeAgent.fields),
        signal: new AbortController().signal, now: 0});
      assert.equal(fact?.value.own, true);
      assert.equal(fact?.value.contextPercent, 8);
      assert.equal(claudeAgent.persistence, 'display-only', 'agent context never enters command snapshots');
    } finally { if (previous === undefined) delete process.env.NMSH_RUNTIME_DIR; else process.env.NMSH_RUNTIME_DIR = previous; }
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('`nmsh agent-status claude` records and prints; bad input prints nothing and never throws', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nmsh-agent-')));
  const config = join(root, 'config');
  try {
    let printed = '';
    const env = {NMSH_RUNTIME_DIR: root, NMSH_SESSION_ID: 'sess-1', NO_COLOR: '1', COLUMNS: '120', XDG_CONFIG_HOME: config, HOME: root};
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = config;
    try {
      assert.equal(await runAgentStatusCommand(['claude'], {out: text => { printed += text; }, err: () => {}, env, stdin: Readable.from([JSON.stringify(DOCUMENTED)]), now: () => 1_738_400_000_000}), 0);
    } finally { if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; }
    assert.match(printed, /Opus · High · CTX 8%/u);
    assert.match(printed, /5H 24% · 7D 41%/u);
    assert.ok(!/\u001b/u.test(printed), 'NO_COLOR is respected');
    assert.equal(JSON.parse(await readFile(join(root, 'agent-context', 'claude-sess-1.json'), 'utf8')).model, 'Opus');
    let quiet = '';
    assert.equal(await runAgentStatusCommand(['claude'], {out: text => { quiet += text; }, err: () => {}, env, stdin: Readable.from(['{broken'])}), 0);
    assert.equal(quiet, '');
    assert.equal(await runAgentStatusCommand(['nonsense'], {out: () => {}, err: () => {}, env}), 2);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('setup shows the exact settings edit, never replaces a user status line, and removal deletes exactly what NMSh added', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nmsh-claude-')));
  const env = {HOME: root, XDG_CONFIG_HOME: join(root, 'config'), CLAUDE_CONFIG_DIR: join(root, '.claude')};
  const launcher = '/opt/homebrew/bin/nmsh';
  try {
    // A missing settings file is created with the status line only.
    let planned = planClaudeBridge(launcher, env);
    assert.ok('plan' in planned && planned.plan.operation === 'create');
    assert.ok(applyClaudeBridge((planned as {plan: never}).plan, launcher, env).ok);
    const created = JSON.parse(await readFile(join(root, '.claude', 'settings.json'), 'utf8'));
    assert.deepEqual(created, {statusLine: {type: 'command', command: `'/opt/homebrew/bin/nmsh' agent-status claude`, padding: 0}});
    assert.equal(inspectClaudeBridge(env).state, 'configured');
    assert.ok('noop' in planClaudeBridge(launcher, env));
    planned = planClaudeBridgeRemoval(env);
    assert.ok('plan' in planned);
    assert.ok(applyClaudeBridgeRemoval((planned as {plan: never}).plan, env).ok);
    assert.equal(await readFile(join(root, '.claude', 'settings.json'), 'utf8'), '{}\n');

    // An existing file keeps every other byte; removal restores it exactly.
    const original = '{\n  "model": "opus",\n  "permissions": {"allow": ["Bash(npm test)"]}\n}\n';
    await writeFile(join(root, '.claude', 'settings.json'), original);
    planned = planClaudeBridge(launcher, env);
    assert.ok('plan' in planned);
    const plan = (planned as {plan: {preview: string[]}}).plan;
    assert.ok(plan.preview.some(line => line.startsWith('+') && line.includes('"statusLine"')), 'the diff is shown before anything is written');
    await writeFile(join(root, '.claude', 'settings.json'), `${original} `);
    assert.equal(applyClaudeBridge((planned as {plan: never}).plan, launcher, env).ok, false, 'a file changed since review is not written');
    await writeFile(join(root, '.claude', 'settings.json'), original);
    planned = planClaudeBridge(launcher, env);
    assert.ok(applyClaudeBridge((planned as {plan: never}).plan, launcher, env).ok);
    const edited = await readFile(join(root, '.claude', 'settings.json'), 'utf8');
    assert.ok(edited.startsWith('{\n  "model": "opus",\n  "permissions": {"allow": ["Bash(npm test)"]}'));
    assert.ok(isBridgeValue(JSON.parse(edited).statusLine));
    planned = planClaudeBridgeRemoval(env);
    assert.ok(applyClaudeBridgeRemoval((planned as {plan: never}).plan, env).ok);
    assert.equal(await readFile(join(root, '.claude', 'settings.json'), 'utf8'), original);

    // A person's own status line is a conflict, never replaced.
    await writeFile(join(root, '.claude', 'settings.json'), '{"statusLine": {"type": "command", "command": "~/.claude/statusline.sh"}}\n');
    const conflict = planClaudeBridge(launcher, env);
    assert.ok('refuse' in conflict && /will not replace it/u.test(conflict.refuse));
    await writeFile(join(root, '.claude', 'settings.json'), '{not json');
    assert.ok('refuse' in planClaudeBridge(launcher, env));
    assert.equal(await readFile(join(root, '.claude', 'settings.json'), 'utf8'), '{not json');
  } finally { await rm(root, {recursive: true, force: true}); }
});
