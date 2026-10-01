import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {NativeCompletionSource} from '../src/shell/CompletionService.js';
import {HistoryIndex, historyId} from '../src/shell/HistoryIndex.js';
import {HistoryService, indexImportedHistory} from '../src/shell/HistoryService.js';

test('native fuzzy filtering preserves nested path capture context and cached insertion ranges', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nmsh-path-completion-'));
  const originalHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await mkdir(join(home, 'src')); await writeFile(join(home, 'src', 'alpha.ts'), '');
    const source = new NativeCompletionSource();
    const context = {buffer: 'ls src/al', cwd: home};
    const items = await source.query(context, new AbortController().signal);
    assert.ok(items.some(candidate => candidate.insertion === 'ls src/alpha.ts'));
    const cached = await source.query({...context, buffer: 'ls src/aph'}, new AbortController().signal);
    assert.ok(cached.some(candidate => candidate.insertion === 'ls src/alpha.ts' && candidate.context.buffer === 'ls src/aph'));
  } finally {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    await rm(home, {recursive: true, force: true});
  }
});

test('history hashing/indexing yields on 100k imports and respects cancellation', async () => {
  const entries = Array.from({length: 100_000}, (_, index) => ({command: `echo ${index}`, at: index}));
  let responsive = false;
  setImmediate(() => { responsive = true; });
  const index = new HistoryIndex();
  await indexImportedHistory(index, entries, 'zsh');
  assert.equal(responsive, true);
  assert.equal(index.all().length, 100_000);
  const active = new AbortController();
  const cancelled = new HistoryIndex();
  const pending = indexImportedHistory(cancelled, entries, 'zsh', active.signal);
  active.abort(); await pending;
  assert.ok(cancelled.all().length < entries.length);
});

test('two history frontends cannot overwrite each other’s deletion IDs; earlier JSON remains readable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-history-deletions-'));
  const file = join(directory, 'history-deletions.json');
  const first = {id: historyId('zsh', 'one'), command: 'echo one', source: 'zsh' as const};
  const second = {id: historyId('zsh', 'two'), command: 'echo two', source: 'zsh' as const};
  try {
    const a = new HistoryIndex(file); const b = new HistoryIndex(file);
    a.add(first); b.add(second);
    await Promise.all([a.delete(first.id), b.delete(second.id)]);
    assert.deepEqual((await readdir(`${file}.d`)).sort(), [first.id, second.id].sort());
    const restored = new HistoryIndex(file); await restored.loadDeletions();
    restored.add(first); restored.add(second); assert.deepEqual(await restored.search(''), []);
    const legacy = historyId('zsh', 'legacy');
    await writeFile(file, JSON.stringify({version: 1, ids: [legacy]}));
    await restored.loadDeletions(); restored.add({id: legacy, command: 'legacy', source: 'zsh'});
    assert.deepEqual(await restored.search(''), []);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('a successful but incompatible Atuin response falls back truthfully to Native', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-atuin-format-'));
  const service = new HistoryService({...process.env, HOME: directory, XDG_CONFIG_HOME: directory, PATH: directory});
  try {
    await writeFile(join(directory, '.zsh_history'), ': 123:0;echo native\n');
    await writeFile(join(directory, 'atuin'), `#!${process.execPath}\nprocess.stdout.write('unsupported format\\n');\n`, {mode: 0o700});
    assert.equal(await service.reload('atuin'), true);
    assert.equal(service.status.active, 'native');
    assert.deepEqual(service.getAll(), ['echo native']);
  } finally { service.dispose(); await rm(directory, {recursive: true, force: true}); }
});
