import test from 'node:test';
import assert from 'node:assert/strict';
import {isSlashInput, parseSlashCommand, slashCommands, slashSuggestions} from '../src/commands/slashCommands.js';
import {describeSlashCommand} from '../src/shell/CommandInspector.js';

test('absolute executable paths belong to the shell, never to NMSh', () => {
  for (const line of ['/Volumes/MotoLab/tools/platform-tools/adb devices', '/usr/bin/env', '/bin/ls -la', '/opt/homebrew/bin/brew list', '//usr/bin/true', '/./script.sh']) {
    assert.equal(isSlashInput(line), false, line);
    assert.equal(parseSlashCommand(line), undefined, `${line} runs as typed, not "Unknown NMSh command"`);
    assert.deepEqual(slashSuggestions(line), [], `${line} opens no slash menu`);
  }
});

test('paths whose first segment names an NMSh command are still paths', () => {
  // /zsh is the handoff command; /bin/zsh and /zsh/bin/zsh are executables.
  assert.deepEqual(parseSlashCommand('/zsh'), {kind: 'handoff', shell: 'zsh'});
  for (const line of ['/bin/zsh', '/zsh/bin/zsh', '/open/foo', '/history/x', '/update/apply', '/clear/']) assert.equal(parseSlashCommand(line), undefined, line);
  // A path in an argument does not make the line a path.
  assert.deepEqual(parseSlashCommand('/open /Volumes/MotoLab/notes.md'), {kind: 'open', target: '/Volumes/MotoLab/notes.md'});
  assert.deepEqual(parseSlashCommand('/dirs /usr/local'), {kind: 'directories', query: '/usr/local'});
  assert.deepEqual(parseSlashCommand('/open-diff /a/x /b/x'), {kind: 'openDiff', left: '/a/x', right: '/b/x'});
});

test('registered commands keep opening their UI; the menu still opens on a bare slash', () => {
  for (const command of slashCommands) {
    const word = command.name.split(' ')[0]!;
    assert.ok(isSlashInput(word), word);
    assert.ok(!/^\/[^\s/]*\//u.test(command.name), `${command.name} has no inner slash`);
  }
  assert.deepEqual(parseSlashCommand('/settings'), {kind: 'settings', view: 'config'});
  assert.equal(isSlashInput('/'), true);
  assert.ok(slashSuggestions('/').length > 0);
  assert.ok(slashSuggestions('/se').some(command => command.name === '/settings'));
  assert.match(describeSlashCommand('/settings') ?? '', /NMSh slash command/u);
});

test('unknown single-word slash input stays an NMSh typo, not a shell command', () => {
  // Ambiguous by text alone: a root-level word is far more likely a mistyped NMSh command than an executable in /.
  assert.deepEqual(parseSlashCommand('/stauts'), {kind: 'unknown', input: '/stauts'});
  assert.deepEqual(parseSlashCommand('/frobnicate now'), {kind: 'unknown', input: '/frobnicate now'});
  assert.equal(parseSlashCommand('ls /'), undefined);
  assert.equal(parseSlashCommand(' /settings'), undefined, 'a leading space is still the explicit shell escape');
});
