import assert from 'node:assert/strict';
import test from 'node:test';
import type {Key} from '../src/terminal/keys.js';
import {actionControls, DRAFT_PANEL_ACTIONS, enabledActions, renderActionHelp, resolveAction, type UiAction} from '../src/ui/actions.js';
import {createPalette, handlePaletteKey, paletteActions, renderPalette} from '../src/ui/CommandPalette.js';
import {createLayoutPanel, renderLayoutPanel} from '../src/ui/LayoutPanel.js';

const strip = (text: string) => text.replace(/\u001B\[[0-9;]*m/gu, '');
const key = (kind: string): Key => ({kind} as Key);

test('disabled actions are neither resolved nor shown in help', () => {
  const actions: UiAction[] = [
    {id: 'a', label: 'alpha', keyLabel: 'A', kinds: ['enter']},
    {id: 'b', label: 'beta', keyLabel: 'B', kinds: ['escape'], enabled: false},
  ];
  assert.deepEqual(enabledActions(actions).map(action => action.id), ['a']);
  assert.equal(resolveAction(actions, key('enter'))?.id, 'a');
  assert.equal(resolveAction(actions, key('escape')), undefined);
  assert.deepEqual(actionControls(actions), [['A', 'alpha']]);
  assert.equal(strip(renderActionHelp(actions)), 'A alpha');
});

test('draft panels keep complete keyboard operation with derived help', () => {
  for (const kind of ['up', 'down', 'left', 'right', 'enter', 'escape']) {
    assert.ok(resolveAction(DRAFT_PANEL_ACTIONS, key(kind)), `${kind} is bound`);
  }
  assert.equal(strip(renderActionHelp(DRAFT_PANEL_ACTIONS)), '↑↓ move · ←→ change · Enter save · Esc cancel');
});

test('layout panel footer is generated from its actions, including at narrow widths', () => {
  const state = createLayoutPanel({composerPosition: 'bottom', transcriptPresentation: 'flow'} as never);
  const wide = renderLayoutPanel(state, 80, 30).map(strip);
  assert.ok(wide.some(row => row.includes('↑↓ move · ←→ change · Enter save · Esc cancel')));
  for (const row of renderLayoutPanel(state, 24, 30).map(strip)) assert.ok([...row].length <= 24);
});

test('palette help reflects what is available', () => {
  const state = createPalette([
    {id: 'one', label: 'One', category: 'c', detail: 'd'},
    {id: 'two', label: 'Two', category: 'c', detail: 'd'},
  ] as never);
  const help = (rows: string[]) => strip(rows[rows.length - 1]!);
  assert.match(help(renderPalette(state, 80, 20)), /↑↓ move · Enter run/u);
  state.query = 'zzz-nothing';
  const empty = help(renderPalette(state, 80, 20));
  assert.doesNotMatch(empty, /Enter/u);
  assert.doesNotMatch(empty, /↑↓/u);
  assert.match(empty, /Esc close/u);
  assert.equal(handlePaletteKey(key('enter'), state), undefined);
  assert.deepEqual(enabledActions(paletteActions(1)).map(action => action.id), ['search', 'run', 'close']);
});

test('palette Enter still chooses the selected item', () => {
  const state = createPalette([{id: 'one', label: 'One', category: 'c', detail: 'd'}] as never);
  assert.equal((handlePaletteKey(key('enter'), state) as {id: string}).id, 'one');
});
