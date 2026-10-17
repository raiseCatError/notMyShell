import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { selectStable, resolveSourceLink, validateMedia, renderReleaseMarkdown, assertReleaseCache, assertFileMembership, planOwnedRemovals } from '../scripts/content.mjs';

test('stable selection rejects drafts and prereleases and sorts semantic versions', () => {
  const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, ...extra });
  assert.equal(selectStable([release('v0.9.0'), release('v0.18.0'), release('v0.20.0', { prerelease: true }), release('v1.0.0', { draft: true })]).tag_name, 'v0.18.0');
  assert.throws(() => selectStable([release('v0.19.0-rc.1')]));
});

test('source links preserve anchors, map imported docs and leave external URLs alone', () => {
  const options = { commit: 'abc123', routes: { 'docs/privacy.md': 'privacy' } };
  assert.equal(resolveSourceLink('../privacy.md#context-modules', 'docs/architecture/context-modules.md', options), '/docs/reference/privacy/#context-modules');
  assert.equal(resolveSourceLink('../../src/app.ts', 'docs/architecture/context-modules.md', options), 'https://github.com/raiseCatError/notMyShell/blob/abc123/src/app.ts');
  assert.equal(resolveSourceLink('#overview', 'README.md', options), '#overview');
  assert.equal(resolveSourceLink('https://example.com/', 'README.md', options), 'https://example.com/');
});

test('media validates semantic IDs and prevents uncaptioned or inaccessible supplied assets', () => {
  const slot = { id: 'hero-shell', width: 1440, height: 900, caption: 'Product overview.', altRequirement: 'Describe the genuine composer and transcript.' };
  assert.equal(validateMedia(slot), true);
  assert.throws(() => validateMedia({ ...slot, width: 0 }));
  assert.throws(() => validateMedia({ ...slot, src: '/media/hero.webp', kind: 'image' }));
  assert.equal(validateMedia({ ...slot, src: '/media/hero.webp', kind: 'image', alt: 'NMSh composer below a completed command.' }), true);
  assert.throws(() => validateMedia({ ...slot, src: 'https://unreviewed.example/hero.mp4', kind: 'video', alt: 'Overview' }));
});

test('check-only release freshness detects edited notes, metadata, history and extra files', () => {
  const release = { tag_name: 'v0.18.0', name: 'Release title', body: 'Actual notes.', published_at: '2026-10-13T03:26:49Z', html_url: 'https://github.com/raiseCatError/notMyShell/releases/tag/v0.18.0', draft: false, prerelease: false };
  const cached = { latest: { tag: release.tag_name, version: '0.18.0', date: '2026-10-13', url: release.html_url }, history: [{ tag: release.tag_name, date: '2026-10-13', url: release.html_url }] };
  const contents = { 'v0.18.0.md': renderReleaseMarkdown(release) };
  assert.doesNotThrow(() => assertReleaseCache([release], cached, contents));
  for (const change of [{ body: 'Corrected notes.' }, { name: 'Corrected title' }, { published_at: '2026-10-14T03:26:49Z' }]) {
    assert.throws(() => assertReleaseCache([{ ...release, ...change }], cached, contents));
  }
  assert.throws(() => assertReleaseCache([release, { ...release, tag_name: 'v0.17.0' }], cached, contents));
  assert.throws(() => assertReleaseCache([release], cached, { ...contents, 'v0.1.0.md': 'Orphan' }));
});

test('generated collections cannot silently publish orphan files or lose manifest entries', () => {
  assert.doesNotThrow(() => assertFileMembership(['privacy.md'], ['privacy.md'], 'reference'));
  assert.throws(() => assertFileMembership(['privacy.md', 'old.md'], ['privacy.md'], 'reference'));
  assert.throws(() => assertFileMembership([], ['privacy.md'], 'reference'));
  const contents = { 'old.md': 'Previously generated.' };
  const proofs = { 'old.md': createHash('sha256').update(contents['old.md']).digest('hex') };
  assert.deepEqual(planOwnedRemovals(contents, [], proofs), ['old.md']);
  assert.throws(() => planOwnedRemovals({ 'old.md': 'User edits.' }, [], proofs));
  assert.throws(() => planOwnedRemovals(contents, [], {}));
});
