import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ConfiguredCompletionSource, parseConfiguredCompletions} from '../src/shell/ConfiguredCompletion.js';
import {ShellCompletionSource} from '../src/shell/CompletionService.js';
import {CompletionService} from '../src/shell/CompletionService.js';

test('real configured candidate capture is bounded to 4096 records', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-large-completion-'));
  writeFileSync(join(home, '.zshrc'), 'autoload -Uz compinit\ncompinit -D\n_large() { compadd -J large -- value{1..5000}; }\ncompdef _large large\n');
  const source = new ConfiguredCompletionSource({env: {...process.env, HOME: home}, startupMs: 4000, queryMs: 2000});
  try {
    const values = await source.query({buffer: 'large v', cwd: home}, new AbortController().signal);
    assert.equal(values.length, 4096);
    assert.ok(values.every(value => value.group === 'large' && value.value.startsWith('value')));
  } finally { source.dispose(); rmSync(home, {recursive: true, force: true}); }
});

test('configured records retain descriptions, groups, prefixes and safe quoted insertion', () => {
  const context = {buffer: 'demo "sp', cursor: 8, cwd: '/'};
  const records = ['space 世界', 'space 世界', 'a description', 'arguments', '', '', 'argument'].join('\0') + '\0';
  const [candidate] = parseConfiguredCompletions(records, context);
  assert.equal(candidate.description, 'a description');
  assert.equal(candidate.group, 'arguments');
  assert.equal(candidate.insertion, 'demo space\\ 世界');
  assert.deepEqual(candidate.replacement, {start: 5, end: 8});
  assert.equal(parseConfiguredCompletions('bad', context).length, 0);
});

test('home filesystem completion preserves expansion and quoted tilde paths stay literal', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-completion-fixture-'));
  mkdirSync(join(home, 'alpha dir'));
  writeFileSync(join(home, 'alpha 世界.txt'), '');
  mkdirSync(join(home, '~')); mkdirSync(join(home, '~', 'literal dir'));
  writeFileSync(join(home, '.zshrc'), 'autoload -Uz compinit\ncompinit -D\n_demo() { _files; }\ncompdef _demo demo\n');
  const source = new ConfiguredCompletionSource({env: {...process.env, HOME: home}, startupMs: 4000, queryMs: 1500});
  try {
    const values = await source.query({buffer: 'demo ~/al', cwd: home}, new AbortController().signal);
    assert.ok(values.some(candidate => candidate.insertion === 'demo ~/alpha\\ 世界.txt'), JSON.stringify(values));
    assert.ok(values.some(candidate => candidate.insertion === 'demo ~/alpha\\ dir/' && candidate.kind === 'directory'), JSON.stringify(values));
    for (const buffer of ['demo "~/lit', "demo '~/lit", 'demo \\~/lit']) {
      const literal = await source.query({buffer, cwd: home}, new AbortController().signal);
      assert.ok(literal.some(candidate => candidate.insertion === 'demo \\~/literal\\ dir/'), JSON.stringify({buffer, literal}));
    }
  } finally { source.dispose(); rmSync(home, {recursive: true, force: true}); }
});

test('configured helper reuses trusted config, returns compdef knowledge, and cleans up', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-completion-fixture-'));
  writeFileSync(join(home, '.zshrc'), `autoload -Uz compinit\ncompinit -D\n_demo() { local -a labels=('alpha -- first' 'alpine -- second'); compadd -J choices -d labels -- alpha alpine; }\ncompdef _demo demo\nprint x >> "$HOME/starts"\n`);
  const source = new ConfiguredCompletionSource({env: {...process.env, HOME: home}, startupMs: 4000, queryMs: 1000});
  try {
    const values = await source.query({buffer: 'demo al', cursor: 7, cwd: home}, new AbortController().signal);
    assert.deepEqual(values.map(value => value.value), ['alpha', 'alpine']);
    assert.equal(values[0]?.group, 'choices');
    assert.match(values[0]?.description ?? '', /first/);
    assert.equal((await source.query({buffer: 'demo alp', cursor: 8, cwd: home}, new AbortController().signal)).length, 2);
    assert.equal(readFileSync(join(home, 'starts'), 'utf8'), 'x\n');
    await source.query({buffer: 'demo al', cwd: tmpdir()}, new AbortController().signal);
    assert.equal(readFileSync(join(home, 'starts'), 'utf8'), 'x\nx\n');
  } finally { source.dispose(); rmSync(home, {recursive: true, force: true}); }
});

test('word replacement preserves trailing arguments, spaces, quotes and Unicode', () => {
  const wire = ['a b世界', 'a b世界', '', 'files', 'dir/', '/', 'directory'].join('\0') + '\0';
  const [candidate] = parseConfiguredCompletions(wire, {buffer: 'demo ab tail', cursor: 7, cwd: '/'});
  assert.equal(candidate.insertion, 'demo dir/a\\ b世界/ tail');
  assert.equal(candidate.prefix, 'dir/');
  assert.equal(candidate.suffix, '/');
  assert.equal(candidate.kind, 'directory');
  assert.equal(parseConfiguredCompletions(wire, {buffer: 'demo $(touch nope)', cwd: '/'}).length, 0);
  assert.equal(parseConfiguredCompletions(wire.replace('a b世界', '\u001bunsafe'), {buffer: 'demo a', cwd: '/'}).length, 0);
});

test('startup timeout and cancellation dispose helper and private root', async () => {
  for (const cancelled of [false, true]) {
    const home = mkdtempSync(join(tmpdir(), 'nmsh-completion-fixture-'));
    writeFileSync(join(home, '.zshrc'), 'sleep 30\n');
    const source = new ConfiguredCompletionSource({env: {...process.env, HOME: home}, startupMs: 150});
    const controller = new AbortController();
    try {
      const pending = source.query({buffer: 'demo a', cwd: home}, controller.signal);
      await Promise.resolve();
      const root = source['root']!;
      if (cancelled) setTimeout(() => controller.abort(), 80);
      assert.deepEqual(await pending, []);
      assert.equal(existsSync(root), false);
      assert.equal(source['child'], undefined);
    } finally { source.dispose(); rmSync(home, {recursive: true, force: true}); }
  }
});

test('configured options, argument functions, aliases and filesystem knowledge', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-completion-fixture-'));
  writeFileSync(join(home, 'space 世界.txt'), '');
  mkdirSync(join(home, 'directory'));
  writeFileSync(join(home, '.zshrc'), `autoload -Uz compinit\ncompinit -D\n_demo() { _arguments '--verbose[verbose output]' '*:path:_files'; }\ncompdef _demo demo\nalias dm=demo\nfun() { :; }\ncompdef _demo fun\n`);
  const source = new ConfiguredCompletionSource({env: {...process.env, HOME: home}, startupMs: 4000, queryMs: 1500});
  try {
    for (const command of ['demo', 'dm', 'fun']) {
      const options = await source.query({buffer: `${command} --v`, cwd: home}, new AbortController().signal);
      assert.ok(options.some(candidate => candidate.value === '--verbose' && candidate.kind === 'option'), JSON.stringify({command, options}));
    }
    const files = await source.query({buffer: 'demo "space', cwd: home}, new AbortController().signal);
    assert.ok(files.some(candidate => candidate.insertion === 'demo space\\ 世界.txt'), JSON.stringify(files));
    const directories = await source.query({buffer: 'demo dir', cwd: home}, new AbortController().signal);
    assert.ok(directories.some(candidate => candidate.value === 'directory/' && candidate.kind === 'directory'), JSON.stringify(directories));
  } finally { source.dispose(); rmSync(home, {recursive: true, force: true}); }
});

test('native fallback survives configured failure and honours cancellation/cursor', async () => {
  let calls = 0;
  const native = {id: 'native', query: async () => { calls++; return []; }};
  const source = new ShellCompletionSource({id: 'broken', query: async () => { throw new Error('malformed'); }}, native);
  await source.query({buffer: 'demo a', cwd: '/'}, new AbortController().signal);
  assert.equal(calls, 1);
  await source.query({buffer: 'demo a tail', cwd: '/', cursor: 5}, new AbortController().signal);
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await source.query({buffer: 'demo a', cwd: '/'}, controller.signal);
  assert.equal(calls, 1);
});

test('malformed/truncated records fail closed, large sets are bounded', () => {
  const context = {buffer: 'demo a', cwd: '/'};
  const wire = ['alpha', 'alpha', 'description', 'group', '', '', 'argument'].join('\0') + '\0';
  assert.deepEqual(parseConfiguredCompletions(wire.slice(0, -1), context), []);
  assert.deepEqual(parseConfiguredCompletions('extra\0' + wire, context), []);
  const large = Array.from({length: 5000}, (_, i) => wire.replaceAll('alpha', `alpha${i}`)).join('');
  assert.equal(parseConfiguredCompletions(large, context).length, 4096);
});

test('query timeout, config exit and cwd restart are safe', async () => {
  for (const configuration of ['exit 1', `autoload -Uz compinit\ncompinit -D\n_demo() { sleep 30; }\ncompdef _demo demo`]) {
    const home = mkdtempSync(join(tmpdir(), 'nmsh-completion-fixture-'));
    writeFileSync(join(home, '.zshrc'), configuration);
    const source = new ConfiguredCompletionSource({env: {...process.env, HOME: home}, startupMs: 4000, queryMs: 100});
    try { assert.deepEqual(await source.query({buffer: 'demo a', cwd: home}, new AbortController().signal), []); }
    finally { source.dispose(); rmSync(home, {recursive: true, force: true}); }
  }
});

test('superseding startup reuses config and completes newest cursor request', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-completion-fixture-'));
  writeFileSync(join(home, '.zshrc'), `sleep .2\nautoload -Uz compinit\ncompinit -D\n_demo() { local -a hits=(alpha alpine); compadd -a hits; }\ncompdef _demo demo\n`);
  const source = new ConfiguredCompletionSource({env: {...process.env, HOME: home}, startupMs: 4000});
  const service = new CompletionService(source);
  try {
    const old = service.suggest('demo a tail', home, 6);
    await new Promise(resolve => setTimeout(resolve, 50));
    const latest = service.suggest('demo al tail', home, 7);
    assert.deepEqual(await old, []);
    assert.deepEqual((await latest).map(candidate => candidate.value), ['alpha', 'alpine']);
  } finally { service.dispose(); rmSync(home, {recursive: true, force: true}); }
});

test('config cwd changes and escaped directory prefixes cannot corrupt provenance/insertion', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-completion-fixture-'));
  const cwd = join(home, 'other'); mkdirSync(cwd);
  mkdirSync(join(cwd, 'a b')); writeFileSync(join(cwd, 'a b', 'xyz'), '');
  writeFileSync(join(home, '.zshrc'), `cd "$HOME"\nautoload -Uz compinit\ncompinit -D\n_demo() { _files; }\ncompdef _demo demo\n`);
  const source = new ConfiguredCompletionSource({env: {...process.env, HOME: home}, startupMs: 4000});
  try {
    const values = await source.query({buffer: 'demo a\\ b/x', cwd}, new AbortController().signal);
    assert.ok(values.some(candidate => candidate.insertion === 'demo a\\ b/xyz'), JSON.stringify(values));
    assert.equal(values[0]?.context.cwd, cwd);
    const equals = ['=ls', '=ls', '', '', '', '', 'argument'].join('\0') + '\0';
    assert.equal(parseConfiguredCompletions(equals, {buffer: 'demo =', cwd})[0]?.insertion, 'demo \\=ls');
  } finally { source.dispose(); rmSync(home, {recursive: true, force: true}); }
});

test('escaped file candidates preserve literal filenames and directory suffixes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-completion-fixture-'));
  for (const name of ['a b', "a'b", 'a*b', 'a\\b']) mkdirSync(join(home, name));
  writeFileSync(join(home, '.zshrc'), `autoload -Uz compinit\ncompinit -D\n_demo() { _files; }\ncompdef _demo demo\n`);
  const source = new ConfiguredCompletionSource({env: {...process.env, HOME: home}, startupMs: 4000});
  try {
    const values = await source.query({buffer: 'demo a', cwd: home}, new AbortController().signal);
    assert.deepEqual(values.map(candidate => candidate.value).sort(), ['a b/', "a'b/", 'a*b/', 'a\\b/'].sort());
    assert.ok(values.every(candidate => candidate.kind === 'directory'));
  } finally { source.dispose(); rmSync(home, {recursive: true, force: true}); }
});

test('explicit disposal cannot recreate helpers from queued requests', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-completion-fixture-'));
  writeFileSync(join(home, '.zshrc'), 'sleep .2\nautoload -Uz compinit\ncompinit -D\n');
  const source = new ConfiguredCompletionSource({env: {...process.env, HOME: home}});
  try {
    const first = source.query({buffer: 'echo a', cwd: home}, new AbortController().signal);
    await new Promise(resolve => setTimeout(resolve, 50));
    const queued = source.query({buffer: 'echo b', cwd: home}, new AbortController().signal);
    source.dispose();
    assert.deepEqual(await first, []);
    assert.deepEqual(await queued, []);
    assert.equal(source['child'], undefined);
  } finally { source.dispose(); rmSync(home, {recursive: true, force: true}); }
});
