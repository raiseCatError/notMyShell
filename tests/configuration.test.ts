import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nmshConfigDirectory, promptConfigurationPath} from '../src/configuration/paths.js';
import {loadPromptConfiguration} from '../src/prompt/configuration.js';

test('NMSh configuration uses macOS Application Support and honors XDG overrides', () => {
  assert.equal(nmshConfigDirectory({HOME: '/Users/test'}, 'darwin'), '/Users/test/Library/Application Support/notMyShell');
  assert.equal(nmshConfigDirectory({HOME: '/Users/test', XDG_CONFIG_HOME: '/tmp/config'}, 'darwin'), '/tmp/config/nmsh');
  assert.equal(nmshConfigDirectory({HOME: '/home/test'}, 'linux'), '/home/test/.config/nmsh');
  assert.equal(promptConfigurationPath({HOME: '/Users/test'}), '/Users/test/Library/Application Support/notMyShell/config.json');
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
