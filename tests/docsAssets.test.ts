import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {IDLE_MODES} from '../src/idle/scenes.js';

/**
 * Lightweight documentation integrity: local links and media resolve, every
 * published clip has its committed VHS source, and nothing personal leaks into
 * docs, tapes or vector art. Prose is not parsed.
 */
const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const markdown = ['README.md', 'ARCHITECTURE.md', 'CHANGELOG.md', 'ROADMAP.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SUPPORT.md',
  'docs/demos.md', 'docs/design/keep-awake.md', 'docs/design/theme-bridge.md', 'scripts/demos/README.md', 'dev/tapes/README.md']
  .filter(path => existsSync(join(root, path)));
const tapes = readdirSync(join(root, 'scripts/demos')).filter(name => name.endsWith('.tape') && name !== 'settings.tape');

test('local links and images in the main docs resolve', () => {
  for (const file of markdown) {
    const text = read(file);
    const targets = [...text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/gu), ...text.matchAll(/src="([^"]+)"/gu)].map(match => match[1]!)
      .filter(target => !/^(?:https?:|mailto:|\.\.\/\.\.\/issues)/u.test(target) && /(?:\.[A-Za-z]+|\/)$/u.test(target));
    for (const target of targets) assert.ok(existsSync(resolve(root, dirname(file), target)), `${file} → ${target}`);
  }
});

test('every published clip and still has a committed VHS tape that produces it', () => {
  const produced = new Set(tapes.flatMap(name => {
    const text = read(`scripts/demos/${name}`);
    return [...text.matchAll(/^Output "?([^"\s]+)"?$/gmu), ...text.matchAll(/^# demo-still: (\S+) /gmu)].map(match => match[1]!);
  }));
  for (const output of produced) assert.ok(existsSync(join(root, output)), `${output} is missing; run npm run demos`);
  const media = readdirSync(join(root, 'assets/readme')).filter(name => /\.(?:gif|png|webm|mp4)$/u.test(name));
  for (const name of media) assert.ok(produced.has(`assets/readme/${name}`), `assets/readme/${name} has no tape in scripts/demos`);
  assert.ok(read('README.md').includes('assets/readme/nmsh-demo.gif') && produced.has('assets/readme/nmsh-demo.gif'));
});

test('demo GIFs are complete, wide and tall; every named screensaver has a tape', () => {
  for (const name of tapes) {
    const source = read(`scripts/demos/${name}`);
    const output = /^Output (\S+\.gif)$/mu.exec(source)?.[1];
    assert.ok(output, name);
    const bytes = readFileSync(join(root, output));
    assert.match(bytes.subarray(0, 6).toString(), /^GIF8[79]a$/u, output);
    assert.ok(bytes.readUInt16LE(6) >= 1300 && bytes.readUInt16LE(8) >= 900, `${output} is cramped`);
    assert.equal(bytes.at(-1), 0x3b, `${output} is truncated`);
  }
  const recorded = new Set(tapes.flatMap(name => [...read(`scripts/demos/${name}`).matchAll(/\/screensaver start (\w+)/gu)].map(match => match[1])));
  for (const mode of IDLE_MODES.filter(mode => mode !== 'random')) assert.ok(recorded.has(mode), `${mode} needs showcase coverage`);
  assert.match(read('scripts/demos/render.mjs'), /NMSH_DEMO: '1'/u);
  assert.ok(!read('scripts/demos/settings.tape').includes('Set WindowBar Colorful'));
});

test('promo has a reproducible local composition and usable video/poster assets', () => {
  assert.ok(readFileSync(join(root, 'assets/promo/nmsh-promo.mp4')).length > 10000);
  assert.ok(readFileSync(join(root, 'assets/promo/nmsh-promo.png')).length > 10000);
  assert.match(read('scripts/demos/promo.mjs'), /xfade=transition/u);
  assert.match(read('package.json'), /"promo"/u);
});

test('docs, tapes and vector art carry no personal paths, hosts or secrets', () => {
  const files = [...markdown, 'llms.txt', ...tapes.map(name => `scripts/demos/${name}`), 'scripts/demos/settings.tape', 'scripts/demos/render.mjs',
    ...readdirSync(join(root, 'assets/readme')).filter(name => name.endsWith('.svg')).map(name => `assets/readme/${name}`)];
  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /\/Users\/(?!<|\.\.\.)[A-Za-z]|\/home\/(?!<)[a-z]/u, `${file} names a real home directory`);
    assert.doesNotMatch(text, /(?:ghp_|github_pat_|sk-[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/u, `${file} looks like it contains a secret`);
  }
  // The demo identity is neutral by construction.
  const render = read('scripts/demos/render.mjs');
  assert.match(render, /USER: 'demo'/u);
  assert.match(render, /demo@example\.com/u);
});
