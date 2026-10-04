import test from 'node:test';
import assert from 'node:assert/strict';
import {askConversationRows, askKey, createAskState, receiveOutcome, renderAsk, submitText, askTranscriptText, type AskState} from '../src/ask/AskPanel.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {shouldFoldAsk} from '../src/output/FoldPolicy.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const plain = (rows: string[]) => rows.map(stripAnsi);
const choice = {kind: 'choose' as const, reason: 'ambiguous' as const, question: 'Which?', options: [{key: 'a', label: 'Alpha'}, {key: 'b', label: 'Beta'}]};

function conversation(exchanges: number): AskState {
  const state = createAskState();
  for (let index = 0; index < exchanges; index += 1) {
    submitText(state, `question number ${index}`);
    receiveOutcome(state, {kind: 'answer', capability: 'shell.current', text: `answer number ${index}`});
  }
  return state;
}

test('←→ and ↑↓ both move Ask choices; confirmations keep ←→; the footer says so', () => {
  const state = createAskState();
  receiveOutcome(state, choice);
  askKey(state, {kind: 'right'});
  assert.equal(state.selected, 1);
  askKey(state, {kind: 'left'});
  assert.equal(state.selected, 0);
  askKey(state, {kind: 'down'});
  assert.equal(state.selected, 1);
  assert.match(plain(renderAsk(state, 100)).at(-1)!, /Enter send.*←→\/↑↓ choose.*Esc close/u);
  const confirm = createAskState();
  receiveOutcome(confirm, {kind: 'proposal', capability: 'git.status', safety: 'read', confidence: 0.9, text: 'Show status?', action: {kind: 'read', command: {id: 'git.status'}}});
  askKey(confirm, {kind: 'right'});
  assert.equal(confirm.confirm, 'no');
  const idle = createAskState();
  assert.doesNotMatch(plain(renderAsk(idle, 100)).at(-1)!, /choose/u, 'nothing to choose, nothing advertised');
});

test('Ask presentation defaults to Chat, lives in Settings → Ask, and is independent of the transcript', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.askPresentation, 'chat');
  assert.equal(normalizePromptConfiguration({}).askPresentation, 'chat');
  assert.equal(normalizePromptConfiguration({askPresentation: 'normal'}).askPresentation, 'normal');
  const row = SETTINGS_ROWS.find(item => item.id === 'askPresentation')!;
  assert.equal(row.category, 'Ask');
  const changed = normalizePromptConfiguration({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), askPresentation: 'normal'});
  assert.equal(changed.transcriptPresentation, DEFAULT_PROMPT_CONFIGURATION.transcriptPresentation, 'the transcript keeps its own presentation');
});

test('Chat: your turns right-aligned, Ask left; Normal keeps both left; narrow falls back cleanly', () => {
  const state = conversation(2);
  const chat = plain(askConversationRows(state.turns, 100, 'chat'));
  const you = chat.find(row => row.includes('question number 0'))!;
  assert.equal(displayWidth(you.trimEnd()), 98, 'right edge of the content area');
  assert.ok(you.startsWith('     '), 'pushed right');
  assert.match(chat.find(row => row.includes('answer number 0'))!, /^ {2}answer/u);
  const normal = plain(askConversationRows(state.turns, 100, 'normal'));
  assert.match(normal.find(row => row.includes('question number 0'))!, /^ {2}question/u);
  for (const columns of [40, 24]) {
    const narrow = plain(askConversationRows(state.turns, columns, 'chat'));
    for (const row of narrow) assert.ok(displayWidth(row) <= columns, `${columns}: ${row}`);
    assert.match(narrow.find(row => row.includes('question'))!, /^ {2}question/u, 'narrow Chat stacks on the left');
  }
  assert.ok(chat.some(row => row.trim() === 'You') && chat.some(row => row.trim() === 'Ask'), 'role labels read without color');
});

test('a faint rule separates exchanges, not lines; choices follow the reply that asked', () => {
  const state = conversation(3);
  receiveOutcome(state, {...choice, question: 'Pick one'});
  const rows = plain(renderAsk(state, 100));
  const rules = rows.filter(row => /^ {2}─{10,}$/u.test(row));
  assert.equal(rules.length, 2, 'three exchanges, two rules');
  const question = rows.findIndex(row => row.includes('Pick one'));
  const alpha = rows.findIndex(row => row.includes('Alpha'));
  assert.ok(alpha > question && alpha - question <= 3, 'options attached to their reply');
});

test('bounded viewport: follows the newest, scrolls back, returns on send, survives resize', () => {
  const state = conversation(30);
  const rows = renderAsk(state, 100, {height: 20});
  assert.ok(rows.length <= 20, `panel stays within its height (${rows.length})`);
  assert.ok(plain(rows).some(row => row.includes('answer number 29')), 'newest visible');
  assert.ok(plain(rows).some(row => /earlier rows · PgUp/u.test(row)));
  askKey(state, {kind: 'pageUp'});
  askKey(state, {kind: 'pageUp'});
  const back = plain(renderAsk(state, 100, {height: 20}));
  assert.ok(!back.some(row => row.includes('answer number 29')), 'older history in view');
  assert.deepEqual(plain(renderAsk(state, 100, {height: 20})), back, 'redraws keep the place');
  askKey(state, {kind: 'wheelDown'});
  assert.ok(state.scroll > 0);
  for (const height of [12, 40, 8]) assert.ok(renderAsk(state, 100, {height}).length <= Math.max(height, 12));
  submitText(state, 'one more');
  assert.equal(state.scroll, 0, 'sending returns to the newest');
  assert.ok(plain(renderAsk(state, 100, {height: 20})).some(row => row.includes('one more')));
});

test('recorded Ask: structured turns only, folded by Output folding, Ctrl+O and the user choice win, save/restore', () => {
  const short = [{role: 'ask' as const, text: 'This session runs zsh.'}];
  const long = [{role: 'ask' as const, text: 'Which one?'}, {role: 'you' as const, text: '1'}, {role: 'ask' as const, text: 'Opening /resume.'},
    {role: 'you' as const, text: 'show my sessions'}, {role: 'ask' as const, text: 'Opening /sessions.'}, {role: 'you' as const, text: 'resume the other one'}, {role: 'ask' as const, text: 'Resumed.'}];
  const pair = [{role: 'ask' as const, text: 'Which one?'}, {role: 'you' as const, text: '1'}, {role: 'ask' as const, text: 'Opening /resume.'}];
  assert.equal(shouldFoldAsk('smart', pair), false, 'a short exchange stays open in Smart');
  assert.equal(shouldFoldAsk('never', long), false);
  assert.equal(shouldFoldAsk('smart', short), false, 'a short factual answer stays open');
  assert.equal(shouldFoldAsk('smart', long), true);
  assert.equal(shouldFoldAsk('always', short), true);

  const output = new OutputBuffer();
  output.setOutputFolding('smart');
  output.addAskInteraction('resume yesterday', long);
  const [record] = output.view().completed;
  assert.equal(record!.frontend, 'ask');
  assert.equal(record!.expanded, false);
  assert.deepEqual(record!.ask, {version: 1, turns: long});
  let rows = output.wrapped(100).map(row => row.plain);
  assert.ok(rows.some(row => row.includes('/ask resume yesterday')), 'the request identifies the block');
  assert.ok(rows.some(row => /Ask · 7 turns · sessions · Ctrl\+O/u.test(row)), 'a deterministic topic summary from the requests');
  assert.ok(!rows.some(row => row.includes('Opening /resume')));
  output.toggleExpanded(0);
  rows = output.wrapped(100).map(row => row.plain);
  assert.ok(rows.some(row => row.includes('Opening /resume')), 'Ctrl+O expands');
  assert.equal(output.applyAdvisoryFold(record!.startId, true), false, 'the user choice wins over later hints');
  assert.equal(output.recentShell(1), undefined, '/copy and recent commands skip Ask blocks');

  const restored = new OutputBuffer();
  restored.restoreTranscript(JSON.parse(JSON.stringify(output.transcript())));
  assert.deepEqual(restored.view().completed[0]!.ask, {version: 1, turns: long});
  assert.equal(restored.view().completed[0]!.expanded, true);
  const stored = JSON.stringify(output.transcript().records);
  assert.doesNotMatch(stored, /capability|confidence|rejected|\\u001b/u, 'no outcome or model data, no ANSI in records');

  const off = new OutputBuffer();
  off.setOutputFolding('never');
  off.addAskInteraction('x', long);
  assert.equal(off.view().completed[0]!.expanded, true);
});

test('older transcripts with flat Ask lines still restore and render', () => {
  const output = new OutputBuffer();
  output.addFrontendInteraction('/ask what shell', 'Ask: This session runs zsh.');
  const restored = new OutputBuffer();
  restored.restoreTranscript(JSON.parse(JSON.stringify(output.transcript())));
  assert.ok(restored.wrapped(100).some(row => row.plain.includes('This session runs zsh')));
});

test('askTranscriptText keeps only visible roles and text', () => {
  const state = conversation(2);
  state.rejected.add('secret-key');
  const recorded = askTranscriptText(state)!;
  assert.deepEqual(Object.keys(recorded.turns[0]!).sort(), ['role', 'text']);
  assert.doesNotMatch(JSON.stringify(recorded), /secret-key|capability/u);
});
