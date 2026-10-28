import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadWelcomeAsset, listWelcomeAssets, resolveWelcomePath} from '../src/welcome/assets.js';
import {ImageError} from '../src/graphics/raster.js';
import {encodePng} from '../src/graphics/pngEncode.js';

test('picker filters assets and navigates directories; path entry supports relative and tilde', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-assets-'));
  try {
    await mkdir(join(dir, 'child')); await writeFile(join(dir, 'a.png'), ''); await writeFile(join(dir, 'x.sh'), '');
    const entries = await listWelcomeAssets(dir);
    assert.deepEqual(entries.map(e => e.name), ['..', 'child', 'a.png']);
    assert.equal((await listWelcomeAssets(join(dir, 'child')))[0]!.path, dir);
    assert.equal(resolveWelcomePath('a.png', dir, dir), join(dir, 'a.png'));
    assert.equal(resolveWelcomePath('~/a.png', '/', dir), join(dir, 'a.png'));
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('asset loader validates bounded pixels and ANSI strips all controls except SGR', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-assets-'));
  try {
    const file = join(dir, 'logo.png');
    await writeFile(file, encodePng({width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255)}));
    const image = await loadWelcomeAsset(file, dir, dir);
    assert.equal(image.kind, 'image'); assert.equal(image.metadata.width, 2);
    await writeFile(join(dir, 'bad.gif'), 'garbage');
    await assert.rejects(loadWelcomeAsset('bad.gif', dir, dir), ImageError);
    await writeFile(join(dir, 'big.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
    await assert.rejects(loadWelcomeAsset('big.png', dir, dir), ImageError);
    await writeFile(join(dir, 'art.ans'), '\x1b]0;SECRET\x07\x1bPSECRET\x1b\\\x1b_SECRET\x1b\\\x1b[31mcat\x1b[0m\nline');
    const art = await loadWelcomeAsset('art.ans', dir, dir);
    assert.equal(art.kind, 'art');
    if (art.kind === 'art') { assert.match(art.rows[0]!, /31mcat/); assert.doesNotMatch(art.rows.join(''), /SECRET|\x1b\]|\x1bP|\x1b_/); }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

import jpeg from 'jpeg-js';
import {encodeGif} from './support/gifEncoder.js';
import {LOSSLESS_WEBP} from './support/graphicsFixtures.js';
import {webpDecoderAvailable} from '../src/graphics/webp.js';
import {chunk, concat, ihdr, PNG_SIGNATURE} from './support/pngEncoder.js';

test('welcome admission covers JPEG, WebP, GIF, APNG and the 2 MP source limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-formats-'));
  try {
    await writeFile(join(dir, 'a.jpg'), jpeg.encode({width: 2, height: 2, data: Buffer.alloc(16, 255)}).data);
    assert.equal((await loadWelcomeAsset('a.jpg', dir, dir)).metadata.format, 'jpeg');
    await writeFile(join(dir, 'a.webp'), Buffer.from(LOSSLESS_WEBP, 'base64'));
    if (webpDecoderAvailable()) assert.equal((await loadWelcomeAsset('a.webp', dir, dir)).metadata.format, 'webp');
    else await assert.rejects(loadWelcomeAsset('a.webp', dir, dir), ImageError);
    const gif = encodeGif({width: 1, height: 1, palette: [[0, 0, 0], [255, 255, 255]], frames: Array.from({length: 76}, () => ({width: 1, height: 1, indices: [1]}))});
    await writeFile(join(dir, 'a.gif'), gif);
    const animation = await loadWelcomeAsset('a.gif', dir, dir);
    assert.ok(animation.metadata.frames <= 75); assert.match(animation.metadata.note!, /limited/);
    // An APNG whose default image participates in its one-frame animation.
    const png = encodePng({width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255])});
    const control = Buffer.alloc(26); control.writeUInt32BE(1, 4); control.writeUInt32BE(1, 8); control.writeUInt16BE(1, 20); control.writeUInt16BE(10, 22);
    const actl = Buffer.alloc(8); actl.writeUInt32BE(1);
    const apng = concat([png.subarray(0, 33), chunk('acTL', actl), chunk('fcTL', control), png.subarray(33)]);
    await writeFile(join(dir, 'a.apng'), apng);
    assert.equal((await loadWelcomeAsset('a.apng', dir, dir)).metadata.frames, 1);
    await writeFile(join(dir, 'large.png'), concat([PNG_SIGNATURE, chunk('IHDR', ihdr(2000, 1001, 8, 6))]));
    await assert.rejects(loadWelcomeAsset('large.png', dir, dir), e => e instanceof ImageError && e.code === 'too-large');
  } finally { await rm(dir, {recursive: true, force: true}); }
});
