import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {agentBlocks, renderAgentView, renderShelf} from '../src/agents/sessions/AgentViews.js';
import {pushEvent, type AgentSession} from '../src/agents/sessions/model.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const session = (extra: Partial<AgentSession> = {}): AgentSession => ({id: 'a1', harness: 'claude', level: 'managed', title: 'Ask chat viewport', cwd: '/home/u/proj', startedAt: 0,
  state: 'working', events: [], attention: false, updatedAt: 0, ...extra});

function app(): TerminalApp {
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'render', {value: () => {}});
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns: 120, rows: 40})});
  instance['startupPending'] = false;
  return instance;
}

test('/ai parses; the shelf is compact, factual and narrows cleanly; NO_COLOR and safe glyphs keep identity', () => {
  assert.deepEqual(parseSlashCommand('/ai'), {kind: 'ai'});
  assert.deepEqual(parseSlashCommand('/ai claude-account1'), {kind: 'ai', target: 'claude-account1'});
  const working = session({activity: 'Edit TerminalApp.ts', startedAt: 0});
  const waiting = session({id: 'b', harness: 'codex', level: 'observed', title: 'Codex', state: 'running', startedAt: 0});
  assert.equal(stripAnsi(renderShelf([working, waiting], 120, 240_000)), '✻ Claude · Ask chat viewport · editing TerminalApp.ts   ◇ Codex · running 4m');
  for (const columns of [40, 24, 8]) assert.ok(displayWidth(renderShelf([working, waiting], columns, 240_000)) <= columns, `${columns}`);
  assert.match(stripAnsi(renderShelf([working, waiting], 30, 240_000)), /^✻ Claude · editing · \+1$/u);
  setIconStyle('safe');
  try { assert.match(stripAnsi(renderShelf([working], 120, 0)), /^\* Claude/u); } finally { setIconStyle('nerd'); }
  const before = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try { assert.doesNotMatch(renderShelf([working], 120, 0), /\u001b\[(?:38|48);/u, 'no color codes'); assert.match(stripAnsi(renderShelf([working], 120, 0)), /^✻ Claude · /u, 'still readable'); } finally { if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before; }
});

test('agent view: user/assistant/tool blocks; tool detail folded until Ctrl+O; approvals explicit; observed has no input', () => {
  const managed = session();
  pushEvent(managed, {kind: 'user', text: 'implement the Ask chat viewport'});
  pushEvent(managed, {kind: 'assistant', text: 'I will inspect the rendering path.'});
  pushEvent(managed, {kind: 'tool', id: 't', name: 'Read', target: 'src/AskPanel.ts', status: 'started'});
  pushEvent(managed, {kind: 'tool', id: 't', name: '', status: 'finished', detail: 'a\nb\nc'});
  pushEvent(managed, {kind: 'approval', requestId: 'r', tool: 'Edit', target: 'src/TerminalApp.ts'});
  const view = {sessionId: 'a1', input: '', expanded: new Set<string>(), scroll: 0};
  const rows = renderAgentView(managed, view, 100, 40, 1000).map(stripAnsi);
  assert.ok(rows.some(row => row.trim() === 'implement the Ask chat viewport'));
  assert.ok(rows.some(row => row.trim() === 'Read src/AskPanel.ts'));
  assert.ok(rows.some(row => /› 3 detail lines hidden · Ctrl\+O/u.test(row)));
  assert.ok(rows.some(row => /\[A\] Allow once {3}\[D\] Deny {3}NMSh never answers for you\./u.test(row)));
  assert.ok(!rows.some(row => /always/iu.test(row)), 'no lasting approval');
  view.expanded.add('t');
  assert.ok(renderAgentView(managed, view, 100, 40, 1000).map(stripAnsi).some(row => row.trim() === 'c'));
  assert.deepEqual(agentBlocks(managed).filter(block => block.kind === 'assistant').map(block => block.text), ['I will inspect the rendering path.'], '/copy source: visible text only');
  const observed = renderAgentView(session({level: 'observed', state: 'running', tty: 'ttys004', pid: 7}), view, 100, 40, 720_000).map(stripAnsi).join('\n').replace(/\s+/gu, ' ');
  assert.match(observed, /no supported way to read or control its conversation/u);
  assert.doesNotMatch(observed, /type to/u, 'no input box for an observed session');
});

test('app: ← on a truly idle composer opens sessions; with text it moves the cursor', async () => {
  const instance = app();
  try {
    let opened = 0;
    instance['openSessionsView'] = async () => { opened += 1; };
    instance['editor'].insert('ls');
    await instance['handleKey']({kind: 'left'});
    assert.equal(opened, 0);
    assert.equal(instance['editor'].cursorIndex, 1, 'ordinary cursor-left');
    instance['editor'].clear();
    await instance['handleKey']({kind: 'left'});
    assert.equal(opened, 1, 'empty composer: fast /sessions');
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('app: ↓ reveals the shelf; ↑ from an idle composer focuses a visible shelf; ↓ and Esc return; history navigation still wins', async () => {
  const instance = app();
  try {
    const agents = instance['agents'];
    agents.sessions.push(session({updatedAt: 1}));
    await instance['handleKey']({kind: 'down'});
    assert.equal(instance['shelf'].visible, true);
    assert.ok(instance['noticeRows'](120).some((row: string) => stripAnsi(row).startsWith('✻ Claude')), 'shelf row is part of the planned chrome');
    await instance['handleKey']({kind: 'down'});
    assert.equal(instance['shelf'].focused, false, '↓ only reveals; it never focuses');
    await instance['handleKey']({kind: 'up'});
    assert.equal(instance['shelf'].focused, true, 'one ↑ from the idle composer focuses the visible shelf');
    await instance['handleKey']({kind: 'down'});
    assert.equal(instance['shelf'].focused, false, '↓ returns to the composer');
    await instance['handleKey']({kind: 'up'});
    await instance['handleKey']({kind: 'escape'});
    assert.equal(instance['shelf'].focused, false, 'Esc returns to the composer');
    // Walking history: ↓ restores newer entries before the shelf is involved.
    instance['composerHistory'].previous('', () => ['echo one']);
    instance['editor'].replaceText('echo one');
    instance['shelf'].visible = false;
    await instance['handleKey']({kind: 'down'});
    assert.equal(instance['shelf'].visible, false, 'history navigation took the key');
    // Auto-hide after idle unless something needs attention.
    instance['shelf'] = {visible: true, focused: false, selected: 0, shownAt: Date.now() - 60_000};
    instance['syncAgents']();
    assert.equal(instance['shelf'].visible, false);
    agents.sessions[0]!.attention = true;
    assert.ok(instance['shelfRow'](120), 'pinned while something needs attention');
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('app: /ai lists harnesses truthfully; leaving an agent view does not stop it; /copy copies the reply text', async () => {
  const instance = app();
  try {
    await instance['runSlash']('/ai', {kind: 'ai'});
    assert.ok(instance['agentPanel']);
    const rows = instance['agentPanelRows']();
    assert.ok(rows.some((row: {kind: string; harness?: {id: string}}) => row.kind === 'harness' && row.harness?.id === 'gemini'));
    await instance['handleKey']({kind: 'escape'});
    assert.equal(instance['agentPanel'], undefined);
    const managed = session({id: 'm1'});
    pushEvent(managed, {kind: 'assistant', text: 'Here is the plan.'});
    instance['agents'].sessions.push(managed);
    instance['openAgentView']('m1');
    let copied = '';
    const clipboard = await import('../src/clipboard/clipboard.js');
    void clipboard;
    instance['copyAgentBlock'] = async (target: AgentSession, index: number) => { copied = agentBlocks(target).filter(block => block.kind === 'assistant').at(-index)!.text; };
    for (const char of '/copy') await instance['handleKey']({kind: 'text', value: char});
    await instance['handleKey']({kind: 'enter'});
    assert.equal(copied, 'Here is the plan.');
    await instance['handleKey']({kind: 'escape'});
    assert.equal(instance['agentView'], undefined);
    assert.ok(instance['agents'].get('m1'), 'the session keeps running in the background');
    await instance['runSlash']('/ai nope', {kind: 'ai', target: 'nope'});
    assert.match(instance['output'].wrapped(200).map((row: {plain: string}) => row.plain).join('\n'), /No harness or launch profile is called "nope"/u);
  } finally { instance['stop'](0); instance['session'].kill(); }
});
