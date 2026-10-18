#!/usr/bin/env node
/**
 * Builds a self-contained copy of review.html for publishing: every capture is
 * quantized to an 8-bit PNG (visually identical for terminal frames) and inlined
 * as a data URI; videos named in EMBED_VIDEOS are inlined, the rest point at the T7.
 *   t7run node build-embedded.mjs [concept,concept]
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** Archive copy: reads review.html and captures/ from REVIEW_ROOT (the T7 archive by default); writes to T7 scratch. */
const here = process.env.REVIEW_ROOT || '/Volumes/T7 Shield/NMSh Design Archive/first-run-onboarding-2026-10-17/design-concepts';
const scratch = process.env.T7_RUN_DIR;
if (!scratch) throw new Error('Run through t7run so the build stays on the T7.');
const build = join(scratch, 'build');
mkdirSync(build, {recursive: true});
const embedVideos = new Set((process.argv[2] ?? 'reactive').split(',').filter(Boolean));
const cache = new Map();

function image(path) {
  if (cache.has(path)) return cache.get(path);
  const out = join(build, path.replaceAll('/', '_'));
  if (!existsSync(out)) {
    const run = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(here, path), '-vf',
      'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none', out], {encoding: 'utf8'});
    if (run.status !== 0) throw new Error(`ffmpeg ${path}: ${run.stderr}`);
  }
  const uri = `data:image/png;base64,${readFileSync(out).toString('base64')}`;
  cache.set(path, uri);
  return uri;
}

let page = readFileSync(join(here, 'review.html'), 'utf8');
page = page.replace(/ data-full="captures\/[^"]+"/gu, '');
page = page.replace(/<video src="(captures\/([a-z]+)\/motion\.mp4)"[^>]*><\/video>/gu, (whole, path, concept) => {
  if (embedVideos.has(concept) && existsSync(join(here, path))) {
    return `<video src="data:video/mp4;base64,${readFileSync(join(here, path)).toString('base64')}" controls muted loop playsinline preload="metadata"></video>`;
  }
  return `<p class="callout">This clip is kept on the T7 beside the captures: <code>design-concepts/${path}</code>.</p>`;
});
page = page.replace(/(src|poster)="(captures\/[^"]+\.png)"/gu, (_, attribute, path) => `${attribute}="${image(path)}"`);
const out = join(scratch, 'review-embedded.html');
writeFileSync(out, page);
console.log(`${out}  ${(statSync(out).size / 1048576).toFixed(2)} MiB, ${cache.size} images, videos: ${[...embedVideos].join(', ') || 'none'}`);
