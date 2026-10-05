import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand, slashCommands} from '../src/commands/slashCommands.js';
import {createPalette, filterPalette, handlePaletteKey, paletteItems, renderPalette} from '../src/ui/CommandPalette.js';
import {SETTINGS_ENTRIES, SETTINGS_ROWS, visibleSettingsRows} from '../src/ui/SettingsPanel.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {stripAnsi} from '../src/util/text.js';

const ALLOWED = new Set(['slash', 'open', 'config', 'toggleComposerPosition', 'toggleTranscriptPresentation', 'cycleOutputFolding',
  'theme', 'latest', 'toggleDetails', 'toggleInspector']);

test('one registry lists slash commands, settings pages, config rows and explicit NMSh actions only', () => {
  const items = paletteItems();
  const ids = new Set(items.map(item => item.id));
  assert.equal(ids.size, items.length, 'ids are unique');
  // Aliases (/composer, /pickers, /status-strip) resolve to their canonical command's one entry.
  for (const command of slashCommands.filter(command => command.name !== '/copy N' && !command.alias)) assert.ok(ids.has(`slash:${command.name}`), command.name);
  for (const command of slashCommands.filter(command => command.alias)) assert.ok(!ids.has(`slash:${command.name}`) && ids.has(`slash:${command.alias}`), command.name);
  for (const entry of SETTINGS_ENTRIES) assert.ok(ids.has(`open:${entry.id}`), entry.id);
  for (const row of SETTINGS_ROWS) assert.ok(ids.has(`config:${row.id}`), row.id);
  for (const item of items) {
    assert.ok(ALLOWED.has(item.action.kind), `${item.id} declares a known NMSh action`);
    assert.ok(item.label && item.detail, `${item.id} has a clear label`);
    if (item.action.kind === 'slash') assert.notEqual(parseSlashCommand(item.action.command)?.kind, 'unknown', item.id);
  }
});

test('search: substring first, acronym fuzzy, recent items first on an empty query', () => {
  const state = createPalette();
  state.query = 'chat';
  assert.equal(filterPalette(state)[0]!.id, 'layout:presentation');
  state.query = 'tcp';
  assert.equal(filterPalette(state)[0]!.id, 'layout:position');
  state.query = 'zzzz-nothing';
  assert.deepEqual(filterPalette(state), []);
  assert.match(renderPalette(state, 80, 12).map(stripAnsi).join('\n'), /No matching NMSh action/u);
  state.query = '';
  assert.equal(filterPalette(state, ['theme:warm'])[0]!.id, 'theme:warm');
  for (const key of decodeKeys('res')) handlePaletteKey(key, state);
  assert.equal(state.query, 'res');
  handlePaletteKey({kind: 'backspace'}, state);
  assert.equal(state.query, 're');
});

test('bindings: Ctrl+Shift+P / Cmd+Shift+P (CSI-u), F1 and /palette; plain Ctrl+P keeps its meaning', () => {
  assert.deepEqual(decodeKeys('\u001B[112;6u\u001B[80;6u\u001B[112;10u\u001BOP\u001B[11~').map(key => key.kind),
    ['palette', 'palette', 'palette', 'palette', 'palette']);
  assert.deepEqual(decodeKeys('\u0010').map(key => key.kind), ['suggestPrevious']);
  assert.deepEqual(parseSlashCommand('/palette'), {kind: 'palette'});
});

test('the palette opens, runs only the chosen action, and never executes shell text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-palette-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  const written: string[] = [];
  app['session'].write = ((data: string) => { written.push(data); }) as never;
  try {
    app['handleKey']({kind: 'palette'});
    assert.ok(app['paletteState'], 'F1 / Ctrl+Shift+P opens the palette');
    for (const key of decodeKeys('toggle chat')) app['handleKey'](key);
    app['handleKey']({kind: 'enter'});
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(app['paletteState'], undefined);
    assert.equal(app['promptConfiguration'].transcriptPresentation, 'chat');
    assert.equal(app['output'].presenter.transcriptLayout, 'chat');
    assert.equal(app['editor'].text, '', 'palette typing never reaches the editor');
    assert.deepEqual(written, [], 'nothing was sent to the shell');
    assert.equal(app['paletteRecent'][0], 'layout:presentation');

    app['handleKey']({kind: 'palette'});
    for (const key of decodeKeys('Config: Composer position')) app['handleKey'](key);
    app['handleKey']({kind: 'enter'});
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(app['settingsPanelState']?.view, 'config');
    assert.equal(visibleSettingsRows(app['settingsPanelState']!)[app['settingsPanelState']!.contentIndex!]!.id, 'composerPosition');
    app['settingsPanelState'] = undefined;

    app['handleKey']({kind: 'palette'});
    app['handleKey']({kind: 'escape'});
    assert.equal(app['paletteState'], undefined, 'Esc closes');
  } finally {
    app['stop'](0);
    app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    await rm(directory, {recursive: true, force: true});
  }
});
