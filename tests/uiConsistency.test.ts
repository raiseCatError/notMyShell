import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {createRowPanel, renderRowPanel} from '../src/ui/RowPanel.js';
import {foreground, UI_COLORS} from '../src/ui/palette.js';
import {createToolsPanel, renderTools, visibleTools} from '../src/tools/ToolsPanel.js';
import {handleSyntaxPanelKey, renderSyntaxPanel} from '../src/input/SyntaxPanel.js';
import {stripAnsi} from '../src/util/text.js';
import {createWelcomeSnapshot, renderWelcome} from '../src/output/Welcome.js';
import {cloneFromPalette} from '../src/appearance/themeSelection.js';
import {setThemeContext, themeContext} from '../src/prompt/prompt.js';
import {syntaxSgr} from '../src/input/syntaxTheme.js';

test('syntax cache follows custom theme edits even when chrome is unchanged', () => {
  const previous = themeContext();
  const custom = cloneFromPalette('lavender', 'mauve', 'Preview');
  try {
    setThemeContext('mauve', custom);
    const appearance = {...DEFAULT_PROMPT_CONFIGURATION.syntax, colors: 'theme' as const, theme: 'custom' as const};
    const before = syntaxSgr(appearance, 'lavender').KnownCommand;
    setThemeContext('mauve', {...custom, prompt: {...custom.prompt, project: '#ff0000'}});
    assert.notEqual(syntaxSgr(appearance, 'lavender').KnownCommand, before);
  } finally { setThemeContext(previous.accent, previous.custom); }
});

test('chosen tool checkboxes remain visible with NO_COLOR and focus elsewhere', () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const state = createToolsPanel();
    const items = visibleTools(state);
    state.selection = new Set([items[0]!.id]); state.selected = 1;
    const row = renderTools(state, 120, 50).find(line => line.includes(items[0]!.label))!;
    assert.match(stripAnsi(row), /\[x\]/u);
    assert.doesNotMatch(row, /\u001b\[(?:38|48);/u);
  } finally { if (previous === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = previous; }
});

test('demo welcome hides release, commit, branch and dirty metadata without freezing motion', () => {
  const previous = process.env.NMSH_DEMO;
  process.env.NMSH_DEMO = '1';
  try {
    const text = renderWelcome(createWelcomeSnapshot({version: '0.16.0', commit: 'abcdef1', branch: 'private-branch', dirty: true}, '/tmp/demo'), 120).map(row => row.plain).join('\n');
    assert.match(text, /demo/u);
    assert.doesNotMatch(text, /0\.16\.0|abcdef1|private-branch|dirty/u);
  } finally { if (previous === undefined) delete process.env.NMSH_DEMO; else process.env.NMSH_DEMO = previous; }
});

test('focused canonical settings label uses the accent, not ordinary text', () => {
  const state = createRowPanel('Syntax', '', ['syntaxHighlighting']);
  const line = renderRowPanel(state, DEFAULT_PROMPT_CONFIGURATION, 100, 30, []).find(row => row.includes('Syntax highlighting'))!;
  assert.ok(line.includes(`\u001b[1m${foreground(UI_COLORS.accent)}Syntax highlighting`));
});

test('chosen tools retain an explicit checkbox when keyboard focus moves away', () => {
  const state = createToolsPanel();
  const items = visibleTools(state);
  state.selection = new Set([items[0]!.id]);
  state.selected = 1;
  const line = renderTools(state, 120, 50).map(stripAnsi).find(row => row.includes(items[0]!.label))!;
  assert.match(line, /\[x\]/u);
});

test('syntax theme family can move from NMSh to Catppuccin with a real preview', () => {
  const state = {selectedIndex: 2, draft: {...DEFAULT_PROMPT_CONFIGURATION.syntax, colors: 'theme' as const}, saved: {...DEFAULT_PROMPT_CONFIGURATION.syntax}};
  handleSyntaxPanelKey({kind: 'right'}, state);
  assert.match(state.draft.theme, /^catppuccin/u);
  assert.match(renderSyntaxPanel(state, 120, 'lavender').map(stripAnsi).join('\n'), /Family\s+‹ Catppuccin/u);
});
