import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {stripAnsi} from '../src/util/text.js';

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
    assert.ok(frame?.rows.some(row => stripAnsi(row).includes('Appearance')));
    app['handleKey']({kind: 'escape'});
    assert.equal(app['settingsPanelState'], undefined);
    assert.equal(JSON.stringify(app['output'].transcript()), before);
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
