import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {codexCapabilities, codexMessage, codexToolEvent, CodexSession} from '../src/agents/sessions/codexAdapter.js';
import type {AgentEvent} from '../src/agents/sessions/model.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'fake-codex-app-server.mjs');

test('capabilities come from the installed CLI\'s own help, and the experimental label is kept', () => {
  const help = '[experimental] Run the app server or related tooling\n\nUsage: codex app-server [OPTIONS] [COMMAND]\n';
  assert.deepEqual(codexCapabilities('codex', help), {appServer: true, experimental: true});
  assert.deepEqual(codexCapabilities('codex', 'Usage: codex app-server [OPTIONS]\n'), {appServer: true, experimental: false});
  assert.deepEqual(codexCapabilities('codex', 'error: unrecognized subcommand'), {appServer: false, experimental: false});
});

test('messages: items, approvals and turn results normalize from structured fields only; unknown shapes give nothing', () => {
  assert.deepEqual(codexMessage('{"method":"item/completed","params":{"item":{"type":"agentMessage","id":"i","text":"Done."}}}').events, [{kind: 'assistant', text: 'Done.'}]);
  assert.deepEqual(codexToolEvent({type: 'commandExecution', id: 'c', command: 'npm test\nsecond', status: 'completed', exitCode: 1}, 'completed'),
    {kind: 'tool', id: 'c', name: 'command', target: 'npm test', status: 'failed', detail: 'exit 1'}, 'a non-zero exit is a failure');
  assert.deepEqual(codexToolEvent({type: 'mcpToolCall', id: 'm', server: 'docs', tool: 'search', status: 'inProgress'}, 'started'), {kind: 'tool', id: 'm', name: 'docs.search', status: 'started'});
  assert.equal(codexToolEvent({type: 'reasoning', id: 'r'}, 'started'), undefined, 'reasoning is not a tool');
  const approval = codexMessage('{"id":7,"method":"item/commandExecution/requestApproval","params":{"command":"rm -rf /","cwd":"/","itemId":"x","threadId":"t","turnId":"u","startedAtMs":1}}');
  assert.deepEqual(approval.events, [{kind: 'approval', requestId: '7', tool: 'command', target: 'rm -rf /', input: {command: 'rm -rf /', cwd: '/'}}]);
  assert.equal(approval.request?.id, 7);
  assert.deepEqual(codexMessage('{"method":"turn/completed","params":{"turn":{"id":"u","status":"interrupted"}}}').events, [{kind: 'settled', ok: false, interrupted: true}]);
  assert.deepEqual(codexMessage('{"method":"turn/completed","params":{"turn":{"id":"u","status":"failed","error":{"message":"quota\\nmore"}}}}').events, [{kind: 'settled', ok: false, message: 'quota'}]);
  assert.deepEqual(codexMessage('{"method":"turn/completed","params":{"turn":{"id":"u","status":"failed"}}}').events, [{kind: 'settled', ok: false}], 'no reason is invented');
  for (const line of ['', 'nope', '[]', '{"method":"turn/plan/updated","params":{"plan":[]}}', '{"method":"item/completed","params":{"item":{"type":"agentMessage","id":"i","text":"   "}}}']) {
    assert.deepEqual(codexMessage(line).events, [], line);
  }
});

async function session(scenario: string, act: (session: CodexSession, events: AgentEvent[], wait: (kind: AgentEvent['kind'], count?: number) => Promise<void>) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-codex-'));
  const log = join(directory, 'client.log');
  const events: AgentEvent[] = [];
  const waiters: Array<() => void> = [];
  const codex = new CodexSession({executable: process.execPath, args: [FIXTURE, scenario, log], cwd: directory, clientVersion: '0.18.0',
    onEvent: event => { events.push(event); waiters.splice(0).forEach(wake => wake()); }});
  const wait = async (kind: AgentEvent['kind'], count = 1) => {
    const deadline = Date.now() + 10_000;
    while (events.filter(event => event.kind === kind).length < count) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${kind}: ${JSON.stringify(events)}`);
      await new Promise<void>(resolve => { waiters.push(resolve); setTimeout(resolve, 200); });
    }
  };
  try {
    assert.deepEqual(codex.start(), {ok: true});
    await act(codex, events, wait);
    const client = (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
    return client;
  } finally {
    codex.close();
    await wait('exited').catch(() => {});
    await rm(directory, {recursive: true, force: true});
  }
}

test('a session: handshake, thread, a message, one approval answered by the person, unsupported requests refused', async () => {
  const client = await session('normal', async (codex, events, wait) => {
    assert.equal(codex.send('clean the build'), true, 'a message before the thread exists is queued, not lost');
    await wait('approval');
    const approval = events.find(event => event.kind === 'approval');
    assert.deepEqual(approval, {kind: 'approval', requestId: '100', tool: 'command', target: 'rm -rf build', input: {command: 'rm -rf build', cwd: '/tmp', reason: 'cleans the build'}});
    assert.equal(codex.answer('nope', true), false, 'only a pending request can be answered');
    assert.equal(codex.answer('100', true), true);
    assert.equal(codex.answer('100', true), false, 'an answer is sent once');
    await wait('settled');
    assert.deepEqual(events.filter(event => event.kind === 'started'), [{kind: 'started', harnessSessionId: 'thr_1'}], 'reported once, whichever arrives first');
    assert.deepEqual(events.find(event => event.kind === 'model'), {kind: 'model', model: 'gpt-test'});
    assert.deepEqual(events.filter(event => event.kind === 'tool'), [
      {kind: 'tool', id: 'item_1', name: 'command', target: 'rm -rf build', status: 'started'},
      {kind: 'tool', id: 'item_1', name: 'command', target: 'rm -rf build', status: 'finished', detail: 'exit 0'},
      {kind: 'tool', id: 'item_2', name: 'file change', target: 'src/a.ts', status: 'finished', detail: '2 files'},
    ]);
    assert.deepEqual(events.filter(event => event.kind === 'assistant'), [{kind: 'assistant', text: 'Cleaned.'}]);
    assert.deepEqual(events.at(-1), {kind: 'settled', ok: true});
  });
  assert.deepEqual(client.map(message => message.method ?? `response:${String(message.id)}`), ['initialize', 'initialized', 'thread/start', 'turn/start', 'response:101', 'response:100']);
  assert.deepEqual(client[0]!.params, {clientInfo: {name: 'nmsh', title: 'notMyShell', version: '0.18.0'}});
  assert.deepEqual((client[3]!.params as Record<string, unknown>).input, [{type: 'text', text: 'clean the build', text_elements: []}]);
  assert.deepEqual(client[4], {id: 101, error: {code: -32601, message: 'Not supported by NMSh'}}, 'requests NMSh does not implement are refused, never left waiting');
  assert.deepEqual(client[5], {id: 100, result: {decision: 'accept'}}, 'accept once; never "for the session"');
  assert.ok(!client.some(message => message.method === 'thread/start' && 'approvalPolicy' in (message.params as object)), 'Codex\'s own approval policy and sandbox are not overridden');
});

test('declining is the person\'s choice and Codex reports the command as declined', async () => {
  const client = await session('normal', async (codex, events, wait) => {
    codex.send('clean the build');
    await wait('approval');
    assert.equal(codex.answer('100', false), true);
    await wait('settled');
    assert.deepEqual(events.find(event => event.kind === 'approvalAnswered'), {kind: 'approvalAnswered', requestId: '100', allowed: false});
    assert.ok(events.some(event => event.kind === 'tool' && event.id === 'item_1' && event.status === 'failed' && event.detail === 'declined'));
  });
  assert.deepEqual(client.find(message => message.id === 100), {id: 100, result: {decision: 'decline'}});
});

test('cancellation is acknowledged only when the turn completes as interrupted', async () => {
  const client = await session('interrupt', async (codex, events, wait) => {
    codex.send('long task');
    await new Promise(resolve => setTimeout(resolve, 300));
    codex.cancel();
    await wait('settled');
    assert.deepEqual(events.at(-1), {kind: 'settled', ok: false, interrupted: true});
    assert.ok(events.some(event => event.kind === 'requestsCleared'));
  });
  assert.deepEqual(client.find(message => message.method === 'turn/interrupt')?.params, {threadId: 'thr_1', turnId: 'turn_1'});
});

test('a failed turn reports the provider\'s own message; a refused initialization ends the session honestly', async () => {
  await session('fail', async (codex, events, wait) => {
    codex.send('go');
    await wait('settled');
    assert.deepEqual(events.at(-1), {kind: 'settled', ok: false, message: 'usage limit reached'});
  });
  await session('refuse-init', async (codex, events, wait) => {
    await wait('settled');
    assert.deepEqual(events.find(event => event.kind === 'settled'), {kind: 'settled', ok: false, message: 'Codex app-server refused initialization'});
    assert.equal(codex.send('hello'), false, 'nothing is accepted after a failed start');
  });
});

test('hostile output: garbage and an oversized frame are dropped, the session still works', async () => {
  await session('garbage', async (codex, events, wait) => {
    codex.send('hi');
    await wait('approval');
    assert.ok(events.some(event => event.kind === 'incomplete' && /8 MiB/u.test(event.reason)));
    codex.answer('100', false);
    await wait('settled');
  });
});
