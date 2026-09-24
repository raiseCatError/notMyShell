import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {stripAnsi} from '../src/util/text.js';
import {renderSettingsPanel} from '../src/ui/SettingsPanel.js';
import {decodeKeys} from '../src/terminal/keys.js';

/** Config writes land in a throwaway directory, never the developer's real settings. */
async function withApp(run: (app: TerminalApp) => void | Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-settings-panel-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const app = new TerminalApp();
  try {
    await run(app);
  } finally {
    app['stop'](0);
    app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    await rm(directory, {recursive: true, force: true});
  }
}

test('/settings, /config, and /status open one shared panel on the right view', async () => {
  assert.deepEqual(parseSlashCommand('/settings'), {kind: 'settings', view: 'config'});
  assert.deepEqual(parseSlashCommand('/config'), {kind: 'settings', view: 'config'});
  assert.deepEqual(parseSlashCommand('/status'), {kind: 'settings', view: 'status'});
  await withApp(async app => {
    app['render'] = () => {};
    for (const [command, view] of [['/settings', 'config'], ['/config', 'config'], ['/status', 'status']] as const) {
      app['editor'].insert(command);
      await app['submit']();
      assert.equal(app['settingsPanelState']?.view, view, command);
      app['settingsPanelState'] = undefined;
    }
  });
});

test('the panel is a temporary overlay and leaves transcript untouched on close', () => withApp(app => {
  let frame: TerminalFrame | undefined;
  app['fetchSuggestions'] = async () => {};
  app['renderer'].render = next => { frame = next; };
  app['openSettingsPanel']('config');
  const before = JSON.stringify(app['output'].transcript());
  app['render']();
  assert.equal(frame?.cursorVisible, false);
  assert.ok(frame?.rows.some(row => stripAnsi(row).includes('Config')));
  assert.ok(frame?.rows.some(row => stripAnsi(row).includes('Glyph style')));
  app['handleKey']({kind: 'escape'});
  assert.equal(app['settingsPanelState'], undefined);
  assert.equal(JSON.stringify(app['output'].transcript()), before);
}));

test('Left/Right switch Settings / Status / Config; Tab does not', () => withApp(app => {
  app['openSettingsPanel']('status');
  app['handleKey']({kind: 'right'});
  assert.equal(app['settingsPanelState']!.view, 'config');
  const glyph = app['promptConfiguration'].glyphStyle;
  app['handleKey']({kind: 'up'}); // Config rows edit values with ←/→; the view bar switches views
  app['handleKey']({kind: 'right'});
  assert.equal(app['settingsPanelState']!.view, 'settings');
  app['handleKey']({kind: 'left'});
  assert.equal(app['settingsPanelState']!.view, 'config');
  assert.equal(app['promptConfiguration'].glyphStyle, glyph);
  app['handleKey']({kind: 'complete'});
  app['handleKey']({kind: 'focusPrevious'});
  assert.equal(app['settingsPanelState']!.view, 'config');
  assert.deepEqual(decodeKeys('\u001B[C'), [{kind: 'right'}]);
}));

test('Settings view opens the glyph preview, which returns to Settings on Esc', () => withApp(app => {
  app['settingsPanelState'] = {section: 'root', view: 'settings', selectedIndex: 0, contentIndex: 1, glyphStyle: 'nerd', onboarding: false};
  app['handleKey']({kind: 'enter'});
  assert.equal(app['settingsPanelState']!.section, 'appearance');
  assert.ok(renderSettingsPanel(app['settingsPanelState']!, 80).some(row => stripAnsi(row).includes('~/Projects')),
    'the rich glyph comparison is kept');
  app['handleKey']({kind: 'escape'});
  assert.equal(app['settingsPanelState']!.section, 'root');
  assert.equal(app['settingsPanelState']!.view, 'settings');
}));

test('Transcript and Keyboard entries open their live panels and return to Settings', () => withApp(app => {
  app['settingsPanelState'] = {section: 'root', view: 'settings', selectedIndex: 0, contentIndex: 3, glyphStyle: 'nerd', onboarding: false};
  app['handleKey']({kind: 'enter'});
  assert.ok(app['transcriptPanelState']);
  app['handleKey']({kind: 'escape'});
  assert.equal(app['settingsPanelState']!.view, 'settings');
  assert.equal(app['settingsPanelState']!.contentIndex, 3);

  app['settingsPanelState']!.contentIndex = 4;
  app['startKeyboard'] = async () => { app['keyboardState'] = {selectedIndex: 0}; };
  app['handleKey']({kind: 'enter'});
  assert.ok(app['keyboardState']);
  app['handleKey']({kind: 'escape'});
  assert.equal(app['settingsPanelState']!.contentIndex, 4);
}));

test('Config Prompt provider row opens the prompt panel and returns to Config', () => withApp(app => {
  app['settingsPanelState'] = {section: 'root', view: 'config', selectedIndex: 0, contentIndex: 1, glyphStyle: 'nerd', onboarding: false};
  app['handleKey']({kind: 'enter'});
  assert.ok(app['promptPanelState']);
  app['handleKey']({kind: 'escape'});
  assert.equal(app['settingsPanelState']!.view, 'config');
  assert.equal(app['settingsPanelState']!.contentIndex, 1);
}));

test('Status is read-only, uses no secrets, and marks unknown build identity quietly', () => withApp(app => {
  process.env.NMSH_TEST_SECRET_TOKEN = 'sk-super-secret-value';
  try {
    app['openSettingsPanel']('status');
    const before = JSON.stringify(app['promptConfiguration']);
    for (const key of [{kind: 'down'}, {kind: 'enter'}, {kind: 'text', value: ' '}, {kind: 'text', value: '/'}] as const) app['handleKey'](key);
    assert.equal(JSON.stringify(app['promptConfiguration']), before);
    assert.equal(app['settingsPanelState']!.searchFocused, undefined, '/ does not search in Status');
    const rows = app['settingsPanelRows'](80).map(stripAnsi).join('\n');
    assert.match(rows, /Version:/u);
    assert.match(rows, /Session journal:\s+(active|inactive)/u);
    assert.ok(!rows.includes('sk-super-secret-value'));
    app['buildIdentity'] = {version: 'unknown', commit: 'unknown'};
    assert.ok(app['statusSections']().flat().some(item => item.label === 'Build' && item.value === 'unknown' && item.tone === 'muted'));
    for (const columns of [24, 40]) {
      app['settingsPanelState']!.contentIndex = 0;
      for (const row of renderSettingsPanel(app['settingsPanelState']!, columns, 30, {status: app['statusSections']()})) {
        assert.ok(stripAnsi(row).length <= columns);
      }
    }
  } finally {
    delete process.env.NMSH_TEST_SECRET_TOKEN;
  }
}));
