import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore standalone runner outside product tsconfig
import {discoverTestFiles, selectTestGroups, parseTestOptions, testConcurrency} from '../scripts/test-selection.mjs';

test('verification concurrency can be reduced explicitly without changing suite selection', () => {
  assert.equal(testConcurrency(undefined, 8), 4);
  assert.equal(testConcurrency(undefined, 1), 1);
  assert.equal(testConcurrency('1', 8), 1);
  assert.equal(testConcurrency('2', 8), 2);
  for (const value of ['', '0', '5', '1.5', 'auto']) assert.throws(() => testConcurrency(value, 8));
});

test('shards are deterministic, disjoint and cover the exact canonical suite', () => {
  const files = discoverTestFiles();
  for (const count of [1, 2, 3, 7]) {
    const shards = Array.from({length: count}, (_, i) => selectTestGroups(files, {shard: {index: i + 1, count}}).flat());
    assert.deepEqual(shards.flat().sort(), files);
    assert.equal(new Set(shards.flat()).size, files.length);
    for (let i = 0; i < count; i++) assert.deepEqual(selectTestGroups([...files].reverse(), {shard: {index: i + 1, count}}).flat(), shards[i]);
  }
});
test('ranking runs separately and only in shard one', () => {
  const files = discoverTestFiles();
  assert.deepEqual(selectTestGroups(files)[1], ['tests/suggestionRanking.test.ts']);
  assert.deepEqual(selectTestGroups(files, {shard: {index: 1, count: 2}})[1], ['tests/suggestionRanking.test.ts']);
  assert.deepEqual(selectTestGroups(files, {shard: {index: 2, count: 2}})[1], []);
});
test('invalid selection fails instead of silently omitting tests', () => {
  for (const value of ['0/2', '3/2', '1/0', '1.5/2', '1', 'x/2', '1/2/3']) assert.throws(() => parseTestOptions([`--shard=${value}`]));
  assert.throws(() => parseTestOptions(['--shard=1/2', '--shard=2/2']));
  assert.throws(() => parseTestOptions(['--suite=typo']));
  assert.throws(() => parseTestOptions(['--suite=fast', '--shard=1/2']));
  assert.deepEqual(parseTestOptions(['--shard=2/3', '--test-timeout=120000']), {shard: {index: 2, count: 3}, args: ['--test-timeout=120000']});
});
test('curated suites exist, contain no duplicates and are proper canonical subsets', () => {
  const files = discoverTestFiles();
  for (const suite of ['fast', 'node22', 'fedora']) {
    const selected = selectTestGroups(files, {suite}).flat();
    assert.ok(selected.length > 0 && selected.length < files.length);
    assert.equal(new Set(selected).size, selected.length);
    assert.ok(selected.every((file: string) => files.includes(file)));
    assert.throws(() => selectTestGroups(files.filter((file: string) => file !== selected[0]), {suite}));
  }
});
