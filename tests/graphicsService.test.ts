import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {BASELINE_CAPABILITIES, resolveHostCapabilities, type TerminalCapabilities} from '../src/host/capabilities.js';
import {resolveProbeReplies} from '../src/host/probe.js';
import {decideGraphics, type GraphicsDecision} from '../src/graphics/capabilities.js';
import {containsKittyBytes, PLACEHOLDER_CHAR} from '../src/graphics/kittyPlaceholder.js';
import {encodePng} from '../src/graphics/pngEncode.js';
import {ImageError, type Raster} from '../src/graphics/raster.js';
import {GraphicsService, cropRaster, type GraphicsHost} from '../src/graphics/service.js';
import type {ColorLevel} from '../src/presentation/capabilities.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {containsImageBytes} from '../src/presentation/ImageSurface.js';

const KITTY_OK = '\u001b_Gi=31;OK\u001b\\';

function raster(width: number, height: number, paint = (x: number, y: number): [number, number, number, number] => [x * 255 / Math.max(1, width - 1), y * 255 / Math.max(1, height - 1), 128, 255]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(paint(x, y), (y * width + x) * 4);
  return {width, height, data};
}

function fixture(options: {env?: NodeJS.ProcessEnv; replies?: string; mode?: GraphicsDecision extends never ? never : 'auto' | 'kitty' | 'iterm2' | 'sixel' | 'unicode' | 'off'; color?: ColorLevel; safe?: boolean; limits?: Partial<ConstructorParameters<typeof GraphicsService>[1]>} = {}) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'gfx-'));
  const env = options.env ?? {TERM_PROGRAM: 'ghostty'};
  const hints = resolveHostCapabilities(env);
  const capabilities: TerminalCapabilities = options.replies !== undefined ? resolveProbeReplies(options.replies, hints, {extended: true}).capabilities : resolveProbeReplies(KITTY_OK, hints, {extended: true}).capabilities;
  const sent: string[] = [];
  const host: GraphicsHost = {
    decision: () => decideGraphics({capabilities, env, mode: options.mode ?? 'auto', color: options.color ?? 'truecolor', safeGlyphs: options.safe ?? false, columns: 100, rows: 40}),
    send: data => { sent.push(data); },
    scratchDir: () => join(dir, 'scratch'),
    color: () => options.color ?? 'truecolor',
    safeGlyphs: () => options.safe ?? false,
  };
  const service = new GraphicsService(host, options.limits);
  const write = (name: string, image: Raster) => { const file = join(dir, name); writeFileSync(file, encodePng(image)); return file; };
  return {dir, sent, service, write, done: () => rmSync(dir, {recursive: true, force: true})};
}

test('references: remote, data and escaping paths are refused; local ones resolve inside the root', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.dir, 'docs', 'img'), {recursive: true});
    mkdirSync(join(f.dir, 'outside'));
    writeFileSync(join(f.dir, 'docs', 'img', 'a b.png'), encodePng(raster(2, 2)));
    writeFileSync(join(f.dir, 'outside', 'secret.png'), encodePng(raster(2, 2)));
    symlinkSync(join(f.dir, 'outside'), join(f.dir, 'docs', 'link'));
    const base = join(f.dir, 'docs');
    const root = join(f.dir, 'docs');
    const ok = await GraphicsService.resolveReference('img/a%20b.png?raw=1#x', base, root);
    assert.ok(ok.endsWith('docs/img/a b.png'));
    for (const bad of ['https://example.com/x.png', 'http://x/y.png', 'data:image/png;base64,AAAA', 'file:///etc/passwd', 'ftp://x/y.png', '//host/x.png', '']) {
      await assert.rejects(GraphicsService.resolveReference(bad, base, root), (error: unknown) => error instanceof ImageError && error.code === 'unsafe', bad);
    }
    await assert.rejects(GraphicsService.resolveReference('../outside/secret.png', base, root), /outside this document/u);
    await assert.rejects(GraphicsService.resolveReference('link/secret.png', base, root), /outside this document/u, 'a symlink out of the root is followed to its real place and refused');
    await assert.rejects(GraphicsService.resolveReference(join(f.dir, 'outside', 'secret.png'), base, root), /outside this document/u);
    await assert.rejects(GraphicsService.resolveReference('missing.png', base, root), (error: unknown) => error instanceof ImageError && error.code === 'unavailable');
    assert.ok((await GraphicsService.resolveReference('../outside/secret.png', base, f.dir)).endsWith('outside/secret.png'), 'a wider root allows it');
  } finally { f.done(); }
});

test('load: decodes, caches by file identity, reduces big images, refuses non-images', async () => {
  const f = fixture({limits: {storeLongSide: 64, cacheImages: 2}});
  try {
    const small = f.write('small.png', raster(8, 4));
    const big = f.write('big.png', raster(200, 100));
    const a = await f.service.load(small);
    assert.deepEqual([a.info.format, a.info.width, a.info.height, a.raster.width], ['png', 8, 4, 8]);
    assert.equal(await f.service.load(small), a, 'the same file is served from the cache');
    const b = await f.service.load(big);
    assert.deepEqual([b.info.width, b.raster.width, b.raster.height], [200, 64, 32], 'stored reduced, header keeps the real size');
    writeFileSync(small, encodePng(raster(8, 4, () => [1, 2, 3, 255])));
    const future = new Date(Date.now() + 5000);
    utimesSync(small, future, future);
    assert.notEqual(await f.service.load(small), a, 'a changed file is decoded again');
    assert.ok(f.service.stats().cached <= 2, 'the cache keeps at most two images');
    writeFileSync(join(f.dir, 'not.png'), 'just text');
    await assert.rejects(f.service.load(join(f.dir, 'not.png')), (error: unknown) => error instanceof ImageError && error.code === 'unsupported');
    writeFileSync(join(f.dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await assert.rejects(f.service.load(join(f.dir, 'icon.svg')), /SVG is not rendered/u);
  } finally { f.done(); }
});

test('Kitty: an inline image is uploaded once, placed as placeholders, shared by owners and deleted when the last owner leaves', async () => {
  const f = fixture();
  try {
    const image = await f.service.load(f.write('logo.png', raster(160, 80)));
    const owner = {};
    const placement = f.service.place(image, {columns: 20, rows: 10, owner, surface: 'inline'});
    assert.equal(placement.kind, 'kitty-placeholder');
    assert.equal(placement.lines.length, placement.rows);
    assert.deepEqual([placement.columns, placement.rows], [20, 5], '160x80 px at 8x16 cells is 20x5 cells');
    for (const line of placement.lines) { assert.equal(displayWidth(line), 20); assert.ok(line.includes(PLACEHOLDER_CHAR)); }
    assert.equal(f.sent.length, 1);
    assert.match(f.sent[0]!, /\u001b_Ga=t,f=100,t=d,i=\d+,q=2/u, 'uploaded as PNG');
    assert.match(f.sent[0]!, /\u001b_Ga=p,U=1,i=\d+,c=20,r=5,q=2/u, 'with a virtual placement');
    f.service.place(image, {columns: 20, rows: 10, owner, surface: 'inline'});
    assert.equal(f.sent.length, 1, 'the same box is not uploaded again');
    const other = {};
    f.service.place(image, {columns: 20, rows: 10, owner: other, surface: 'inline'});
    f.service.releaseOwner(owner);
    assert.equal(f.sent.length, 1, 'another owner still shows it');
    f.service.releaseOwner(other);
    assert.equal(f.sent.length, 2);
    assert.match(f.sent[1]!, /^\u001b_Ga=d,d=I,i=\d+,q=2\u001b\\$/u, 'deleted, with its data');
    assert.equal(f.service.stats().uploads, 0);
  } finally { f.done(); }
});

test('Kitty: upload memory is capped, the oldest upload is deleted first, and releaseAll empties the terminal', async () => {
  const f = fixture({limits: {uploadBytes: 1000}});
  try {
    const image = await f.service.load(f.write('noise.png', raster(64, 64, (x, y) => [(x * 37 + y * 11) & 255, (x * 5) & 255, (y * 91) & 255, 255])));
    const owner = {};
    f.service.place(image, {columns: 8, rows: 4, owner, surface: 'inline'});
    assert.equal(f.service.stats().uploads, 1);
    f.service.place(image, {columns: 6, rows: 3, owner, surface: 'inline'});
    assert.equal(f.service.stats().uploads, 1, 'the second upload did not fit beside the first, which was deleted');
    assert.ok(f.sent.some(chunk => chunk.includes('a=d,d=I')), 'older uploads were deleted to stay under the cap');
    f.service.releaseAll();
    assert.equal(f.service.stats().uploads, 0);
    const before = f.sent.length;
    f.service.forgetUploads();
    assert.equal(f.sent.length, before, 'forgetting sends nothing');
  } finally { f.done(); }
});

test('character art: Zed, tmux, NO_COLOR and forced Unicode draw rows of exactly the placed width and emit no graphics bytes', async () => {
  const cases: Array<[string, Parameters<typeof fixture>[0]]> = [
    ['zed', {env: {TERM_PROGRAM: 'zed'}, replies: ''}],
    ['tmux', {env: {TERM_PROGRAM: 'ghostty', TMUX: '/tmp/x,1,0'}}],
    ['no color', {color: 'none'}],
    ['forced unicode', {mode: 'unicode'}],
    ['safe glyphs on a terminal without graphics', {env: {TERM_PROGRAM: 'zed'}, replies: '', safe: true}],
    ['ansi16', {color: 'ansi16', env: {TERM_PROGRAM: 'zed'}, replies: ''}],
  ];
  for (const [name, options] of cases) {
    const f = fixture(options);
    try {
      const image = await f.service.load(f.write('photo.png', raster(240, 120)));
      const placement = f.service.place(image, {columns: 30, rows: 12, owner: {}, surface: 'inline'});
      assert.equal(placement.kind, 'character-art', name);
      assert.equal(placement.lines.length, placement.rows, name);
      for (const line of placement.lines) assert.equal(displayWidth(stripAnsi(line)), placement.columns, name);
      assert.equal(f.sent.length, 0, `${name}: nothing was written to the terminal`);
      assert.equal(placement.lines.some(line => containsKittyBytes(line) || containsImageBytes(line)), false, name);
      if (name.startsWith('safe glyphs')) assert.ok(placement.lines.every(line => /^[\x20-\x7e]*$/u.test(stripAnsi(line))), 'Safe Glyphs: printable ASCII only');
    } finally { f.done(); }
  }
});

test('off: a placeholder line names the image; nothing is decoded into cells or sent', async () => {
  const f = fixture({mode: 'off'});
  try {
    const image = await f.service.load(f.write('x.png', raster(10, 10)));
    const placement = f.service.place(image, {columns: 20, rows: 10, owner: {}, surface: 'inline'});
    assert.deepEqual([placement.kind, placement.lines], ['text', ['[image: x.png]']]);
    assert.equal(f.sent.length, 0);
  } finally { f.done(); }
});

test('viewer surface: iTerm2 and Sixel give overlays the app positions; zoom crops; small images are not enlarged unless asked', async () => {
  const iterm = fixture({env: {TERM_PROGRAM: 'iTerm.app'}, replies: ''});
  try {
    const image = await iterm.service.load(iterm.write('p.png', raster(160, 80)));
    const placement = iterm.service.place(image, {columns: 60, rows: 30, owner: {}, surface: 'viewer'});
    assert.equal(placement.kind, 'overlay');
    assert.match(placement.overlay!.place, /\u001b\]1337;File=/u);
    assert.deepEqual([placement.columns, placement.rows], [20, 5], 'not enlarged beyond its own pixels');
    const enlarged = iterm.service.place(image, {columns: 60, rows: 30, owner: {}, surface: 'viewer', upscale: true});
    assert.ok(enlarged.columns > 20);
    const zoomed = iterm.service.place(image, {columns: 60, rows: 30, owner: {}, surface: 'viewer', crop: {x: 0, y: 0, width: 0.5, height: 0.5}});
    assert.deepEqual([zoomed.columns, zoomed.rows], [10, 3]);
    assert.notEqual(zoomed.overlay!.key, placement.overlay!.key);
  } finally { iterm.done(); }
  const sixel = fixture({env: {TERM_PROGRAM: 'unknown'}, replies: '\u001b[?62;4c'});
  try {
    const image = await sixel.service.load(sixel.write('p.png', raster(32, 32)));
    const placement = sixel.service.place(image, {columns: 20, rows: 10, owner: {}, surface: 'viewer'});
    assert.equal(placement.kind, 'overlay');
    assert.match(placement.overlay!.place, /^\u001bP0;/u);
    assert.equal(sixel.sent.length, 0, 'an overlay is written by the renderer, not by the service');
    const inline = sixel.service.place(image, {columns: 20, rows: 10, owner: {}, surface: 'inline'});
    assert.equal(inline.kind, 'character-art', 'Sixel is a standalone surface only; documents get character art');
  } finally { sixel.done(); }
});

test('cropRaster clamps and copies exactly the region', () => {
  const source = raster(4, 4, (x, y) => [x * 10 + y, 0, 0, 255]);
  const piece = cropRaster(source, {x: 0.5, y: 0.5, width: 0.5, height: 0.5});
  assert.deepEqual([piece.width, piece.height], [2, 2]);
  assert.equal(piece.data[0], 2 * 10 + 2);
  assert.equal(cropRaster(source, {x: 0, y: 0, width: 1, height: 1}), source);
  const clamped = cropRaster(source, {x: 0.9, y: 0.9, width: 5, height: 5});
  assert.ok(clamped.width >= 1 && clamped.height >= 1 && clamped.width <= 4);
  void BASELINE_CAPABILITIES;
});
