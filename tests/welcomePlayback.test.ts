import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import zlib from 'node:zlib';
import {encodeGif} from './support/gifEncoder.js';
import {chunk, concat, ihdr, PNG_SIGNATURE} from './support/pngEncoder.js';
import {encodePng} from '../src/graphics/pngEncode.js';
import {GraphicsService} from '../src/graphics/service.js';
import type {GraphicsDecision} from '../src/graphics/capabilities.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {normalizeWelcomeStudio, type WelcomeStudio} from '../src/welcome/model.js';
import {WelcomeStudioController, type StudioHost} from '../src/welcome/studio.js';
import {NativeWelcomePresentation} from '../src/welcome/startup.js';
import {loadWelcomeAsset} from '../src/welcome/assets.js';
import {presentationClock} from '../src/motion/PresentationClock.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';

const key = (value: string) => ({kind: 'text' as const, value});
const snapshot = (model: WelcomeStudio) => ({identity: {version: '1', commit: 'abc'}, cwd: '.', shell: 'zsh' as const, studio: model, facts: {shell: 'zsh', version: '1'}});
function host(dir: string, model: Partial<WelcomeStudio> = {}, graphics = false): StudioHost {
  const config = normalizePromptConfiguration({welcomeStudio: {customized: true, ...model}});
  const decision: GraphicsDecision = {backend: graphics ? 'kitty' : 'unicode', evidence: graphics ? 'query' : 'none', inline: graphics ? 'placeholder' : 'unicode', unicode: 'half', cell: {width: 8, height: 16, source: 'estimated'}, reason: 'Character art: no verified inline graphics.'};
  const service = new GraphicsService({decision: () => decision, send: () => {}, scratchDir: () => dir, color: () => 'truecolor', safeGlyphs: () => false});
  return {config: () => config, cwd: () => dir, scratch: () => dir, graphics: () => service, decision: () => decision,
    facts: () => ({shell: 'zsh', version: '1'}), capabilities: () => ({color: true}), background: () => ({red: 0, green: 0, blue: 0}), save: () => true, render: () => {}, close: () => {}};
}
function gif(count = 2, plays = 0): Uint8Array {
  const palette = [[255, 0, 0], [0, 0, 255]];
  const header = encodeGif({width: 1, height: 1, palette, frames: []});
  const parts = [header.subarray(0, -1), Uint8Array.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, plays, 0, 0])];
  for (let i = 0; i < count; i++) {
    const encoded = encodeGif({width: 1, height: 1, palette, frames: [{width: 1, height: 1, indices: [i % 2]}]});
    const body = encoded.slice(header.length - 1, -1);
    body[4] = i % 2 ? 20 : 10; body[5] = 0;
    parts.push(body);
  }
  return concat([...parts, Uint8Array.of(0x3b)]);
}
function apng(): Uint8Array {
  const actl = Buffer.alloc(8); actl.writeUInt32BE(2); actl.writeUInt32BE(2, 4);
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr(1, 1, 8, 6)), chunk('acTL', actl)];
  for (let i = 0; i < 2; i++) {
    const control = Buffer.alloc(26); control.writeUInt32BE(i ? 1 : 0); control.writeUInt32BE(1, 4); control.writeUInt32BE(1, 8);
    control.writeUInt16BE(i ? 2 : 1, 20); control.writeUInt16BE(10, 22);
    parts.push(chunk('fcTL', control));
    const pixels = zlib.deflateSync(Uint8Array.from([0, i ? 0 : 255, 0, i ? 255 : 0, 255]));
    const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
    parts.push(chunk(i ? 'fdAT' : 'IDAT', i ? concat([sequence, pixels]) : pixels));
  }
  return concat([...parts, chunk('IEND', new Uint8Array())]);
}
async function fixtures(dir: string): Promise<void> {
  await writeFile(join(dir, 'a.gif'), gif()); await writeFile(join(dir, 'a.apng'), apng());
  await writeFile(join(dir, 'a.png'), encodePng({width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255])}));
  await writeFile(join(dir, 'a.ans'), '\x1b[31mCAT\x1b[0m');
}

test('P preview and startup share actual presentation frames/placements for every draft, width, capability and elapsed time', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-parity-'));
  const count = presentationClock.subscriberCount;
  try {
    await fixtures(dir);
    for (const graphics of [false, true]) for (const assetPath of ['a.png', 'a.gif', 'a.apng', 'a.ans', 'missing.png', 'external']) {
      const model = {logo: assetPath.endsWith('.ans') ? 'art' as const : 'image' as const, assetPath};
      const a = host(dir, model, graphics), b = host(dir, model, graphics);
      const studio = new WelcomeStudioController(a);
      await studio.start();
      if (assetPath === 'external') { studio.state.provider = 'fastfetch'; studio.state.captured = ['provider rows']; }
      const saved = snapshot(studio.state.draft);
      if (assetPath === 'external') Object.assign(saved, {captured: ['provider rows']});
      const startup = new NativeWelcomePresentation(saved, b.graphics(), b.capabilities, b.background);
      try {
        await startup.load(dir, dir); await studio.key(key('p'));
        assert.ok(studio.fullPreview);
        const full = studio['full']!;
        for (const width of [40, 80, 120]) for (const time of [0, 99, 100, 299, 300, 599, 600, 5000, 7000]) {
          const reason = graphics ? undefined : a.decision().reason;
          const startupFrame = startup.frame(width, 40, time, reason);
          const previewFrame = full.frame(width, 40, time, reason);
          assert.deepEqual(previewFrame, startupFrame, `${assetPath}, ${width}, ${graphics}, ${time}`);
        }
      } finally { startup.dispose(); studio.dispose(); assert.equal(a.graphics().stats().uploads, 0); assert.equal(b.graphics().stats().uploads, 0); }
    }
    assert.equal(presentationClock.subscriberCount, count);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('decoded delays and finite loops settle; indefinite playback stops at five seconds; truncation is a noted frame-zero still', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-delays-'));
  const count = presentationClock.subscriberCount;
  try {
    await fixtures(dir); await writeFile(join(dir, 'limited.gif'), gif(76));
    for (const [file, end] of [['a.gif', 5000], ['a.apng', 600], ['limited.gif', 0]] as const) {
      const h = host(dir, {logo: 'image', assetPath: file, effect: file === 'limited.gif' ? 'float' : 'original'});
      const native = new NativeWelcomePresentation(snapshot(h.config().welcomeStudio), h.graphics(), h.capabilities, h.background);
      await native.load(dir, dir);
      try {
        if (end) {
          assert.equal(native.frame(80, 40, 99).frameIndex, 0);
          assert.equal(native.frame(80, 40, 100).frameIndex, 1);
          assert.equal(native.frame(80, 40, 299).frameIndex, 1);
          assert.equal(native.frame(80, 40, 300).frameIndex, 0);
          assert.equal(native.frame(80, 40, end).frameIndex, 1);
          assert.equal(native.frame(80, 40, end).active, false);
          assert.equal(presentationClock.subscriberCount, count);
        } else {
          const frame = native.frame(80, 40, 200);
          assert.equal(frame.frameIndex, 0); assert.equal(frame.active, false);
          assert.match(frame.rows.map(r => r.plain).join(''), /75 frames.*32 MiB.*5 s/);
        }
      } finally { native.dispose(); }
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('Reduced Motion, Effects Off and no color hold decoded frame zero without a subscription', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-gates-'));
  const count = presentationClock.subscriberCount;
  try {
    await fixtures(dir);
    for (const gate of [{reducedMotion: true}, {effectsOff: true}, {color: false}]) {
      const h = host(dir, {logo: 'image', assetPath: 'a.gif', effect: 'float'});
      const native = new NativeWelcomePresentation(snapshot(h.config().welcomeStudio), h.graphics(), () => ({color: true, ...gate}), h.background);
      await native.load(dir, dir);
      try {
        const first = native.frame(80, 40, 0);
        assert.deepEqual(native.frame(80, 40, 400), first);
        assert.equal(first.frameIndex, 0); assert.equal(presentationClock.subscriberCount, count);
      } finally { native.dispose(); }
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('only a portable final still is serialized; input frees playback uploads/timers, cannot restart them and keeps the native still', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-still-'));
  const count = presentationClock.subscriberCount;
  try {
    await fixtures(dir);
    const h = host(dir, {logo: 'image', assetPath: 'a.gif'}, true), saved = snapshot(h.config().welcomeStudio);
    const native = new NativeWelcomePresentation(saved, h.graphics(), h.capabilities, h.background);
    await native.load(dir, dir);
    const output = new OutputBuffer(); output.setWelcome(saved);
    output.presenter.welcomePainter = (snapshot, width) => native.rows(snapshot, width);
    try {
      native.frame(80, 40, 0); output.wrapped(80); const before = output.transcript();
      assert.ok(h.graphics().stats().uploads > 0);
      native.frame(80, 40, 150);
      assert.deepEqual(output.transcript(), before, 'runtime animation never mutates transcript frames');
      assert.doesNotMatch(JSON.stringify(before), /assetPath|a.gif|frameIndex|iVBOR|\\u001b_G/);
      assert.ok(before.welcome?.still?.length);
      native.cancelMotion(); assert.equal(h.graphics().stats().uploads, 0, 'playback frames are deleted at once');
      native.frame(80, 40, 200);
      assert.equal(h.graphics().stats().uploads, 1, 'the still stays a native image'); assert.equal(presentationClock.subscriberCount, count);
    } finally { native.dispose(); }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('all P exit keys swallow input and preserve draft/selection; disposal releases terminal objects and subscriptions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-exits-'));
  const count = presentationClock.subscriberCount;
  try {
    await fixtures(dir);
    for (const exit of [key('s'), key('x'), {kind: 'escape' as const}, {kind: 'enter' as const}, {kind: 'paste' as const, value: 'echo secret'}]) {
      const h = host(dir, {logo: 'image', assetPath: 'a.gif'}, true);
      let saves = 0; h.save = () => { saves++; return true; };
      const studio = new WelcomeStudioController(h); await studio.start(); studio.state.selected = 6;
      const draft = structuredClone(studio.state.draft);
      try {
        await studio.key(key('p')); studio.renderPreview(80, 24);
        assert.ok(h.graphics().stats().uploads > 0);
        await studio.key(exit); assert.equal(studio.fullPreview, false);
        assert.deepEqual(studio.state.draft, draft); assert.equal(studio.state.selected, 6); assert.equal(saves, 0);
        assert.equal(h.graphics().stats().uploads, 0); assert.equal(presentationClock.subscriberCount, count);
        await studio.key(key('p')); studio.renderPreview(80, 24); studio.dispose();
        assert.equal(h.graphics().stats().uploads, 0); assert.equal(presentationClock.subscriberCount, count);
      } finally { studio.dispose(); }
    }
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('TerminalApp owns fullscreen preview, swallows whole input batches, ends on resize, handover, detach and shutdown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-app-preview-'));
  const previous = process.env.XDG_CONFIG_HOME; process.env.XDG_CONFIG_HOME = dir;
  try {
    await fixtures(dir);
    for (const exit of ['input', 'escape', 'resize', 'handover', 'detach', 'shutdown'] as const) {
      const app = new TerminalApp(), writes: string[] = [];
      app['renderer'] = new TerminalRenderer(data => writes.push(data));
      Object.defineProperty(app, 'render', {value: () => {}});
      app['promptConfiguration'].welcomeStudio = normalizeWelcomeStudio({logo: 'image', assetPath: join(dir, 'a.gif')});
      app['openWelcomeStudio'](); const studio = app['welcomeStudio']!; await studio.start();
      const baseline = presentationClock.subscriberCount;
      const draft = structuredClone(studio.state.draft), shell = app['session'];
      try {
        await studio.key(key('p')); studio.renderPreview(80, 24);
        assert.ok(writes.some(data => data.includes('\x1b[?1049h')), 'existing renderer owns alternate screen');
        assert.equal(app['session'], shell);
        studio['full']!['now'] = () => 0; studio['full']!['started'] = 0;
        TerminalApp.prototype['render'].call(app);
        const previewRows = studio.renderPreview(80, 24);
        assert.deepEqual(app['renderer'].snapshot().slice(0, previewRows.length), previewRows);
        const screen = app['renderer'].snapshot();
        app['paintPresentation'](Date.now()); app['renderPresentation'](Date.now()); app['renderTaskPresentation']();
        assert.deepEqual(app['renderer'].snapshot(), screen, 'shell/panel clocks cannot overpaint the full preview');
        if (exit === 'input' || exit === 'escape') app['handleDecodedKeys']([exit === 'escape' ? {kind: 'escape'} : key('s'), key('s'), {kind: 'enter'}]);
        else if (exit === 'resize') app['onResize']();
        else if (exit === 'handover') app['handOverTerminal']();
        else if (exit === 'detach') app['onTerminate']();
        else app['stop'](0);
        assert.equal(studio.fullPreview, false); assert.deepEqual(studio.state.draft, draft);
        assert.equal(app['editor'].text, ''); assert.equal(app['running'], undefined);
        assert.equal(app['graphicsService']().stats().uploads, 0);
        assert.ok(presentationClock.subscriberCount <= baseline);
      } finally { app['stop'](0); app['session'].kill(); }
    }
  } finally { if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; await rm(dir, {recursive: true, force: true}); }
});

test('startup readiness never waits for asset loading or playback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-ready-'));
  const previous = process.env.XDG_CONFIG_HOME; process.env.XDG_CONFIG_HOME = dir;
  const original = NativeWelcomePresentation.prototype.load;
  let finish!: () => void;
  NativeWelcomePresentation.prototype.load = () => new Promise<void>(resolve => { finish = resolve; });
  const app = new TerminalApp(); Object.defineProperty(app, 'render', {value: () => {}});
  try {
    app['promptConfiguration'].welcomeStudio = normalizeWelcomeStudio({logo: 'image', assetPath: 'pending.gif', effect: 'float'});
    app['startWelcome'](dir);
    assert.ok(app['nativeWelcome']); assert.ok(finish);
    app['handleKey'](key('x')); assert.equal(app['editor'].text, 'x', 'composer accepts input while loading is unresolved');
    app['nativeWelcome']!.frame(80, 40, 100);
    assert.equal(app['running'], undefined);
  } finally { finish?.(); NativeWelcomePresentation.prototype.load = original; app['stop'](0); app['session'].kill(); if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; await rm(dir, {recursive: true, force: true}); }
});


test('the shared sequencer requests decoded boundaries and removes its last subscription at the finite end', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-schedule-'));
  const original = presentationClock.subscribe;
  let pending: ((now: number) => void) | undefined;
  const intervals: number[] = [];
  let time = 0;
  presentationClock.subscribe = (callback, interval) => {
    assert.equal(pending, undefined, 'at most one scheduled frame');
    intervals.push(interval!); pending = callback;
    return () => { pending = undefined; };
  };
  try {
    await fixtures(dir);
    const h = host(dir, {logo: 'image', assetPath: 'a.apng'}), seen: (number | undefined)[] = [];
    const native = new NativeWelcomePresentation(snapshot(h.config().welcomeStudio), h.graphics(), h.capabilities, h.background,
      () => { seen.push(native.frame(80).frameIndex); }, undefined, () => time);
    try {
      await native.load(dir, dir); seen.push(native.frame(80).frameIndex);
      for (const next of [100, 300, 400, 600]) { time = next; assert.ok(pending); const tick = pending; tick(time); }
      assert.deepEqual(intervals, [100, 200, 100, 200]);
      assert.deepEqual(seen, [0, 1, 0, 1, 1]); assert.equal(pending, undefined);
    } finally { native.dispose(); }
  } finally { presentationClock.subscribe = original; await rm(dir, {recursive: true, force: true}); }
});

test('startup frees playback uploads and timers on input, Esc, resize, history detach, handover, frontend detach and shutdown', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-startup-exits-'));
  const previous = process.env.XDG_CONFIG_HOME; process.env.XDG_CONFIG_HOME = dir;
  try {
    await fixtures(dir);
    for (const exit of ['input', 'escape', 'resize', 'history', 'handover', 'detach', 'shutdown'] as const) {
      const app = new TerminalApp(); Object.defineProperty(app, 'render', {value: () => {}});
      const h = host(dir, {logo: 'image', assetPath: join(dir, 'a.gif')}, true);
      app['graphics'] = h.graphics(); app['promptConfiguration'].welcomeStudio = h.config().welcomeStudio;
      const count = presentationClock.subscriberCount;
      try {
        app['startWelcome'](dir); const native = app['nativeWelcome']!; await native.load(dir, dir);
        app['output'].wrapped(80);
        assert.ok(h.graphics().stats().uploads > 0); assert.equal(presentationClock.subscriberCount, count + 1);
        if (exit === 'input') app['handleKey'](key('x'));
        else if (exit === 'escape') app['handleKey']({kind: 'escape'});
        else if (exit === 'resize') app['onResize']();
        else if (exit === 'history') app['scrollLines'](-1);
        else if (exit === 'handover') app['handOverTerminal']();
        else if (exit === 'detach') app['onTerminate']();
        else app['stop'](0);
        // Scrolling repaints at once: the still is back as one native upload; every other exit repaints later.
        assert.equal(h.graphics().stats().uploads, exit === 'history' ? 1 : 0, exit); assert.equal(presentationClock.subscriberCount, count);
        if (!app['stopped']) {
          app['output'].wrapped(80);
          // Playback cannot restart; the repaint shows the still as a native image (one upload), never character art.
          assert.equal(h.graphics().stats().uploads, 1, exit); assert.equal(presentationClock.subscriberCount, count);
        }
      } finally { app['stop'](0); app['session'].kill(); }
    }
  } finally { if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous; await rm(dir, {recursive: true, force: true}); }
});

test('bounded decoder admission is retained and archived stills are SGR-only under NO_COLOR too', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-budget-'));
  try {
    await writeFile(join(dir, 'limited.gif'), gif(76));
    const asset = await loadWelcomeAsset('limited.gif', dir, dir);
    assert.equal(asset.kind, 'image');
    if (asset.kind === 'image') {
      assert.ok(asset.animation!.truncated);
      assert.ok(asset.animation!.frames.length <= 75);
      assert.ok(asset.animation!.frames.reduce((sum, f) => sum + f.raster.data.byteLength, 0) <= 32 * 1024 * 1024);
      assert.ok(asset.animation!.frames.reduce((sum, f) => sum + f.delayMs, 0) <= 5000);
    }
    const {renderWelcome} = await import('../src/output/Welcome.js');
    const still = {...snapshot(normalizeWelcomeStudio({})), studio: undefined, still: ['\x1b]0;private\x07\x1b_Gbad\x1b\\\x1b[31mCAT\x1b[0m']};
    assert.equal(renderWelcome(still, 80)[0]!.plain, 'CAT');
    const color = process.env.NO_COLOR; process.env.NO_COLOR = '1';
    try { assert.equal(renderWelcome(still, 80)[0]!.ansi, 'CAT'); }
    finally { if (color === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = color; }
  } finally { await rm(dir, {recursive: true, force: true}); }
});


test('P adopts an in-flight asset without a second decode and failed provider capture uses the startup fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'welcome-preview-load-'));
  try {
    await fixtures(dir);
    const h = host(dir, {logo: 'image', assetPath: 'a.gif'});
    const studio = new WelcomeStudioController(h);
    try {
      const loading = studio.start(); await studio.key(key('p')); await loading;
      assert.match(studio.renderPreview(80, 24).join(''), /38;2;255;0;0/);
      await studio.key({kind: 'escape'});
      const path = process.env.PATH; process.env.PATH = dir;
      try {
        studio.state.provider = 'zigfetch'; await studio['providerChanged']();
        await studio.key(key('p'));
        assert.equal(studio['full']!.snapshot.captured, undefined, 'failed capture shares native fallback');
        assert.match(studio.renderPreview(80, 24).join(''), /notMyShell/);
      } finally { process.env.PATH = path; }
    } finally { studio.dispose(); }
  } finally { await rm(dir, {recursive: true, force: true}); }
});
