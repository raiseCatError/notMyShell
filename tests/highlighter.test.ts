import test from 'node:test';
import assert from 'node:assert';
import {Highlighter} from '../src/input/Highlighter.js';
import type {CommandType} from '../src/shell/SemanticService.js';
import {graphemes} from '../src/input/inputLayout.js';

test('lexical highlighting of various shell constructs', () => {
  const h = new Highlighter();
  const cache = new Map<string, CommandType>();

  const check = (input: string) => {
    return h.tokenize(graphemes(input), cache).map(t => `${t.type}:${t.text}`);
  };

  assert.deepEqual(check('git status'), ['Command:git', 'Normal: ', 'Argument:status']);
  assert.deepEqual(check('echo "hello world"'), ['Command:echo', 'Normal: ', 'String:"hello world"']);
  assert.deepEqual(check("echo 'hello world'"), ['Command:echo', 'Normal: ', 'String:\'hello world\'']);
  assert.deepEqual(check('FOO=bar command'), ['Argument:FOO=bar', 'Normal: ', 'Command:command']);
  assert.deepEqual(check('echo $HOME'), ['Command:echo', 'Normal: ', 'Variable:$HOME']);
  assert.deepEqual(check('echo ${HOME}'), ['Command:echo', 'Normal: ', 'Variable:${HOME}']);
  assert.deepEqual(check('echo $(pwd)'), ['Command:echo', 'Normal: ', 'Variable:$', 'Operator:(', 'Command:pwd', 'Operator:)']);
  
  assert.deepEqual(check('git status && echo done'), [
    'Command:git', 'Normal: ', 'Argument:status', 'Normal: ', 'Operator:&&', 'Normal: ', 'Command:echo', 'Normal: ', 'Argument:done'
  ]);
  assert.deepEqual(check('cat file | grep foo'), [
    'Command:cat', 'Normal: ', 'Argument:file', 'Normal: ', 'Operator:|', 'Normal: ', 'Command:grep', 'Normal: ', 'Argument:foo'
  ]);
  assert.deepEqual(check('echo hi > file'), [
    'Command:echo', 'Normal: ', 'Argument:hi', 'Normal: ', 'Operator:>', 'Normal: ', 'Argument:file'
  ]);
  assert.deepEqual(check('echo hi 2>&1'), [
    'Command:echo', 'Normal: ', 'Argument:hi', 'Normal: ', 'Operator:2>&1'
  ]);
  
  assert.deepEqual(check('# comment'), ['Comment:# comment']);
  assert.deepEqual(check('echo "# not comment"'), ['Command:echo', 'Normal: ', 'String:"# not comment"']);
  assert.deepEqual(check('./script.sh'), ['Path:./script.sh']);
  assert.deepEqual(check('~/Projects/foo'), ['Path:~/Projects/foo']);
  assert.deepEqual(check('ls --help -v'), ['Command:ls', 'Normal: ', 'Flag:--help', 'Normal: ', 'Flag:-v']);
});

test('incomplete input does not throw', () => {
  const h = new Highlighter();
  const cache = new Map<string, CommandType>();

  const tryTokenize = (input: string) => {
    assert.doesNotThrow(() => {
      h.tokenize(graphemes(input), cache);
    });
  };

  tryTokenize('echo "');
  tryTokenize("echo '");
  tryTokenize('echo ${');
  tryTokenize('echo $(');
  tryTokenize('if [[');
  tryTokenize('git status &&');
  tryTokenize('foo |');
});

test('semantic classification updates', () => {
  const h = new Highlighter();
  const cache = new Map<string, CommandType>();
  
  // Initially git is unknown because cache is empty
  let t = h.tokenize(graphemes('git status'), cache);
  assert.equal(t[0].type, 'Command');
  
  cache.set('git', 'executable');
  cache.set('cd', 'builtin');
  cache.set('ll', 'alias');
  cache.set('z', 'function');
  cache.set('gti', 'unknown');
  
  t = h.tokenize(graphemes('git status'), cache);
  assert.equal(t[0].type, 'KnownCommand');
  
  t = h.tokenize(graphemes('cd ~/dir'), cache);
  assert.equal(t[0].type, 'Builtin');
  
  t = h.tokenize(graphemes('ll'), cache);
  assert.equal(t[0].type, 'Alias');
  
  t = h.tokenize(graphemes('z foo'), cache);
  assert.equal(t[0].type, 'Function');
  
  t = h.tokenize(graphemes('gti status'), cache);
  assert.equal(t[0].type, 'UnknownCommand');
});
