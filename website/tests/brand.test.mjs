import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import sharp from 'sharp';

const brand = new URL('../public/brand/', import.meta.url);
test('Vespyr icons preserve transparent backgrounds at tab and touch sizes', async () => {
  for (const [filename, size] of [['favicon-16.png', 16], ['favicon-32.png', 32], ['apple-touch-icon.png', 180]]) {
    const image = sharp(await readFile(new URL(filename, brand)));
    const metadata = await image.metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    assert.equal(metadata.hasAlpha, true);
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0);
    const opaque = Array.from({ length: info.width * info.height }, (_, index) => data[index * 4 + 3]).filter(alpha => alpha > 0).length;
    assert.ok(opaque > size * size * .15 && opaque < size * size * .6);
  }
  const icon = await readFile(new URL('favicon.svg', brand), 'utf8');
  assert.ok(icon.includes('shape-rendering="crispEdges"'));
  assert.ok(!icon.includes('<image'));
});

test('the actual social preview is a compact production PNG', async () => {
  const data = await readFile(new URL('social-preview.png', brand));
  const metadata = await sharp(data).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
  assert.ok(data.length < 180000);
});
