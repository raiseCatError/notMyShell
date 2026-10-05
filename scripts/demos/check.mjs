#!/usr/bin/env node
/** Decode committed demo assets and enforce the showcase's delivery formats. */
import {execFileSync} from 'node:child_process';
import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const repo = fileURLToPath(new URL('../..', import.meta.url));
const probe = path => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], {encoding: 'utf8'}));
function check(path, kind) {
  const file = join(repo, path);
  const data = probe(file);
  const video = data.streams.find(stream => stream.codec_type === 'video');
  if (!video || video.width < 1300 || video.height < 900) throw new Error(`${path}: missing or cramped video`);
  if (kind === 'gif' && (video.codec_name !== 'gif' || !(Number(data.format.duration) > 0))) throw new Error(`${path}: invalid GIF`);
  if (kind === 'promo' && (video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || video.width !== 1920 || video.height !== 1080 || Math.abs(Number(data.format.duration) - 20) > 0.1 || data.streams.some(stream => stream.codec_type === 'audio'))) throw new Error(`${path}: invalid promo format`);
  execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], {stdio: ['ignore', 'ignore', 'pipe']});
  console.log(`checked ${path}: ${video.width}×${video.height}${data.format.duration ? `, ${Number(data.format.duration).toFixed(2)}s` : ''}`);
}
for (const tape of readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.tape') && name !== 'settings.tape')) {
  const source = readFileSync(new URL(tape, import.meta.url), 'utf8');
  const output = /^Output (\S+\.gif)$/mu.exec(source)?.[1];
  if (!output) throw new Error(`${tape}: no GIF output`);
  check(output, 'gif');
  for (const still of source.matchAll(/^# demo-still: (\S+) /gmu)) check(still[1], 'still');
}
check('assets/promo/nmsh-promo.mp4', 'promo');
check('assets/promo/nmsh-promo.png', 'still');
