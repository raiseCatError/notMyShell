import test from 'node:test';
import assert from 'node:assert/strict';
import type {DiagramLibrary, DiagramRenderer, DiagramRenderRequest, DiagramRenderResult} from '../src/browser/types.js';
import type {LoadedImage} from '../src/graphics/service.js';
import {DiagramService, type DiagramBackend, type DiagramPlacer} from '../src/diagrams/service.js';
import {DocumentDiagrams} from '../src/diagrams/document.js';
import {MERMAID_LIMITS} from '../src/diagrams/mermaid.js';

const THEME = {scheme: 'dark' as const, text: '#ffffff', accent: '#c5b9e8', line: '#b0b8c2'};

/** A manual scheduler: nothing happens until the test advances it, so counts are exact. */
class Clock {
  private tasks: Array<{at: number; fn: () => void; live: boolean}> = [];
  now = 0;
  schedule = (fn: () => void, ms: number) => { const task = {at: this.now + ms, fn, live: true}; this.tasks.push(task); return {cancel: () => { task.live = false; }}; };
  async advance(ms: number): Promise<void> {
    this.now += ms;
    for (;;) {
      const due = this.tasks.filter(task => task.live && task.at <= this.now);
      if (!due.length) break;
      for (const task of due) { task.live = false; task.fn(); }
      this.tasks = this.tasks.filter(task => task.live);
      await flush();
    }
    await flush();
  }
}

async function flush(): Promise<void> { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); }

type Behaviour = (request: DiagramRenderRequest) => DiagramRenderResult | Promise<DiagramRenderResult>;

class FakeRenderer implements DiagramRenderer {
  closed = false;
  readonly requests: string[] = [];
  constructor(private readonly behaviour: Behaviour) {}
  async render(request: DiagramRenderRequest): Promise<DiagramRenderResult> {
    this.requests.push(request.source);
    const result = await this.behaviour(request);
    if (!result.ok && (result.code === 'timeout' || result.code === 'crashed')) this.closed = true;
    return result;
  }
  async close(): Promise<void> { this.closed = true; }
}

const PNG = new Uint8Array([137, 80, 78, 71]);
const ok: Behaviour = () => ({ok: true, png: PNG, width: 40, height: 20, type: 'flowchart-v2'});

function lab(behaviour: Behaviour = ok, options: {blocked?: string; library?: boolean} = {}) {
  const clock = new Clock();
  const renderers: FakeRenderer[] = [];
  const decoded: string[] = [];
  let libraryCalls = 0;
  const backend: DiagramBackend = {
    blocked: async () => options.blocked,
    library: async () => { libraryCalls += 1; return options.library === false ? {ok: false, reason: 'Mermaid is not installed.'} : {ok: true, path: '/x/mermaid.min.js', version: '12.2.0', source: '//'}; },
    open: async (_library: DiagramLibrary) => { const renderer = new FakeRenderer(behaviour); renderers.push(renderer); return renderer; },
    decode: async (_png, name, key) => { decoded.push(key); return {key, name, path: name, info: {format: 'png', width: 40, height: 20}, raster: {width: 40, height: 20, data: new Uint8Array(40 * 20 * 4)}, fileBytes: 4} as unknown as LoadedImage; },
  };
  const service = new DiagramService({backend, schedule: clock.schedule, settleMs: 100, idleMs: 60_000, timeoutMs: 5000});
  const placed: unknown[] = [];
  const released: unknown[] = [];
  const placer: DiagramPlacer = {
    place: (_image, request) => { placed.push(request.owner); return {kind: 'kitty-placeholder', columns: Math.min(request.columns, 10), rows: 3, lines: ['a', 'b', 'c'], owner: request.owner}; },
    releaseOwner: owner => { released.push(owner); },
  };
  const document = (mode: 'auto' | 'manual' | 'off' = 'auto') => {
    let changes = 0;
    const doc = new DocumentDiagrams(() => service, {mode: () => mode, theme: () => THEME, placer, changed: () => { changes += 1; }});
    return {doc, changes: () => changes};
  };
  return {clock, service, renderers, decoded, placed, released, document, libraryCalls: () => libraryCalls};
}

test('nothing starts for a document without diagrams, or with diagrams on request until the person asks', async () => {
  const {clock, service, renderers, document, libraryCalls} = lab();
  const {doc} = document('manual');
  doc.pass(() => doc.slot('flowchart LR\n A --> B'));
  await clock.advance(1000);
  assert.equal(renderers.length, 0);
  assert.equal(libraryCalls(), 0);
  assert.match(doc.slot('flowchart LR\n A --> B').note ?? '', /press D/u);
  assert.equal(service.stats.renders, 0);
  doc.request();
  doc.pass(() => doc.slot('flowchart LR\n A --> B'));
  await clock.advance(200);
  assert.equal(renderers.length, 1);
  assert.equal(service.stats.renders, 1);
  assert.ok(doc.slot('flowchart LR\n A --> B').place(80, 20));
  const off = document('off').doc;
  assert.match(off.pass(() => off.slot('flowchart LR\n A --> C')).note ?? '', /off/u);
});

test('a drawn diagram is cached by its text and theme: drawing it again or in another document costs nothing', async () => {
  const {clock, service, renderers, document} = lab();
  const a = document().doc, b = document().doc;
  a.pass(() => a.slot('flowchart LR\n A --> B'));
  await clock.advance(200);
  b.pass(() => b.slot('flowchart LR\n A --> B'));
  await clock.advance(200);
  assert.equal(service.stats.renders, 1);
  assert.equal(renderers[0]!.requests.length, 1);
  assert.ok(b.slot('flowchart LR\n A --> B').place(80, 20));
});

test('rapid edits: work waits for a pause, and text nobody shows any more is never drawn', async () => {
  const {clock, service, renderers, document} = lab();
  const {doc} = document();
  // Fifty keystrokes, 30 ms apart: each one is a new version of the diagram on screen.
  let text = 'flowchart LR\n A --> B';
  for (let i = 0; i < 50; i++) {
    text += String(i % 10);
    doc.pass(() => doc.slot(text));
    await clock.advance(30);
  }
  await clock.advance(500);
  assert.equal(service.stats.renders, 1, 'only the text on screen after the pause is drawn');
  assert.equal(renderers[0]!.requests[0], text);
  assert.equal(service.stats.dropped, 49);
});

test('an edit while a diagram is drawing: the drawing finishes (bounded), then only the latest text is drawn', async () => {
  let release: (() => void) | undefined;
  const {clock, service, document} = lab(request => request.source.endsWith('slow') ? new Promise(resolve => { release = () => resolve(ok(request) as DiagramRenderResult); }) : ok(request));
  const {doc} = document();
  doc.pass(() => doc.slot('flowchart LR\n A --> slow'));
  await clock.advance(200);
  assert.equal(service.stats.renders, 1);
  for (const suffix of ['1', '12', '123']) { doc.pass(() => doc.slot(`flowchart LR\n A --> B${suffix}`)); await clock.advance(20); }
  release!();
  await clock.advance(500);
  assert.equal(service.stats.renders, 2);
  assert.ok(doc.slot('flowchart LR\n A --> B123').place(80, 20));
});

test('syntax errors and refused text show the reason; the source is never sent when it is out of bounds', async () => {
  const {clock, service, renderers, document} = lab(request => request.source.includes('-->') && !request.source.includes('B') ? {ok: false, code: 'syntax', reason: 'Parse error on line 2:\n...A -->\n------^\nExpecting \'NODE_STRING\', got \'EOF\''} : ok(request));
  const {doc} = document();
  doc.pass(() => doc.slot('flowchart LR\n A -->'));
  await clock.advance(200);
  const slot = doc.slot('flowchart LR\n A -->');
  assert.equal(slot.place(80, 20), undefined);
  assert.match(slot.note ?? '', /Parse error on line 2/u);
  assert.doesNotMatch(slot.note ?? '', /\n/u);
  const huge = `flowchart LR\n${'  A --> B\n'.repeat(MERMAID_LIMITS.lines + 5)}`;
  doc.pass(() => doc.slot(huge));
  await clock.advance(200);
  assert.match(doc.slot(huge).note ?? '', /at most/u);
  assert.ok(!renderers.some(renderer => renderer.requests.includes(huge)));
  assert.equal(service.stats.renders, 1);
});

test('a timeout or crash closes the renderer; the next diagram opens a fresh one, and the failure is not retried on its own', async () => {
  const {clock, service, renderers, document} = lab(request => request.source.includes('hang') ? {ok: false, code: 'timeout', reason: 'Drawing took longer than 5 s, so it was stopped.'} : request.source.includes('crash') ? {ok: false, code: 'crashed', reason: 'The browser page drawing diagrams stopped.'} : ok(request));
  const {doc} = document();
  doc.pass(() => doc.slot('flowchart LR\n hang'));
  await clock.advance(200);
  assert.match(doc.slot('flowchart LR\n hang').note ?? '', /longer than/u);
  doc.pass(() => { doc.slot('flowchart LR\n hang'); doc.slot('flowchart LR\n crash'); });
  await clock.advance(200);
  doc.pass(() => doc.slot('flowchart LR\n fine'));
  await clock.advance(200);
  assert.equal(renderers.length, 3);
  assert.ok(doc.slot('flowchart LR\n fine').place(80, 20));
  assert.equal(service.stats.timeouts, 1);
  assert.equal(service.stats.crashes, 1);
  // Asking again (D) retries what failed for a transient reason.
  doc.request();
  doc.pass(() => doc.slot('flowchart LR\n hang'));
  await clock.advance(200);
  assert.equal(service.stats.timeouts, 2);
});

test('no browser, the browser off, or no Mermaid: the reason is shown and nothing is opened', async () => {
  for (const [options, pattern] of [[{blocked: 'The real browser is off.'}, /browser is off/u], [{library: false}, /not installed/u]] as const) {
    const {clock, renderers, document} = lab(ok, options);
    const {doc} = document();
    doc.pass(() => doc.slot('flowchart LR\n A --> B'));
    await clock.advance(300);
    assert.equal(renderers.length, 0);
    assert.match(doc.slot('flowchart LR\n A --> B').note ?? '', pattern);
  }
});

test('the cache is bounded in images and bytes; old drawings are forgotten first', async () => {
  const {clock, service, document} = lab();
  const {doc} = document();
  for (let i = 0; i < 40; i++) { doc.pass(() => doc.slot(`flowchart LR\n A --> N${i}`)); await clock.advance(200); }
  assert.ok(service.stats.cachedImages <= 24, `${service.stats.cachedImages}`);
  assert.ok(service.stats.cacheBytes <= 48 * 1024 * 1024);
  assert.ok(doc.slot('flowchart LR\n A --> N39').place(80, 20));
});

test('closing every document releases its pictures and closes the renderer page now; reopening works', async () => {
  const {clock, service, renderers, released, document} = lab();
  const first = document();
  first.doc.pass(() => first.doc.slot('flowchart LR\n A --> B'));
  await clock.advance(200);
  first.doc.slot('flowchart LR\n A --> B').place(80, 20);
  first.doc.close();
  assert.equal(renderers[0]!.closed, true);
  assert.ok(released.includes(first.doc));
  assert.equal(service.stats.documents, 0);
  // Work queued for a closed document is dropped; its change callback is never called again.
  const second = document();
  second.doc.pass(() => second.doc.slot('flowchart LR\n X --> Y'));
  second.doc.close();
  const before = second.changes();
  await clock.advance(500);
  assert.equal(second.changes(), before);
  assert.equal(service.stats.renders, 1);
  for (let i = 0; i < 20; i++) { const again = document(); again.doc.pass(() => again.doc.slot('flowchart LR\n A --> B')); await clock.advance(200); again.doc.close(); }
  assert.ok(renderers.every(renderer => renderer.closed));
  assert.equal(service.stats.documents, 0);
});

test('an idle renderer page closes by itself; the browser engine then stops on its own idle timer', async () => {
  const {clock, renderers, document} = lab();
  const {doc} = document();
  doc.pass(() => doc.slot('flowchart LR\n A --> B'));
  await clock.advance(200);
  assert.equal(renderers[0]!.closed, false);
  await clock.advance(60_000);
  assert.equal(renderers[0]!.closed, true);
  doc.pass(() => doc.slot('flowchart LR\n A --> C'));
  await clock.advance(200);
  assert.equal(renderers.length, 2);
});
