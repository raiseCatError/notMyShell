import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {MAX_BATCH_CHARACTERS, splitBatch, type BatchShell} from '../src/input/pasteBatch.js';

const texts = (input: string, shell: BatchShell) => {
  const result = splitBatch(input, shell);
  assert.ok(result.ok, result.ok ? '' : result.reason);
  return result.ok ? result.commands.map(command => command.text) : [];
};
const refuses = (input: string, shell: BatchShell) => { const result = splitBatch(input, shell); assert.equal(result.ok, false, JSON.stringify(result)); return result.ok ? '' : result.reason; };

const POSIX: BatchShell[] = ['zsh', 'bash'];

test('independent lines are separate commands, in order; blank lines vanish between them', () => {
  for (const shell of ['zsh', 'bash', 'fish'] as const) {
    assert.deepEqual(texts('cd ~/work\n\nls -la\ngit status\n', shell), ['cd ~/work', 'ls -la', 'git status']);
    assert.deepEqual(texts('  echo   "a  b"   \r\necho c', shell), ['echo   "a  b"', 'echo c']);
  }
  const result = splitBatch('a\n\nb\nc', 'bash');
  assert.deepEqual(result.ok && result.commands.map(command => [command.firstLine, command.lastLine]), [[1, 1], [3, 3], [4, 4]]);
});

test('chains and pipelines on one line stay one command: splitting them would change what runs', () => {
  for (const shell of ['zsh', 'bash', 'fish'] as const) {
    assert.deepEqual(texts('make && make install\necho a; echo b\nls | wc -l', shell), ['make && make install', 'echo a; echo b', 'ls | wc -l']);
  }
});

test('a trailing backslash, && , || or | continues the command onto the next line', () => {
  for (const shell of ['zsh', 'bash', 'fish'] as const) {
    assert.deepEqual(texts('docker run \\\n  -it \\\n  alpine\nls', shell), ['docker run \\\n  -it \\\n  alpine', 'ls']);
    assert.deepEqual(texts('make &&\n  make test ||\n  echo failed\nls |\n  wc -l', shell), ['make &&\n  make test ||\n  echo failed', 'ls |\n  wc -l']);
  }
});

test('quotes, including multiline strings, hold their newlines', () => {
  for (const shell of ['zsh', 'bash', 'fish'] as const) {
    assert.deepEqual(texts('echo "line one\nline two"\necho \'a\nb\'\necho x', shell), ['echo "line one\nline two"', 'echo \'a\nb\'', 'echo x']);
    assert.deepEqual(texts('echo "it\'s ok"\necho \'say "hi"\'', shell), ['echo "it\'s ok"', 'echo \'say "hi"\'']);
    assert.deepEqual(texts('echo "a \\" b"\necho c', shell), ['echo "a \\" b"', 'echo c']);
  }
  for (const shell of POSIX) assert.deepEqual(texts("echo $'it\\'s\nnew'\necho z", shell), ["echo $'it\\'s\nnew'", 'echo z']);
  assert.deepEqual(texts("echo 'it\\'s'\necho z", 'fish'), ["echo 'it\\'s'", 'echo z']);
});

test('command substitutions and groups hold their newlines', () => {
  for (const shell of POSIX) {
    assert.deepEqual(texts('x=$(\n  ls\n  pwd\n)\necho "$x"\n(\n  cd /tmp\n  ls\n)\n{ echo a\n  echo b\n}', shell), ['x=$(\n  ls\n  pwd\n)', 'echo "$x"', '(\n  cd /tmp\n  ls\n)', '{ echo a\n  echo b\n}']);
    assert.deepEqual(texts('echo `date\n`\necho ${HOME:-\n}', shell).length, 2);
  }
  assert.deepEqual(texts('set x (\n  ls\n)\necho $x', 'fish'), ['set x (\n  ls\n)', 'echo $x']);
});

test('heredocs keep their bodies, including lines that look like commands', () => {
  for (const shell of POSIX) {
    assert.deepEqual(texts('cat <<EOF\nrm -rf /\n  indented\nEOF\nls', shell), ['cat <<EOF\nrm -rf /\n  indented\nEOF', 'ls']);
    assert.deepEqual(texts("cat <<'EOF' > f\n$HOME\nEOF\ncat <<-END\n\tbody\n\tEND\npwd", shell), ["cat <<'EOF' > f\n$HOME\nEOF", 'cat <<-END\n\tbody\n\tEND', 'pwd']);
    assert.deepEqual(texts('cat <<A; cat <<B\n1\nA\n2\nB\nls', shell), ['cat <<A; cat <<B\n1\nA\n2\nB', 'ls']);
    assert.deepEqual(texts('cat <<<"here string"\nls', shell), ['cat <<<"here string"', 'ls']);
  }
});

test('blocks (if, for, while, case, functions) are one command until they close', () => {
  const block = 'if [ -f x ]; then\n  echo yes\nelse\n  echo no\nfi';
  const loop = 'for f in *.txt; do\n  echo "$f"\ndone';
  const cases = 'case "$1" in\n  a) echo A ;;\n  b|c) echo BC ;;\nesac';
  const fn = 'greet() {\n  echo hi\n}';
  const fn2 = 'function bye {\n  echo bye\n}';
  const loop2 = 'while read line; do\n  echo "$line"\ndone < file';
  const test2 = '[[ -n $x && ( $y == z || $y == w ) ]]';
  for (const shell of POSIX) {
    assert.deepEqual(texts([block, loop, cases, fn, fn2, loop2, test2, 'echo done'].join('\n'), shell), [block, loop, cases, fn, fn2, loop2, test2, 'echo done']);
  }
  const fishBlock = 'if test -f x\n  echo yes\nelse if test -d x\n  echo dir\nelse\n  echo no\nend';
  const fishFor = 'for f in *.txt\n  echo $f\nend';
  const fishFn = 'function greet\n  echo hi\nend';
  const fishSwitch = 'switch $x\n  case a\n    echo A\n  case b c\n    echo BC\nend';
  const fishBegin = 'begin\n  echo a\n  echo b\nend | cat';
  assert.deepEqual(texts([fishBlock, fishFor, fishFn, fishSwitch, fishBegin, 'echo done'].join('\n'), 'fish'), [fishBlock, fishFor, fishFn, fishSwitch, fishBegin, 'echo done']);
  assert.deepEqual(texts('test -f x\nand echo yes\nor echo no\nls', 'fish'), ['test -f x\nand echo yes\nor echo no', 'ls']);
});

test('comments stay with the command they precede; trailing ones with the command above', () => {
  for (const shell of ['zsh', 'bash', 'fish'] as const) {
    assert.deepEqual(texts('# install\nnpm i\n# build\nnpm run build # inline\n# done', shell), ['# install\nnpm i', '# build\nnpm run build # inline\n# done']);
    assert.deepEqual(texts('echo a # it\'s fine\necho b', shell), ['echo a # it\'s fine', 'echo b']);
  }
});

test('syntax this cannot account for is refused with a reason, never guessed', () => {
  for (const shell of ['zsh', 'bash', 'fish'] as const) {
    assert.match(refuses('echo "never closed\nls', shell), /double quote/u);
    assert.match(refuses("echo 'never closed\nls", shell), /single quote/u);
    assert.match(refuses('echo $(ls\nls', shell), /parenthesis/u);
    assert.match(refuses('make &&', shell), /middle of a command/u);
    assert.match(refuses('echo ok\n)', shell), /parenthesis/u);
  }
  for (const shell of POSIX) {
    assert.match(refuses('fi\nls', shell), /fi/u);
    assert.match(refuses('if true; then\n  echo hi', shell), /never closed/u);
    assert.match(refuses('cat <<EOF\nbody', shell), /here-document/u);
    assert.match(refuses('ls\n&& echo ok', shell), /operator/u);
    assert.match(refuses('echo }\n}', shell), /brace/u);
  }
  assert.match(refuses('foreach x (a b)\n echo $x\nend', 'zsh'), /foreach/u);
  assert.match(refuses('end\nls', 'fish'), /end/u);
  assert.match(refuses('if true\n echo hi', 'fish'), /never closed/u);
  assert.match(refuses('x'.repeat(MAX_BATCH_CHARACTERS + 1), 'bash'), /too large/u);
});

test('hostile or huge input is bounded: deep nesting is refused, long pastes stay fast', () => {
  assert.match(refuses(`${'$('.repeat(5000)}${')'.repeat(5000)}`, 'bash'), /deeply/u);
  assert.match(refuses(`${'('.repeat(5000)}`, 'bash'), /deeply/u);
  assert.match(refuses(`${'if true; then\n'.repeat(1000)}`, 'bash'), /deeply|never closed/u);
  const started = Date.now();
  const many = Array.from({length: 40_000}, (_, index) => `echo line ${index}`).join('\n');
  assert.equal(texts(many, 'zsh').length, 40_000);
  assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
  assert.equal(texts(`${'\n'.repeat(200_000)}echo x${'\n'.repeat(200_000)}`, 'bash').length, 1);
});

test('the commands are the paste, in order: joined back they hold every non-blank source character', () => {
  const source = '# setup\ncd /tmp && ls\ncat <<EOF\nhello\nEOF\nfor i in 1 2; do\n  echo $i\ndone\necho "multi\nline"';
  const joined = texts(source, 'bash').join('\n');
  assert.equal(joined, source);
});

/** Parse-check each chunk with the real shell (never runs it): every command the splitter produces must be valid on its own. */
const parses = (shell: BatchShell, code: string) => {
  const args = shell === 'fish' ? ['--no-execute'] : ['-n'];
  const result = spawnSync(shell, args, {input: code, encoding: 'utf8', timeout: 5000});
  return result.error ? undefined : result.status === 0;
};
const FIXTURES: Record<BatchShell, string> = {
  bash: 'cd /tmp\nif [ -f x ]; then\n  echo yes\nelse\n  echo no\nfi\nfor f in a b; do\n  echo "$f"\ndone\ncat <<EOF\nrm -rf /\nEOF\ngreet() {\n  echo hi\n}\ncase "$1" in\n  a) echo A ;;\n  *) echo other ;;\nesac\nx=$(\n  ls\n)\nmake &&\n  make test\necho "two\nlines"\nwhile read l; do\n  echo "$l"\ndone < /dev/null',
  zsh: 'cd /tmp\nif [ -f x ]; then\n  echo yes\nelse\n  echo no\nfi\nfor f in a b; do\n  echo "$f"\ndone\ncat <<EOF\nrm -rf /\nEOF\ngreet() {\n  echo hi\n}\ncase "$1" in\n  a) echo A ;;\n  *) echo other ;;\nesac\nx=$(\n  ls\n)\nmake &&\n  make test\necho "two\nlines"',
  fish: 'cd /tmp\nif test -f x\n  echo yes\nelse if test -d x\n  echo dir\nelse\n  echo no\nend\nfor f in a b\n  echo $f\nend\nfunction greet\n  echo hi\nend\nswitch $x\n  case a\n    echo A\n  case "*"\n    echo other\nend\nset x (\n  ls\n)\nmake &&\n  make test\necho "two\nlines"\ntest -f x\nand echo yes\nor echo no',
};
for (const shell of ['bash', 'zsh', 'fish'] as const) {
  test(`${shell}: every split command parses on its own (checked with ${shell} itself, nothing runs)`, {skip: parses(shell, 'true') === undefined ? `${shell} is not installed` : false}, () => {
    assert.equal(parses(shell, FIXTURES[shell]), true, 'the fixture is valid shell');
    const commands = texts(FIXTURES[shell], shell);
    assert.ok(commands.length >= 8, String(commands.length));
    for (const command of commands) assert.equal(parses(shell, command), true, `${command}`);
  });
}
