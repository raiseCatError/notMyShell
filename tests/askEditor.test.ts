import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyAskCompletion, askKey, createAskState, receiveOutcome, renderAsk, visibleOptions} from '../src/ask/AskPanel.js';
import {completePath} from '../src/ask/files.js';
import {stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const type = (state: ReturnType<typeof createAskState>, text: string) => { for (const value of text) askKey(state, {kind: 'text', value}); };
const press = (state: ReturnType<typeof createAskState>, ...keys: Key['kind'][]) => { for (const kind of keys) askKey(state, {kind} as Key); };

test('Ask input is a real editor: caret moves, words, selection and deletion', () => {
  const state = createAskState();
  type(state, 'open the packge file');
  press(state, 'wordLeft', 'wordLeft', 'right', 'right', 'right', 'right');
  type(state, 'a');
  assert.equal(state.input, 'open the package file');
  press(state, 'lineHome');
  assert.equal(state.editor.cursorIndex, 0);
  press(state, 'lineEnd', 'deleteWord');
  assert.equal(state.input, 'open the package ');
  press(state, 'selectWordLeft', 'backspace');
  assert.equal(state.input, 'open the ');
  press(state, 'deleteLineBefore');
  assert.equal(state.input, '');
  askKey(state, {kind: 'paste', value: 'add this\r\n  "a": 1'});
  assert.equal(state.input, 'add this\n  "a": 1');
  const rows = renderAsk(state, 80).map(stripAnsi);
  assert.ok(rows.some(row => row.includes('› add this')) && rows.some(row => row.includes('"a": 1')), 'multiline input shows every line');
});

test('←→ edit text when there is text; on an empty input they move the choice', () => {
  const state = createAskState();
  receiveOutcome(state, {kind: 'choose', reason: 'ambiguous', question: 'Which?', options: [{key: 'a', label: 'Alpha'}, {key: 'b', label: 'Beta'}]});
  press(state, 'right');
  assert.equal(state.selected, 1);
  type(state, 'xy');
  press(state, 'left');
  assert.equal(state.selected, 0, 'typing resets the choice');
  assert.equal(state.editor.cursorIndex, 1, '← moved the caret, not the choice');
  // Confirmation: ←→ switch Yes/No only while the input is empty.
  const confirm = createAskState();
  receiveOutcome(confirm, {kind: 'proposal', capability: 'git.status', safety: 'mutate', confidence: 1, text: 'Run?', action: {kind: 'git', argv: ['git', 'add', '-A'], risk: 'mutate'}});
  assert.equal(confirm.confirm, 'no');
  press(confirm, 'left');
  assert.equal(confirm.confirm, 'yes');
});

test('Tab completes real paths after the first word; several matches become a list that fills, never sends', () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-ask-complete-'));
  try {
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, 'package-lock.json'), '{}');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'index.ts'), '');
    writeFileSync(join(root, 'src', 'ask.ts'), '');
    const unique = completePath('open sr', 7, root, root)!;
    assert.equal(unique.text, 'open src/');
    const state = createAskState();
    type(state, 'open pa');
    const event = askKey(state, {kind: 'complete'});
    assert.deepEqual(event, {kind: 'complete', text: 'open pa', caret: 7});
    applyAskCompletion(state, completePath(state.input, state.editor.cursorIndex, root, root)!);
    assert.equal(state.input, 'open package');
    assert.deepEqual(visibleOptions(state).map(option => option.label), ['package-lock.json', 'package.json']);
    press(state, 'down');
    const sent = askKey(state, {kind: 'enter'});
    assert.equal(sent, undefined, 'choosing a completion sends nothing');
    assert.equal(state.input, 'open package.json ');
    assert.equal(state.turns.length, 0);
    const inside = completePath('open src/', 9, root, root)!;
    assert.deepEqual(inside.candidates.map(item => item.value), ['src/ask.ts', 'src/index.ts']);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
