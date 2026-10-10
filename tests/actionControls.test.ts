import test from 'node:test';
import assert from 'node:assert/strict';
import {actionText, describeActions, hitAction, renderActionRow, type ActionControl, type ActionState} from '../src/ui/actionControls.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const STATES: ActionState[] = ['default', 'focused', 'selected', 'disabled', 'destructive', 'destructiveFocused'];
const control = (state: ActionState, label = 'Apply'): ActionControl => ({id: `Action.${label}`, label, state, ...(state === 'disabled' ? {reason: 'nothing selected'} : {})});

test('all six states look different without any color, in Unicode and in Safe/ASCII', () => {
  for (const safe of [false, true]) {
    for (const style of ['outline', 'plain', 'soft', 'filled'] as const) {
      const texts = STATES.map(state => actionText(control(state), style, 'square', safe));
      assert.equal(new Set(texts).size, STATES.length, `${safe ? 'safe' : 'unicode'} ${style}: ${texts.join(' | ')}`);
      if (safe) for (const text of texts) assert.match(text, /^[\x20-\x7e]+$/u, 'Safe marks are ASCII');
    }
  }
  assert.deepEqual(STATES.map(state => actionText(control(state), 'outline', 'square', true)),
    ['[ Apply ]', '[>Apply<]', '[x Apply ]', '[- Apply ]', '[! Apply ]', '[>!Apply<]']);
});

test('geometry and style are independent of state; rounded swaps only the brackets', () => {
  assert.equal(actionText(control('default'), 'outline', 'rounded', true), '( Apply )');
  assert.equal(actionText(control('focused'), 'outline', 'rounded', true), '(>Apply<)');
  assert.equal(actionText(control('selected'), 'plain', 'square', false), '✓ Apply');
});

test('colour is only decoration: stripping it leaves exactly the plain text, and colour:false emits no escapes', () => {
  const controls = STATES.map(state => control(state, state));
  const coloured = renderActionRow(controls, {columns: 200, color: true, safe: true});
  const plain = renderActionRow(controls, {columns: 200, color: false, safe: true});
  assert.equal(coloured.rows.map(stripAnsi).join('\n'), plain.rows.join('\n'));
  assert.ok(!plain.rows.join('').includes('\u001b'));
  assert.deepEqual(plain.plain, plain.rows);
});

test('a disabled control says why, and one without a reason is not drawn at all', () => {
  const row = renderActionRow([control('default', 'Cancel'), control('disabled', 'Merge'), {id: 'Action.Dead', label: 'Dead', state: 'disabled'}], {columns: 80, color: false, safe: true});
  assert.equal(row.plain.length, 2);
  assert.match(row.plain[0]!, /\[- Merge \]/u);
  assert.doesNotMatch(row.plain.join('\n'), /Dead/u);
  assert.match(row.plain[1]!, /^Merge: nothing selected$/u);
  assert.deepEqual(describeActions([{...control('default', 'Cancel'), key: 'Esc'}, control('disabled', 'Merge'), {id: 'x', label: 'Dead', state: 'disabled'}]),
    ['Esc  Cancel', 'Merge (unavailable: nothing selected)']);
});

test('narrow windows: essential controls keep their words, the rest fold into a count, nothing overflows', () => {
  const controls: ActionControl[] = [{...control('focused', 'Confirm'), essential: true, key: 'Enter'}, {...control('default', 'Cancel'), key: 'Esc', essential: true},
    {...control('default', 'Open in browser'), key: 'o'}, {...control('default', 'Copy link'), key: 'c'}];
  for (const columns of [120, 60, 40, 30, 20, 12, 6]) {
    const row = renderActionRow(controls, {columns, color: false, safe: true});
    for (const text of row.plain) assert.ok(displayWidth(text) <= columns, `${columns}: ${text}`);
  }
  const narrow = renderActionRow(controls, {columns: 40, color: false, safe: true});
  assert.match(narrow.plain.join(' '), /Confirm/u);
  assert.match(narrow.plain.join(' '), /Cancel/u);
  assert.match(narrow.plain.join(' '), /\+2/u, 'the others are counted, not silently dropped');
  assert.doesNotMatch(narrow.plain.join(' '), /browser/u);
  const tight = renderActionRow(controls, {columns: 14, color: false, safe: true});
  assert.match(tight.plain.join(' '), /Enter|Esc|C/u, 'the tightest layout falls back to keys');
});

test('wide windows keep one row; regions say where each control is, and the pointer reaches the same semantic action', () => {
  const controls = [control('default', 'Yes'), control('default', 'No')];
  const row = renderActionRow(controls, {columns: 80, color: false, safe: true});
  assert.equal(row.rows.length, 1);
  assert.deepEqual(row.regions, [{id: 'Action.Yes', row: 0, column: 1, end: 7}, {id: 'Action.No', row: 0, column: 9, end: 14}]);
  assert.equal(hitAction(row.regions, 0, 3), 'Action.Yes');
  assert.equal(hitAction(row.regions, 0, 8), undefined, 'the gap is not a control');
  assert.equal(hitAction(row.regions, 0, 12), 'Action.No');
  assert.equal(hitAction(row.regions, 1, 3), undefined);
});

test('hostile labels are drawn as text only: no escapes, bidi, newlines or oversize', () => {
  const hostile = control('default', '\u001b[2JApply‮\nnow\u0007' + 'x'.repeat(200));
  const row = renderActionRow([hostile], {columns: 60, color: false, safe: false});
  const text = row.plain.join('');
  assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f‮]/u);
  assert.ok(displayWidth(text) <= 60);
  assert.match(text, /Apply/u);
});

test('keys can be shown after each control and are kept in the measured width', () => {
  const row = renderActionRow([{...control('focused', 'Apply'), key: 'Enter'}, {...control('default', 'Cancel'), key: 'Esc'}], {columns: 80, color: false, safe: true, keys: true});
  assert.equal(row.plain[0], '[>Apply<] Enter [ Cancel ] Esc');
  for (const columns of [30, 16, 8]) for (const text of renderActionRow([{...control('focused', 'Apply'), key: 'Enter'}, {...control('default', 'Cancel'), key: 'Esc'}], {columns, color: false, safe: true, keys: true}).plain) assert.ok(displayWidth(text) <= columns, `${columns}: ${text}`);
});
