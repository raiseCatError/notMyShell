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
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionService} from '../src/session/SessionService.js';
import {SocketSessionClient} from '../src/session/SocketSessionClient.js';
import {StreamBacklog, readSpool} from '../src/session/StreamBacklog.js';
import {until} from './helpers/liveFrontend.js';

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
  assert.equal(role('>1file echo hi', '1file'), 'Argument');
  assert.equal(role('>1file echo hi', 'echo'), 'Command');
  assert.equal(role('echo if then', 'if'), 'Argument');
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
    shell.submit("alias live_alias='print alias-secret'; alias λ='print unicode-secret'; live_function() { print function-secret; }; print RAW-MARKER");
    const [marker] = await changed;
    const names = parseShellKnowledge(marker.knowledge ?? '');
    assert.match(marker.knowledge ?? '', /complete\n$/u);
    assert.equal(names.get('live_alias'), 'alias');
    assert.equal(names.get('λ'), 'alias');
    assert.equal(names.get('live_function'), 'function');
    assert.match(output, /RAW-MARKER/);
    assert.doesNotMatch(output, /alias-secret|function-secret|unicode-secret/);
    const partial = once(shell, 'prompt');
    shell.submit("alias 'odd:name=print odd-secret'");
    const [filtered] = await partial;
    assert.match(filtered.knowledge ?? '', /partial\n$/u);
    assert.equal(parseShellKnowledge(filtered.knowledge ?? '').has('odd:name'), false);
    const removed = once(shell, 'prompt');
    shell.submit("unalias live_alias λ 'odd:name'; unfunction live_function");
    const [fresh] = await removed;
    assert.equal(parseShellKnowledge(fresh.knowledge ?? '').has('live_alias'), false);
    assert.equal(parseShellKnowledge(fresh.knowledge ?? '').has('live_function'), false);
  } finally { shell.kill(); rmSync(home, {recursive: true, force: true}); }
});

test('complete snapshots reveal unshadowed commands, partial snapshots preserve positive knowledge, and dead helpers retain live names', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-semantic-knowledge-'));
  writeFileSync(join(home, '.zshrc'), "alias ls='print configured'; alias echo='print configured'; alias configured_only='print configured'\n");
  const previous = process.env.HOME;
  process.env.HOME = home;
  const service = new SemanticService(home);
  try {
    service.applyShellKnowledge('complete\n');
    assert.equal(await service.classifyCommand('ls'), 'executable');
    assert.equal(await service.classifyCommand('echo'), 'builtin');
    assert.equal(await service.classifyCommand('configured_only'), 'unknown');
    service.applyShellKnowledge('function positive\npartial\n');
    assert.equal(await service.classifyCommand('positive'), 'function');
    assert.equal(await service.classifyCommand('configured_only'), 'alias');
    service.applyShellKnowledge('alias live_alias\ncomplete\n');
    const stale = service.classifyCommand('stale_result');
    service.applyShellKnowledge('function latest\ncomplete\n');
    assert.equal(await stale, 'unknown');
    assert.equal(service.cache.has('stale_result'), false);
    service.kill();
    assert.equal(await service.classifyCommand('latest'), 'function');
  } finally {
    service.kill();
    if (previous === undefined) delete process.env.HOME; else process.env.HOME = previous;
    rmSync(home, {recursive: true, force: true});
  }
});

test('large live name snapshots explicitly signal truncation', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nmsh-large-knowledge-'));
  writeFileSync(join(home, '.zshrc'), '');
  const shell = new ShellSession(home, 80, 24, home, {...process.env, HOME: home});
  try {
    await once(shell, 'prompt');
    const changed = once(shell, 'prompt');
    shell.submit("for i in {1..4500}; do functions[bulk_$i]=':'; done");
    const [marker] = await changed;
    assert.match(marker.knowledge ?? '', /partial\n$/u);
    assert.ok(Buffer.byteLength(marker.knowledge ?? '') <= 65536);
    assert.ok(parseShellKnowledge(marker.knowledge ?? '').size <= 4096);
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

test('name snapshots survive spool replay and reattachment after prompt acknowledgement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-name-replay-'));
  const home = join(root, 'h'); mkdirSync(home);
  writeFileSync(join(home, '.zshrc'), '');
  const event = {kind: 'prompt' as const, seq: 1, at: 1, cwd: home, exitCode: 0, knowledge: 'alias replay_name\ncomplete\n'};
  const spool = join(root, 'spool.jsonl');
  const backlog = new StreamBacklog(spool, {memoryBytes: 1, spoolBytes: 100000});
  backlog.append(event);
  assert.deepEqual(readSpool(spool).events, [event]);
  backlog.dispose();
  const service = new SessionService({runtimeDir: join(root, 'r'), startupIdleMs: 60000});
  let first: SocketSessionClient | undefined;
  let second: SocketSessionClient | undefined;
  try {
    await service.start();
    const options = {socketPath: service.socketPath, cwd: home, columns: 80, rows: 24, env: {...process.env, HOME: home}};
    first = await SocketSessionClient.connect(options);
    let latest = '';
    let seq = 0;
    first.on('prompt', (marker, stamp) => { latest = marker.knowledge ?? ''; seq = stamp.seq ?? 0; });
    first.start();
    await until(() => seq > 0, 15000, 'initial snapshot');
    seq = 0;
    first.submit("alias replay_name='print never-executed'");
    await until(() => seq > 0 && parseShellKnowledge(latest).has('replay_name'), 15000, 'live snapshot');
    first.ack(seq, 'test-journal');
    first.detach();
    await until(() => service.registry[0]?.state === 'detached', 10000, 'detached service');
    second = await SocketSessionClient.connect({...options, attach: first.sessionId});
    assert.equal(second.attachedSession?.ackedSeq, seq);
    assert.equal(parseShellKnowledge(second.attachedSession?.knowledge ?? '').get('replay_name'), 'alias');
    assert.doesNotMatch(second.attachedSession?.knowledge ?? '', /never-executed/);
    second.start();
  } finally {
    first?.detach(); second?.detach(); await service.close();
    rmSync(root, {recursive: true, force: true});
  }
});
