import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nmshConfigDirectory, promptConfigurationPath} from '../src/configuration/paths.js';
import {loadPromptConfiguration, normalizePromptConfiguration, savePromptConfiguration} from '../src/prompt/configuration.js';
import {framePanel} from '../src/ui/PanelShell.js';
import {getCurrentGlyphMode, powerlineShapeGlyphs, setIconStyle} from '../src/ui/glyphs.js';
import {renderSettingsPanel} from '../src/ui/SettingsPanel.js';

test('NMSh configuration uses macOS Application Support and honors XDG overrides', () => {
  assert.equal(nmshConfigDirectory({HOME: '/Users/test'}, 'darwin'), '/Users/test/Library/Application Support/notMyShell');
  assert.equal(nmshConfigDirectory({HOME: '/Users/test', XDG_CONFIG_HOME: '/tmp/config'}, 'darwin'), '/tmp/config/nmsh');
  assert.equal(nmshConfigDirectory({HOME: '/home/test'}, 'linux'), '/home/test/.config/nmsh');
  assert.equal(promptConfigurationPath({HOME: '/Users/test'}), '/Users/test/Library/Application Support/notMyShell/config.json');
});

test('v0.3 config keeps Nerd appearance and completed onboarding; fresh config asks for glyph style', () => {
  assert.equal(normalizePromptConfiguration({}).glyphChoiceComplete, false);
  assert.equal(normalizePromptConfiguration({onboardingComplete: true}).glyphChoiceComplete, true);
  assert.equal(normalizePromptConfiguration({onboardingComplete: true}).glyphStyle, 'nerd');
  assert.equal(normalizePromptConfiguration({glyphStyle: 'invalid'}).glyphStyle, 'nerd');
  assert.equal(normalizePromptConfiguration({}).sessionRetention, 1000);
  assert.equal(normalizePromptConfiguration({sessionRetention: 500}).sessionRetention, 500);
  assert.equal(normalizePromptConfiguration({sessionRetention: null}).sessionRetention, null);
  assert.equal(normalizePromptConfiguration({sessionRetention: -1}).sessionRetention, 1000);
});

test('glyph style persists and safe geometry avoids private-use glyphs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-glyph-config-'));
  const path = join(directory, 'config.json');
  try {
    await writeFile(path, JSON.stringify({onboardingComplete: true}), 'utf8');
    const existing = loadPromptConfiguration(path);
    assert.equal(existing.glyphStyle, 'nerd');
    assert.equal(existing.glyphChoiceComplete, true);
    savePromptConfiguration({...existing, glyphStyle: 'safe'}, path);
    assert.equal(loadPromptConfiguration(path).glyphStyle, 'safe');
    setIconStyle('safe');
    assert.equal(getCurrentGlyphMode(), process.env.NMSH_ICONS === 'nerd' ? 'nerd' : 'safe');
    if (process.env.NMSH_ICONS !== 'nerd') assert.deepEqual(powerlineShapeGlyphs('wedge'), {open: '<', close: '>', join: '>'});
  } finally {
    setIconStyle('nerd');
    await rm(directory, {recursive: true, force: true});
  }
});

test('panel boundary is transient rendering chrome', () => {
  const rows = renderSettingsPanel({section: 'appearance', selectedIndex: 1, glyphStyle: 'safe', onboarding: false});
  const framed = framePanel(rows, 12);
  assert.equal(framed.length, rows.length + 1);
  assert.match(framed[0]!, /─{12}|-{12}/u);
  assert.equal(rows[0]?.includes('Appearance'), true);
  const compact = renderSettingsPanel({section: 'root', selectedIndex: 10, glyphStyle: 'safe', onboarding: false}, 7);
  assert.equal(compact.length, 7);
  assert.match(compact.join('\n'), /Keyboard/u);
});

test('composer layout loads from the existing prompt config and legacy config defaults to two-line', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-prompt-config-'));
  const path = join(directory, 'config.json');
  try {
    await writeFile(path, JSON.stringify({composerLayout: 'oneLine'}), 'utf8');
    assert.equal(loadPromptConfiguration(path).composerLayout, 'oneLine');
    await writeFile(path, JSON.stringify({placement: 'composer', gap: 2}), 'utf8');
    assert.equal(loadPromptConfiguration(path).composerLayout, 'twoLine');
    await writeFile(path, JSON.stringify({composerLayout: 'unexpected'}), 'utf8');
    assert.equal(loadPromptConfiguration(path).composerLayout, 'twoLine');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
