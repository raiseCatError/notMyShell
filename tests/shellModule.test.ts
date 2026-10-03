import test from 'node:test';
import assert from 'node:assert/strict';
import {applyShellModuleVisibility, DEFAULT_PROMPT_CONFIGURATION, hasVisibleContextModule, normalizePromptConfiguration, shellModuleVisibility,
  type PromptConfiguration} from '../src/prompt/configuration.js';
import {renderedModules} from '../src/prompt/prompt.js';
import {SETTINGS_ROWS, settingsRowValue} from '../src/ui/SettingsPanel.js';
import {SETUP_SECTIONS} from '../src/setup/SetupCat.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

const config = (): PromptConfiguration => structuredClone(DEFAULT_PROMPT_CONFIGURATION);
const shellText = (configuration: PromptConfiguration, current: string, differs: boolean) => renderedModules({cwd: '/w', project: 'w', exitStatus: 0,
  shell: {current, differs}}, configuration).filter(module => module.id === 'shell').map(module => module.text).join(' ');

test('current-shell module: When different is the default; hidden when equal, shown when different', () => {
  const configuration = config();
  assert.equal(shellModuleVisibility(configuration), 'whenDifferent');
  assert.equal(shellText(configuration, 'zsh', false), '');
  assert.match(shellText(configuration, 'fish', true), /fish$/u);
  assert.equal(hasVisibleContextModule({...configuration, modules: configuration.modules.filter(module => module.id === 'shell')}, {shell: {differs: false}}), false);
  assert.equal(hasVisibleContextModule({...configuration, modules: configuration.modules.filter(module => module.id === 'shell')}, {shell: {differs: true}}), true);
});

test('current-shell module: Always and Never', () => {
  const always = config();
  applyShellModuleVisibility(always, 'always');
  assert.match(shellText(always, 'zsh', false), /zsh$/u);
  const never = config();
  applyShellModuleVisibility(never, 'never');
  assert.equal(shellText(never, 'bash', true), '');
  assert.equal(shellModuleVisibility(never), 'never');
});

test('normalization: older configs gain the module at its default; invalid conditions fall back; shellDiffers stays shell-only', () => {
  const legacy = normalizePromptConfiguration({modules: [{id: 'cwd', visible: true, condition: 'always'}]});
  assert.deepEqual(legacy.modules.find(module => module.id === 'shell'), {id: 'shell', visible: true, condition: 'shellDiffers'});
  const bad = normalizePromptConfiguration({modules: [{id: 'shell', visible: true, condition: 'inRepository'}, {id: 'cwd', visible: true, condition: 'shellDiffers'}]});
  assert.equal(bad.modules.find(module => module.id === 'shell')!.condition, 'shellDiffers');
  assert.equal(bad.modules.find(module => module.id === 'cwd')!.condition, 'always');
  const saved = normalizePromptConfiguration({modules: [{id: 'shell', visible: true, condition: 'always'}]});
  assert.equal(shellModuleVisibility(saved), 'always');
});

test('Settings and Setup Cat share the same Default shell and Show current shell rows', () => {
  const row = SETTINGS_ROWS.find(item => item.id === 'showShell')!;
  assert.equal(settingsRowValue(row, config()), 'When different');
  const next = row.control === 'enum' ? row.select(config(), 1) : config();
  assert.equal(shellModuleVisibility(next), 'always');
  const shell = SETUP_SECTIONS.find(section => section.id === 'shell')!;
  assert.deepEqual(shell.rows.map(item => item.row), [SETTINGS_ROWS.find(item => item.id === 'shellBackend'), row]);
});

test('app: the module follows /shell immediately and changing the default never switches this session', () => {
  const app = new TerminalApp();
  try {
    assert.deepEqual(app['promptContext']('').shell, {current: 'zsh', differs: false});
    app['shellId'] = 'fish';
    assert.deepEqual(app['promptContext']('').shell, {current: 'fish', differs: true});
    app['promptConfiguration'] = {...app['promptConfiguration'], shellBackend: 'fish'};
    assert.deepEqual(app['promptContext']('').shell, {current: 'fish', differs: false});
    app['shellId'] = 'zsh';
    app['promptConfiguration'] = {...app['promptConfiguration'], shellBackend: 'bash'};
    assert.equal(app['shellId'], 'zsh', 'the default is for new sessions only');
  } finally { app['stop'](0); app['session'].kill(); }
});
