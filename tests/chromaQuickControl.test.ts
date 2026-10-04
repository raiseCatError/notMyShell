import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {chromaQuickControl, handlePromptPanelKey, renderPromptPanel, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

function panel(preset: 'off' | 'aurora'): PromptPanelState {
  const draft = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  draft.provider = 'nmsh';
  draft.presentation = {...draft.presentation, preset};
  return {onboarding: false, step: 'appearance', view: 'main', selectedIndex: 0, draft, saved: structuredClone(draft)};
}
const previews = (state: PromptPanelState) => Array.from({length: 40}, (_, index) => `preview-${index}`);
const text = (state: PromptPanelState, columns = 140) => renderPromptPanel(state, columns, ['p'], previews(state)).map(stripAnsi);

test('Chroma On: the gallery says previews are colorized and offers Turn Off; Off says base colors and offers Turn On', () => {
  const on = text(panel('aurora'));
  assert.ok(on.some(row => /✦ Chroma ON · previews are colorized\s+\[C\] Turn Off/u.test(row)), on.join('\n'));
  assert.ok(!on.some(row => /previews include Chroma/u.test(row)), 'replaces the old sentence');
  const off = text(panel('off'));
  assert.ok(off.some(row => /Chroma OFF · showing base theme colors\s+\[C\] Turn On/u.test(row)));
  assert.ok(!off.some(row => /Chroma ON/u.test(row)), 'Off removes the On notice');
  assert.match(chromaQuickControl(true, 140), /\u001b\[1m/u, 'On is bold and starred, not only colored');
});

test('C toggles the one Chroma setting in the draft and restores the palette it turned Off', () => {
  const state = panel('aurora');
  assert.equal(handlePromptPanelKey({kind: 'text', value: 'c'}, state), true);
  assert.equal(state.draft.presentation.preset, 'off', 'the draft palette is the state; nothing else is added to configuration');
  assert.deepEqual(Object.keys(state.draft).sort(), Object.keys(DEFAULT_PROMPT_CONFIGURATION).sort());
  handlePromptPanelKey({kind: 'text', value: 'C'}, state);
  assert.equal(state.draft.presentation.preset, 'aurora');
  const fresh = panel('off');
  handlePromptPanelKey({kind: 'text', value: 'c'}, fresh);
  assert.notEqual(fresh.draft.presentation.preset, 'off', 'turning On from a saved Off picks a palette');
  const chroma = {...panel('aurora'), view: 'chroma' as const};
  handlePromptPanelKey({kind: 'text', value: 'c'}, chroma);
  assert.equal(chroma.draft.presentation.preset, 'aurora', 'detailed Chroma controls stay in the Chroma tab; C is the gallery shortcut only');
});

test('narrow widths keep state and toggle first and never corrupt the theme list', () => {
  for (const columns of [60, 40, 28]) {
    const row = stripAnsi(chromaQuickControl(true, columns));
    assert.match(row, /^✦ Chroma ON/u);
    assert.match(row, /Turn Off/u);
    const rows = text(panel('aurora'), columns);
    for (const line of rows) assert.ok(displayWidth(line) <= columns);
    assert.ok(rows.filter(line => /preview-\d+/u.test(line)).length > 3, 'themes still listed');
  }
});
