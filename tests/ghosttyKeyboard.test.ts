import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {installGhosttyKeybinding} from '../src/keyboard/ghosttyKeyboard.js';

test('Ghostty keybinding installation', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nmsh-test-'));
  
  // Override environment to point to our temp dir
  const oldXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;
  
  try {
    const configDir = path.join(tmpDir, 'ghostty');
    await fs.mkdir(configDir, {recursive: true});
    const configPath = path.join(configDir, 'config');
    
    // 1. Initial unrelated config
    await fs.writeFile(configPath, 'font-size = 14\n', 'utf8');
    
    // 2. Install
    const result1 = await installGhosttyKeybinding();
    assert.equal(result1.success, true);
    
    const installedConfig = await fs.readFile(configPath, 'utf8');
    assert.match(installedConfig, /font-size = 14/);
    assert.match(installedConfig, /keybind = cmd\+a=text:\\x1b\[97;9u/);
    assert.match(installedConfig, /keybind = alt\+backspace=text:\\x1b\[127;3u/);
    
    // 3. Idempotency check
    const result2 = await installGhosttyKeybinding();
    assert.equal(result2.success, true);
    
    const installedConfig2 = await fs.readFile(configPath, 'utf8');
    assert.equal(installedConfig, installedConfig2, 'Config should not change on second install');
    
  } finally {
    process.env.XDG_CONFIG_HOME = oldXdg;
    await fs.rm(tmpDir, {recursive: true, force: true});
  }
});
