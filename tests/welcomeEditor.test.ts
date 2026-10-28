import test from 'node:test';
import assert from 'node:assert/strict';
import {createWelcomeEditor, welcomeEditorKey, renderWelcomeEditor} from '../src/welcome/editor.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {appearanceHubKey, createAppearanceHub} from '../src/appearance/AppearanceHub.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

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

test('section tabs jump without mutating the draft, and a choice gallery cancels without losing edits', () => {
  const state = createWelcomeEditor(normalizePromptConfiguration({}));
  const draft = structuredClone(state.draft);
  welcomeEditorKey(state, {kind: 'complete'});
  assert.equal(state.selected, 6, 'next section is typography');
  assert.deepEqual(state.draft, draft);
  state.selected = 24;
  welcomeEditorKey(state, {kind: 'text', value: 'g'});
  const rows = renderWelcomeEditor(state, 80, 24, {}, {color: false}, 0).map(stripAnsi);
  assert.match(rows.join('\n'), /Choose preset/);
  assert.ok(rows.some(row => row.startsWith('›')));
  welcomeEditorKey(state, {kind: 'down'});
  welcomeEditorKey(state, {kind: 'escape'});
  assert.deepEqual(state.draft, draft);
  assert.equal(state.selected, 24);
});

test('all editor fields and pickers keep focus and complete controls in the four requested sizes', () => {
  for (const [columns, height] of [[120, 40], [80, 24], [60, 20], [40, 14]]) {
    const state = createWelcomeEditor(normalizePromptConfiguration({}));
    for (let selected = 0; selected < 33; selected++) {
      state.selected = selected;
      const rows = renderWelcomeEditor(state, columns!, height!, {}, {color: false}, 0);
      assert.ok(rows.length <= height! && rows.every(row => displayWidth(row) <= columns!));
      assert.ok(rows.map(stripAnsi).some(row => row.startsWith('›')), `focus ${selected} at ${columns}x${height}`);
      assert.match(stripAnsi(rows.join('\n')), /S save/);
      assert.match(stripAnsi(rows.at(-1)!), /Esc/);
    }
    state.picker = {directory: '/assets', entries: [{name: 'logo.png', path: '/assets/logo.png', directory: false}], selected: 0};
    const rows = renderWelcomeEditor(state, columns!, height!, {}, {color: false}, 0);
    assert.ok(rows.map(stripAnsi).some(row => row.startsWith('›') && row.includes('logo.png')));
    assert.match(stripAnsi(rows.at(-1)!), /Esc/);
  }
});

test('monochrome gallery, file browser, empty state and text/error views preserve editor actions', () => {
  const color = process.env.NMSH_COLOR, noColor = process.env.NO_COLOR;
  delete process.env.NMSH_COLOR; process.env.NO_COLOR = '1';
  try {
    for (const [columns, height] of [[120, 40], [80, 24], [60, 20], [40, 14]] as const) {
      const state = createWelcomeEditor(normalizePromptConfiguration({}));
      const check = (focus = true) => {
        const rows = renderWelcomeEditor(state, columns, height, {}, {color: false}, 0);
        assert.ok(rows.length <= height && rows.every(row => displayWidth(row) <= columns));
        assert.match(stripAnsi(rows.at(-1)!), /Esc/);
        assert.doesNotMatch(rows.join(''), /\x1b\[(?:38|48);/u);
        if (focus) assert.ok(rows.map(stripAnsi).some(row => row.startsWith('›')));
      };
      check();
      for (const field of [1, 5, 12, 24]) {
        state.selected = field; welcomeEditorKey(state, {kind: 'text', value: 'g'});
        check(); welcomeEditorKey(state, {kind: 'escape'});
      }
      state.input = {kind: 'export', value: '/local/welcome.json', before: structuredClone(state.draft), selected: 29};
      state.message = 'Could not create file; draft kept.'; check();
      welcomeEditorKey(state, {kind: 'escape'});
      state.picker = {directory: '/local', entries: [], selected: 0}; check(false);
      state.picker.entries = [{name: 'cat.png', path: '/local/cat.png', directory: false}]; check();
    }
  } finally {
    if (color === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = color;
    if (noColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = noColor;
  }
});
