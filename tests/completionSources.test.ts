import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {candidateIdentity, CompletionAggregator, DeclarativeSpecSource, mergeCandidates, normalizeSpec, specCandidates, validCandidate} from '../src/shell/CompletionSources.js';
import {CompletionService} from '../src/shell/CompletionService.js';
import type {CompletionCandidate, CompletionContext, CompletionSource} from '../src/shell/completion.js';

const context = (buffer: string): CompletionContext => ({buffer, cwd: '/', cursor: buffer.length});
function candidate(value: string, source: string, buffer: string, extra: Partial<CompletionCandidate> = {}): CompletionCandidate {
  const start = buffer.lastIndexOf(' ') + 1;
  return {value, display: value, name: value, description: '', kind: 'argument', source, replacement: {start, end: buffer.length},
    context: context(buffer), insertion: buffer.slice(0, start) + value, ...extra};
}
const fixed = (id: string, values: CompletionCandidate[] | Error, delayMs = 0): CompletionSource => ({id, async query(_context, signal) {
  if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
  if (values instanceof Error) throw values;
  return signal.aborted ? [] : values;
}});

test('merge: stable identity dedupes across sources, keeps provenance, fills only missing descriptions', () => {
  const buffer = 'git ch';
  const merged = mergeCandidates([
    {priority: 10, id: 'spec', candidates: [candidate('checkout', 'spec', buffer, {description: 'Switch branches'}), candidate('cherry-pick', 'spec', buffer)]},
    {priority: 0, id: 'zsh', candidates: [candidate('checkout', 'zsh', buffer), candidate('chmod', 'zsh', buffer)]},
  ], context(buffer));
  const checkout = merged.find(item => item.value === 'checkout')!;
  assert.deepEqual(checkout.provenance, ['zsh', 'spec'], 'higher-priority source owns the row; the other is recorded');
  assert.equal(checkout.source, 'zsh');
  assert.equal(checkout.description, 'Switch branches', 'a lower-priority description fills a gap');
  assert.equal(merged.filter(item => item.value === 'checkout').length, 1);
  assert.deepEqual(merged.map(item => item.value), ['checkout', 'chmod', 'cherry-pick'], 'deterministic: tier, then priority, then source order');
  assert.equal(candidateIdentity(checkout), `4:6:checkout`);
});

test('merge: invalid replacement ranges and control characters are rejected; a single source keeps its own order', () => {
  const buffer = 'ls a';
  assert.equal(validCandidate(candidate('a\u001b[31m', 'x', buffer), context(buffer)), false);
  assert.equal(validCandidate({...candidate('ab', 'x', buffer), replacement: {start: 3, end: 99}}, context(buffer)), false);
  const zshOrder = [candidate('zzz-group-first', 'zsh', buffer), candidate('a', 'zsh', buffer)];
  assert.deepEqual(mergeCandidates([{priority: 0, id: 'zsh', candidates: zshOrder}, {priority: 10, id: 'spec', candidates: []}], context(buffer)).map(item => item.value),
    ['zzz-group-first', 'a'], 'zsh behavior is unchanged when it is the only contributor');
});

test('aggregator: a failing or slow source never blocks or breaks the menu; cancellation yields nothing', async () => {
  const buffer = 'make t';
  const aggregator = new CompletionAggregator([
    {source: fixed('broken', new Error('boom')), priority: 0},
    {source: fixed('slow', [candidate('test-slow', 'slow', buffer)], 500), priority: 1, timeoutMs: 30},
    {source: fixed('good', [candidate('test', 'good', buffer)]), priority: 2},
  ]);
  const started = Date.now();
  const result = await aggregator.query(context(buffer), new AbortController().signal);
  assert.deepEqual(result.map(item => item.value), ['test']);
  assert.ok(Date.now() - started < 400, 'the slow source was not awaited past its deadline');
  assert.match(aggregator.failures.get('broken') ?? '', /boom/u);
  const aborted = new AbortController();
  const pending = aggregator.query(context(buffer), aborted.signal);
  aborted.abort();
  assert.deepEqual(await pending, []);
});

test('declarative specs: data only, bounded, subcommands and options with descriptions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-specs-'));
  try {
    writeFileSync(join(dir, 'tool.json'), JSON.stringify({name: 'tool', subcommands: [{name: ['build', 'b'], description: 'Build it', options: [{name: '--release', description: 'Optimized'}]}],
      options: [{name: ['-v', '--verbose'], description: 'More output'}]}));
    writeFileSync(join(dir, 'broken.json'), '{nope');
    writeFileSync(join(dir, 'evil.json'), JSON.stringify({name: 'bad\u001bname'}));
    const source = new DeclarativeSpecSource(dir);
    const specs = source.load();
    assert.equal(source.skipped, 2);
    assert.deepEqual(specCandidates(specs, context('tool b')).map(item => [item.value, item.kind, item.description]), [['build', 'subcommand', 'Build it'], ['b', 'subcommand', 'Build it']]);
    assert.deepEqual(specCandidates(specs, context('tool build --r')).map(item => item.value), ['--release']);
    assert.deepEqual(specCandidates(specs, context('tool -')).map(item => item.value), ['-v', '--verbose']);
    assert.deepEqual(specCandidates(specs, context('tool')), [], 'command position belongs to the shell');
    assert.equal(normalizeSpec({name: 'x', generators: {script: 'rm -rf /'}})?.name.toString(), 'x', 'unknown (dynamic) fields are ignored, never run');
    assert.deepEqual(new DeclarativeSpecSource(undefined).load().size, 0);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('CompletionService: provider rebinding by construction; one menu from the aggregate', async () => {
  const buffer = 'git st';
  const service = new CompletionService(new CompletionAggregator([
    {source: fixed('shell', [candidate('status', 'shell', buffer)]), priority: 0},
    {source: fixed('spec', [candidate('status', 'spec', buffer, {description: 'Show status'}), candidate('stash', 'spec', buffer)]), priority: 10},
  ]));
  const result = await service.suggest(buffer, '/');
  assert.deepEqual(result.map(item => item.value), ['status', 'stash']);
  assert.equal(result[0]!.description, 'Show status');
  assert.deepEqual(service.sourceIds, ['shell', 'spec']);
  service.dispose();
});
