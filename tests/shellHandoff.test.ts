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

test('/zsh, /fish, /bash and /exit parse as one handoff command', () => {
  assert.deepEqual(parseSlashCommand('/zsh'), {kind: 'handoff', shell: 'zsh'});
  assert.deepEqual(parseSlashCommand('/zsh  '), {kind: 'handoff', shell: 'zsh'});
  assert.deepEqual(parseSlashCommand('/fish'), {kind: 'handoff', shell: 'fish'});
  assert.deepEqual(parseSlashCommand('/bash'), {kind: 'handoff', shell: 'bash'});
  assert.deepEqual(parseSlashCommand('/exit'), {kind: 'handoff'}, '/exit uses the configured default');
  assert.deepEqual(parseSlashCommand('/shell fish'), {kind: 'shell', shell: 'fish'}, 'switching is a different command');
});
