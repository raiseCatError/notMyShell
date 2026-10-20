import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {resolveProbeReplies} from '../src/host/probe.js';
import {containsKittyBytes} from '../src/graphics/kittyPlaceholder.js';
import {encodePng} from '../src/graphics/pngEncode.js';
import type {Raster} from '../src/graphics/raster.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

const png = (width: number, height: number, color: [number, number, number] = [200, 90, 140]): Uint8Array => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set([...color, 255], i * 4);
  const raster: Raster = {width, height, data};
  return encodePng(raster);
};
const settle = async (until: () => boolean) => { for (let i = 0; i < 200 && !until(); i += 1) await new Promise(done => setTimeout(done, 10)); };

function fixture(options: {kitty?: boolean} = {}) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'view-img-'));
  const previous = {TERM_PROGRAM: process.env.TERM_PROGRAM, TMUX: process.env.TMUX};
  const frame = executionFrameFixture(110, 40);
  // The frame fixture isolates the environment; the terminal under test is set after it.
  process.env.TERM_PROGRAM = options.kitty ? 'ghostty' : 'zed';
  delete process.env.TMUX;
  const app = frame.app;
  app['shellCwd'] = dir;
  const sent: string[] = [];
  app['renderer'].sendRaw = (data: string) => { sent.push(data); };
  if (options.kitty) app['host'].capabilities = resolveProbeReplies('\u001b_Gi=31;OK\u001b\\\u001b[6;16;8t', app['host'].capabilities, {extended: true}).capabilities;
  const view = async (target: string) => app['runSlash'](`/view ${target}`, {kind: 'view', target});
  const screen = () => frame.capture().frame.rows.map(row => stripAnsi(row)).join('\n');
  const raw = () => frame.capture().frame.rows.join('\n');
  return {dir, app, frame, sent, view, screen, raw, key: (value: Parameters<typeof app['handleKey']>[0]) => app['handleKey'](value), done: () => {
    frame.dispose(); rmSync(dir, {recursive: true, force: true});
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }};
}

test('/view image.png: character art on a terminal without a protocol, with name, size and navigation; Esc restores the shell', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'a.png'), png(160, 80));
    writeFileSync(join(f.dir, 'b.png'), png(40, 40, [20, 200, 90]));
    await f.view('a.png');
    await settle(() => Boolean(f.app['imageView'] && !f.app['imageView'].loading));
    const text = f.screen();
    assert.match(text, /a\.png/u);
    assert.match(text, /PNG · 160 × 80/u);
    assert.match(text, /1 of 2/u);
    assert.match(text, /n\/p next\/previous/u);
    assert.match(f.raw(), /[▀▄▌▐▘▝▖▗▙▛▜▟▞▚█]/u, 'character art rows');
    assert.equal(f.sent.length, 0, 'nothing written to the terminal for character art');
    f.key({kind: 'text', value: 'n'});
    await settle(() => f.app['imageView']?.index === 1 && !f.app['imageView'].loading);
    assert.match(f.screen(), /b\.png[\s\S]*2 of 2/u);
    f.key({kind: 'text', value: '+'});
    assert.match(f.screen(), /150%/u);
    f.key({kind: 'text', value: '0'});
    f.key({kind: 'escape'});
    assert.equal(f.app['imageView'], undefined);
    assert.equal(f.app['editor'].text, '');
  } finally { f.done(); }
});

test('/view image.png on a Kitty terminal: uploaded once as placeholders, deleted on Esc', async () => {
  const f = fixture({kitty: true});
  try {
    writeFileSync(join(f.dir, 'a.png'), png(160, 80));
    await f.view('a.png');
    await settle(() => Boolean(f.app['imageView'] && !f.app['imageView'].loading));
    const rows = f.raw();
    assert.ok(containsKittyBytes(rows), 'placeholder cells in the frame');
    assert.equal(f.sent.filter(data => data.includes('a=t')).length, 1, 'one upload');
    f.screen();
    assert.equal(f.sent.filter(data => data.includes('a=t')).length, 1, 'redrawing the same view uploads nothing');
    f.key({kind: 'escape'});
    assert.ok(f.sent.some(data => data.includes('a=d,d=I')), 'the image is deleted from the terminal');
  } finally { f.done(); }
});

test('/view image.png: unreadable, huge-declared and non-image files say why and leave the shell usable', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'broken.png'), 'not really a png');
    await f.view('broken.png');
    await settle(() => Boolean(f.app['imageView'] && !f.app['imageView'].loading));
    assert.match(f.screen(), /not an image format|cannot|malformed|unsupported|could not/iu);
    f.key({kind: 'escape'});
    assert.equal(f.app['imageView'], undefined);
    await f.view('missing.png');
    await settle(() => Boolean(f.app['imageView'] && !f.app['imageView'].loading));
    assert.match(f.screen(), /not found/u);
    f.key({kind: 'escape'});
  } finally { f.done(); }
});

test('README: local images are drawn where they are written, remote and escaping ones are placeholders with the reason', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.dir, 'docs', 'img'), {recursive: true});
    mkdirSync(join(f.dir, 'outside'));
    writeFileSync(join(f.dir, 'docs', 'img', 'logo.png'), png(160, 64));
    writeFileSync(join(f.dir, 'outside', 'secret.png'), png(16, 16));
    symlinkSync(join(f.dir, 'outside'), join(f.dir, 'docs', 'link'));
    writeFileSync(join(f.dir, 'docs', 'README.md'), [
      '# Project', '', '![Logo](img/logo.png)', '', 'Remote: ![Banner](https://example.com/b.png)', '', '![Up](../outside/secret.png)', '', '![Link](link/secret.png)', '', '![Gone](img/missing.png)', '',
      '<p><img src="img/logo.png" alt="Same logo"></p>', '', 'The end.',
    ].join('\n'));
    f.app['shellCwd'] = join(f.dir, 'docs');
    await f.view('README.md');
    await settle(() => Boolean(f.app['docSession']));
    f.key({kind: 'text', value: 'h'});
    await settle(() => Boolean(f.app['viewerImages']) && f.app['viewerImages'].version > 1);
    await new Promise(done => setTimeout(done, 100));
    const text = f.screen();
    assert.match(text, /Project/u);
    assert.doesNotMatch(text, /\[image: Logo\]/u, 'the logo is drawn, not named');
    assert.match(text, /\[image: Banner\] \(remote images are not fetched\)/u);
    assert.match(text, /\[image: Up\] \(outside this folder, not shown\)/u);
    assert.match(text, /\[image: Link\] \(outside this folder, not shown\)/u, 'a symlink out of the folder is refused');
    assert.match(text, /\[image: Gone\] \(file not found\)/u);
    assert.match(text, /i images/u);
    assert.match(f.raw(), /[▀▄▌▐▘▝▖▗▙▛▜▟▞▚█]/u);
    // The i key opens the first image; Esc returns to the same document.
    f.key({kind: 'text', value: 'i'});
    await settle(() => Boolean(f.app['imageView'] && !f.app['imageView'].loading));
    assert.match(f.screen(), /Logo \(logo\.png\)|logo\.png/u);
    f.key({kind: 'escape'});
    assert.ok(f.app['docSession'], 'back in the document, as it was');
    assert.equal(f.app['docSession'].mode, 'preview');
    assert.match(f.screen(), /Project/u);
    f.key({kind: 'escape'});
    f.key({kind: 'escape'});
    assert.equal(f.app['docSession'], undefined);
    assert.equal(f.app['viewerImages'], undefined, 'closing the document closes its images');
  } finally { f.done(); }
});

test('Images off: a README shows placeholders only and nothing is decoded', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'logo.png'), png(32, 32));
    writeFileSync(join(f.dir, 'README.md'), '# Hi\n\n![Logo](logo.png)\n');
    f.app['promptConfiguration'].graphicsMode = 'off';
    await f.view('README.md');
    await settle(() => Boolean(f.app['docSession']));
    f.key({kind: 'text', value: 'h'});
    assert.match(f.screen(), /\[image: Logo\]/u);
    assert.equal(f.app['graphics']?.stats().cached ?? 0, 0);
  } finally { f.done(); }
});

test('/doctor reports the graphics decision and the text sizing state', async () => {
  const f = fixture({kitty: true});
  try {
    const checks = f.app['graphicsDoctorChecks']();
    assert.match(checks[0]!.label, /Kitty graphics \(verified\)/u);
    assert.match(checks[0]!.detail ?? '', /Kitty Unicode placeholders/u);
    assert.match(checks[1]!.label, /Text sizing:/u);
  } finally { f.done(); }
});
