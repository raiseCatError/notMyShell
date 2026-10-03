import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {parseZshHistory, parseZshHistoryInChunks} from '../src/shell/HistoryService.js';
import {once} from 'node:events';
import {HistoryIndex, journalHistory, historyId, type HistoryEntry} from '../src/shell/HistoryIndex.js';
import {ShellProtocolDecoder} from '../src/shell/ShellProtocol.js';
import {ShellSession} from '../src/shell/ShellSession.js';
import {encodeMessage, decodeMessage} from '../src/session/SessionProtocol.js';
import {decodeKeys} from '../src/terminal/keys.js';

const entry: HistoryEntry = {id: historyId('test', '1'), command: 'git status', cwd: '/work/app', project: 'app',
  exitCode: 1, at: Date.UTC(2026, 0, 2), durationMs: 1500, session: 'session-abc', source: 'nmsh'};

test('structured history filters combine, text remains searchable, malformed filters fail closed', async () => {
  const index = new HistoryIndex(); index.add(entry);
  for (const query of ['git', 'cwd:/work project:app exit:failure git', 'before:2026-01-03 after:2026-01-01 session:session duration:>1s', 'exit:1 duration:<=2s']) {
    assert.equal((await index.search(query)).length, 1, query);
  }
  for (const query of ['exit:success', 'before:bad', 'duration:bad', 'project:', 'cwd:/work/other', 'exit:127']) assert.deepEqual(await index.search(query), [], query);
  index.add({...entry, id: historyId('test', '2'), cwd: '/work/my app'});
  assert.equal((await index.search('cwd:"/work/my app"')).length, 1);
});

test('journal history requires explicit shell eligibility and excludes leading spaces', () => {
  const record = {command: 'git status', output: '', lifecycleText: '', exitCode: 0, startId: 1, outputStartId: 2,
    startedAt: 100, durationMs: 200, historicalContext: {cwd: '/work', project: 'work'}};
  assert.equal(journalHistory(record, 'session'), undefined, 'legacy journals are excluded');
  assert.equal(journalHistory({...record, historyEligible: false}, 'session'), undefined);
  assert.equal(journalHistory({...record, historyEligible: true, command: ' secret'}, 'session'), undefined);
  assert.deepEqual(journalHistory({...record, historyEligible: true}, 'session'), {id: historyId('nmsh', 'session:1'), source: 'nmsh',
    session: 'session', command: 'git status', cwd: '/work', project: 'work', exitCode: 0, at: 100, durationMs: 200});
});

test('deletion survives reload without storing commands; corrupt deletion metadata fails closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-history-index-'));
  const file = join(directory, 'deletions.json');
  try {
    const index = new HistoryIndex(file); await index.loadDeletions(); index.add(entry); await index.delete(entry.id);
    assert.deepEqual(await index.search(''), []);
    assert.equal(await readFile(join(`${file}.d`, entry.id), 'utf8'), '');
    const restored = new HistoryIndex(file); await restored.loadDeletions(); restored.add(entry);
    assert.deepEqual(await restored.search(''), []);
    await writeFile(file, '{broken');
    await assert.rejects(new HistoryIndex(file).loadDeletions());
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('100k queries yield to input, are bounded and cancel stale scans', async () => {
  const index = new HistoryIndex();
  for (let i = 0; i < 100_000; i += 1) index.add({...entry, id: String(i), command: `command ${i}`, at: i});
  index.all();
  assert.equal((await index.search('command')).length, 100);
  const active = new AbortController();
  const pending = index.search('missing', active.signal);
  active.abort(); assert.deepEqual(await pending, []);
  let yielded = false;
  setImmediate(() => { yielded = true; });
  await index.search('missing');
  assert.equal(yielded, true);
});

test('eligibility markers survive chunked shell decoding and current IPC, old exec stays unknown', () => {
  const decoder = new ShellProtocolDecoder('token');
  assert.deepEqual(decoder.push('\u001b]777;nmsh;token;exec2;'), []);
  assert.deepEqual(decoder.push('0;echo secret\u0007'), [{kind: 'exec', command: 'echo secret', historyAllowed: 0}]);
  const message = {type: 'exec' as const, command: 'echo secret', historyAllowed: 0, seq: 1, at: 100};
  assert.deepEqual(decodeMessage(encodeMessage(message)), {ok: true, message});
  assert.deepEqual(decoder.push('\u001b]777;nmsh;token;exec;legacy\u0007'), [{kind: 'exec', command: 'legacy'}]);
  assert.equal(decodeKeys('\u0018')[0]!.kind, 'historyDelete');
});

test('real zsh reports unexported HISTORY_IGNORE without changing hooks or executing probes', {timeout: 10000}, async () => {
  const home = await mkdtemp(join(tmpdir(), 'nmsh-history-shell-'));
  await writeFile(join(home, '.zshrc'), "HISTORY_IGNORE='(echo secret|pwd)'\n");
  const shell = new ShellSession(home, 80, 24, home, {...process.env, HOME: home});
  const flags: Array<number | undefined> = [];
  shell.on('exec', (_command, allowed) => { flags.push(allowed); });
  try {
    await once(shell, 'prompt');
    for (const command of ['echo public', 'echo secret', 'pwd', ' echo private']) {
      const done = once(shell, 'prompt'); shell.submit(command); await done;
    }
    assert.deepEqual(flags, [1, 0, 0, 0]);
  } finally { shell.kill(); await rm(home, {recursive: true, force: true}); }
});


test('chunked import preserves multiline/metafied parsing and worker reads only eligible journals', async () => {
  const content = ': 100:2;echo hello\\\nworld\n: 101:0;pwd\n';
  assert.deepEqual(await parseZshHistoryInChunks(content), parseZshHistory(content));
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-history-worker-'));
  try {
    await writeFile(join(directory, 'session.json'), JSON.stringify({schemaVersion: 1, id: 'session', transcript: {records: [
      {command: 'old', startId: 1, exitCode: 0},
      {command: 'secret', historyEligible: false, startId: 2, exitCode: 0},
      {command: 'public', historyEligible: true, startId: 3, exitCode: 0, output: 'raw output'},
    ]}}));
    const worker = new Worker(new URL('../scripts/read-command-history.cjs', import.meta.url), {workerData: {directory}});
    const batches: Array<{records: Array<{command: string}>}> = [];
    worker.on('message', batch => batches.push(batch));
    await once(worker, 'exit');
    assert.deepEqual(batches.flatMap(batch => batch.records).map(record => record.command), ['public']);
    assert.doesNotMatch(JSON.stringify(batches), /raw output|secret/u);
  } finally { await rm(directory, {recursive: true, force: true}); }
});
