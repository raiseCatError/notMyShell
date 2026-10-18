import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEditorial, corrections } from '../scripts/editorial.mjs';

test('corrections replace exactly one passage and only for their pinned commit', () => {
  const [first] = corrections;
  const body = `before\n${first.from}\nafter\n`;
  const result = applyEditorial(first.slug, first.commit, body);
  assert.equal(result.body, `before\n${first.to}\nafter\n`);
  assert.deepEqual(result.applied.map(item => item.id), [first.id]);
  assert.equal(applyEditorial(first.slug, 'f'.repeat(40), body).body, body);
  assert.equal(applyEditorial('privacy', first.commit, body).body, body);
});

test('a correction that no longer matches exactly once fails loudly', () => {
  const [first] = corrections;
  assert.throws(() => applyEditorial(first.slug, first.commit, 'unrelated\n'), /no longer matches/);
  assert.throws(() => applyEditorial(first.slug, first.commit, `${first.from}\n${first.from}\n`), /no longer matches/);
});

test('no correction points at a private GitHub Project', () => {
  for (const item of corrections) assert.doesNotMatch(item.to, /github\.com\/users\/[^/]+\/projects/);
});
