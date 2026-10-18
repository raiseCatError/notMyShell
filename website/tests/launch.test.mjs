import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLaunch } from '../scripts/launch.mjs';

const candidate = { state: 'candidate', version: '0.20.0', commit: 'a'.repeat(40), ref: 'stabilize/post-v020-slice3', verifiedAt: '2026-10-17' };
const published = { ...candidate, state: 'published', ref: 'v0.20.0', date: '2026-10-20', url: 'https://github.com/raiseCatError/notMyShell/releases/tag/v0.20.0' };
const cache = { latest: { tag: 'v0.20.0', date: published.date, url: published.url }, sourceCommit: published.commit };
test('candidate provenance is buildable but never passes the publication gate', () => {
  assert.doesNotThrow(() => assertLaunch(candidate));
  assert.throws(() => assertLaunch(candidate, cache, true), /published/);
  assert.throws(() => assertLaunch({ ...candidate, date: published.date }));
  assert.throws(() => assertLaunch({ ...candidate, url: published.url }));
  assert.throws(() => assertLaunch({ ...candidate, commit: 'main' }));
});
test('publication requires an exact public tag, commit, date and release URL match', () => {
  assert.doesNotThrow(() => assertLaunch(published, cache, true));
  for (const change of [{ commit: 'b'.repeat(40) }, { ref: 'release/v0.20.0' }, { version: '0.19.0' }, { date: '2026-10-19' }, { url: 'https://preview.example/' }]) {
    assert.throws(() => assertLaunch({ ...published, ...change }, cache, true));
  }
});
