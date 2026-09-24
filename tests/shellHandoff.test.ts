import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrdinaryZshEnvironment, isManagedNmshEnvironment, chooseShellHandoff} from '../src/shell/ShellHandoff.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';

test('managed-shell marker rejects nested NMSh while ordinary shells may launch it', () => {
  assert.equal(isManagedNmshEnvironment({NMSH_ACTIVE: '1'}), true);
  assert.equal(isManagedNmshEnvironment({NMSH_ACTIVE: undefined}), false);
  assert.equal(isManagedNmshEnvironment({}), false);
});

test('ordinary zsh handoff removes only NMSh managed-shell state', () => {
  assert.deepEqual(createOrdinaryZshEnvironment({NMSH_ACTIVE: '1', PATH: '/bin', ZDOTDIR: '/custom/zsh'}), {
    PATH: '/bin',
    ZDOTDIR: '/custom/zsh',
  });
});

test('idle /zsh handoff preserves a valid managed cwd and refuses an active foreground command', () => {
  assert.deepEqual(chooseShellHandoff(false, '/work/project', '/start', path => path === '/work/project'), {
    kind: 'handoff',
    cwd: '/work/project',
  });
  assert.deepEqual(chooseShellHandoff(true, '/work/project', '/start', () => true), {kind: 'busy'});
  assert.deepEqual(chooseShellHandoff(false, '/removed', '/start', path => path === '/start'), {
    kind: 'handoff',
    cwd: '/start',
  });
});

test('/zsh parses as an NMSh command', () => {
  assert.deepEqual(parseSlashCommand('/zsh'), {kind: 'zsh'});
  assert.deepEqual(parseSlashCommand('/zsh  '), {kind: 'zsh'});
});
