import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
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
  }
  for (const shell of ['bash', 'fish'] as const) assert.deepEqual(texts('echo a # it\'s fine\necho b', shell), ['echo a # it\'s fine', 'echo b']);
});

test('zsh does not treat # as a comment unless told to, so a comment with syntax in it is refused, never shown as a comment', () => {
  // Interactive zsh runs everything after the # as ordinary shell text: `; echo x` and `$( )` execute.
  for (const hidden of ['# note; echo EXECUTED', '# note $(touch /tmp/x)', 'ls # `id`', '# a && b', '# it\'s', '# a > b', '# \\']) {
    assert.match(refuses(`${hidden}\nls`, 'zsh'), /comment contains shell syntax/u, hidden);
  }
  // Bash and Fish comments are comments.
  assert.deepEqual(texts('# note; echo not-run\nls', 'bash'), ['# note; echo not-run\nls']);
  assert.deepEqual(texts('# note; echo not-run\nls', 'fish'), ['# note; echo not-run\nls']);
});

test('comments inside substitutions and expansion in heredoc markers are refused; marker quotes are removed like the shell does', () => {
  for (const shell of POSIX) {
    assert.match(refuses('x=$(echo hi # )\nrm -rf ~\n)\nls', shell), /comment inside a substitution/u);
    assert.match(refuses('x=$(echo hi\n# note\n)\nls', shell), /comment inside a substitution/u);
    assert.deepEqual(texts('echo $(( 1 + 2 ))\nx=$(echo "a#b")\necho ${#x} $#\nls', shell), ['echo $(( 1 + 2 ))', 'x=$(echo "a#b")', 'echo ${#x} $#', 'ls']);
    assert.deepEqual(texts('cat <<E"O"F\nbody\nEOF\nls', shell), ['cat <<E"O"F\nbody\nEOF', 'ls']);
    assert.deepEqual(texts('cat <<\\EOF\nbody\nEOF\nls', shell), ['cat <<\\EOF\nbody\nEOF', 'ls']);
    assert.match(refuses('cat <<$MARK\nbody\nx\nls', shell), /marker uses an expansion/u);
  }
});

test('arithmetic is not a here-document, and a here-document inside a substitution is refused', () => {
  for (const shell of POSIX) {
    assert.deepEqual(texts('(( x = 1 << 2 ))\necho $((1<<3))\nls', shell), ['(( x = 1 << 2 ))', 'echo $((1<<3))', 'ls']);
    assert.deepEqual(texts('echo $(( (1 << 2) + 1 ))\nls', shell), ['echo $(( (1 << 2) + 1 ))', 'ls']);
    assert.match(refuses('x=$(cat <<EOF\n)\nEOF\n)\nls', shell), /here-document inside a substitution/u);
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

/**
 * The differential check: run a paste whole, and run the commands the splitter made of it one after another, each
 * submitted the way the queue does (a multi-line command as one brace group). Both must do exactly the same thing.
 * Only echo, printf, variables and control flow run here; nothing touches the disk or the network.
 */
const submission = (command: string) => command.includes('\n') ? `{ ${command}\n}` : command;
const PIECES: Record<BatchShell, string[]> = {
  bash: ['cat <<E"O"F\nbody\nEOF', 'echo one', 'x=$((1 << 3)); echo "x=$x"', 'echo "multi\nline"', 'for i in 1 2; do\n  echo "loop-$i"\ndone', 'if [ -z "$x" ]; then\n  echo empty\nelse\n  echo "has-$x"\nfi',
    'cat <<EOF\nbody $HOME-free\nEOF', 'cat <<\'RAW\'\n$x not expanded\nRAW', 'echo a &&\n  echo b', 'echo "p" |\n  cat', 'f() {\n  echo "in-f-$1"\n}\nf arg', 'case "$x" in\n  8) echo eight ;;\n  *) echo other ;;\nesac',
    'y=$(\n  echo sub\n)\necho "y=$y"', 'echo \\\n  continued', '# plain comment\necho after-comment', 'false || echo recovered', '(( x += 1 ))\necho "n=$x"', 'echo \'it\'"\'"\'s\'', 'while [ "${n:-0}" -lt 2 ]; do\n  n=$(( ${n:-0} + 1 ))\ndone\necho "n=$n"'],
  zsh: ['cat <<E"O"F\nbody\nEOF', 'echo one', 'x=$((1 << 3)); echo "x=$x"', 'echo "multi\nline"', 'for i in 1 2; do\n  echo "loop-$i"\ndone', 'if [ -z "$x" ]; then\n  echo empty\nelse\n  echo "has-$x"\nfi',
    'cat <<EOF\nbody\nEOF', 'cat <<\'RAW\'\n$x not expanded\nRAW', 'echo a &&\n  echo b', 'echo "p" |\n  cat', 'f() {\n  echo "in-f-$1"\n}\nf arg', 'case "$x" in\n  8) echo eight ;;\n  *) echo other ;;\nesac',
    'y=$(\n  echo sub\n)\necho "y=$y"', 'echo \\\n  continued', '# plain comment\necho after-comment', 'false || echo recovered', '(( x += 1 ))\necho "n=$x"', 'while [[ "${n:-0}" -lt 2 ]]; do\n  n=$(( ${n:-0} + 1 ))\ndone\necho "n=$n"'],
  fish: ['echo one', 'set x 8; echo "x=$x"', 'echo "multi\nline"', 'for i in 1 2\n  echo "loop-$i"\nend', 'if test -z "$x"\n  echo empty\nelse if test "$x" = 8\n  echo eight\nelse\n  echo "has-$x"\nend',
    'echo a &&\n  echo b', 'echo "p" |\n  cat', 'function f\n  echo "in-f-$argv[1]"\nend\nf arg', 'switch $x\n  case 8\n    echo eight\n  case "*"\n    echo other\nend',
    'set y (\n  echo sub\n)\necho "y=$y"', 'echo \\\n  continued', '# plain comment\necho after-comment', 'false; or echo recovered', 'test -n "$x"\nand echo set\nor echo unset', 'begin\n  echo in-begin\nend | cat'],
};
const RUN: Record<BatchShell, (script: string) => string[]> = {
  bash: script => ['bash', '--noprofile', '--norc', '-c', script],
  zsh: script => ['zsh', '-f', '-c', script],
  fish: script => ['fish', '--no-config', '-c', script],
};
const execute = (shell: BatchShell, script: string) => {
  const [command, ...args] = RUN[shell](script);
  const result = spawnSync(command!, args, {encoding: 'utf8', timeout: 8000, cwd: tmpdir(), env: {PATH: process.env.PATH ?? '', HOME: tmpdir()}});
  return `${result.stdout}\n--stderr--\n${result.stderr.replace(/line \d+|-c: line \d+|:\d+:/gu, '')}\n--status ${result.status}`;
};
for (const shell of ['bash', 'zsh', 'fish'] as const) {
  test(`${shell}: running a paste whole and running its split commands one after another do exactly the same`, {skip: parses(shell, 'true') === undefined ? `${shell} is not installed` : false, timeout: 120_000}, () => {
    let seed = shell.length * 7919;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let compared = 0;
    const rounds = Number(process.env.NMSH_FUZZ_ROUNDS ?? 40);
    for (let round = 0; round < rounds; round += 1) {
      const count = 2 + Math.floor(random() * 5);
      const pieces = Array.from({length: count}, () => PIECES[shell][Math.floor(random() * PIECES[shell].length)]!);
      const paste = pieces.join('\n');
      const result = splitBatch(paste, shell);
      if (!result.ok) continue;
      compared += 1;
      const whole = execute(shell, submission(paste));
      const parts = execute(shell, result.commands.map(command => submission(command.text)).join('\n'));
      assert.equal(parts, whole, `${shell}: ${JSON.stringify(paste)} split into ${JSON.stringify(result.commands.map(command => command.text))}`);
    }
    assert.ok(compared >= Math.floor(rounds * 0.6), `only ${compared} comparable pastes`);
  });
}

test('the real shell checks every command on its own before a split is shown; a boundary through a construct is refused', async () => {
  const {verifyCommands} = await import('../src/input/pasteBatchCheck.js');
  for (const shell of ['bash', 'zsh', 'fish'] as const) {
    if (parses(shell, 'true') === undefined) continue;
    assert.deepEqual(await verifyCommands(texts(FIXTURES[shell], shell), shell), {ok: true});
    // A command cut in the middle is not whole syntax, however the cut came about.
    const fragments = shell === 'fish' ? ['echo "never closed', 'if true\n  echo hi'] : ['x=$(echo hi # )', 'echo "never closed', 'if true; then\n  echo hi', 'cat <<EOF\nbody'];
    for (const fragment of fragments) {
      const result = await verifyCommands(['echo ok', fragment], shell);
      assert.equal(result.ok, false, `${shell}: ${fragment}`);
      assert.match(result.ok ? '' : result.reason, /Command 2 is not complete/u);
    }
    assert.deepEqual(await verifyCommands([], shell), {ok: true});
  }
});
