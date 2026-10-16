import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {WORKSPACE_DISABLED_MESSAGE, WorkspaceHost} from '../src/app/workspaceHost.js';
import {parseSlashCommand, slashCommands} from '../src/commands/slashCommands.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {createSetup, sectionIndex, SETUP_SECTIONS} from '../src/setup/SetupCat.js';
import {SETTINGS_ROWS, settingsRowValue} from '../src/ui/SettingsPanel.js';
import type {Binding} from '../src/workspace/keymap.js';
import {stripAnsi} from '../src/util/text.js';

// The docked sidebar and detail panel are experimental and Off by default (workspace-ui-decision.md, v0.20).

function app(columns: number, workspacePanels: boolean, rows = 30): TerminalApp {
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'render', {value: () => {}});
  Object.defineProperty(instance, 'terminalDimensions', {value: () => ({columns, rows})});
  instance['startupPending'] = false;
  Object.defineProperty(instance, 'refreshWorkspaceSources', {value: async () => {}});
  instance['configuration'] = {...instance['configuration'], workspacePanels};
  const said: string[] = [];
  Object.defineProperty(instance['output'], 'addFrontendInteraction', {value: (_command: string, text: string) => { said.push(text); }});
  Object.defineProperty(instance, 'said', {value: said});
  return instance;
}
const said = (instance: TerminalApp) => (instance as unknown as {said: string[]}).said.join('\n');
const done = (instance: TerminalApp) => { instance['stop'](0); instance['session'].kill(); };
const slash = async (instance: TerminalApp, text: string) => instance['runSlash'](text, parseSlashCommand(text)!);

test('the setting: Off for new configurations; only an explicit true turns it on; it round-trips', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.workspacePanels, false);
  assert.equal(normalizePromptConfiguration({}).workspacePanels, false, 'an existing configuration without it upgrades to Off');
  for (const value of ['true', 1, 'yes', null, {}]) assert.equal(normalizePromptConfiguration({workspacePanels: value} as never).workspacePanels, false);
  const on = normalizePromptConfiguration({workspacePanels: true});
  assert.equal(on.workspacePanels, true);
  assert.equal(normalizePromptConfiguration(JSON.parse(JSON.stringify(on))).workspacePanels, true, 'persists');
  // Every other saved choice is untouched by the new field.
  const saved = normalizePromptConfiguration({commandQueue: false, composerPosition: 'top'});
  assert.equal(saved.commandQueue, false);
  assert.equal(saved.composerPosition, 'top');
});

test('discoverable: a labelled Settings → Layout row and a Setup → Editor row edit the same setting', () => {
  const row = SETTINGS_ROWS.find(item => item.id === 'workspacePanels')!;
  assert.ok(row, 'Settings row');
  assert.equal(row.category, 'Layout');
  assert.match(row.description, /Experimental, Off by default/u);
  assert.equal(settingsRowValue(row, DEFAULT_PROMPT_CONFIGURATION), 'false');
  assert.ok(row.control === 'boolean' && row.set(DEFAULT_PROMPT_CONFIGURATION, true).workspacePanels);
  const editor = SETUP_SECTIONS.find(section => section.id === 'editor')!;
  assert.ok(editor.rows.some(item => item.row.id === 'workspacePanels'), 'in Setup');
  assert.equal(createSetup(DEFAULT_PROMPT_CONFIGURATION, 'editor').section, sectionIndex('editor'));
  for (const name of ['/sidebar', '/panel']) assert.match(slashCommands.find(item => item.name === name)!.description, /^Experimental \(Off by default/u);
});

test('Off: /sidebar and /panel open nothing, say how to turn them on, and never resize the shell', async () => {
  const instance = app(160, false);
  try {
    const before = instance['dimensions']();
    for (const command of ['/sidebar', '/panel', '/sidebar focus', '/panel focus']) {
      await slash(instance, command);
      assert.equal(instance['workspace'].open, false, `${command} opens nothing`);
      assert.equal(instance['workspaceOwner'](), 'COMPOSER', 'the composer keeps the keyboard');
      assert.deepEqual(instance['dimensions'](), before, 'the PTY keeps every column');
    }
    assert.ok(said(instance).includes('Settings → Layout → Workspace sidebar & panel'), WORKSPACE_DISABLED_MESSAGE);
    assert.equal(instance['workspaceColumns']().ptyColumns, 160);
  } finally { done(instance); }
});

test('Off: keymap.json workspace bindings stay as written but take no key', async () => {
  const instance = app(160, false);
  try {
    const binding: Binding = {action: 'sidebar.focus', context: 'composerEmpty', key: {kind: 'left'}};
    instance['workspace'].bindings = [...instance['workspace'].bindings, binding];
    assert.equal(instance['handleWorkspaceKey']({kind: 'left'}), false, 'Left does what it always did');
    assert.equal(instance['workspace'].open, false);
    assert.ok(instance['workspace'].bindings.includes(binding), 'the binding is kept, not removed');
    await slash(instance, '/keys');
    assert.ok(said(instance).includes('take no key until they are turned on'), '/keys says why');
  } finally { done(instance); }
});

test('On: /sidebar docks and narrows the shell as before; turning the setting Off closes both and gives every column back', async () => {
  const instance = app(160, true);
  try {
    await slash(instance, '/sidebar');
    await slash(instance, '/panel focus');
    assert.equal(instance['workspace'].open, true);
    assert.ok(instance['dimensions']().columns < 160, 'docked regions narrow the center');
    assert.equal(instance['workspaceOwner'](), 'RIGHT_PANEL');
    instance['promptConfiguration'] = {...instance['configuration'], workspacePanels: false};
    assert.equal(instance['workspace'].open, false, 'closed');
    assert.equal(instance['workspaceOwner'](), 'COMPOSER', 'focus back in the composer');
    assert.equal(instance['dimensions']().columns, 160, 'the PTY gets every column again');
    await slash(instance, '/sidebar');
    assert.equal(instance['workspace'].open, false, 'and stays closed while Off');
  } finally { done(instance); }
});

test('native commands never depend on the experimental regions', () => {
  for (const command of ['/worktrees', '/sessions', '/github', '/background', '/keys']) {
    assert.notEqual(parseSlashCommand(command)?.kind, 'unknown', command);
    assert.notEqual(parseSlashCommand(command)?.kind, 'workspace', command);
  }
  // The host alone (as its own unit tests use it) is enabled; the gate is the frontend's setting.
  const host = new WorkspaceHost(() => false);
  assert.deepEqual(host.perform('sidebar.toggle', 160), {kind: 'disabled'});
  assert.deepEqual(host.perform('panel.focus', 160), {kind: 'disabled'});
  assert.equal(host.open, false);
  assert.notDeepEqual(new WorkspaceHost().perform('sidebar.toggle', 160), {kind: 'disabled'});
});
