import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {stripAnsi} from '../src/util/text.js';
import {renderSettingsPanel, SETTINGS_SECTIONS} from '../src/ui/SettingsPanel.js';
import {renderTabStrip} from '../src/ui/PanelShell.js';
import {decodeKeys} from '../src/terminal/keys.js';

test('/settings opens as a temporary framed overlay and leaves transcript untouched on close', () => {
  assert.deepEqual(parseSlashCommand('/settings'), {kind: 'settings'});
  const app = new TerminalApp();
  let frame: TerminalFrame | undefined;
  try {
    app['fetchSuggestions'] = async () => {};
    app['renderer'].render = next => { frame = next; };
    app['settingsPanelState'] = {section: 'root', selectedIndex: 0, glyphStyle: 'nerd', onboarding: false};
    const before = JSON.stringify(app['output'].transcript());
    app['render']();
    assert.equal(frame?.cursorVisible, false);
    assert.ok(frame?.rows.some(row => stripAnsi(row).includes('Settings')));
    assert.ok(frame?.rows.some(row => stripAnsi(row).includes('Glyph style')));
    app['handleKey']({kind: 'escape'});
    assert.equal(app['settingsPanelState'], undefined);
    assert.equal(JSON.stringify(app['output'].transcript()), before);
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('Tab and Shift+Tab move between settings categories; category content follows', () => {
  const app = new TerminalApp();
  try {
    app['settingsPanelState'] = {section: 'root', selectedIndex: 0, glyphStyle: 'nerd', onboarding: false};
    app['handleKey']({kind: 'complete'});
    assert.equal(app['settingsPanelState']!.selectedIndex, 1);
    assert.ok(renderSettingsPanel(app['settingsPanelState']!, 80).some(row => stripAnsi(row).includes('Provider, theme')));
    app['handleKey']({kind: 'focusPrevious'});
    assert.equal(app['settingsPanelState']!.selectedIndex, 0);
    assert.ok(renderSettingsPanel(app['settingsPanelState']!, 80).some(row => stripAnsi(row).includes('Glyph style')));
    assert.deepEqual(decodeKeys('\u001B[9;2u'), [{kind: 'focusPrevious'}]);
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('selected tab stays visible in one line across narrow terminal widths', () => {
  for (const columns of [20, 32, 48, 80]) {
    for (const selected of [0, 2, 10]) {
      const row = stripAnsi(renderTabStrip(SETTINGS_SECTIONS, selected, columns));
      assert.ok(row.includes(SETTINGS_SECTIONS[selected]!), `${columns} columns: ${row}`);
      assert.ok(!row.includes('\n'));
      assert.ok(row.length <= columns);
    }
  }
});

test('settings search filters name, description, and category without changing config', () => {
  const app = new TerminalApp();
  try {
    app['settingsPanelState'] = {section: 'root', selectedIndex: 0, glyphStyle: 'nerd', onboarding: false};
    const before = JSON.stringify(app['promptConfiguration']);
    for (const letter of 'binding') app['handleKey']({kind: 'text', value: letter});
    assert.ok(renderSettingsPanel(app['settingsPanelState']!, 80).some(row => stripAnsi(row).includes('Keyboard  ')));
    assert.equal(JSON.stringify(app['promptConfiguration']), before);
    app['handleKey']({kind: 'escape'});
    assert.equal(app['settingsPanelState']!.searchQuery, '');
    app['handleKey']({kind: 'escape'});
    assert.equal(app['settingsPanelState'], undefined);
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('General opens glyph style and returns to General on Esc', () => {
  const app = new TerminalApp();
  try {
    app['settingsPanelState'] = {section: 'root', selectedIndex: 0, glyphStyle: 'nerd', onboarding: false};
    app['handleKey']({kind: 'enter'});
    assert.equal(app['settingsPanelState']!.section, 'appearance');
    app['handleKey']({kind: 'escape'});
    assert.equal(app['settingsPanelState']!.section, 'root');
    assert.equal(app['settingsPanelState']!.selectedIndex, 0);
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('Transcript and Keyboard tabs open their live panels and return to their tabs', () => {
  const app = new TerminalApp();
  try {
    app['settingsPanelState'] = {section: 'root', selectedIndex: 2, glyphStyle: 'nerd', onboarding: false};
    app['handleKey']({kind: 'enter'});
    assert.ok(app['transcriptPanelState']);
    app['handleKey']({kind: 'escape'});
    assert.equal(app['settingsPanelState']!.selectedIndex, 2);

    app['settingsPanelState']!.selectedIndex = 10;
    app['startKeyboard'] = async () => { app['keyboardState'] = {selectedIndex: 0}; };
    app['handleKey']({kind: 'enter'});
    assert.ok(app['keyboardState']);
    app['handleKey']({kind: 'escape'});
    assert.equal(app['settingsPanelState']!.selectedIndex, 10);
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
