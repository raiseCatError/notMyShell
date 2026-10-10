import test from 'node:test';
import assert from 'node:assert/strict';
import {pushEvent, type AgentSession} from '../src/agents/sessions/model.js';
import {AgentTranscript} from '../src/agents/transcript/model.js';
import {renderSemanticAgentView} from '../src/agents/transcript/view.js';
import {AgentInputController} from '../src/agents/input/controller.js';
import {handleAgentInput} from '../src/agents/input/surface.js';
import type {AgentViewState} from '../src/agents/sessions/AgentViews.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const SGR = /\u001b\[[0-9;]*m/gu;

function session(extra: Partial<AgentSession> = {}): AgentSession {
  return {id: 'a', harness: 'claude', level: 'managed', title: 'Sum helper', cwd: `${process.env.HOME}/Projects/demo`, startedAt: 0,
    state: 'waiting', events: [], attention: false, updatedAt: 0, transcript: new AgentTranscript(), ...extra};
}
function view(input = ''): AgentViewState {
  return {sessionId: 'a', input, expanded: new Set(), scroll: 0, controller: new AgentInputController()};
}
function conversation(): AgentSession {
  const s = session();
  pushEvent(s, {kind: 'model', model: 'fixture-model'});
  pushEvent(s, {kind: 'user', text: 'How is the sum helper tested, and what is missing?'});
  pushEvent(s, {kind: 'assistant', text: "I'll look at how the sum helper is tested before changing anything."});
  pushEvent(s, {kind: 'tool', id: 't1', name: 'Read', target: 'src/sum.js', status: 'started'});
  pushEvent(s, {kind: 'tool', id: 't2', name: 'Bash', target: 'npm test', status: 'started'});
  pushEvent(s, {kind: 'tool', id: 't2', name: 'Bash', status: 'failed'});
  pushEvent(s, {kind: 'assistant', text: 'Two gaps worth covering: negative numbers and non-integer input. Floating-point addition such as 0.1 + 0.2 will not equal 0.3 exactly.'});
  pushEvent(s, {kind: 'settled', ok: true});
  return s;
}
const plain = (rows: string[]) => rows.map(row => stripAnsi(row));

test('the agent view owns its full height: the conversation meets the composer, the state rides the composer rule', () => {
  for (const height of [12, 24, 40]) {
    const rows = plain(renderSemanticAgentView(conversation(), view(), 90, height, {profileLabel: 'Claude account 2', branch: 'main'}));
    assert.equal(rows.length, height, `exactly ${height} rows`);
    assert.match(rows.at(-2)!, /^❯ ▏Message Claude…$/u);
    assert.match(rows.at(-1)!, /^Enter send · Tab transcript · Esc shell$/u);
    assert.match(rows.at(-3)!, /^─ Waiting for you ─+$/u, 'one rule separates the conversation from the composer and carries the state');
    assert.notEqual(rows.at(-4), '', 'the newest row sits on the rule: no gap above the composer');
  }
  const tall = plain(renderSemanticAgentView(conversation(), view(), 90, 40, {profileLabel: 'Claude account 2', branch: 'main'}));
  const header = tall.findIndex(row => /^✻ Claude Code · Sum helper +fixture-model$/u.test(row));
  assert.ok(header > 0, 'the header starts the stream, after the space the conversation has not filled');
  assert.match(tall[header + 1]!, /^ {2}Claude account 2 · ~\/Projects\/demo · main$/u, 'identity and place; the state is not repeated');
  assert.ok(tall.slice(0, header).every(row => row === ''), 'unused space is above the header, never between it and the composer');
});

test('a fresh session: a compact welcome directly above the composer, then it gives way to the conversation', () => {
  const fresh = session();
  const rows = plain(renderSemanticAgentView(fresh, view(), 90, 30, {profileLabel: 'Claude account 2', branch: 'main'}));
  const welcome = rows.findIndex(row => /^✻ Claude Code/u.test(row));
  assert.ok(welcome > 0);
  assert.ok(rows.slice(welcome).length <= 9, 'compact: welcome, rule, composer and controls');
  assert.match(rows.at(-4)!, /What would you like to work on\?/u, 'the welcome ends right above the composer rule');
  assert.equal(rows.filter(row => /Claude account 2/u.test(row)).length, 1, 'identity once');
  pushEvent(fresh, {kind: 'user', text: 'first question'});
  const started = plain(renderSemanticAgentView(fresh, view(), 90, 30, {profileLabel: 'Claude account 2'}));
  assert.ok(!started.some(row => /What would you like/u.test(row)), 'the welcome prompt gives way once a message is sent');
  assert.ok(started.some(row => /first question/u.test(row)));
});

test('turns are distinct without color: user marker, indented agent prose, quiet tool rows, outcome glyphs', () => {
  const rows = plain(renderSemanticAgentView(conversation(), view(), 70, 40));
  const text = rows.join('\n');
  assert.match(text, /^› How is the sum helper tested, and what is missing\?$/mu);
  assert.match(text, /^ {2}I'll look at how the sum helper is tested before changing anything\.$/mu);
  assert.match(text, /^ {2}▸ Read src\/sum\.js\n {2}▸ Bash npm test · failed$/mu, 'consecutive tools stay together; failure is in words');
  assert.match(text, /^ {2}✔ Finished; waiting for you\.$/mu);
  assert.doesNotMatch(text, /^(?:You|Claude|Tool): /mu, 'no repeated speaker prefixes');
  // A blank row before each user turn and between prose and activity.
  const user = rows.findIndex(row => row.startsWith('› '));
  assert.equal(rows[user + 1], '');
});

test('prose wraps at words with a hanging indent and never splits a word mid-line', () => {
  const rows = plain(renderSemanticAgentView(conversation(), view(), 40, 40));
  const prose = rows.filter(row => /^ {2}(?:Two|covering|non-integer|addition|0\.3|will)/u.test(row) || /^ {2}[a-z0-9]/u.test(row));
  assert.ok(prose.length > 2);
  for (const row of rows) assert.ok(displayWidth(row) <= 40, JSON.stringify(row));
  const words = rows.join(' ').split(/\s+/u);
  for (const word of ['Floating-point', 'non-integer', 'negative', 'covering:']) assert.ok(words.includes(word), `${word} is whole`);
});

test('every width fits in display cells, including wide characters and very narrow terminals; resize re-lays out', () => {
  const s = conversation();
  pushEvent(s, {kind: 'assistant', text: '表示幅のテスト: 全角文字は二つのセルを使います。 An unbroken-identifier-that-is-much-longer-than-a-narrow-terminal-line.'});
  pushEvent(s, {kind: 'settled', ok: true});
  for (const columns of [12, 20, 32, 60, 120, 200]) {
    const rendered = renderSemanticAgentView(s, view('a draft'), columns, 30);
    assert.equal(rendered.length, 30);
    for (const row of rendered) assert.ok(displayWidth(row) <= columns, `${columns}: ${JSON.stringify(stripAnsi(row))}`);
    assert.ok(rendered.some(row => /Waiting/u.test(stripAnsi(row))), 'the state survives every width');
  }
});

test('narrow header gives way in order: identity, then the start of the path; state and project survive', () => {
  const s = conversation();
  s.cwd = `${process.env.HOME}/Projects/clients/acme/very-long-repository-name`;
  const rows = plain(renderSemanticAgentView(s, view(), 40, 30, {profileLabel: 'Claude account 2', branch: 'feature/x'}));
  const place = rows.find(row => /very-long-repository-name/u.test(row))!;
  assert.doesNotMatch(place, /Claude account 2/u, 'the identity gives way first');
  assert.match(place, /^ {2}…\S*\/very-long-repository-name$/u, 'the project name stays whole; the branch gives way before it');
  assert.ok(rows.some(row => /^─ Waiting for you/u.test(row)), 'the state survives on the composer rule');
});

test('state feedback: working offers interrupt; approvals and questions are marked in words and glyph', () => {
  const s = conversation();
  pushEvent(s, {kind: 'user', text: 'Run it again'});
  let rows = plain(renderSemanticAgentView(s, view(), 90, 24));
  assert.match(rows.at(-3)!, /^─ Working/u);
  assert.match(rows.at(-1)!, /Ctrl\+C interrupt/u);
  pushEvent(s, {kind: 'approval', requestId: 'r1', tool: 'Edit', target: 'src/sum.js'});
  rows = plain(renderSemanticAgentView(s, view(), 90, 24));
  assert.ok(rows.some(row => /^─ ◆ Needs approval/u.test(row)), 'attention in words and glyph on the composer rule');
  assert.ok(rows.some(row => /^◆ Permission pending · Shift\+Tab or \/approval to review$/u.test(row)));
  assert.ok(rows.some(row => /^ {2}◆ Approval requested: Edit src\/sum\.js$/u.test(row)));
});

test('multiline drafts: continuation rows align under the text, the caret follows the cursor, long drafts collapse', () => {
  const v = view();
  const s = conversation();
  const host = {shellEmpty: true, send: () => true, answer: () => true, cancel: () => {}, copy: () => {}, copyReply: () => {}};
  for (const character of 'first line') handleAgentInput(v, s, {kind: 'text', value: character}, host);
  handleAgentInput(v, s, {kind: 'newline'}, host);
  for (const character of 'second') handleAgentInput(v, s, {kind: 'text', value: character}, host);
  let rows = plain(renderSemanticAgentView(s, v, 60, 20));
  assert.equal(rows.at(-3), '❯ first line');
  assert.equal(rows.at(-2), '  second▏');
  handleAgentInput(v, s, {kind: 'left'}, host);
  rows = plain(renderSemanticAgentView(s, v, 60, 20));
  assert.equal(rows.at(-2), '  secon▏d', 'caret at the cursor, not the end');
  for (let index = 0; index < 8; index += 1) { handleAgentInput(v, s, {kind: 'lineEnd'}, host); handleAgentInput(v, s, {kind: 'newline'}, host); handleAgentInput(v, s, {kind: 'text', value: `l${index}`}, host); }
  rows = plain(renderSemanticAgentView(s, v, 60, 20));
  assert.ok(rows.some(row => /^ {2}\d+ earlier lines$/u.test(row)));
  assert.equal(rows.at(-2), '  l7▏');
  assert.equal(rows.length, 20);
});

test('Safe glyphs are ASCII markers; NO_COLOR emits no color escapes and keeps every distinction', () => {
  const before = process.env.NO_COLOR;
  setIconStyle('safe');
  process.env.NO_COLOR = '1';
  try {
    const rendered = renderSemanticAgentView(conversation(), view('draft'), 70, 30);
    assert.doesNotMatch(rendered.join('\n'), /\u001b\[(?:38|48);/u, 'no color under NO_COLOR');
    const rows = plain(rendered);
    const text = rows.join('\n');
    assert.match(text, /^> How is the sum helper tested/mu);
    assert.match(text, /^ {2}- Read src\/sum\.js$/mu);
    assert.match(text, /^ {2}\+ Finished; waiting for you\.$/mu);
    assert.match(rows.at(-2)!, /^> draft_$/u);
    assert.match(rows.at(-3)!, /^- Waiting for you -+$/u);
    assert.match(rows.at(-1)!, /Enter send/u);
    for (const row of rows) assert.ok(/^[\x20-\x7e·]*$/u.test(row), `ASCII apart from the shared separator: ${JSON.stringify(row)}`);
  } finally { setIconStyle('nerd'); if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before; }
});

test('hostile provider text renders inert; copied text and the source carry no presentation escapes', () => {
  const s = session();
  const hostile = 'ok \u001b]0;PWNED\u0007 \u001b[2J\u009b31m \u202eevil\u202c done';
  pushEvent(s, {kind: 'user', text: 'go'});
  pushEvent(s, {kind: 'assistant', text: hostile});
  pushEvent(s, {kind: 'tool', id: 't', name: 'Bash\u001b[31m', target: 'x\u0007y', status: 'started'});
  const rendered = renderSemanticAgentView(s, view(`draft \u001b]52;c;Zm9v\u0007`), 80, 20);
  for (const row of rendered) assert.doesNotMatch(row.replace(SGR, ''), CONTROL, JSON.stringify(row));
  assert.doesNotMatch(rendered.join(''), /PWNED|Zm9v|\u001b\[2J/u);
  let copied = '';
  const v = view();
  const host = {shellEmpty: true, send: () => true, answer: () => true, cancel: () => {}, copy: (text: string) => { copied = text; }, copyReply: () => {}};
  handleAgentInput(v, s, {kind: 'complete'}, host);
  handleAgentInput(v, s, {kind: 'up'}, host);
  handleAgentInput(v, s, {kind: 'text', value: 'C'}, host);
  assert.ok(copied.length > 0, 'something was copied');
  assert.doesNotMatch(copied, /\u001b|[\u0080-\u009f]/u, 'copied text has no terminal escapes');
  assert.doesNotMatch(copied, /[›▸✔]/u, 'and none of the presentation markers');
});

test('scrolling reveals earlier turns and keeps the height; the composer never scrolls away', () => {
  const s = session();
  for (let index = 0; index < 30; index += 1) { pushEvent(s, {kind: 'user', text: `question ${index}`}); pushEvent(s, {kind: 'assistant', text: `answer ${index}`}); }
  const v = view();
  const latest = plain(renderSemanticAgentView(s, v, 60, 16));
  assert.ok(latest.some(row => row.includes('answer 29')));
  v.scroll = 10;
  const earlier = plain(renderSemanticAgentView(s, v, 60, 16));
  assert.equal(earlier.length, 16);
  assert.ok(!earlier.some(row => row.includes('answer 29')));
  assert.match(earlier.at(-2)!, /^❯ /u);
});
