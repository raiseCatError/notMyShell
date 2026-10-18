import {isolateConfig} from './support/isolatedConfig.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {pushEvent, type AgentSession} from '../src/agents/sessions/model.js';
import {AgentTranscript} from '../src/agents/transcript/model.js';
import {renderSemanticAgentView, type AgentViewLayout, type AgentViewOptions} from '../src/agents/transcript/view.js';
import {AgentInputController} from '../src/agents/input/controller.js';
import {handleAgentInput} from '../src/agents/input/surface.js';
import type {AgentViewState} from '../src/agents/sessions/AgentViews.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

function session(extra: Partial<AgentSession> = {}): AgentSession {
  return {id: 'a', harness: 'claude', level: 'managed', title: 'Sum helper', cwd: `${process.env.HOME}/Projects/demo`, startedAt: 0,
    state: 'waiting', events: [], attention: false, updatedAt: 0, transcript: new AgentTranscript(), ...extra};
}
const view = (input = ''): AgentViewState => ({sessionId: 'a', input, expanded: new Set(), scroll: 0, controller: new AgentInputController()});
const host = {shellEmpty: true, send: () => true, answer: () => true, cancel: () => {}, copy: () => {}, copyReply: () => {}};
const type = (v: AgentViewState, s: AgentSession, text: string) => { for (const value of text) handleAgentInput(v, s, {kind: 'text', value}, host); };

function draw(s: AgentSession, v: AgentViewState, columns: number, height: number, options: AgentViewOptions = {}): {rows: string[]; caret?: {row: number; column: number}} {
  const layout: AgentViewLayout = {};
  const rows = renderSemanticAgentView(s, v, columns, height, {}, {hardwareCaret: true, ...options, layout}).map(stripAnsi);
  return {rows, caret: layout.caret};
}
/** The text left of the caret on its row, as the terminal would show it. */
const beforeCaret = (rows: string[], caret: {row: number; column: number}) => {
  let out = '', width = 0;
  for (const ch of rows[caret.row]!) { if (width + displayWidth(ch) > caret.column) break; out += ch; width += displayWidth(ch); }
  return out;
};

function chat(): AgentSession {
  const s = session();
  pushEvent(s, {kind: 'model', model: 'fixture-model'});
  pushEvent(s, {kind: 'user', text: 'first question'});
  pushEvent(s, {kind: 'assistant', text: 'first answer'});
  pushEvent(s, {kind: 'tool', id: 't1', name: 'Read', target: 'src/sum.js', status: 'started'});
  pushEvent(s, {kind: 'assistant', text: 'second answer'});
  pushEvent(s, {kind: 'settled', ok: true});
  pushEvent(s, {kind: 'user', text: 'second question'});
  pushEvent(s, {kind: 'assistant', text: 'third answer'});
  pushEvent(s, {kind: 'settled', ok: true});
  return s;
}

test('caret: an empty draft has a real insertion point after the prompt, with no drawn caret glyph', () => {
  for (const columns of [12, 40, 120]) {
    const {rows, caret} = draw(session(), view(), columns, 20);
    assert.ok(caret, `${columns}: the view reports a caret`);
    assert.equal(rows[caret.row]!.startsWith('❯ '), true);
    assert.equal(caret.column, 2, 'right after the prompt glyph and its space');
    assert.ok(!rows.join('\n').includes('▏'), 'no painted caret: the terminal draws the one caret');
  }
});

test('caret: typing, moving, deleting, pasting and wide characters keep the caret on the editor cursor', () => {
  const s = session(), v = view();
  type(v, s, 'hello');
  let {rows, caret} = draw(s, v, 60, 20);
  assert.equal(beforeCaret(rows, caret!), '❯ hello');
  handleAgentInput(v, s, {kind: 'left'}, host);
  handleAgentInput(v, s, {kind: 'left'}, host);
  ({rows, caret} = draw(s, v, 60, 20));
  assert.equal(beforeCaret(rows, caret!), '❯ hel');
  handleAgentInput(v, s, {kind: 'backspace'}, host);
  ({rows, caret} = draw(s, v, 60, 20));
  assert.equal(rows[caret!.row], '❯ helo');
  assert.equal(beforeCaret(rows, caret!), '❯ he');
  handleAgentInput(v, s, {kind: 'paste', value: '表示X'}, host);
  ({rows, caret} = draw(s, v, 60, 20));
  assert.equal(beforeCaret(rows, caret!), '❯ he表示X', 'wide characters take two cells each');
  assert.equal(caret!.column, 2 + 2 + 4 + 1);
});

test('caret: multiline and wrapped drafts; Up and Down move between the rows the screen shows', () => {
  const s = session(), v = view();
  type(v, s, 'first line');
  handleAgentInput(v, s, {kind: 'newline'}, host);
  type(v, s, 'second');
  let {rows, caret} = draw(s, v, 40, 20);
  assert.equal(rows[caret!.row], '  second', 'continuation rows align under the text');
  assert.equal(rows[caret!.row - 1], '❯ first line');
  handleAgentInput(v, s, {kind: 'up'}, host);
  ({rows, caret} = draw(s, v, 40, 20));
  assert.equal(rows[caret!.row], '❯ first line', 'Up reaches the first row');
  assert.equal(beforeCaret(rows, caret!), '❯ first ', 'and keeps the column');
  handleAgentInput(v, s, {kind: 'down'}, host);
  ({rows, caret} = draw(s, v, 40, 20));
  assert.equal(rows[caret!.row], '  second');
  // A draft wider than a narrow terminal wraps; the caret follows onto the wrapped row.
  const w = view();
  type(w, s, 'an agent message that is much wider than this narrow view');
  ({rows, caret} = draw(s, w, 20, 20));
  assert.ok(caret!.column < 20);
  assert.equal(beforeCaret(rows, caret!), '  iew', 'wrapped exactly as the shell composer wraps (by cell), caret at the end');
  handleAgentInput(w, s, {kind: 'up'}, host);
  const up = draw(s, w, 20, 20);
  assert.equal(up.caret!.row, caret!.row - 1, 'Up moves one wrapped row, at the width that was drawn');
});

test('caret: only while the agent draft owns typing; approvals, questions and transcript focus have none', () => {
  const s = chat(), v = view();
  assert.ok(draw(s, v, 80, 24).caret);
  handleAgentInput(v, s, {kind: 'complete'}, host);
  assert.equal(v.controller!.owner, 'TRANSCRIPT');
  assert.equal(draw(s, v, 80, 24).caret, undefined);
  const approving = chat();
  pushEvent(approving, {kind: 'user', text: 'edit it'});
  pushEvent(approving, {kind: 'approval', requestId: 'r1', tool: 'Edit', target: 'src/sum.js'});
  const a = view();
  handleAgentInput(a, approving, {kind: 'focusPrevious'}, host);
  assert.equal(a.controller!.owner, 'APPROVAL');
  const shown = draw(approving, a, 80, 24);
  assert.equal(shown.caret, undefined);
  assert.ok(shown.rows.some(row => /Permission: Edit/u.test(row)), 'the approval is clearly its own focus');
});

test('composer position: Bottom puts the composer last; Top puts it first with the conversation below it', () => {
  const s = chat();
  const bottom = draw(s, view(), 70, 20, {composerPosition: 'bottom'});
  assert.match(bottom.rows.at(-1)!, /Enter send/u);
  assert.equal(bottom.caret!.row, 18);
  const top = draw(s, view(), 70, 20, {composerPosition: 'top'});
  assert.equal(top.caret!.row, 0);
  assert.match(top.rows[0]!, /^❯ /u);
  assert.match(top.rows[1]!, /^─ Waiting for you/u);
  assert.match(top.rows[2]!, /\S/u, 'the conversation starts right under the composer rule');
  assert.match(top.rows.at(-1)!, /Enter send/u);
  for (const rows of [bottom.rows, top.rows]) assert.equal(rows.length, 20);
});

test('Normal and Chat: same chronological order; Chat sets your turns right and names the agent', () => {
  const s = chat();
  const order = (rows: string[]) => ['first question', 'first answer', 'Read src/sum.js', 'second answer', 'second question', 'third answer']
    .map(text => rows.findIndex(row => row.includes(text)));
  for (const presentation of ['normal', 'chat'] as const) {
    const {rows} = draw(s, view(), 90, 40, {presentation});
    const at = order(rows);
    assert.ok(at.every(index => index >= 0), `${presentation}: every event is shown`);
    assert.deepEqual([...at].sort((x, y) => x - y), at, `${presentation}: chronological`);
    assert.equal(rows.filter(row => row.includes('first answer')).length, 1, 'no duplicates');
  }
  const normal = draw(s, view(), 90, 40).rows;
  assert.ok(normal.some(row => row === '› first question'));
  const chatRows = draw(s, view(), 90, 40, {presentation: 'chat'}).rows;
  const you = chatRows.find(row => row.includes('first question'))!;
  assert.ok(you.endsWith('first question') && you.startsWith(' '.repeat(40)), 'your turn is right-aligned');
  assert.ok(chatRows.some(row => /^ {2}Claude$/u.test(row)), 'the agent is named in Chat');
  assert.ok(chatRows.some(row => /^ +You$/u.test(row)), 'and you are labelled');
  assert.ok(chatRows.some(row => /^ {2}▸ Read src\/sum\.js$/u.test(row)), 'tool activity stays a quiet row');
});

test('Chat in Safe glyphs and NO_COLOR: no color escapes, ASCII markers, every row fits narrow widths', () => {
  const before = process.env.NO_COLOR;
  setIconStyle('safe');
  process.env.NO_COLOR = '1';
  try {
    for (const columns of [24, 50, 100]) {
      for (const presentation of ['normal', 'chat'] as const) {
        const raw = renderSemanticAgentView(chat(), view('a draft'), columns, 24, {}, {presentation, hardwareCaret: true});
        assert.doesNotMatch(raw.join('\n'), /\u001b\[(?:38|48);/u);
        for (const row of raw.map(stripAnsi)) {
          assert.ok(displayWidth(row) <= columns, `${presentation} ${columns}: ${JSON.stringify(row)}`);
          assert.ok(/^[\x20-\x7e·…]*$/u.test(row), `${presentation} ${columns}: ${JSON.stringify(row)}`);
        }
      }
    }
  } finally { setIconStyle('nerd'); if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before; }
});

test('long conversations: scrollback reaches the start; new events never move a scrolled-back view', () => {
  const s = session();
  for (let index = 0; index < 60; index += 1) { pushEvent(s, {kind: 'user', text: `question ${index}`}); pushEvent(s, {kind: 'assistant', text: `answer ${index}`}); }
  const v = view();
  draw(s, v, 60, 16);
  v.scroll = 10_000;
  const oldest = draw(s, v, 60, 16).rows;
  assert.ok(oldest.some(row => row.includes('question 0')), 'the first turn is reachable');
  v.scroll = 30;
  const before = draw(s, v, 60, 16).rows;
  pushEvent(s, {kind: 'user', text: 'a new question'});
  pushEvent(s, {kind: 'assistant', text: 'a new answer'});
  const after = draw(s, v, 60, 16).rows;
  assert.deepEqual(after.slice(0, 12), before.slice(0, 12), 'the scrolled-back rows stay put');
  v.scroll = 0;
  assert.ok(draw(s, v, 60, 16).rows.some(row => row.includes('a new answer')), 'at the bottom, new rows show');
});

test('resume: a transcript rebuilt from its source renders the same conversation in the same order', () => {
  const original = chat();
  const rebuilt = session({transcript: new AgentTranscript()});
  for (const event of original.events) pushEvent(rebuilt, event);
  for (const presentation of ['normal', 'chat'] as const) {
    assert.deepEqual(draw(rebuilt, view(), 80, 30, {presentation}).rows, draw(original, view(), 80, 30, {presentation}).rows);
  }
});

function harness(config: object = {}): {app: TerminalApp; frames: TerminalFrame[]; cleanup: () => void} {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  const frames: TerminalFrame[] = [];
  app['renderer'].render = (frame: TerminalFrame) => { frames.push(frame); };
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 24})});
  app['fetchSuggestions'] = async () => {};
  app['presentationStarted'] = true;
  app['startupPending'] = false;
  app['configuration'] = normalizePromptConfiguration({...DEFAULT_PROMPT_CONFIGURATION, ...config});
  return {app, frames, cleanup: () => { app['stop'](0); app['session'].kill(); isolation.restore(); }};
}

for (const composerPosition of ['bottom', 'top'] as const) {
  test(`app (${composerPosition} composer): the terminal caret sits in the agent draft, leaves for approvals, and returns to the shell with its draft`, () => {
    const {app, frames, cleanup} = harness({composerPosition});
    try {
      app['editor'].insert('ls -la');
      const s = chat();
      app['agents'].sessions.push(s);
      app['openAgentView'](s.id);
      app['render']();
      let frame = frames.at(-1)!;
      assert.equal(frame.cursorVisible, true, 'one visible caret: the terminal\'s');
      let row = stripAnsi(frame.rows[frame.cursorRow - 1]!);
      assert.match(row, /^❯ /u, 'on the agent composer row');
      assert.equal(frame.cursorColumn, 3, 'right after the prompt');
      assert.ok(!frame.rows.some(item => stripAnsi(item).includes('▏')), 'no second, painted caret');
      for (const value of 'hi there') app['handleKey']({kind: 'text', value});
      app['render']();
      frame = frames.at(-1)!;
      row = stripAnsi(frame.rows[frame.cursorRow - 1]!);
      assert.equal(row.slice(0, frame.cursorColumn - 1), '❯ hi there', 'the caret follows typing');
      assert.equal(app['editor'].text, 'ls -la', 'the shell draft is untouched by agent typing');
      // A permission request takes focus: no text caret while it is reviewed.
      pushEvent(s, {kind: 'approval', requestId: 'r1', tool: 'Edit', target: 'src/sum.js'});
      app['handleKey']({kind: 'focusPrevious'});
      app['render']();
      assert.equal(frames.at(-1)!.cursorVisible, false, 'no caret while the approval owns the keys');
      app['handleKey']({kind: 'escape'});
      app['render']();
      assert.equal(frames.at(-1)!.cursorVisible, true, 'back to the draft, the caret returns');
      app['handleKey']({kind: 'escape'});
      app['render']();
      frame = frames.at(-1)!;
      assert.equal(app['agentView'], undefined, 'Esc returns to the shell');
      assert.equal(frame.cursorVisible, true);
      assert.equal(app['editor'].text, 'ls -la', 'with its own draft');
      assert.match(stripAnsi(frame.rows[frame.cursorRow - 1]!), /ls -la/u, 'and the caret back on the shell input');
      assert.equal(app['agentDrafts'].get(s.id)?.input, 'hi there', 'the agent draft is kept for later');
    } finally { cleanup(); }
  });
}
