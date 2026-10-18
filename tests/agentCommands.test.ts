import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import type {AgentSession} from '../src/agents/sessions/model.js';

test('provider commands and mod aliases have one canonical parsed model', () => {
  assert.deepEqual(parseSlashCommand('/mods'), {kind: 'mods'});
  assert.deepEqual(parseSlashCommand('/extensions'), {kind: 'mods'});
  for (const provider of ['claude', 'codex', 'opencode']) {
    assert.deepEqual(parseSlashCommand(`/${provider} mods`), {kind: 'mods', provider});
    if (provider !== 'opencode') {
      assert.deepEqual(parseSlashCommand(`/${provider}`), {kind: 'managedTarget', provider, action: 'open'});
      assert.deepEqual(parseSlashCommand(`/${provider} new`), {kind: 'managedTarget', provider, action: 'new'});
    }
  }
  assert.deepEqual(parseSlashCommand('/nmsh raw claude -p "hello"'), {kind: 'rawProvider', command: 'claude -p "hello"'});
  assert.equal(parseSlashCommand('/claude --unsafe')?.kind, 'unknown');
});

test('product target focus/picker and agent input preserve shell draft and editor selection', async () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  app['startupPending'] = false;
  app['discoverProfiles'] = () => [];
  const session = (id: string): AgentSession => ({id, harness: 'claude', level: 'managed', title: id, cwd: app['shellCwd'], startedAt: 0, state: 'waiting', events: [], attention: false, updatedAt: 0});
  try {
    app['agents'].sessions.push(session('a'));
    app['editor'].insert('git stat'); app['editor'].selectLeft();
    const snapshot = {text: app['editor'].text, cursor: app['editor'].cursorIndex, selection: app['editor'].selection};
    // /claude always opens the launcher; selection alone activates nothing, Enter opens the selected target.
    await app['runSlash']('/claude', parseSlashCommand('/claude')!);
    assert.equal(app['agentView'], undefined, 'the launcher opens; no target is entered implicitly');
    assert.equal(app['launcherRows']()[app['launcher']!.selected]?.kind, 'target');
    app['handleKey']({kind: 'enter'});
    assert.equal(app['agentView']?.sessionId, 'a');
    app['handleKey']({kind: 'text', value: 'inspect parser'}); app['handleKey']({kind: 'left'});
    app['handleKey']({kind: 'escape'});
    assert.deepEqual({text: app['editor'].text, cursor: app['editor'].cursorIndex, selection: app['editor'].selection}, snapshot);
    await app['runSlash']('/claude', parseSlashCommand('/claude')!);
    app['handleKey']({kind: 'enter'});
    assert.equal(app['agentView']?.input, 'inspect parser');
    assert.equal(app['agentView']?.controller?.editor.cursorIndex, 13);
    app['handleKey']({kind: 'escape'});
    app['agents'].sessions.push(session('b'));
    await app['runSlash']('/claude', parseSlashCommand('/claude')!);
    app['handleKey']({kind: 'down'});
    assert.equal(app['agentView'], undefined, 'moving the selection never switches targets');
    app['handleKey']({kind: 'enter'});
    assert.equal(app['agentView']?.sessionId, 'b');
  } finally {app['stop'](0); app['session'].kill();}
});

test('ordinary typing cannot approve in the wired agent view', () => {
  const app = new TerminalApp(); Object.defineProperty(app, 'render', {value: () => {}});
  const session: AgentSession = {id: 'a', harness: 'claude', level: 'managed', title: 'a', startedAt: 0, state: 'approval', pendingApproval: {requestId: 'r', tool: 'Edit'}, events: [], attention: true, updatedAt: 0};
  let approvals = 0;
  app['agents'].answer = () => {approvals++; return true;};
  try {
    app['agents'].sessions.push(session); app['openAgentView']('a');
    for (const key of [{kind: 'text', value: 'A'}, {kind: 'enter'}, {kind: 'paste', value: 'A'}, {kind: 'wheelUp'}] as const) app['handleKey'](key);
    assert.equal(approvals, 0);
    app['handleKey']({kind: 'focusPrevious'});
    app['handleKey']({kind: 'enter'}); assert.equal(approvals, 0);
    app['handleKey']({kind: 'toggleDetails'}); assert.equal(approvals, 1);
  } finally {app['stop'](0); app['session'].kill();}
});
