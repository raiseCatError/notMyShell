import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectStable, resolveSourceLink, validateMedia } from '../scripts/content.mjs';

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
