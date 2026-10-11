import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolsPanel, toolsKey} from '../src/tools/ToolsPanel.js';
import {createTmuxPanel, tmuxPanelKey} from '../src/tools/config/TmuxPanel.js';
import {DEFAULT_TMUX_MODEL} from '../src/tools/config/tmux.js';
import {createThemeStudio, studioKey, type StudioContext} from '../src/appearance/ThemeStudio.js';
import {handlePromptPanelKey, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {Key} from '../src/terminal/keys.js';

const TAB: Key = {kind: 'complete'}, SHIFT_TAB: Key = {kind: 'focusPrevious'};

test('Tools: Tab and Shift+Tab cycle Discover … Errors with wrap-around, also while a search is typed', () => {
  const state = createToolsPanel();
  assert.equal(state.tab, 'discover');
  toolsKey(state, SHIFT_TAB);
  assert.equal(state.tab, 'errors');
  toolsKey(state, TAB);
  assert.equal(state.tab, 'discover');
  toolsKey(state, {kind: 'text', value: 'g'});
  toolsKey(state, TAB);
  assert.equal(state.tab, 'installed');
  assert.equal(state.query, 'g', 'the typed search is kept');
});

test('tmux configuration: Tab cycles its tabs from the bar or the list; key entry keeps Tab', () => {
  const state = createTmuxPanel(DEFAULT_TMUX_MODEL(), undefined, 'Independent', true);
  const first = state.tab;
  tmuxPanelKey(state, TAB);
  assert.notEqual(state.tab, first);
  tmuxPanelKey(state, SHIFT_TAB);
  assert.equal(state.tab, first);
  tmuxPanelKey(state, SHIFT_TAB);
  assert.notEqual(state.tab, first, 'wraps backwards');
});

test('Theme Studio: Tab cycles tabs, but not while the import path field is being typed', () => {
  const context: StudioContext = {themes: [], accent: 'mauve', pinnedTo: () => []};
  const state = createThemeStudio(context);
  const first = state.tab;
  studioKey(state, TAB, 'truecolor', '/tmp', context);
  assert.notEqual(state.tab, first);
  studioKey(state, SHIFT_TAB, 'truecolor', '/tmp', context);
  assert.equal(state.tab, first);
  const importing = createThemeStudio(context, 'import');
  importing.focus = 'list';
  importing.importField = 'path';
  studioKey(importing, TAB, 'truecolor', '/tmp', context);
  assert.equal(importing.tab, 'import', 'Tab is not stolen from the path field');
});

test('/prompt: Tab and Shift+Tab switch Main · Git · Chroma · Rail', () => {
  const state: PromptPanelState = {onboarding: false, step: 'appearance', selectedIndex: 2, draft: structuredClone(DEFAULT_PROMPT_CONFIGURATION)};
  handlePromptPanelKey(TAB, state);
  assert.equal(state.view, 'git');
  assert.equal(state.selectedIndex, 0);
  handlePromptPanelKey(SHIFT_TAB, state);
  handlePromptPanelKey(SHIFT_TAB, state);
  assert.equal(state.view, 'rail', 'wraps backwards');
});

test('Settings: Tab switches views; inside the Config search Tab is left alone', () => {
  const app = new TerminalApp();
  try {
    app['renderer'].render = (() => {}) as never;
    app['openSettingsPanel']('settings');
    const state = app['settingsPanelState']!;
    const first = state.view;
    app['handleKey'](TAB);
    assert.notEqual(state.view, first);
    app['handleKey'](SHIFT_TAB);
    assert.equal(state.view, first);
    state.view = 'config';
    state.searchFocused = true;
    app['handleKey'](TAB);
    assert.equal(state.view, 'config', 'a focused search keeps Tab');
  } finally { app['stop'](0); app['session'].kill(); }
});
