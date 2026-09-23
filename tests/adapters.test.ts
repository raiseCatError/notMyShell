import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFacts} from '../src/status/adapters.js';

test('Node TAP summary: all passing', () => {
  const output = `
# tests 135
# suites 0
# pass 135
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2149.589083
`;
  const facts = extractFacts('npm test', output);
  assert.deepEqual(facts, ['135 passed']);
});

test('Node TAP summary: some failing', () => {
  const output = `
# tests 135
# suites 0
# pass 132
# fail 3
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2149.589083
`;
  const facts = extractFacts('npm test', output);
  assert.deepEqual(facts, ['132 passed', '3 failed']);
});

test('Node TAP summary: skipped tests', () => {
  const output = `
# tests 135
# suites 0
# pass 130
# fail 1
# cancelled 0
# skipped 4
# todo 0
# duration_ms 2149.589083
`;
  const facts = extractFacts('npm test', output);
  assert.deepEqual(facts, ['130 passed', '1 failed', '4 skipped']);
});

test('Node TAP summary: malformed / partial safely falls back', () => {
  const output = `
just some output
# nothing here
tests 135
pass 135
`;
  const facts = extractFacts('npm test', output);
  assert.equal(facts, undefined);
});
