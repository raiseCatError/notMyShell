import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {claudeCapabilities, claudeEvents} from '../src/agents/sessions/claudeAdapter.js';
import {findAgents, parseElapsed, parsePs} from '../src/agents/sessions/discovery.js';
import {AgentSessions, normalizeProfiles} from '../src/agents/sessions/manager.js';
import {titleFromPrompt} from '../src/agents/sessions/model.js';
import {HARNESSES} from '../src/agents/harnesses.js';

const HELP = 'Usage: claude [options]\n  -p, --print  Print response\n  --input-format <format>  "text" (default), or "stream-json"\n  --output-format <format>  "stream-json" (realtime)\n  --permission-prompts <target>  Who answers: "host" (the SDK host) or "none"\n  -r, --resume [value]\n  --session-id <uuid>\n';
const root = mkdtempSync(join(tmpdir(), 'nmsh-agents-'));
test.after(() => rmSync(root, {recursive: true, force: true}));

/** A stand-in harness speaking stream-json: it records stdin and answers like the real protocol. */
const fake = join(root, 'claude');
writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(join(root, 'argv.json'))}, JSON.stringify(process.argv.slice(2)));
const out = message => process.stdout.write(JSON.stringify(message) + '\\n');
out({type: 'system', subtype: 'init', session_id: 'sess-1'});
let buffer = '';
process.stdin.on('data', chunk => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\\n')) >= 0) {
    const line = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    fs.appendFileSync(${JSON.stringify(join(root, 'stdin.jsonl'))}, JSON.stringify(line) + '\\n');
    if (line.type === 'user') {
      out({type: 'assistant', message: {content: [{type: 'text', text: 'Reading the file.'}, {type: 'tool_use', id: 't1', name: 'Read', input: {file_path: '/p/src/AskPanel.ts'}}]}});
      out({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 't1', content: 'line1\\nline2'}]}});
      out({type: 'control_request', request_id: 'r1', request: {subtype: 'can_use_tool', tool_name: 'Edit', input: {file_path: '/p/src/TerminalApp.ts'}}});
      out({type: 'control_request', request_id: 'r2', request: {subtype: 'something_new'}});
    }
    if (line.type === 'control_request' && line.request.subtype === 'initialize') out({type: 'control_response', response: {subtype: 'success', request_id: line.request_id, response: {}}});
    if (line.type === 'control_response' && line.response.request_id === 'r1') out({type: 'result', subtype: 'success', is_error: false, session_id: 'sess-1'});
  }
});
process.stdin.on('end', () => process.exit(0));
`);
chmodSync(fake, 0o755);

const until = async (check: () => boolean) => { for (let i = 0; i < 300 && !check(); i += 1) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(check(), 'condition reached'); };

test('capabilities come from the installed help text only', () => {
  assert.deepEqual(claudeCapabilities('x', HELP), {streamJson: true, hostPermissions: true, resume: true, sessionId: true});
  assert.deepEqual(claudeCapabilities('x', 'Usage: claude'), {streamJson: false, hostPermissions: false, resume: false, sessionId: false});
});

test('event normalization: text, tools with factual targets, results, approvals; junk ignored', () => {
  assert.deepEqual(claudeEvents('{"type":"system","subtype":"init","session_id":"s"}').events, [{kind: 'started', harnessSessionId: 's'}]);
  assert.deepEqual(claudeEvents(JSON.stringify({type: 'assistant', message: {content: [{type: 'tool_use', id: 'a', name: 'Bash', input: {command: 'npm test\nmore'}}]}})).events,
    [{kind: 'tool', id: 'a', name: 'Bash', target: 'npm test', status: 'started', input: {command: 'npm test\nmore'}}]);
  assert.deepEqual(claudeEvents('{"type":"result","subtype":"error_max_turns","is_error":true}').events, [{kind: 'settled', ok: false, message: 'turn limit reached'}]);
  assert.deepEqual(claudeEvents('not json').events, []);
  assert.deepEqual(claudeEvents('{"type":"mystery"}').events, []);
});

test('managed session: background launch, structured events, approval waits for the person, unsupported requests refused', async () => {
  const sessions = new AgentSessions({resolve: name => name === 'claude' ? fake : undefined, scan: async () => [], now: () => Date.now(), claudeHelp: HELP});
  try {
    const launched = sessions.launch('claude', root, {prompt: 'implement the Ask chat viewport and fix folding'});
    assert.ok(launched.ok);
    const session = launched.ok ? launched.session : undefined!;
    assert.equal(session.level, 'managed');
    assert.equal(session.title, 'Ask chat viewport', 'deterministic title from the first prompt');
    await until(() => session.state === 'approval');
    assert.equal(session.harnessSessionId, 'sess-1');
    assert.equal(session.activity, undefined, 'completed Read activity clears instead of remaining stale');
    assert.deepEqual(session.pendingApproval, {requestId: 'r1', tool: 'Edit', target: '/p/src/TerminalApp.ts', input: {file_path: '/p/src/TerminalApp.ts'}});
    assert.equal(session.attention, true, 'needs attention');
    await new Promise(resolve => setTimeout(resolve, 100));
    const sent = readFileSync(join(root, 'stdin.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(!sent.some(line => line.type === 'control_response' && line.response.request_id === 'r1'), 'never answered automatically');
    assert.ok(sent.some(line => line.type === 'control_response' && line.response.request_id === 'r2' && line.response.subtype === 'error'), 'unknown requests are refused, not left hanging');
    const argv = JSON.parse(readFileSync(join(root, 'argv.json'), 'utf8')) as string[];
    assert.deepEqual(argv.slice(0, 8), ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompts', 'host']);
    assert.ok(argv.includes('--permission-prompt-tool'), 'uses the official SDK stdio permission channel');
    assert.equal(sent[0].request?.subtype, 'initialize', 'initializes before user messages');
    assert.ok(sessions.answer(session.id, false));
    await until(() => session.state === 'waiting');
    const answer = readFileSync(join(root, 'stdin.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).find(line => line.response?.request_id === 'r1');
    assert.deepEqual(answer.response.response, {behavior: 'deny', message: 'Denied in NMSh.'});
  } finally { sessions.dispose(); }
});

test('observed sessions: discovered from process metadata, never controllable, gone when the process is', async () => {
  let found = [{pid: 4242, harness: 'claude', tty: 'ttys004', startedAt: 1000}];
  const sessions = new AgentSessions({resolve: () => undefined, scan: async () => found, now: () => 5000});
  await sessions.discover();
  const observed = sessions.get('observed-4242')!;
  assert.equal(observed.level, 'observed');
  assert.equal(sessions.send(observed.id, 'hello'), false, 'no input to an observed session');
  assert.equal(sessions.answer(observed.id, true), false);
  found = [];
  await sessions.discover();
  assert.equal(sessions.get('observed-4242'), undefined, 'stale processes disappear');
});

test('discovery: executable names only, nested helpers and managed processes deduped, no arguments read', () => {
  const ps = ['  100     1 ttys004    12:01 /opt/node22/bin/claude', '  101   100 ttys004    11:59 claude', '  200     1 ??       01:02:03 /usr/local/bin/codex',
    '  300     1 ttys002    00:05 /bin/zsh', '  400     1 ttys003    00:05 claude-helper', '  500     1 ttys005    1-00:00:01 pi'].join('\n');
  const rows = parsePs(ps);
  assert.ok(rows.every(row => !('args' in row)));
  assert.deepEqual(findAgents(rows, 10_000_000).map(agent => [agent.pid, agent.harness]), [[100, 'claude'], [200, 'codex'], [500, 'pi']]);
  assert.deepEqual(findAgents(rows, 10_000_000, new Set([100])).map(agent => agent.pid), [200, 500], 'a managed process is not listed again');
  assert.equal(parseElapsed('1-02:03:04'), ((26 * 60 + 3) * 60 + 4) * 1000);
});

test('profiles: provider-specific, non-secret fields only; unknown harnesses dropped', () => {
  const profiles = normalizeProfiles([{name: 'claude-account1', harness: 'claude', configDir: '/Users/me/.claude-work', model: 'opus', token: 'sk-SECRET', permissionMode: 'bypassPermissions'},
    {name: 'mystery', harness: 'unknown-agent'}, {name: 'bad name!', harness: 'claude'}]);
  assert.deepEqual(profiles, [{name: 'claude-account1', harness: 'claude', configDir: '/Users/me/.claude-work', model: 'opus'}]);
  assert.doesNotMatch(JSON.stringify(profiles), /SECRET|bypass/u);
});

test('registry: more than three harnesses; launch is truthful for uncontrolled or missing ones', () => {
  assert.ok(['claude', 'codex', 'pi', 'gemini', 'aider', 'opencode', 'qwen'].every(id => HARNESSES.some(item => item.id === id)));
  const sessions = new AgentSessions({resolve: name => name === 'gemini' ? '/usr/bin/gemini' : undefined, scan: async () => [], now: () => 0});
  const gemini = sessions.launch('gemini', root);
  assert.equal(gemini.ok, false);
  assert.match(gemini.ok ? '' : gemini.reason, /no supported control channel/u);
  assert.match((sessions.launch('pi', root) as {reason: string}).reason, /not installed/u);
  assert.equal(titleFromPrompt('please fix the flaky test', 'proj · Claude 1'), 'Flaky test');
});

test('named profiles remain distinct and resume retains target identity, source and profile', async () => {
  const sessions = new AgentSessions({resolve: name => name === 'claude' ? fake : undefined, scan: async () => [], now: () => Date.now(), claudeHelp: HELP});
  try {
    const a = sessions.launch('claude', root, {profile: {name: 'profile-a', harness: 'claude', configDir: root}});
    const b = sessions.launch('claude', root, {profile: {name: 'profile-b', harness: 'claude', configDir: root}});
    assert.ok(a.ok && b.ok); if (!a.ok || !b.ok) return;
    assert.notEqual(a.session.id, b.session.id);
    assert.equal(a.session.profileId, 'profile-a'); assert.equal(b.session.profileId, 'profile-b');
    await until(() => Boolean(a.session.harnessSessionId));
    const source = a.session.transcript;
    sessions.close(a.session.id); await until(() => a.session.state === 'exited');
    assert.ok(sessions.resume(a.session.id).ok);
    await until(() => a.session.state === 'starting' && a.session.pid !== undefined);
    assert.equal(a.session.transcript, source);
    assert.equal(a.session.profileId, 'profile-a');
  } finally {sessions.dispose();}
});
