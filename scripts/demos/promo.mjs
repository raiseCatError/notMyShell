#!/usr/bin/env node
/** Silent 20-second promo made from real NMSh demos. No runtime dependencies. */
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo = fileURLToPath(new URL('../..', import.meta.url));
const output = resolve(repo, 'assets/promo');
const work = mkdtempSync(join(tmpdir(), 'nmsh-promo-'));
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, {cwd: repo, encoding: 'utf8'});
  if (result.error || result.status !== 0) throw new Error(`${cmd}: ${result.error?.message ?? result.stderr}`);
};
const scenes = [
  {clip: 'nmsh-demo', start: 3, title: ['Your shell.', 'More alive.'], detail: ['Real shell state.', 'Live feedback.']},
  {clip: 'chroma', start: 4, title: ['Color.', 'In motion.'], detail: ['Gradients. Chroma.', 'Your own rhythm.']},
  {clip: 'syntax', start: 5, title: ['Make it', 'yours.'], detail: ['Shared theme families.', 'Meaningful syntax colors.']},
  {clip: 'screensavers-cats', start: 10, title: ['Meet', 'Vespyr.'], detail: ['A little personality.', 'A lot of possibility.']},
];
const text = (x, y, value, size, color = '#f2f0ec') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${value}</text>`;
try {
  mkdirSync(output, {recursive: true});
  for (const [i, scene] of scenes.entries()) {
    const gif = resolve(repo, `assets/readme/${scene.clip}.gif`);
    if (!existsSync(gif)) throw new Error(`Record ${scene.clip} first with npm run demos`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1920 1080"><defs><linearGradient id="bg"><stop stop-color="#15141c"/><stop offset="1" stop-color="#242035"/></linearGradient><linearGradient id="line"><stop stop-color="#c5b9e8"/><stop offset=".5" stop-color="#7fc4cc"/><stop offset="1" stop-color="#cd737b"/></linearGradient></defs><rect width="1920" height="1080" fill="url(#bg)"/><circle cx="1700" cy="90" r="340" fill="#c5b9e8" opacity=".035"/><g font-family="ui-sans-serif,system-ui,sans-serif"><g font-weight="700">${text(64, 88, 'notMyShell', 42, '#c5b9e8')}${scene.title.map((line, n) => text(64, 392 + n * 84, line, 72)).join('')}</g>${scene.detail.map((line, n) => text(68, 566 + n * 44, line, 28, '#b0b8c2')).join('')}${text(68, 874, 'zsh · Bash · Fish', 27, '#7fc4cc')}${text(64, 1035, 'github.com/raiseCatError/notMyShell', 24, '#b0b8c2')}${text(1750, 1035, `0${i + 1} / 04`, 22, '#c5b9e8')}</g><rect x="64" y="660" width="390" height="4" fill="url(#line)"/><rect x="588" y="128" width="1298" height="872" rx="16" fill="#15141c" stroke="#58506f"/></svg>`;
    const card = join(work, `card-${i}.svg`);
    writeFileSync(card, svg);
    // Quick Look renders responsive SVG into a square. Crop its centered 16:9 viewport.
    run('qlmanage', ['-t', '-s', '1920', '-o', work, card]);
    run('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', `${card}.png`, '-ss', String(scene.start), '-i', gif,
      '-filter_complex', '[0:v]crop=1920:1080:0:420,fps=30,format=yuv420p,setsar=1[card];[1:v]scale=1280:854,fps=30,format=yuv420p,setsar=1[ui];[card][ui]overlay=x=598+18*exp(-t*4):y=137:shortest=1,trim=duration=5.375,setpts=PTS-STARTPTS[out]',
      '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', join(work, `scene-${i}.mp4`)]);
  }
  const inputs = scenes.flatMap((_, i) => ['-i', join(work, `scene-${i}.mp4`)]);
  run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex',
    '[0:v][1:v]xfade=transition=fade:duration=0.5:offset=4.875[a];[a][2:v]xfade=transition=slideleft:duration=0.5:offset=9.75[b];[b][3:v]xfade=transition=fade:duration=0.5:offset=14.625,trim=duration=20[out]',
    '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(output, 'nmsh-promo.mp4')]);
  run('ffmpeg', ['-v', 'error', '-y', '-i', join(output, 'nmsh-promo.mp4'), '-frames:v', '1', join(output, 'nmsh-promo.png')]);
  console.log('promo: assets/promo/nmsh-promo.mp4 (20s, silent, 1920×1080) and poster');
} finally { rmSync(work, {recursive: true, force: true}); }
