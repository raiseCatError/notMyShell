import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {renderPromptPanel, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {createProvidersOverview, OVERVIEW_ROWS, renderProvidersOverview} from '../src/providers/ProvidersOverview.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {COLUMN_GUTTER, displayWidth, labelColumnWidth, padCells, stripAnsi} from '../src/util/text.js';

const providerFacts = () => ({configuration: structuredClone(DEFAULT_PROMPT_CONFIGURATION), statuses: new Map(), installedByNmsh: new Set<string>(),
  understanding: {active: 'Built-in', detail: ['Mode: Off']}, shell: {current: 'zsh', defaultShell: 'zsh'}});

function providers(columns: number, selected = 'directory'): string[] {
  const state = createProvidersOverview();
  state.detecting = false;
  state.selected = Math.max(0, OVERVIEW_ROWS.indexOf(selected as typeof OVERVIEW_ROWS[number]));
  return renderProvidersOverview(state, providerFacts(), columns).map(stripAnsi);
}

function prompt(view: 'main' | 'git' | 'chroma', columns: number): string[] {
  const draft = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  draft.presentation = {...draft.presentation, preset: 'aurora'};
  const state: PromptPanelState = {onboarding: false, step: 'appearance', view, selectedIndex: 0, draft, saved: structuredClone(draft)};
  return renderPromptPanel(state, columns, []).map(stripAnsi);
}

/** The label is followed by at least the gutter of spaces before any other text. */
function assertGutter(rows: string[], label: string): void {
  const row = rows.find(item => item.includes(label));
  assert.ok(row, `${label} row rendered:\n${rows.join('\n')}`);
  const after = row.slice(row.indexOf(label) + label.length);
  assert.match(after, new RegExp(`^ {${COLUMN_GUTTER},}\\S`, 'u'), `"${row}"`);
}

test('padCells: display-cell padding with a gutter that survives a full-width label', () => {
  assert.equal(padCells('abc', 3), 'abc  ');
  assert.equal(padCells('\u001b[31mab\u001b[0m', 4), '\u001b[31mab\u001b[0m    ', 'ANSI does not count toward width');
  assert.equal(displayWidth(padCells('漢字', 6)), 8, 'wide characters measured in cells');
  assert.equal(stripAnsi(padCells('Directory navigation', 10)), 'Directory…  ', 'too wide truncates, gutter kept');
  assert.equal(labelColumnWidth(['a', 'Directory navigation'], 200), 20);
  assert.ok(labelColumnWidth(['Directory navigation'], 24) < 20, 'narrow terminals narrow the label column');
});

test('/providers: the longest family name keeps a gutter before its provider', () => {
  for (const glyphs of ['nerd', 'safe'] as const) {
    setIconStyle(glyphs);
    const rows = providers(120);
    assertGutter(rows, 'Directory navigation');
    assertGutter(rows, 'Local understanding');
    // Family rows share one data column regardless of the selection marker.
    const family = rows.filter(row => /● Active|fallback →/u.test(row) && !row.startsWith('      '));
    const dataColumn = (row: string) => { const match = /\S {2,}(?=\S)/u.exec(row)!; return displayWidth(row.slice(0, match.index + match[0].length)); };
    assert.ok(family.length > 3);
    assert.equal(new Set(family.map(dataColumn)).size, 1, family.join('\n'));
  }
});

test('/prompt: Main, Rich Git and Chroma rows keep a gutter after the longest label', () => {
  assertGutter(prompt('chroma', 140), 'Semantic colors');
  assertGutter(prompt('git', 140), 'Connector fade');
  const main = prompt('main', 140);
  const labels = main.filter(row => /^[ ›] \S/u.test(row));
  assert.ok(labels.length > 3);
  for (const row of labels) assert.doesNotMatch(row.slice(2), /^\S+(?: \S+)*[a-z][‹A-Z]/u, `"${row}" touches`);
});

test('narrow widths truncate instead of joining columns; NO_COLOR keeps the geometry', () => {
  for (const columns of [40, 32]) {
    for (const row of providers(columns)) assert.ok(displayWidth(row) <= columns);
    assert.doesNotMatch(providers(columns).join('\n'), /navigationNMSh|understandingBuilt/u);
    for (const row of prompt('chroma', columns)) assert.ok(displayWidth(row) <= columns);
    assert.doesNotMatch(prompt('chroma', columns).join('\n'), /colors‹/u);
  }
  const before = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try { assertGutter(providers(120), 'Directory navigation'); } finally { if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before; }
});
