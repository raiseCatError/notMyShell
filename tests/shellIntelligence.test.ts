import test from 'node:test';
import assert from 'node:assert/strict';
import {Highlighter} from '../src/input/Highlighter.js';
import {graphemes} from '../src/input/inputLayout.js';
import {parseShellKnowledge, classifyShellFailure} from '../src/shell/ShellKnowledge.js';
import {ShellSession} from '../src/shell/ShellSession.js';
import {SemanticService} from '../src/shell/SemanticService.js';
import {CompletionService} from '../src/shell/CompletionService.js';
import {inspectCommand} from '../src/shell/CommandKnowledge.js';
import {once} from 'node:events';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('shell name metadata is bounded, ignores bodies, and preserves alias precedence', () => {
  const names = parseShellKnowledge('function fun\nalias ll\nfunction ll\nalias unsafe\u001b\nbody execute-me\n');
  assert.equal(names.get('fun'), 'function');
  assert.equal(names.get('ll'), 'alias');
  assert.equal(names.has('unsafe'), false);
  assert.equal(parseShellKnowledge('x'.repeat(65537)).size, 0);
});

test('syntax roles handle compound keywords, leading redirects, expansions, escapes and globbing', () => {
  const tokens = (input: string) => new Highlighter().tokenize(graphemes(input), new Map());
  const role = (input: string, word: string) => tokens(input).find(token => token.text === word)?.type;
  assert.equal(role('if true; then echo yes; fi', 'if'), 'KnownCommand');
  assert.equal(role('if true; then echo yes; fi', 'echo'), 'Command');
  assert.equal(role('> output echo hi', 'output'), 'Argument');
  assert.equal(role('> output echo hi', 'echo'), 'Command');
  assert.equal(role('echo first & next', 'next'), 'Command');
  assert.equal(role('echo ${HOME:-a b}', '${HOME:-a b}'), 'Variable');
  assert.equal(role('echo $((1 + 2))', '$((1 + 2))'), 'Variable');
  assert.equal(role('echo $(printf hello)', '$(printf hello)'), 'Variable');
  assert.equal(role('echo `printf hello`', '`printf hello`'), 'Variable');
  assert.equal(role('if [[ -f file ]]; then echo yes; fi', '[['), 'KnownCommand');
  assert.equal(role('if [[ -f file ]]; then echo yes; fi', ']]'), 'KnownCommand');
  assert.equal(role('echo *.ts', '*.ts'), 'Path');
  for (const input of ['echo "', 'echo ${', 'echo $(', 'echo \\', "echo 'a\\' tail", '3> file echo']) {
    const values = tokens(input);
    assert.equal(values.map(value => value.text).join(''), input);
    assert.ok(values.every(value => value.end <= graphemes(input).length));
  }
});

test('failure classification requires a matching real diagnostic, not exit 127 alone', () => {
  assert.equal(classifyShellFailure('missing', 127, 'zsh: command not found: missing\n'), 'command-not-found');
  assert.equal(classifyShellFailure('fun', 127, 'internal failure\n'), undefined);
  assert.equal(classifyShellFailure('missing', 127, 'zsh: command not found: other\n'), undefined);
  assert.equal(classifyShellFailure('echo ok', 1, 'zsh: parse error near `)\'\n'), 'syntax-error');
});

test('live alias/function names refresh after real definitions and removal without leaking bodies', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-knowledge-fixture-'));
  writeFileSync(join(home, '.zshrc'), '');
  const shell = new ShellSession(home, 80, 24, home, {...process.env, HOME: home});
  let output = '';
  shell.on('data', data => { output += data; });
  try {
    await once(shell, 'prompt');
    const changed = once(shell, 'prompt');
    shell.submit("alias live_alias='print alias-secret'; live_function() { print function-secret; }; print RAW-MARKER");
    const [marker] = await changed;
    const names = parseShellKnowledge(marker.knowledge ?? '');
    assert.equal(names.get('live_alias'), 'alias');
    assert.equal(names.get('live_function'), 'function');
    assert.match(output, /RAW-MARKER/);
    assert.doesNotMatch(output, /alias-secret|function-secret/);
    const removed = once(shell, 'prompt');
    shell.submit('unalias live_alias; unfunction live_function');
    const [fresh] = await removed;
    assert.equal(parseShellKnowledge(fresh.knowledge ?? '').has('live_alias'), false);
    assert.equal(parseShellKnowledge(fresh.knowledge ?? '').has('live_function'), false);
  } finally { shell.kill(); rmSync(home, {recursive: true, force: true}); }
});

test('shell metadata primes semantics, completion and inspector without executing names', async () => {
  const service = new SemanticService(process.cwd());
  const completions = new CompletionService({id: 'empty', query: async () => []});
  try {
    service.applyShellKnowledge('alias live_alias\nfunction live_function\n');
    assert.equal(await service.classifyCommand('live_alias'), 'alias');
    assert.equal(await service.classifyCommand('live_function'), 'function');
    assert.equal(inspectCommand('live_alias', 10, '/', [], service.cache)?.source, 'shell-metadata');
    completions.setShellKnowledge(parseShellKnowledge('alias live_alias\nfunction live_function\n'));
    assert.deepEqual((await completions.suggest('live_', '/')).map(item => item.value), ['live_alias', 'live_function']);
    service.applyShellKnowledge('');
    assert.equal(service.cache.has('live_alias'), false);
  } finally { service.kill(); completions.dispose(); }
});
