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
  adjustSettingsRow, renderSettingsPanel, SEARCH_MATCH, SETTINGS_ROWS, SETTINGS_SECTIONS, settingsRowDestination,
  toggleSettingsRow, visibleSettingsRows, type SettingsPanelState, type SettingsRow,
} from '../src/ui/SettingsPanel.js';
import {displayWidth, highlightMatches, stripAnsi} from '../src/util/text.js';
import {getCurrentGlyphMode, setIconStyle} from '../src/ui/glyphs.js';

const BOLD_UNDERLINE = '\u001B[1m\u001B[4m';
const root = (patch: Partial<SettingsPanelState> = {}): SettingsPanelState =>
  ({section: 'root', selectedIndex: 0, glyphStyle: 'nerd', onboarding: false, ...patch});
const row = (id: string): SettingsRow => SETTINGS_ROWS.find(candidate => candidate.id === id)!;
const text = (value: string) => [...value].map(character => ({kind: 'text', value: character}) as Key);

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

test('selected tab is styled, not bracketed; inactive tabs are muted', () => {
  const strip = renderTabStrip(SETTINGS_SECTIONS, 1, 120);
  assert.ok(!stripAnsi(strip).includes('['));
  assert.ok(strip.includes(`${BOLD_UNDERLINE}`), 'active tab is bold and underlined');
  const active = strip.indexOf('Prompt');
  const inactive = strip.indexOf('General');
  assert.notEqual(strip.slice(active - 30, active), strip.slice(inactive - 30, inactive));
});

test('tab strip windows around the selection on one row at every width', () => {
  for (const columns of [12, 20, 36, 60, 80, 140]) {
    for (let selected = 0; selected < SETTINGS_SECTIONS.length; selected++) {
      const strip = renderTabStrip(SETTINGS_SECTIONS, selected, columns);
      const plain = stripAnsi(strip);
      assert.ok(displayWidth(strip) <= columns, `${columns}: ${plain}`);
      assert.ok(!plain.includes('\n'));
      if (columns >= 20) assert.ok(plain.includes(SETTINGS_SECTIONS[selected]!), `${columns}/${selected}: ${plain}`);
      assert.ok(strip.endsWith('\u001B[0m'), 'ANSI state is reset at the end of the strip');
    }
  }
  const window = tabWindow([5, 5, 5, 5, 5], 4, 20);
  assert.equal(window.end, 4);
  assert.ok(window.start > 0);
  assert.ok(stripAnsi(renderTabStrip(SETTINGS_SECTIONS, 5, 40)).startsWith('‹'));
});

test('search field has distinct idle, focused, and filtered states', () => {
  const idle = renderSettingsPanel(root(), 80).map(stripAnsi);
  assert.ok(idle.some(line => line.includes('Search settings…')));
  assert.ok(!idle.some(line => line.includes('Search:')));
  const focused = renderSettingsPanel(root({searchQuery: 'git', searchFocused: true}), 80);
  const unfocused = renderSettingsPanel(root({searchQuery: 'git', searchFocused: false}), 80);
  const field = (rows: string[]) => rows.find(line => stripAnsi(line).includes('results') || stripAnsi(line).includes('result'))!;
  assert.ok(field(focused).includes('\u001B[7m'), 'focused search shows a caret');
  assert.ok(!field(unfocused).includes('\u001B[7m'));
});

test('search matches label, description, and category case-insensitively and highlights them', () => {
  assert.deepEqual(visibleSettingsRows(root({searchQuery: 'GLYPH'})).map(entry => entry.id), ['glyphStyle']);
  assert.ok(visibleSettingsRows(root({searchQuery: 'opacity'})).some(entry => entry.id === 'appearance'));
  assert.ok(visibleSettingsRows(root({searchQuery: 'transcript'})).some(entry => entry.id === 'divider'));
  const rows = renderSettingsPanel(root({searchQuery: 'trans', searchFocused: true}), 100);
  const label = rows.find(line => stripAnsi(line).includes('› Transcript'))!;
  assert.ok(label.includes(`${SEARCH_MATCH}Trans`), 'original casing is highlighted');
  assert.ok(rows.some(line => stripAnsi(line).includes('Transcript · ') && line.includes(`${SEARCH_MATCH}Trans`)), 'category match highlights too');
  const described = renderSettingsPanel(root({searchQuery: 'divider'}), 100);
  assert.ok(described.some(line => stripAnsi(line).includes('History colors, dividers') && line.includes(`${SEARCH_MATCH}divider`)),
    'description match highlights too');
  assert.equal(stripAnsi(highlightMatches('Glyph glyph', 'GLYPH', '', SEARCH_MATCH)), 'Glyph glyph');
  assert.equal(highlightMatches('Glyph glyph', 'glyph', '', '<m>').split('<m>').length, 3);
});

test('no-match search shows a quiet empty state', () => {
  const rows = renderSettingsPanel(root({searchQuery: 'foobar', searchFocused: true}), 80).map(stripAnsi);
  assert.ok(rows.some(line => line.includes('No settings match "foobar"')));
});

test('rows show current values; descriptions are muted; planned rows are readonly', () => {
  const config = {...DEFAULT_PROMPT_CONFIGURATION, glyphStyle: 'safe' as const};
  const rows = renderSettingsPanel(root(), 80, Infinity, config);
  const glyph = rows.find(line => stripAnsi(line).includes('Glyph style'))!;
  assert.match(stripAnsi(glyph), /‹ Safe \/ ASCII ›\s*$/u);
  assert.ok(glyph.includes('\u001B[1m'), 'selected row label is bold');
  const description = rows.find(line => stripAnsi(line).includes('Choose Nerd Font'))!;
  assert.ok(description.startsWith('    \u001B[38;2;125;133;144m'), 'descriptions use the subtle role');
  const transcript = renderSettingsPanel(root({selectedIndex: 2, contentIndex: 0}), 80, Infinity, config).map(stripAnsi);
  assert.ok(transcript.some(line => /History divider\s+On$/u.test(line)));
  const layout = renderSettingsPanel(root({selectedIndex: 3}), 80).map(stripAnsi);
  assert.ok(layout.some(line => /Layout\s+Planned$/u.test(line)));
  assert.equal(adjustSettingsRow(row('layout'), config, 1), undefined);
  assert.equal(toggleSettingsRow(row('layout'), config), undefined);
  assert.equal(settingsRowDestination(row('layout')), undefined);
});

test('footer hints follow the focused control', () => {
  const footer = (state: SettingsPanelState) => stripAnsi(renderSettingsPanel(state, 120).at(-1)!);
  assert.match(footer(root()), /←→ Change/u);
  assert.match(footer(root({selectedIndex: 2, contentIndex: 1})), /Space Toggle/u);
  assert.doesNotMatch(footer(root({selectedIndex: 2, contentIndex: 1})), /←→/u);
  assert.match(footer(root({selectedIndex: 1})), /Enter Open/u);
  assert.match(footer(root({searchQuery: 'x', searchFocused: true})), /Type Search\s+↑↓ Results.*Esc Clear/u);
});

test('Left/Right cycle glyph style inline and persist it', () => withApp(async (app, path) => {
  app['settingsPanelState'] = root();
  app['handleKey']({kind: 'right'});
  assert.equal(app['promptConfiguration'].glyphStyle, 'safe');
  assert.equal(getCurrentGlyphMode(), process.env.NMSH_ICONS === 'nerd' ? 'nerd' : 'safe');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).glyphStyle, 'safe');
  app['handleKey']({kind: 'left'});
  assert.equal(app['promptConfiguration'].glyphStyle, 'nerd');
  assert.equal(app['settingsPanelState']!.section, 'root', 'inline edits stay on the Settings page');
}));

test('Space toggles a real transcript boolean and Enter on a child opens its panel', () => withApp(async (app, path) => {
  app['settingsPanelState'] = root({selectedIndex: 2, contentIndex: 1});
  app['handleKey']({kind: 'text', value: ' '});
  assert.equal(app['promptConfiguration'].transcript.divider, false);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).transcript.divider, false);
  assert.equal(app['settingsPanelState']!.searchQuery, undefined, 'Space is not a search keystroke');
  app['handleKey']({kind: 'down'});
  app['handleKey']({kind: 'right'});
  assert.equal(app['promptConfiguration'].transcript.dividerDensity, 'compact');
  app['handleKey']({kind: 'up'});
  app['handleKey']({kind: 'up'});
  app['handleKey']({kind: 'enter'});
  assert.ok(app['transcriptPanelState']);
  app['handleKey']({kind: 'escape'});
  assert.equal(app['settingsPanelState']!.selectedIndex, 2);
}));

test('planned rows never mutate configuration', () => withApp(app => {
  app['settingsPanelState'] = root({selectedIndex: 3});
  const before = JSON.stringify(app['promptConfiguration']);
  for (const key of [{kind: 'left'}, {kind: 'right'}, {kind: 'text', value: ' '}, {kind: 'enter'}] as Key[]) app['handleKey'](key);
  assert.equal(JSON.stringify(app['promptConfiguration']), before);
  assert.ok(app['settingsPanelState']);
}));

test('typing focuses search without editing; Esc clears search, then closes', () => withApp(app => {
  app['settingsPanelState'] = root();
  const before = JSON.stringify(app['promptConfiguration']);
  app['handleKey']({kind: 'text', value: '/'});
  assert.equal(app['settingsPanelState']!.searchFocused, true);
  assert.equal(app['settingsPanelState']!.searchQuery, '');
  for (const key of text('div ider')) app['handleKey'](key);
  assert.equal(app['settingsPanelState']!.searchQuery, 'div ider', 'Space types into a focused query');
  app['handleKey']({kind: 'backspace'});
  assert.equal(JSON.stringify(app['promptConfiguration']), before);
  for (const [escape] of [decodeKeys('\u001B[27;1u')]) app['handleKey'](escape!);
  assert.equal(app['settingsPanelState']!.searchQuery, '');
  assert.equal(app['settingsPanelState']!.searchFocused, false);
  for (const [escape] of [decodeKeys('\u001B[27u')]) app['handleKey'](escape!);
  assert.equal(app['settingsPanelState'], undefined);
}));

test('Tab and Shift+Tab wrap through every category', () => withApp(app => {
  app['settingsPanelState'] = root();
  for (let step = 1; step <= SETTINGS_SECTIONS.length; step++) {
    app['handleKey']({kind: 'complete'});
    assert.equal(app['settingsPanelState']!.selectedIndex, step % SETTINGS_SECTIONS.length);
  }
  app['handleKey']({kind: 'focusPrevious'});
  assert.equal(app['settingsPanelState']!.selectedIndex, SETTINGS_SECTIONS.length - 1);
}));

test('settings chrome never enters transcript, resume data, or copy payload', () => withApp(app => {
  const before = JSON.stringify(app['output'].transcript());
  app['settingsPanelState'] = root();
  for (const key of [...text('glyph'), {kind: 'down'}, {kind: 'escape'}, {kind: 'right'}, {kind: 'complete'}] as Key[]) app['handleKey'](key);
  app['settingsPanelRows'](80);
  const after = JSON.stringify(app['output'].transcript());
  assert.equal(after, before);
  assert.ok(!after.includes('Search settings') && !after.includes('Navigate'));
  assert.equal(app['output'].recent(1), undefined);
}));

test('narrow widths keep editable values visible and ANSI state balanced', () => {
  for (const columns of [24, 32, 40]) {
    for (const [selectedIndex, contentIndex, value] of [[0, 0, 'Nerd Font'], [2, 4, 'Follow prompt'], [2, 1, 'On']] as const) {
      const rows = renderSettingsPanel(root({selectedIndex, contentIndex}), columns, 40);
      for (const line of rows) assert.ok(displayWidth(line) <= columns, `${columns}: ${stripAnsi(line)}`);
      assert.ok(rows.some(line => stripAnsi(line).includes(value)), `${columns}: ${value}`);
    }
  }
});
