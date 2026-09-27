import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DejaSuggestions, parseDejaResponse} from '../src/suggestions/DejaSuggestions.js';
import {SuggestionController} from '../src/suggestions/SuggestionController.js';
import {NativeSuggestions} from '../src/suggestions/NativeSuggestions.js';
import {SUGGESTION_PROVIDERS} from '../src/suggestions/types.js';
import {resolveProvider} from '../src/providers/providers.js';

async function withFakeDeja<T>(script: string, run: (binary: string, directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-deja-'));
  try {
    const binary = join(directory, 'deja');
    await writeFile(binary, `#!/bin/sh\n${script}\n`);
    await chmod(binary, 0o755);
    return await run(binary, directory);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

const context = (buffer: string) => ({buffer, cwd: '/work/app', previous: ['git add .'], now: 0});

test('Deja is queried through its public CLI with buffer, dir and prev as argv, and parsed from JSON', async () => {
  await withFakeDeja(`printf '%s\\n' "$@" > "$(dirname "$0")/args"
printf '{"suggestion":"git commit -m wip","alternatives":["git checkout main","gco"]}\\n'`, async (binary, directory) => {
    const deja = new DejaSuggestions(binary, process.env, 5000);
    const result = await deja.query(context('git c'));
    assert.deepEqual(result.map(item => item.text), ['git commit -m wip', 'git checkout main', 'gco']);
    assert.ok(result.every(item => item.source === 'deja'));
    assert.deepEqual((await readFile(join(directory, 'args'), 'utf8')).trim().split('\n'),
      ['query', '--buffer', 'git c', '--dir', '/work/app', '--prev', 'git add .', '--json']);
    await rm(join(directory, 'args'));
    await deja.query(context('git c'));
    await assert.rejects(readFile(join(directory, 'args')), 'repeated identical queries are served from cache');
    deja.record();
    await deja.query(context('git c'));
    await readFile(join(directory, 'args'));
  });
});

test('Deja responses: empty means no suggestion; bad output is an error for the fallback path', () => {
  assert.deepEqual(parseDejaResponse(''), []);
  assert.deepEqual(parseDejaResponse('{"suggestion":""}'), []);
  assert.throws(() => parseDejaResponse('not json'), /invalid JSON/u);
  assert.throws(() => parseDejaResponse('42'), /unexpected shape/u);
});

test('a broken Deja degrades to Native per keystroke, then switches with a notice; missing Deja resolves to Native', async () => {
  await withFakeDeja('echo garbage', async binary => {
    const notices: string[] = [];
    let changed: () => void = () => {};
    const controller = new SuggestionController(() => changed(), reason => notices.push(reason), 5000);
    const native = new NativeSuggestions();
    native.load([{command: 'git status'}]);
    controller.setProvider(new DejaSuggestions(binary), native);
    for (const buffer of ['g', 'gi', 'git']) {
      const settled = new Promise<void>(resolve => { changed = resolve; });
      controller.update(context(buffer));
      await settled;
      assert.equal(controller.ghost(buffer), 'git status');
    }
    assert.deepEqual(notices, ['deja query returned invalid JSON']);
    assert.equal(controller.providerId, 'nmsh');
  });
  assert.deepEqual(resolveProvider(SUGGESTION_PROVIDERS, 'deja', {state: 'missing'}, 'nmsh'),
    {id: 'nmsh', notice: 'Deja is not installed; using NMSh Native.'});
  const deja = SUGGESTION_PROVIDERS.find(provider => provider.id === 'deja')!;
  assert.equal(deja.kind, 'external');
  assert.match(deja.setup ?? '', /deja import/u);
});
