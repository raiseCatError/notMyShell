import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DirectoryService, directoryCommand, rankDirectories, filterDirectories, parseZoxide, zoxideDirectory} from '../src/shell/DirectoryService.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {paletteItems} from '../src/ui/CommandPalette.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {resolveCommand, runExternal} from '../src/providers/providers.js';
import type {HistoryEntry} from '../src/shell/HistoryIndex.js';

test('native frecency balances visits and recency, filters fuzzily and yields for 100k records', async () => {
  const now = 1_800_000_000_000;
  const entry = (id: string, cwd: string, at = now): HistoryEntry => ({id, cwd, at, command: 'pwd', source: 'nmsh'});
  const ranked = await rankDirectories([entry('1', '/recent'), entry('2', '/frequent'), entry('3', '/frequent'),
    ...Array.from({length: 10}, (_, i) => entry(`old${i}`, '/old', now - 365 * 86_400_000)), entry('bad', '/control\u001b')], now);
  assert.deepEqual(ranked.map(item => item.path), ['/frequent', '/recent', '/old']);
  assert.deepEqual(filterDirectories(ranked, 'frq').map(item => item.path), ['/frequent']);
  const entries = Array.from({length: 100_000}, (_, i) => entry(String(i), `/project${i % 100}`));
  let responsive = false;
  setImmediate(() => { responsive = true; });
  assert.equal((await rankDirectories(entries, now)).length, 100);
  assert.equal(responsive, true);
  const controller = new AbortController(); controller.abort();
  assert.deepEqual(await rankDirectories(entries, now, controller.signal), []);
});

test('directory command is a literal real cd; paths cannot inject expansions or options', async () => {
  const path = "/work/a'$(touch unwanted); spaced";
  const command = directoryCommand(path);
  const result = await runExternal('/bin/zsh', ['-f', '-c', `${command.replace(/^cd -- /u, 'print -r -- ')}\n`]);
  assert.equal(result.stdout.trimEnd(), path);
  assert.equal(directoryCommand('/-danger'), "cd -- '/-danger'");
  assert.throws(() => directoryCommand('relative'));
  assert.throws(() => directoryCommand('/bad\nline'));
  assert.equal(parseSlashCommand('cd ../work'), undefined);
  assert.equal(normalizePromptConfiguration({}).navigation, 'native');
  assert.equal(normalizePromptConfiguration({navigation: 'zoxide'}).navigation, 'zoxide');
  assert.ok(paletteItems().some(item => item.id === 'slash:/dirs'));
});

test('zoxide query uses a temporary copy, caches results and falls back on missing or bad tools', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-directory-test-'));
  try {
    await writeFile(join(directory, 'db.zo'), 'original', {mode: 0o600});
    const binary = join(directory, 'zoxide');
    await writeFile(binary, `#!${process.execPath}\nconst fs=require('node:fs');if(process.env._ZO_DATA_DIR===process.env.ORIGINAL_DB)process.exit(2);fs.writeFileSync(process.env._ZO_DATA_DIR+'/db.zo','sorted');fs.appendFileSync(process.env.CALLS,JSON.stringify(process.argv.slice(2))+'\\n');process.stdout.write('20.5 /work/one\\n 4.0 /work/two spaces\\n');\n`, {mode: 0o700});
    const calls = join(directory, 'calls');
    const service = new DirectoryService({...process.env, PATH: directory, _ZO_DATA_DIR: directory, ORIGINAL_DB: directory, CALLS: calls});
    assert.equal((await service.query([], '', 'zoxide'))[0]?.path, '/work/one');
    assert.equal((await service.query([], 'two', 'zoxide'))[0]?.path, '/work/two spaces');
    assert.equal(await readFile(join(directory, 'db.zo'), 'utf8'), 'original');
    assert.deepEqual(JSON.parse((await readFile(calls, 'utf8')).trim()), ['query', '--list', '--score', '--all']);
    const fallback = new DirectoryService({PATH: '', HOME: directory});
    assert.equal((await fallback.query([{id: '1', source: 'nmsh', command: 'pwd', cwd: '/native'}], '', 'zoxide'))[0]?.path, '/native');
    assert.equal(fallback.status.active, 'native');
    assert.deepEqual(parseZoxide('garbage\n3 relative\n5 /valid\n8 /invalid\u001b'), [{path: '/valid', score: 5}]);
    assert.equal(zoxideDirectory({_ZO_DATA_DIR: 'relative'}), undefined);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('directory selection inserts only; next Enter uses the normal shell submit path', async () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  const submitted: string[] = [];
  app['session'].submit = ((text: string) => submitted.push(text)) as never;
  try {
    app['editor'].insert('/dirs ');
    app['directoryQuery'] = '';
    app['directoryResults'] = [{path: '/work space', score: 1, visits: 1}];
    app['handleKey']({kind: 'complete'});
    assert.equal(app['editor'].text, "cd -- '/work space'");
    assert.deepEqual(submitted, []);
    await app['submit']();
    assert.deepEqual(submitted, ["cd -- '/work space'"]);
    assert.equal(app['running']?.command, "cd -- '/work space'");
  } finally { app['stop'](0); app['session'].kill(); }
});

test('installed zoxide ranks a fixture without modifying its source database', async t => {
  const binary = resolveCommand('zoxide');
  if (!binary) { t.skip('zoxide is optional'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-zoxide-fixture-'));
  try {
    const target = join(directory, 'target'); await mkdir(target);
    const env = {...process.env, PATH: binary.slice(0, binary.lastIndexOf('/')), _ZO_DATA_DIR: directory};
    assert.equal((await runExternal(binary, ['add', target], {env})).ok, true);
    const before = await readFile(join(directory, 'db.zo'));
    const items = await new DirectoryService(env).query([], '', 'zoxide');
    assert.equal(items[0]?.path, target);
    assert.deepEqual(await readFile(join(directory, 'db.zo')), before);
  } finally { await rm(directory, {recursive: true, force: true}); }
});
