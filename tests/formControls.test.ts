import assert from 'node:assert/strict';
import test from 'node:test';
import type {Key} from '../src/terminal/keys.js';
import {
  createConfirm, editText, handleConfirmKey, handleMultiSelectKey, handleSelectKey, renderConfirm, renderField, renderMultiSelect,
  renderSelect, renderTextValue, renderToggle, stepIndex, toggleMember, toggleValue,
} from '../src/ui/formControls.js';
import {adjustSettingsRow, SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';

const key = (kind: string, value?: string): Key => ({kind, value} as Key);
const text = (value: string) => key('text', value);
const hasEscape = (value: string) => value.includes('\u001B');

test('toggle and select report proposals without owning state', () => {
  assert.equal(toggleValue(false), true);
  assert.equal(stepIndex(3, 0, -1), 2);
  assert.equal(stepIndex(3, 2, 1), 0);
  assert.equal(stepIndex(0, 0, 1), 0);
  assert.equal(handleSelectKey(key('left'), 3, 0), 2);
  assert.equal(handleSelectKey(text(' '), 3, 0), 1);
  assert.equal(handleSelectKey(key('up'), 3, 0), undefined);
});

test('multi-select keeps option order and moves with the keyboard only', () => {
  assert.deepEqual(toggleMember([2], 0), [0, 2]);
  assert.deepEqual(toggleMember([0, 2], 2), [0]);
  let state = {cursor: 0, selected: [] as readonly number[]};
  state = handleMultiSelectKey(key('down'), 3, state)!;
  state = handleMultiSelectKey(text(' '), 3, state)!;
  assert.deepEqual(state, {cursor: 1, selected: [1]});
  assert.equal(handleMultiSelectKey(key('enter'), 3, state), undefined);
});

test('text field edits, pastes and clears', () => {
  assert.equal(editText('ab', text('c')), 'abc');
  assert.equal(editText('ab', key('paste', 'x\ny')), 'abxy');
  assert.equal(editText('ab', key('backspace')), 'a');
  assert.equal(editText('ab', key('deleteWord')), '');
  assert.equal(editText('ab', key('up')), undefined);
});

test('confirmation defaults to no and Esc always cancels', () => {
  const state = createConfirm();
  assert.equal(handleConfirmKey(key('enter'), state), 'cancel');
  assert.equal(handleConfirmKey(key('right'), state), 'changed');
  assert.equal(state.choice, 'yes');
  assert.equal(handleConfirmKey(key('enter'), state), 'confirm');
  assert.equal(handleConfirmKey(key('escape'), state), 'cancel');
  assert.equal(handleConfirmKey(text('y'), createConfirm()), 'confirm');
});

test('plain rendering carries focus, changed state and errors in text', () => {
  const plain = {color: false, focused: true};
  for (const rendered of [renderToggle(true, plain), renderSelect('Daily', plain), renderMultiSelect(['a', 'b'], [1], 0, plain),
    renderTextValue('hi', 'Search', plain), renderTextValue('', 'Search', plain), renderConfirm(createConfirm(), plain)]) {
    assert.equal(hasEscape(rendered), false, rendered);
  }
  assert.equal(renderToggle(false, plain), '[ ] Off');
  const rows = renderField({label: 'Name', control: renderTextValue('x', '', plain), description: 'Shown in the prompt',
    changed: true, error: 'too short', focused: true, color: false}, 60);
  assert.deepEqual(rows, ['> Name  x_ (changed)', '  Shown in the prompt', '  Error: too short']);
});

test('styled rendering stays within narrow widths', () => {
  const rows = renderField({label: 'A long setting label', control: renderSelect('A long option value'), description: 'x'.repeat(80), focused: true}, 20);
  for (const row of rows) assert.ok([...row.replace(/\u001B\[[0-9;]*m/gu, '')].length <= 20);
});

test('settings rows use the shared toggle and select behavior', () => {
  const toggle = SETTINGS_ROWS.find(row => row.control === 'boolean')!;
  const before = toggle.control === 'boolean' && toggle.get(DEFAULT_PROMPT_CONFIGURATION);
  const flipped = adjustSettingsRow(toggle, DEFAULT_PROMPT_CONFIGURATION, 1)!;
  assert.equal(toggle.control === 'boolean' && toggle.get(flipped), !before);
  const select = SETTINGS_ROWS.find(row => row.control === 'enum')!;
  if (select.control !== 'enum') throw new Error('unreachable');
  const back = adjustSettingsRow(select, DEFAULT_PROMPT_CONFIGURATION, -1)!;
  assert.equal(select.index(back), stepIndex(select.options.length, select.index(DEFAULT_PROMPT_CONFIGURATION), -1));
});
