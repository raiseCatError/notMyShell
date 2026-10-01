import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {Key} from '../src/terminal/keys.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {
  renderSettingsPanel, resetSettingsRow, SETTINGS_ROWS, settingsRowChanged, visibleSettingsRows, type SettingsPanelState,
} from '../src/ui/SettingsPanel.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {getCurrentGlyphMode, setIconStyle} from '../src/ui/glyphs.js';

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


const row = (id: string) => SETTINGS_ROWS.find(item => item.id === id)!;

test('default Config hides advanced rows; A reveals them; search always finds them', () => {
  const simple = visibleSettingsRows(config()).map(item => item.id);
  assert.ok(simple.includes('glyphStyle') && !simple.includes('dividerDensity'));
  assert.ok(visibleSettingsRows(config({showAdvanced: true})).some(item => item.id === 'dividerDensity'));
  assert.ok(visibleSettingsRows(config({searchQuery: 'density'})).some(item => item.id === 'dividerDensity'));
  assert.equal(SETTINGS_ROWS.filter(item => item.level === 'advanced').length > 0, true);
}); 

test('changed-from-default is a text cue and reset targets one setting', () => {
  const changed = {...DEFAULT_PROMPT_CONFIGURATION, updateChecks: 'weekly' as const, outputFolding: 'always' as const};
  assert.equal(settingsRowChanged(row('updateChecks'), DEFAULT_PROMPT_CONFIGURATION), false);
  assert.equal(settingsRowChanged(row('updateChecks'), changed), true);
  const reset = resetSettingsRow(row('updateChecks'), changed)!;
  assert.equal(reset.updateChecks, DEFAULT_PROMPT_CONFIGURATION.updateChecks);
  assert.equal(reset.outputFolding, 'always', 'other settings untouched');
  assert.equal(resetSettingsRow(row('provider'), changed), undefined);
});

test('rendering marks changed rows and offers reset only when it applies', () => {
  const index = visibleSettingsRows(config()).findIndex(item => item.id === 'updateChecks');
  const changed = {...DEFAULT_PROMPT_CONFIGURATION, updateChecks: 'weekly' as const};
  const shown = plain(renderSettingsPanel(config({contentIndex: index}), 100, Infinity, {configuration: changed}));
  assert.ok(shown.some(line => line.includes('Update checks') && line.includes('Weekly •')));
  assert.ok(shown.at(-1)!.includes('R reset to'));
  const clean = plain(renderSettingsPanel(config({contentIndex: index}), 100, Infinity, {configuration: DEFAULT_PROMPT_CONFIGURATION}));
  assert.ok(!clean.some(line => line.includes('•')) && !clean.at(-1)!.includes('R reset'));
  for (const columns of [24, 40]) for (const line of renderSettingsPanel(config({contentIndex: index}), columns, Infinity, {configuration: changed})) assert.ok(displayWidth(line) <= columns);
});

test('R resets the focused setting, A toggles advanced, and position is remembered', () => withApp(app => {
  app['openSettingsPanel']('config');
  app['applySettingsConfiguration']({...app['promptConfiguration'], updateChecks: 'weekly'});
  const index = visibleSettingsRows(app['settingsPanelState']!).findIndex(item => item.id === 'updateChecks');
  app['settingsPanelState']!.contentIndex = index;
  app['handleKey']({kind: 'text', value: 'r'});
  assert.equal(app['promptConfiguration'].updateChecks, DEFAULT_PROMPT_CONFIGURATION.updateChecks);
  app['handleKey']({kind: 'text', value: 'a'});
  assert.equal(app['settingsPanelState']!.showAdvanced, true);
  assert.equal(app['settingsPanelState']!.contentIndex, 0);
  app['settingsPanelState']!.contentIndex = 3;
  app['handleKey']({kind: 'down'});
  app['settingsPanelState'] = undefined;
  app['openSettingsPanel']('config');
  assert.equal(app['settingsPanelState']!.contentIndex, 4);
  assert.equal(app['settingsPanelState']!.showAdvanced, true);
}));

test('the palette can target an advanced row', () => withApp(app => {
  app['focusConfigRow']('dividerDensity');
  const state = app['settingsPanelState']!;
  assert.equal(visibleSettingsRows(state)[state.contentIndex!]!.id, 'dividerDensity');
}));

test('R does nothing while searching, so it can be typed', () => withApp(app => {
  app['openSettingsPanel']('config');
  app['handleKey']({kind: 'text', value: '/'});
  app['handleKey']({kind: 'text', value: 'r'});
  assert.equal(app['settingsPanelState']!.searchQuery, 'r');
}));
