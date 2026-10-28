import test from 'node:test';
import assert from 'node:assert/strict';
import {createWelcomeEditor, welcomeEditorKey, renderWelcomeEditor} from '../src/welcome/editor.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {appearanceHubKey, createAppearanceHub} from '../src/appearance/AppearanceHub.js';
import {displayWidth} from '../src/util/text.js';

test('editor Esc cancels a field and restores draft and selection, then closes without saving', () => {
  const state = createWelcomeEditor(normalizePromptConfiguration({}));
  state.selected = 6; const before = structuredClone(state.draft);
  welcomeEditorKey(state, {kind: 'enter'}, 0);
  welcomeEditorKey(state, {kind: 'text', value: 'changed'}, 0);
  welcomeEditorKey(state, {kind: 'escape'}, 0);
  assert.deepEqual(state.draft, before); assert.equal(state.selected, 6);
  assert.equal(welcomeEditorKey(state, {kind: 'escape'}, 0), 'close');
});

test('editor saves only with S, has bounded preview and controls at 80x24 and narrow sizes', () => {
  const state = createWelcomeEditor(normalizePromptConfiguration({}));
  welcomeEditorKey(state, {kind: 'right'}, 0);
  assert.equal(welcomeEditorKey(state, {kind: 'text', value: 's'}, 0), 'save');
  for (const columns of [40, 80, 120]) {
    const rows = renderWelcomeEditor(state, columns, 20, {shell: 'zsh'}, {color: false}, 0);
    assert.ok(rows.length <= 20); assert.ok(rows.every(r => displayWidth(r) <= columns));
    assert.match(rows.join(''), /Esc/);
  }
});

test('Welcome is appended to Appearance NMSh rows and opens its canonical editor', () => {
  const hub = createAppearanceHub('generic'); hub.selected = 8;
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, normalizePromptConfiguration({})), {kind: 'open', destination: 'welcome'});
});

test('an unchanged editor preview retains the legacy Vespyr card and save explicitly selects the native layout', () => {
  const config = normalizePromptConfiguration({welcomeStudio: {customized: false}});
  const state = createWelcomeEditor(config);
  const legacy = {identity: {version: '1', commit: 'abc'}, cwd: '/work', shell: 'zsh' as const};
  renderWelcomeEditor(state, 80, 24, {shell: 'zsh'}, {color: true, legacy}, 0);
  assert.ok(state.preview?.rows.some(r => r.plain.includes('build abc')));
  welcomeEditorKey(state, {kind: 'text', value: 's'}, 0);
  assert.equal(state.draft.customized, true);
});
