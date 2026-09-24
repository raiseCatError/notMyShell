import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {Key} from '../src/terminal/keys.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {renderTabStrip, tabWindow} from '../src/ui/PanelShell.js';
import {
  renderSearchField, renderSettingsPanel, SEARCH_MATCH, SETTINGS_VIEWS, visibleSettingsRows, type SettingsPanelState,
} from '../src/ui/SettingsPanel.js';
import {displayWidth, highlightMatches, stripAnsi} from '../src/util/text.js';
import {getCurrentGlyphMode, setIconStyle} from '../src/ui/glyphs.js';
import {foreground, UI_COLORS} from '../src/ui/palette.js';

const config = (patch: Partial<SettingsPanelState> = {}): SettingsPanelState =>
  ({section: 'root', view: 'config', selectedIndex: 0, glyphStyle: 'nerd', onboarding: false, ...patch});
const text = (value: string) => [...value].map(character => ({kind: 'text', value: character}) as Key);
const plain = (rows: string[]) => rows.map(stripAnsi);

/** An app whose config writes land in a throwaway directory. */
async function withApp(run: (app: TerminalApp, configPath: string) => Promise<void> | void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-settings-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    await run(app, join(directory, 'nmsh', 'config.json'));
  } finally {
    app['stop'](0);
    app['session'].kill();
    setIconStyle('nerd');
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    await rm(directory, {recursive: true, force: true});
  }
}

test('active view is a filled block, not brackets or underline', () => {
  const strip = renderTabStrip(SETTINGS_VIEWS, 2, 80);
  assert.equal(stripAnsi(strip), '   Settings   Status   Config ');
  assert.ok(!strip.includes('\u001B[4m'));
  assert.match(strip, /\u001B\[48;2;[\d;]+m\u001B\[38;2;[\d;]+m Config /u);
  assert.equal(strip.split('\u001B[48;2').length, 2, 'only the active view has a background');
  assert.notEqual(renderTabStrip(SETTINGS_VIEWS, 2, 80, true), strip, 'tab-row focus is visibly distinct');
});

test('tab strip windows around the selection on one row at every width', () => {
  for (const columns of [10, 14, 20, 32, 80]) {
    for (let selected = 0; selected < SETTINGS_VIEWS.length; selected++) {
      const strip = renderTabStrip(SETTINGS_VIEWS, selected, columns);
      assert.ok(displayWidth(strip) <= columns, `${columns}: ${stripAnsi(strip)}`);
      if (columns >= 14) assert.ok(stripAnsi(strip).includes(SETTINGS_VIEWS[selected]!));
      assert.ok(strip.endsWith('\u001B[0m'));
    }
  }
  assert.equal(tabWindow([5, 5, 5, 5, 5], 4, 20).end, 4);
});

test('search field is bordered, inset, and shows focus with a caret and accent border', () => {
  const idle = renderSearchField(config(), 60);
  assert.equal(idle.length, 3);
  assert.match(stripAnsi(idle[0]!), /^ {2}╭─+╮$/u);
  assert.match(stripAnsi(idle[1]!), /^ {2}│.*Search settings….*│$/u);
  for (const row of idle) assert.equal(displayWidth(row), 58);
  const focused = renderSearchField(config({searchFocused: true, searchQuery: 'git'}), 60);
  assert.ok(focused[1]!.includes('\u001B[7m'), 'focused search shows a caret');
  assert.notEqual(focused[0], idle[0], 'focused border uses the accent');
  assert.ok(stripAnsi(focused[1]!).includes('git'));
  for (const columns of [16, 24]) {
    for (const row of renderSearchField(config({searchFocused: true, searchQuery: 'a long query here'}), columns)) {
      assert.ok(displayWidth(row) <= columns);
    }
  }
});

test('Config rows are compact, single-line, with aligned values and a pointer', () => {
  const rows = plain(renderSettingsPanel(config({contentIndex: 2}), 80, Infinity, {configuration: DEFAULT_PROMPT_CONFIGURATION}));
  const list = rows.filter(row => /^ {2}[› ] (Glyph style|Prompt provider|History divider|Divider density|Prompt snapshots|History colors)/u.test(row));
  assert.equal(list.length, 6);
  const first = rows.indexOf(list[0]!);
  assert.deepEqual(rows.slice(first, first + 6), list, 'one line per setting, no blank lines between them');
  const valueStarts = list.map(row => { const match = /^(.*?\S)(\s{2,})\S/u.exec(row)!; return match[1]!.length + match[2]!.length; });
  assert.equal(new Set(valueStarts).size, 1, `values align: ${list.join('|')}`);
  assert.match(list[2]!, /^ {2}› History divider\s+true$/u);
  assert.match(list[0]!, /^ {4}Glyph style\s+Nerd Font$/u, 'enum values are plain, not ‹ › wrapped');
  const styled = renderSettingsPanel(config({contentIndex: 2}), 80, Infinity, {configuration: DEFAULT_PROMPT_CONFIGURATION});
  const accent = foreground(UI_COLORS.accent);
  const selected = styled.find(row => stripAnsi(row).includes('› History divider'))!;
  assert.ok(selected.includes(`\u001B[1m${accent}History divider`), 'selected label is bold accent');
  assert.ok(selected.includes(`${accent}true`), 'selected value is accent');
  const other = styled.find(row => stripAnsi(row).includes('Divider density'))!;
  assert.ok(other.includes(`${foreground(UI_COLORS.primary)}Divider density`), 'unselected labels stay primary');
  assert.notEqual(SEARCH_MATCH, `\u001B[1m${accent}`, 'search matches differ from the selected-row style');
});

test('search highlights matches restrainedly, distinct from the selected row', () => {
  assert.deepEqual(visibleSettingsRows(config({searchQuery: 'GLYPH'})).map(row => row.id), ['glyphStyle']);
  assert.ok(visibleSettingsRows(config({searchQuery: 'transcript'})).some(row => row.id === 'divider'), 'category matches');
  assert.ok(visibleSettingsRows(config({searchQuery: 'past command'})).some(row => row.id === 'divider'), 'description matches');
  const rows = renderSettingsPanel(config({searchQuery: 'div', searchFocused: true}), 80);
  assert.ok(rows.some(row => row.includes(`${SEARCH_MATCH}Div`)), 'original casing keeps highlighting');
  assert.ok(!SEARCH_MATCH.includes('\u001B[48'), 'no background block for matches');
  assert.equal(stripAnsi(highlightMatches('Glyph glyph', 'GLYPH', '', SEARCH_MATCH)), 'Glyph glyph');
  assert.ok(plain(renderSettingsPanel(config({searchQuery: 'foobar'}), 80)).some(row => row.includes('No settings match "foobar"')));
});

test('footer follows Claude-style phrasing for the focused control', () => {
  const footer = (state: SettingsPanelState) => stripAnsi(renderSettingsPanel(state, 120).at(-1)!).trim();
  assert.equal(footer(config()), 'Enter/Space to change · / to search · Esc to close');
  assert.equal(footer(config({contentIndex: 1})), 'Enter to open · ←/→ to switch · / to search · Esc to close');
  assert.equal(footer(config({searchFocused: true, searchQuery: 'x'})), '↑↓ results · Enter select · Esc clear');
  assert.equal(footer(config({view: 'status'})), '←/→ to switch · ↑↓ to scroll · Esc to close');
  assert.ok(!footer(config()).includes('Tab'));
});

test('Settings view lists panel entry points and truthful planned areas', () => {
  const rows = plain(renderSettingsPanel(config({view: 'settings'}), 90));
  assert.ok(rows.some(row => /› Appearance\s+Terminal opacity and blur/u.test(row)));
  assert.ok(rows.some(row => row.includes('Planned for v0.4')));
  assert.ok(rows.some(row => row.includes('Layout · Blocks')));
});

test('Left/Right change an enum inline and persist it; Enter changes too', () => withApp(async (app, path) => {
  app['openSettingsPanel']('config');
  app['handleKey']({kind: 'right'});
  assert.equal(app['promptConfiguration'].glyphStyle, 'safe');
  assert.equal(getCurrentGlyphMode(), process.env.NMSH_ICONS === 'nerd' ? 'nerd' : 'safe');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).glyphStyle, 'safe');
  app['handleKey']({kind: 'left'});
  assert.equal(app['promptConfiguration'].glyphStyle, 'nerd');
  app['handleKey']({kind: 'enter'});
  assert.equal(app['promptConfiguration'].glyphStyle, 'safe');
  assert.equal(app['settingsPanelState']!.view, 'config', 'inline edits stay in Config');
}));

test('Space and Enter toggle a real boolean; values stay shared with Status', () => withApp(async (app, path) => {
  app['openSettingsPanel']('config');
  app['handleKey']({kind: 'down'});
  app['handleKey']({kind: 'down'});
  app['handleKey']({kind: 'text', value: ' '});
  assert.equal(app['promptConfiguration'].transcript.divider, false);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).transcript.divider, false);
  app['handleKey']({kind: 'enter'});
  assert.equal(app['promptConfiguration'].transcript.divider, true);
  for (let step = 0; step < 3; step++) app['handleKey']({kind: 'down'});
  app['handleKey']({kind: 'right'});
  assert.equal(app['promptConfiguration'].transcript.historyColors, 'theme');
  assert.ok(app['statusSections']().flat().some(item => item.label === 'History colors' && item.value === 'Theme'));
}));

test('↑ from the first row focuses the view bar, where ←/→ switch views', () => withApp(app => {
  app['openSettingsPanel']('config');
  app['handleKey']({kind: 'up'});
  assert.equal(app['settingsPanelState']!.focus, 'tabs');
  const before = app['promptConfiguration'].glyphStyle;
  app['handleKey']({kind: 'left'});
  assert.equal(app['settingsPanelState']!.view, 'status');
  assert.equal(app['promptConfiguration'].glyphStyle, before);
  app['handleKey']({kind: 'right'});
  app['handleKey']({kind: 'down'});
  assert.equal(app['settingsPanelState']!.focus, 'rows');
}));

test('only / focuses search; typing edits it; Esc clears then closes (Kitty Escape)', () => withApp(app => {
  app['openSettingsPanel']('config');
  const before = JSON.stringify(app['promptConfiguration']);
  for (const key of text('abc')) app['handleKey'](key);
  assert.ok(!app['settingsPanelState']!.searchFocused, 'random typing does not enter search');
  assert.ok(!app['settingsPanelState']!.searchQuery);
  app['handleKey']({kind: 'text', value: '/'});
  assert.equal(app['settingsPanelState']!.searchFocused, true);
  for (const key of text('prompt s')) app['handleKey'](key);
  assert.equal(app['settingsPanelState']!.searchQuery, 'prompt s');
  app['handleKey']({kind: 'backspace'});
  app['handleKey']({kind: 'down'});
  assert.equal(JSON.stringify(app['promptConfiguration']), before);
  app['handleKey'](decodeKeys('\u001B[27;1u')[0]!);
  assert.equal(app['settingsPanelState']!.searchQuery, '');
  assert.equal(app['settingsPanelState']!.searchFocused, false);
  app['handleKey'](decodeKeys('\u001B[27u')[0]!);
  assert.equal(app['settingsPanelState'], undefined);
}));

test('panel chrome never enters transcript, resume data, or copy payload', () => withApp(app => {
  const before = JSON.stringify(app['output'].transcript());
  for (const view of ['config', 'status', 'settings'] as const) {
    app['openSettingsPanel'](view);
    for (const key of [{kind: 'text', value: '/'}, ...text('glyph'), {kind: 'down'}, {kind: 'escape'}, {kind: 'right'}] as Key[]) app['handleKey'](key);
    app['settingsPanelRows'](80);
  }
  const after = JSON.stringify(app['output'].transcript());
  assert.equal(after, before);
  assert.ok(!after.includes('Search settings') && !after.includes('to search') && !after.includes('Session journal'));
  assert.equal(app['output'].recent(1), undefined);
}));

test('narrow widths keep values visible and never overflow', () => {
  for (const columns of [24, 32, 40]) {
    for (const [contentIndex, value] of [[0, 'Nerd Font'], [5, 'Follow prompt'], [2, 'true']] as const) {
      const rows = renderSettingsPanel(config({contentIndex}), columns, 40);
      for (const line of rows) assert.ok(displayWidth(line) <= columns, `${columns}: ${stripAnsi(line)}`);
      assert.ok(rows.some(line => stripAnsi(line).includes(value)), `${columns}: ${value}`);
    }
  }
  assert.ok(renderSettingsPanel(config(), 30, 8).length <= 8);
});
