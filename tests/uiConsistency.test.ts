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

test('chosen tools read Selected with NO_COLOR and focus elsewhere; reverse video is the cursor only', () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const state = createToolsPanel();
    for (const tool of visibleTools(state)) state.statuses[tool.id] = {state: 'missing'};
    const items = visibleTools(state);
    const rowOf = (rows: string[], label: string) => rows.find(line => new RegExp(`^ {2}(?:› | {2})${label} {2,}`, 'u').test(stripAnsi(line)))!;
    state.selection = new Set([items[0]!.id]); state.selected = 1;
    const row = rowOf(renderTools(state, 120, 50), items[0]!.label);
    assert.match(stripAnsi(row), new RegExp(`^ {4}${items[0]!.label}\\s+✓ Selected`, 'u'), 'chosen row remains distinguishable without color');
    assert.doesNotMatch(row, /\u001b\[7m/u, 'and is not banded like the cursor');
    assert.doesNotMatch(stripAnsi(row), /›/u, 'chosen row has no focus pointer');
    const focused = rowOf(renderTools(state, 120, 50), items[1]!.label);
    assert.match(stripAnsi(focused), /›/u, 'keyboard focus is separately identifiable');
    assert.ok(focused.includes('\u001b[7m'), 'reverse video marks the cursor');
    state.selection.clear();
    const unchosen = rowOf(renderTools(state, 120, 50), items[0]!.label);
    assert.match(stripAnsi(unchosen), /○ Missing/u, 'the status tracks chosen state');
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

test('chosen tools keep Selected when keyboard focus moves away; only the cursor has a band', () => {
  const state = createToolsPanel();
  for (const tool of visibleTools(state)) state.statuses[tool.id] = {state: 'missing'};
  const items = visibleTools(state);
  const rowOf = (rows: string[], label: string) => rows.find(line => new RegExp(`^ {2}(?:› | {2})${label} {2,}`, 'u').test(stripAnsi(line)))!;
  state.selection = new Set([items[0]!.id]);
  state.selected = 1;
  const rows = renderTools(state, 120, 50);
  const line = rowOf(rows, items[0]!.label);
  assert.match(stripAnsi(line), new RegExp(`^ {4}${items[0]!.label}\\s+✓ Selected`, 'u'), 'Selected persists away from focus');
  assert.doesNotMatch(line, /\u001b\[48;/u, 'no band: highlighting is not choosing');
  const focused = rowOf(rows, items[1]!.label);
  assert.match(stripAnsi(focused), /›/u, 'keyboard focus moved to the other row');
  assert.ok(/\u001b\[48;/u.test(focused) && displayWidth(focused) === 120, 'the cursor alone has the full-width band');
  assert.equal(background(UI_COLORS.selection).length > 0, true);
});

test('syntax theme family can move from NMSh to Catppuccin with a real preview', () => {
  const state = {selectedIndex: 2, draft: {...DEFAULT_PROMPT_CONFIGURATION.syntax, colors: 'theme' as const}, saved: {...DEFAULT_PROMPT_CONFIGURATION.syntax}};
  handleSyntaxPanelKey({kind: 'right'}, state);
  assert.match(state.draft.theme, /^catppuccin/u);
  assert.match(renderSyntaxPanel(state, 120, 'lavender').map(stripAnsi).join('\n'), /Family\s+‹ Catppuccin/u);
});
