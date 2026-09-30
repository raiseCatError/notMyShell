import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNativeCompletions} from '../src/shell/completion.js';
import {CompletionService} from '../src/shell/CompletionService.js';

test('native metadata preserves plain candidates, descriptions and full insertion', () => {
  const context = {buffer: 'git ch', cwd: '/work'};
  const candidates = parseNativeCompletions('checkout -- switch branch\ncherry-pick\ncheckout -- duplicate\n', context);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates[0], {value: 'checkout', display: 'checkout', name: 'checkout', description: 'switch branch',
    kind: 'argument', source: 'zsh-native', replacement: {start: 4, end: 6}, context, insertion: 'git checkout'});
  assert.equal(candidates[1]!.description, '');
  assert.equal(parseNativeCompletions('src/\n--all -- everything', context)[0]!.kind, 'directory');
  assert.equal(parseNativeCompletions('git', {buffer: 'g', cwd: '/work'})[0]!.kind, 'command');
});

test('capture labels cannot inject controls and insertion rejects controls', () => {
  const candidates = parseNativeCompletions('safe -- \u001b[31mdescription\u0007\nunsafe\u001b[2J', {buffer: 's', cwd: '/'});
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.description, 'description');
});

test('superseded requests never return candidates even if a source ignores abort', async () => {
  const requests: Array<{signal: AbortSignal; resolve: (values: ReturnType<typeof parseNativeCompletions>) => void}> = [];
  const service = new CompletionService({id: 'test', query: (_context, signal) => new Promise(resolve => requests.push({signal, resolve}))});
  const old = service.suggest('g', '/');
  const current = service.suggest('gi', '/');
  assert.equal(requests[0]!.signal.aborted, true);
  requests[1]!.resolve(parseNativeCompletions('git', {buffer: 'gi', cwd: '/'}));
  assert.equal((await current).length, 1);
  requests[0]!.resolve(parseNativeCompletions('grep', {buffer: 'g', cwd: '/'}));
  assert.deepEqual(await old, []);
});

test('blank input and disposal cancel outstanding completion; provider failure is safe', async () => {
  let signal: AbortSignal | undefined;
  const service = new CompletionService({id: 'test', query: async (_context, current) => { signal = current; throw new Error('missing'); }});
  assert.deepEqual(await service.suggest('g', '/'), []);
  assert.deepEqual(await service.suggest(' ', '/'), []);
  service.cancel();
  assert.ok(signal);
});
