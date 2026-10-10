import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {initialSelection, launcherRows, moveSelection, renderLauncher} from '../src/agents/launcher.js';
import {renderShelf} from '../src/agents/sessions/AgentViews.js';
import {claudeEvents, ClaudeSession} from '../src/agents/sessions/claudeAdapter.js';
import {pushEvent, settledText, type AgentSession} from '../src/agents/sessions/model.js';
import {renderSemanticAgentView} from '../src/agents/transcript/view.js';
import {AgentInputController} from '../src/agents/input/controller.js';
import {discoverClaudeProfiles, parseClaudeAliases} from '../src/agents/profileDiscovery.js';
import type {AgentProfile} from '../src/agents/sessions/manager.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {stripAnsi} from '../src/util/text.js';

const target = (id: string, extra: Partial<AgentSession> = {}): AgentSession => ({id, harness: 'claude', level: 'managed', title: id, cwd: '/p', startedAt: 0,
  state: 'waiting', events: [], attention: false, updatedAt: 0, ...extra});
const PROFILES: AgentProfile[] = [{name: 'account1', harness: 'claude', label: 'Claude account 1'}, {name: 'account2', harness: 'claude', label: 'Claude account 2'}];

function app(profiles: AgentProfile[] = PROFILES): TerminalApp {
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'render', {value: () => {}});
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns: 120, rows: 40})});
  instance['startupPending'] = false;
  instance['discoverProfiles'] = () => [];
  instance['configuration'] = {...instance['configuration'], agentProfiles: profiles};
  return instance;
}

test('launcher: profiles are groups, targets their children, + New per profile; no profile is ever bypassed', () => {
  const rows = launcherRows({provider: 'claude', selected: 0}, [target('Winter', {profileId: 'account2'}), target('Test', {profileId: 'account1', state: 'failed'})], PROFILES);
  const shape = rows.map(row => row.kind === 'group' ? `[${row.label}]` : row.kind === 'target' ? row.session.title : row.kind === 'new' ? `+${row.profile?.name ?? 'default'}` : row.kind);
  assert.deepEqual(shape, ['[Claude account 1]', 'Test', '+account1', '[Claude account 2]', 'Winter', '+account2']);
  assert.ok(!rows.some(row => row.kind === 'new' && !row.profile), 'configured profiles: no default-identity New');
  // Zero targets, no profiles: one fresh default-identity target, stated as such.
  const bare = launcherRows({provider: 'claude', selected: 0}, [], []);
  assert.deepEqual(bare.map(row => row.kind), ['group', 'new']);
  assert.match(stripAnsi(renderLauncher({provider: 'claude', selected: 1}, bare, 100).join('\n')), /default identity/u);
});

test('launcher: /claude starts on existing work, /claude new on a fresh target; both list everything', () => {
  const live = target('Winter', {profileId: 'account2'});
  const resumable = target('Parser QA', {profileId: 'account2', state: 'exited', reconnectable: true, harnessSessionId: 's'});
  for (const sessions of [[], [live], [live, resumable], [resumable]]) {
    const rows = launcherRows({provider: 'claude', selected: 0}, sessions, PROFILES);
    const open = rows[initialSelection(rows, 'open')]!;
    const fresh = rows[initialSelection(rows, 'new')]!;
    assert.equal(open.kind, sessions.length ? 'target' : 'new', `open with ${sessions.length}`);
    if (open.kind === 'target' && sessions.includes(live)) assert.equal(open.session.id, 'Winter', 'the live target first');
    assert.equal(fresh.kind, 'new');
    assert.equal(rows.filter(row => row.kind === 'target').length, sessions.length);
  }
  // Selection skips group headings in both directions.
  const rows = launcherRows({provider: 'claude', selected: 0}, [live], PROFILES);
  const at = initialSelection(rows, 'open');
  assert.notEqual(rows[moveSelection(rows, at, -1)]!.kind, 'group');
  assert.notEqual(rows[moveSelection(rows, at, 1)]!.kind, 'group');
});

test('app: /claude, /claude new and /ai Claude open the same launcher; Enter, N and Esc are explicit; /ai account2 stays direct', async () => {
  const instance = app();
  const launched: Array<string | undefined> = [];
  instance['agents'].launch = ((_provider: string, _cwd: string, options: {profile?: AgentProfile} = {}) => {
    launched.push(options.profile?.name);
    const session = target(`t${launched.length}`, options.profile ? {profileId: options.profile.name} : {});
    instance['agents'].sessions.push(session);
    return {ok: true, session};
  }) as never;
  try {
    instance['agents'].sessions.push(target('Winter', {profileId: 'account2', cwd: instance['shellCwd']}));
    await instance['runSlash']('/claude', parseSlashCommand('/claude')!);
    assert.equal(instance['agentView'], undefined);
    assert.equal(instance['launcherRows']()[instance['launcher']!.selected]?.kind, 'target');
    // N on an existing target: a fresh target from that target's own profile, never a resume.
    instance['handleKey']({kind: 'text', value: 'n'});
    assert.deepEqual(launched, ['account2']);
    instance['handleKey']({kind: 'escape'});
    await instance['runSlash']('/claude new', parseSlashCommand('/claude new')!);
    const rows = instance['launcherRows']();
    assert.equal(rows[instance['launcher']!.selected]?.kind, 'new');
    assert.ok(rows.some(row => row.kind === 'target'), '/claude new keeps existing work visible');
    instance['handleKey']({kind: 'up'});
    instance['handleKey']({kind: 'escape'});
    assert.equal(instance['launcher'], undefined);
    assert.equal(instance['agentView'], undefined, 'Esc returns to the shell; nothing activated');
    // /ai → Claude Code row → Enter: the launcher, not a bare default-identity launch.
    Object.defineProperty(instance['agents'], 'harnesses', {value: () => [{harness: {id: 'claude', name: 'Claude Code'}, executable: '/bin/claude', controllable: true}]});
    await instance['runSlash']('/ai', parseSlashCommand('/ai')!);
    const claudeRow = instance['agentPanelRows']().findIndex((row: {kind: string; harness?: {id: string}}) => row.kind === 'harness' && row.harness?.id === 'claude');
    assert.ok(claudeRow >= 0);
    instance['agentPanel']!.selected = claudeRow;
    instance['handleKey']({kind: 'enter'});
    assert.ok(instance['launcher'], '/ai Claude opens the launcher when profiles exist');
    assert.equal(launched.length, 1, 'nothing launched on the default identity');
    instance['handleKey']({kind: 'escape'});
    // /ai claude (typed) also respects profiles; /ai account2 is the direct fresh launch.
    instance['openAi']('/ai claude', 'claude');
    assert.ok(instance['launcher']);
    instance['handleKey']({kind: 'escape'});
    instance['openAi']('/ai account2', 'account2');
    assert.deepEqual(launched, ['account2', 'account2']);
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('shelf: ↑ only focuses an already visible shelf from an idle composer; Left/Right select; Enter opens', async () => {
  const instance = app();
  try {
    instance['agents'].sessions.push(target('a', {updatedAt: 2}), target('b', {updatedAt: 1}));
    // Hidden shelf: ↑ keeps shell history.
    instance['composerHistory'].previous('', () => ['echo one']);
    instance['composerHistory'].reset?.();
    await instance['handleKey']({kind: 'up'});
    assert.equal(instance['shelf'].focused, false, 'a hidden shelf is never revealed or focused by ↑');
    instance['editor'].replaceText('');
    // Text in the composer: ↑ stays with the editor.
    instance['shelf'].visible = true; instance['shelf'].shownAt = Date.now();
    instance['editor'].replaceText('git status');
    await instance['handleKey']({kind: 'up'});
    assert.equal(instance['shelf'].focused, false, 'non-empty composer keeps ↑');
    instance['editor'].replaceText('');
    await instance['handleKey']({kind: 'up'});
    assert.equal(instance['shelf'].focused, true);
    await instance['handleKey']({kind: 'right'});
    assert.equal(instance['shelf'].selected, 1);
    assert.equal(instance['agentView'], undefined, 'selection never switches targets');
    await instance['handleKey']({kind: 'enter'});
    assert.equal(instance['agentView']?.sessionId, 'b');
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('shelf focus marker reads without color and in Safe glyphs; the selected provider takes its accent', () => {
  const sessions = [target('a', {updatedAt: 2}), target('b', {updatedAt: 1})];
  const focused = renderShelf(sessions, 160, 0, 1, true);
  assert.match(stripAnsi(focused), /^ {2}✻ Claude.* {3}› ✻ Claude|^ {2}✻ Claude.* {3}> ✻ Claude/u, 'two-cell lead; marker on the selected item');
  assert.match(focused, /\u001b\[38;2;217;119;87m/u, 'Claude registry accent #d97757');
  assert.doesNotMatch(stripAnsi(renderShelf(sessions, 160, 0, 1, false)), /[›>]/u, 'a merely visible shelf carries no marker');
  const before = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  setIconStyle('safe');
  try {
    const plain = renderShelf(sessions, 160, 0, 0, true);
    assert.doesNotMatch(plain, /\u001b\[(?:38|48);/u);
    assert.match(stripAnsi(plain), /^> \* Claude/u);
  } finally { setIconStyle('nerd'); if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before; }
});

test('header: provider welcome, no implementation names, model only as reported, effort never invented', () => {
  const view = {sessionId: 'a', input: '', expanded: new Set<string>(), scroll: 0, controller: new AgentInputController()};
  const fresh = target('a', {cwd: '/Users/me/Projects/notMyShell'});
  const welcome = stripAnsi(renderSemanticAgentView(fresh, view, 90, 30, {profileLabel: 'Claude account 2', branch: 'feature/x'}).join('\n'));
  assert.match(welcome, /✻ Claude Code/u);
  assert.match(welcome, /Claude account 2/u);
  assert.match(welcome, /~\/Projects\/notMyShell · feature\/x/u);
  assert.match(welcome, /What would you like to work on\?/u);
  assert.doesNotMatch(welcome, /AGENT_MESSAGE|Input:|managed ·/u);
  assert.doesNotMatch(welcome, /opus|sonnet|claude-|effort|thinking/iu, 'unknown model and effort are not invented');
  assert.match(stripAnsi(renderSemanticAgentView(fresh, view, 90, 30, {configuredModel: 'opus'}).join('\n')), /opus · configured/u);
  // Runtime evidence: the provider's init/assistant model; placeholders such as <synthetic> are ignored.
  assert.deepEqual(claudeEvents(JSON.stringify({type: 'system', subtype: 'init', session_id: 's', model: 'claude-opus-5-5'})).events,
    [{kind: 'started', harnessSessionId: 's'}, {kind: 'model', model: 'claude-opus-5-5'}]);
  assert.deepEqual(claudeEvents(JSON.stringify({type: 'assistant', message: {model: '<synthetic>', content: []}})).events, []);
  pushEvent(fresh, {kind: 'model', model: 'claude-opus-5-5'});
  pushEvent(fresh, {kind: 'user', text: 'hello'});
  const compact = renderSemanticAgentView(fresh, view, 90, 30, {profileLabel: 'Claude account 2'});
  const headerRow = compact.find(row => /✻ Claude Code · /u.test(stripAnsi(row)))!;
  assert.match(stripAnsi(headerRow), /✻ Claude Code · .*claude-opus-5-5$/u);
  assert.match(headerRow, /\u001b\[38;2;217;119;87m/u, 'provider identity carries the registry accent');
});

test('turn results never read "failed: success"; reasons come from structured fields; interruptions and denials are told apart', () => {
  const settled = (line: Record<string, unknown>) => claudeEvents(JSON.stringify(line)).events[0];
  assert.deepEqual(settled({type: 'result', subtype: 'success', is_error: false}), {kind: 'settled', ok: true});
  // The real authentication failure shape: is_error with subtype "success" and terminal_reason api_error.
  const auth = settled({type: 'result', subtype: 'success', is_error: true, terminal_reason: 'api_error'})!;
  assert.deepEqual(auth, {kind: 'settled', ok: false, message: 'provider API error'});
  assert.deepEqual(settled({type: 'result', subtype: 'success', is_error: true}), {kind: 'settled', ok: false});
  assert.equal(settledText({ok: false}), 'Run failed.');
  assert.equal(settledText({ok: false, interrupted: true}), 'Interrupted; waiting for you.');
  for (const text of [settledText(auth as never), settledText({ok: false, message: 'turn limit reached'})]) assert.doesNotMatch(text, /success/u);
  // The session prefers the provider's own error code, and an interrupt over either.
  const events: unknown[] = [];
  const session = new ClaudeSession({executable: '/bin/false', cwd: '/', onEvent: event => events.push(event)}, 'stream-json --input-format --output-format');
  const read = (value: unknown) => session['read'](`${JSON.stringify(value)}\n`);
  read({type: 'assistant', error: 'authentication_failed', is_api_error_message: true, message: {model: '<synthetic>', content: [{type: 'text', text: 'Failed to authenticate.'}]}});
  read({type: 'result', subtype: 'success', is_error: true, terminal_reason: 'api_error'});
  assert.deepEqual(events.at(-1), {kind: 'settled', ok: false, message: 'authentication failed'});
  session['interruptRequested'] = true;
  read({type: 'result', subtype: 'error_during_execution', is_error: true});
  assert.deepEqual(events.at(-1), {kind: 'settled', ok: false, interrupted: true});
  // A denied tool is a failed tool inside a turn that can still succeed.
  read({type: 'user', message: {content: [{type: 'tool_result', tool_use_id: 't', is_error: true, content: 'Denied in NMSh.'}]}});
  read({type: 'result', subtype: 'success', is_error: false});
  assert.deepEqual(events.slice(-2), [{kind: 'tool', id: 't', name: '', status: 'failed', detail: 'Denied in NMSh.'}, {kind: 'settled', ok: true}]);
});

test('profile discovery: text only, narrow alias form, explicit import; hostile text never runs and unsupported aliases are ignored', async () => {
  const home = '/Users/me';
  const zshrc = [
    `alias claude-account2='CLAUDE_CONFIG_DIR="$HOME/.claude-account2" /opt/bin/claude'`,
    `alias claude-account1='CLAUDE_CONFIG_DIR="$HOME/.claude-account1" /opt/bin/claude'`,
    `alias claude="echo 'Use claude-account1'"`,
    `alias claude-pwn='CLAUDE_CONFIG_DIR="$(touch /tmp/nmsh-pwned)" /opt/bin/claude'`,
    `alias claude-chain='CLAUDE_CONFIG_DIR=/tmp/x /opt/bin/claude; rm -rf ~'`,
    `alias claude-up='CLAUDE_CONFIG_DIR="$HOME/../etc" /opt/bin/claude'`,
    `alias claude-args='CLAUDE_CONFIG_DIR="$HOME/.c" /opt/bin/claude --dangerously-skip-permissions'`,
    `alias claude-other='CLAUDE_CONFIG_DIR="$HOME/.claude-other" /usr/local/bin/claude'`,
    `alias claude-gone='CLAUDE_CONFIG_DIR="$HOME/.claude-gone" /opt/bin/claude'`,
  ].join('\n');
  const reads: string[] = [];
  const found = discoverClaudeProfiles({home, claude: '/opt/bin/claude', readFile: path => { reads.push(path); return path.endsWith('.zshrc') ? zshrc : undefined; },
    isDirectory: path => path !== `${home}/.claude-gone`, realpath: path => path});
  assert.deepEqual(found.map(profile => [profile.name, profile.label, profile.configDir]), [['account2', 'Claude account 2', `${home}/.claude-account2`], ['account1', 'Claude account 1', `${home}/.claude-account1`]]);
  assert.ok(reads.every(path => path.startsWith(`${home}/.`) && !/\.claude/u.test(path)), 'only shell files are read; never Claude config or credentials');
  assert.deepEqual(parseClaudeAliases('alias claude-x=\'CLAUDE_CONFIG_DIR="`id`" /opt/bin/claude\'', home), []);
  // Nothing is saved until Import; Skip saves nothing.
  const instance = app([]);
  let saved = 0;
  try {
    instance['discoverProfiles'] = () => found;
    Object.defineProperty(instance, 'promptConfiguration', {configurable: true, get: () => instance['configuration'], set: (next: never) => { saved++; instance['configuration'] = next; }});
    await instance['runSlash']('/claude', parseSlashCommand('/claude')!);
    assert.equal(instance['launcherRows']()[instance['launcher']!.selected]?.kind, 'import', 'the found profiles are previewed, Import selected');
    assert.equal(saved, 0, 'opening the launcher persists nothing');
    instance['handleKey']({kind: 'down'});
    instance['handleKey']({kind: 'enter'});
    assert.equal(saved, 0, 'Skip persists nothing');
    assert.equal(instance['launcher']!.found, undefined);
  } finally { instance['stop'](0); instance['session'].kill(); }
});
