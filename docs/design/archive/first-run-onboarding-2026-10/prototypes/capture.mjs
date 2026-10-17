#!/usr/bin/env node
/**
 * Captures the prototypes through VHS: xterm.js in headless Chrome rendering the
 * prototypes' real ANSI output (the same recipe as scripts/demos/render.mjs).
 * Stills: one VHS session per shot. Clips: a scripted key sequence to MP4.
 *
 *   t7run node capture.mjs horizon            stills for one concept
 *   t7run node capture.mjs horizon --clip     its motion clip
 *   t7run node capture.mjs horizon --only pick-1-wide
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scratch = process.env.T7_RUN_DIR || process.env.TMPDIR;
if (!scratch || !scratch.startsWith('/Volumes/T7Tmp/')) throw new Error('Run through t7run: scratch must be on the T7.');
const FPS = 24, PAD = 18, BACKGROUND = '0x15141c';
/** Archive copy: captures go to T7 scratch (or CAPTURE_DIR), never beside the version-controlled source. */
const captureRoot = process.env.CAPTURE_DIR || join(scratch, 'captures');
const SIZES = {wide: [1440, 960], standard: [1200, 760], medium: [960, 680], narrow: [720, 600], small: [520, 460]};
const THEME = '{ "name": "NMSh Demo", "black": "#1b1a24", "red": "#cd737b", "green": "#74b59a", "yellow": "#e3c48f", "blue": "#8aa4e6", "magenta": "#c5b9e8", "cyan": "#7fc4cc", "white": "#d8d6de", "brightBlack": "#6b6f7b", "brightRed": "#e2939a", "brightGreen": "#94cdb4", "brightYellow": "#f0d9a8", "brightBlue": "#a9bdf0", "brightMagenta": "#dcd2f4", "brightCyan": "#a0d8de", "brightWhite": "#f2f0ec", "background": "#15141c", "foreground": "#f2f0ec", "selection": "#585f91", "cursor": "#c5b9e8" }';

const settings = ([width, height]) => [
  'Set Shell "bash"', 'Set FontFamily "JetBrainsMono Nerd Font Mono"', 'Set FontSize 18', 'Set LineHeight 1.15',
  `Set Width ${width}`, `Set Height ${height}`, 'Set Padding 18', 'Set BorderRadius 0', 'Set Margin 0', `Set Framerate ${FPS}`,
  'Set TypingSpeed 1ms', 'Set CursorBlink false', `Set Theme ${THEME}`, 'Env NMSH_COLOR "truecolor"', 'Env COLORTERM "truecolor"',
  ...(process.env.NMSH_SRC ? [`Env NMSH_SRC "${process.env.NMSH_SRC}"`] : []),
].join('\n');

/** Shots per concept: [name, size, prototype arguments]. */
function shots(concept) {
  if (concept === 'reactive') {
    // The recommended direction: Horizon with Stage's meaningful lighting.
    const r = '--concept horizon --reactive';
    return [1, 2, 3, 4].map(choice => [`pick-${choice}-wide`, 'wide', `${r} --choice ${choice}`])
      .concat([['pick-4-standard', 'standard', `${r} --choice 4`], ['pick-2-standard', 'standard', `${r} --choice 2`]]);
  }
  const c = `--concept ${concept}`;
  const list = [];
  for (const choice of [1, 2, 3, 4]) list.push([`pick-${choice}-wide`, 'wide', `${c} --choice ${choice}`]);
  list.push(['pick-1-standard', 'standard', `${c} --choice 1`]);
  list.push(['pick-4-standard', 'standard', `${c} --choice 4`]);
  list.push(['review-1-wide', 'wide', `${c} --choice 1 --screen review`]);
  list.push(['review-4-wide', 'wide', `${c} --choice 4 --screen review`]);
  list.push(['confirm-wide', 'wide', `${c} --choice 2 --screen confirm`]);
  list.push(['customize-wide', 'wide', `${c} --choice 3 --screen customize`]);
  list.push(['welcome-wide', 'wide', `${c} --screen welcome`]);
  list.push(['kept-standard', 'standard', `${c} --choice 4 --screen kept`]);
  list.push(['pick-2-medium', 'medium', `${c} --choice 2`]);
  list.push(['pick-1-narrow', 'narrow', `${c} --choice 1`]);
  list.push(['pick-4-small', 'small', `${c} --choice 4`]);
  list.push(['backdrop-subtle-standard', 'standard', `${c} --choice 1 --backdrop subtle`]);
  list.push(['backdrop-off-standard', 'standard', `${c} --choice 1 --backdrop off`]);
  list.push(['theme-ocean-standard', 'standard', `${c} --choice 1 --theme ocean`]);
  list.push(['nocolor-standard', 'standard', `${c} --choice 1 --nocolor --safe`]);
  list.push(['keep-multi-wide', 'wide', `${c} --choice 4 --screen review --case multi`]);
  list.push(['keep-custom-wide', 'wide', `${c} --choice 4 --screen review --case custom`]);
  return list;
}

function compose(frames, output, index) {
  const pick = name => join(frames, `frame-${name}-${String(index).padStart(5, '0')}.png`);
  if (!existsSync(pick('text'))) throw new Error(`no frame ${index} for ${output}`);
  const inputs = ['-i', pick('text'), ...(existsSync(pick('cursor')) ? ['-i', pick('cursor')] : [])];
  const filter = `${inputs.length > 2 ? '[0][1]overlay' : '[0]null'},pad=iw+${PAD * 2}:ih+${PAD * 2}:${PAD}:${PAD}:color=${BACKGROUND}`;
  const run = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', filter, '-frames:v', '1', output], {encoding: 'utf8'});
  if (run.status !== 0) throw new Error(`ffmpeg: ${run.stderr}`);
}

function still(concept, [name, size, args]) {
  const work = mkdtempSync(join(scratch, `vhs-${concept}-${name}-`));
  const frames = join(work, 'frames');
  const tape = `Output "${frames}/"\n${settings(SIZES[size])}\nHide\nType "${join(here, 'run.sh')} ${args} --freeze 4200"\nEnter\nSleep 3.2s\nShow\nSleep 500ms\nHide\nType "q"\nSleep 200ms\n`;
  writeFileSync(join(work, 'shot.tape'), tape);
  const run = spawnSync('vhs', [join(work, 'shot.tape')], {cwd: here, encoding: 'utf8'});
  if (run.status !== 0) throw new Error(`vhs ${name}: ${run.stdout.slice(-800)}${run.stderr.slice(-800)}`);
  const count = readdirSync(frames).filter(file => file.startsWith('frame-text-')).length;
  const dir = join(captureRoot, concept);
  mkdirSync(dir, {recursive: true});
  compose(frames, join(dir, `${name}.png`), Math.max(1, count - 2));
  rmSync(work, {recursive: true, force: true});
  console.log(`${concept}/${name}.png  (${size})`);
}

/** A short motion clip: the real Aurora moving and a few honest key presses. */
function clip(concept) {
  const work = mkdtempSync(join(scratch, `vhs-${concept}-clip-`));
  const frames = join(work, 'frames');
  const nav = concept === 'horizon' || concept === 'reactive' ? ['Down', 'Down', 'Down'] : ['Right', 'Right', 'Right'];
  const launch = concept === 'reactive' ? '--concept horizon --reactive' : `--concept ${concept}`;
  const body = [
    'Hide', `Type "${join(here, 'run.sh')} ${launch}"`, 'Enter', 'Sleep 3s', 'Show',
    // The real Aurora, then the A switch through Off and Subtle and back.
    'Sleep 2.4s', 'Type "A"', 'Sleep 1.2s', 'Type "A"', 'Sleep 1.6s', 'Type "A"', 'Sleep 1s',
    // All four choices, then review, back, the leave confirmation, Stay, and Apply.
    ...nav.flatMap(key => [key, 'Sleep 1.7s']), 'Type "1"', 'Sleep 1.2s', 'Enter', 'Sleep 2s', 'Escape', 'Sleep 1s',
    'Escape', 'Sleep 1.6s', 'Escape', 'Sleep 1s', 'Enter', 'Sleep 1.4s', 'Enter', 'Sleep 3.4s', 'Hide', 'Type "q"', 'Sleep 200ms',
  ].join('\n');
  writeFileSync(join(work, 'clip.tape'), `Output "${frames}/"\n${settings(SIZES.standard)}\n${body}\n`);
  const run = spawnSync('vhs', [join(work, 'clip.tape')], {cwd: here, encoding: 'utf8'});
  if (run.status !== 0) throw new Error(`vhs clip: ${run.stdout.slice(-800)}`);
  const dir = join(captureRoot, concept);
  mkdirSync(dir, {recursive: true});
  const inputs = ['-framerate', String(FPS), '-i', join(frames, 'frame-text-%05d.png'), '-framerate', String(FPS), '-i', join(frames, 'frame-cursor-%05d.png')];
  const filter = `[0][1]overlay,pad=iw+${PAD * 2}:ih+${PAD * 2}:${PAD}:${PAD}:color=${BACKGROUND},format=yuv420p`;
  const out = join(dir, 'motion.mp4');
  const encode = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', filter, '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', out], {encoding: 'utf8'});
  if (encode.status !== 0) throw new Error(`ffmpeg clip: ${encode.stderr}`);
  rmSync(work, {recursive: true, force: true});
  console.log(`${concept}/motion.mp4`);
}

if (process.argv[2] === 'skylab') { still('lab', ['sky-bands', 'wide', '--concept sky']); process.exit(0); }
const [concept, ...rest] = process.argv.slice(2);
if (!concept) throw new Error('usage: capture.mjs <horizon|stage|prompt> [--clip] [--only name,name]');
if (rest.includes('--clip')) clip(concept);
else {
  const only = rest.includes('--only') ? rest[rest.indexOf('--only') + 1].split(',') : undefined;
  for (const shot of shots(concept)) if (!only || only.includes(shot[0])) still(concept, shot);
}
