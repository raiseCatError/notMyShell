import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HistoryService, parseAtuinMetadata} from '../src/shell/HistoryService.js';
import {HISTORY_PROVIDERS} from '../src/shell/historyProviders.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';

const record = 'nmsh-v1\u001fid-1\u001f2026-01-02 10:00:00\u001f1\u001f/work\u001f1.5s\u001fsession-1\u001fgit status\0';

test('Atuin metadata preserves multiline commands, identity, session and approximate duration', () => {
  const entries = parseAtuinMetadata(record + record.replace('id-1', 'id-2').replace('git status', 'echo "a\nb\t\u001fc"'));
  assert.equal(entries[0]!.durationMs, 1500);
  assert.equal(entries[0]!.session, 'session-1');
  assert.equal(entries[0]!.source, 'atuin');
  assert.equal(entries[1]!.command, 'echo "a\nb\t\u001fc"');
  assert.notEqual(entries[0]!.id, entries[1]!.id);
  assert.deepEqual(parseAtuinMetadata('broken\0'), []);
  assert.equal(parseAtuinMetadata(record.replace('1.5s', 'unknown'))[0]!.durationMs, undefined);
});

test('Native is the normalized default; explicit Atuin persists in the existing schema', () => {
  assert.equal(normalizePromptConfiguration({}).history, 'native');
  assert.equal(normalizePromptConfiguration({history: 'atuin'}).history, 'atuin');
  assert.equal(normalizePromptConfiguration({history: 'unknown'}).history, 'native');
  assert.deepEqual(HISTORY_PROVIDERS.map(provider => provider.id), ['native', 'atuin']);
});

test('Atuin runs only when selected, uses read-only argv, and missing/failing tools fall back', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-history-provider-'));
  const file = join(directory, 'history');
  const invoked = join(directory, 'invoked');
  await writeFile(file, ': 100:0;native command\n');
  // printf is a shell builtin; a fake tool records only fixed operation names, no private history.
  await writeFile(join(directory, 'atuin'), `#!/bin/sh\nprintf '%s\\n' "$1" "$2" > '${invoked}'\nprintf 'nmsh-v1\\037id-1\\0372026-01-02 10:00:00\\0371\\037/work\\0371.5s\\037session-1\\037git status\\000'\n`);
  await chmod(join(directory, 'atuin'), 0o755);
  const service = new HistoryService({PATH: directory, HOME: directory, HISTFILE: file, XDG_CONFIG_HOME: directory});
  try {
    await service.reload();
    assert.deepEqual(service.getAll(), ['native command']);
    await assert.rejects(readFile(invoked));
    await service.reload('atuin');
    assert.deepEqual(service.getAll(), ['git status']);
    assert.equal(service.status.active, 'atuin');
    assert.equal((await service.search('session:session exit:failure duration:>1s'))[0]!.command, 'git status');
    assert.equal(await readFile(invoked, 'utf8'), 'history\nlist\n');
    await writeFile(join(directory, 'atuin'), '#!/bin/sh\nexit 1\n');
    await service.reload('atuin');
    assert.equal(service.status.active, 'native');
    assert.match(service.status.detail!, /unavailable/u);
    assert.deepEqual(service.getAll(), ['native command']);
    await rm(join(directory, 'atuin'));
    await service.reload('atuin');
    assert.match(service.status.detail!, /not installed/u);
  } finally { service.dispose(); await rm(directory, {recursive: true, force: true}); }
});
