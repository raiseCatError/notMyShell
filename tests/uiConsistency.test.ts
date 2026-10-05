import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {createRowPanel, renderRowPanel} from '../src/ui/RowPanel.js';
import {background, foreground, UI_COLORS} from '../src/ui/palette.js';
import {createToolsPanel, renderTools, visibleTools} from '../src/tools/ToolsPanel.js';
import {handleSyntaxPanelKey, renderSyntaxPanel} from '../src/input/SyntaxPanel.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
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

test('chosen tools retain reverse-video selection with NO_COLOR and focus elsewhere', () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const state = createToolsPanel();
    const items = visibleTools(state);
    state.selection = new Set([items[0]!.id]); state.selected = 1;
    const row = renderTools(state, 120, 50).find(line => line.includes(items[0]!.label))!;
    assert.ok(row.startsWith('\u001b[7m'), 'chosen row remains distinguishable without color');
    assert.equal(displayWidth(row), 120, 'selection fills the row');
    assert.doesNotMatch(stripAnsi(row), /\[[x ]\]|›/u, 'chosen row has no checkbox or focus pointer');
    const focused = renderTools(state, 120, 50).find(line => line.includes(items[1]!.label))!;
    assert.match(stripAnsi(focused), /›/u, 'keyboard focus is separately identifiable');
    state.selection.clear();
    const unchosen = renderTools(state, 120, 50).find(line => line.includes(items[0]!.label))!;
    assert.doesNotMatch(unchosen, /\u001b\[7m/u, 'reverse video tracks chosen state');
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

test('chosen tools retain the semantic selection band when keyboard focus moves away', () => {
  const state = createToolsPanel();
  const items = visibleTools(state);
  state.selection = new Set([items[0]!.id]);
  state.selected = 1;
  const rows = renderTools(state, 120, 50);
  const line = rows.find(row => stripAnsi(row).includes(items[0]!.label))!;
  assert.ok(line.startsWith(background(UI_COLORS.selection)), 'chosen band persists away from focus');
  assert.equal(displayWidth(line), 120, 'selection fills the row');
  assert.doesNotMatch(stripAnsi(line), /\[[x ]\]|›/u, 'chosen row has no checkbox or focus pointer');
  const focused = rows.find(row => stripAnsi(row).includes(items[1]!.label))!;
  assert.match(stripAnsi(focused), /›/u, 'keyboard focus moved to the other row');
  assert.ok(!focused.startsWith(background(UI_COLORS.selection)), 'focus and chosen state use distinct bands');
});

test('syntax theme family can move from NMSh to Catppuccin with a real preview', () => {
  const state = {selectedIndex: 2, draft: {...DEFAULT_PROMPT_CONFIGURATION.syntax, colors: 'theme' as const}, saved: {...DEFAULT_PROMPT_CONFIGURATION.syntax}};
  handleSyntaxPanelKey({kind: 'right'}, state);
  assert.match(state.draft.theme, /^catppuccin/u);
  assert.match(renderSyntaxPanel(state, 120, 'lavender').map(stripAnsi).join('\n'), /Family\s+‹ Catppuccin/u);
});
