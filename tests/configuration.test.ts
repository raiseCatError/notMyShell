import test from 'node:test';
import assert from 'node:assert/strict';
import {nmshConfigDirectory, promptConfigurationPath} from '../src/configuration/paths.js';

test('NMSh configuration uses macOS Application Support and honors XDG overrides', () => {
  assert.equal(nmshConfigDirectory({HOME: '/Users/test'}, 'darwin'), '/Users/test/Library/Application Support/notMyShell');
  assert.equal(nmshConfigDirectory({HOME: '/Users/test', XDG_CONFIG_HOME: '/tmp/config'}, 'darwin'), '/tmp/config/nmsh');
  assert.equal(nmshConfigDirectory({HOME: '/home/test'}, 'linux'), '/home/test/.config/nmsh');
  assert.equal(promptConfigurationPath({HOME: '/Users/test'}), '/Users/test/Library/Application Support/notMyShell/config.json');
});
