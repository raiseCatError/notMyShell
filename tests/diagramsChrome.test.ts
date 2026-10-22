import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {createBrowserEngine} from '../src/browser/engine/index.js';
import type {BrowserEngine, DiagramLibrary, DiagramRenderer, DiagramRenderRequest} from '../src/browser/types.js';
import type {ChromePage} from '../src/browser/engine/page.js';
import {locateMermaid} from '../src/diagrams/library.js';
import {mermaidConfig} from '../src/diagrams/mermaid.js';
import {decodePng} from '../src/graphics/png.js';
import {chromeSkipReason, scratchDir} from './support/browserFixtures.js';

/**
 * The diagram renderer against a real Chromium and a real Mermaid. Skips with the reason when either is missing (NMSh never
 * downloads them): NMSH_TEST_MERMAID (or NMSH_MERMAID, or a global npm install) names the Mermaid package to use.
 */
const THEME = {scheme: 'dark' as const, text: '#f2f0ec', accent: '#c5b9e8', line: '#b0b8c2'};

let library: DiagramLibrary | undefined;
const mermaidSkip = (async () => {
  const found = await locateMermaid({env: {...process.env, ...(process.env.NMSH_TEST_MERMAID ? {NMSH_MERMAID: process.env.NMSH_TEST_MERMAID} : {})}, home: os.homedir(), execPath: process.execPath});
  if (!found.ok) return `no Mermaid: ${found.reason}`;
  library = {source: found.source, version: found.version};
  return undefined;
})();

async function skip(): Promise<string | undefined> {
  return (await chromeSkipReason()) ?? (await mermaidSkip);
}

interface DiagramLab {engine: BrowserEngine; dir: string; done(): Promise<void>}

function freshLab(): DiagramLab {
  const dir = scratchDir('nmsh-diagrams-');
  const engine = createBrowserEngine({profileDir: path.join(dir, 'profile'), idleMs: 60_000});
  return {engine, dir, done: async () => { await engine.shutdown(); fs.rmSync(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 200}); }};
}

// Launching Chromium costs seconds on CI runners: tests that only open renderer pages share one browser; each test closes the
// pages it left open, so the next starts with none. The crash test keeps a browser of its own.
let shared: DiagramLab | undefined;
after(async () => { await shared?.done(); shared = undefined; });

async function lab(options: {fresh?: boolean} = {}): Promise<DiagramLab> {
  if (options.fresh) return freshLab();
  const base = shared ??= freshLab();
  return {...base, done: async () => { await Promise.all(base.engine.pages().map(page => page.close().catch(() => undefined))); }};
}

const request = (source: string, extra: Partial<DiagramRenderRequest> = {}): DiagramRenderRequest => ({source, config: mermaidConfig(THEME), scale: 2, timeoutMs: 10_000, ...extra});

const TYPES: Record<string, string> = {
  flowchart: 'flowchart LR\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]\n  B -->|no| A',
  sequence: 'sequenceDiagram\n  Alice->>Bob: Hello\n  loop Every minute\n    Bob-->>Alice: Still here\n  end',
  class: 'classDiagram\n  Animal <|-- Duck\n  Animal : +int age\n  Animal: +isMammal()\n  class Duck{\n    +swim()\n  }',
  state: 'stateDiagram-v2\n  [*] --> Still\n  Still --> Moving\n  state Moving {\n    [*] --> Slow\n    Slow --> Fast\n  }\n  Moving --> [*]',
  er: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE-ITEM : contains',
  gantt: 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section A\n  Task one :a1, 2026-01-01, 3d\n  Task two :after a1, 2d',
  pie: 'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85',
  journey: 'journey\n  title My day\n  section Work\n    Code: 5: Me\n    Review: 3: Me, Cat',
  gitGraph: 'gitGraph\n  commit\n  branch feature\n  commit\n  checkout main\n  merge feature',
  mindmap: 'mindmap\n  root((NMSh))\n    Editor\n    Viewer\n      Diagrams',
  timeline: 'timeline\n  title Releases\n  2025 : v0.20\n  2026 : v0.23 : v0.24',
  quadrant: 'quadrantChart\n  title Effort\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]',
  xychart: 'xychart-beta\n  x-axis [a, b, c]\n  y-axis 0 --> 10\n  bar [3, 7, 5]',
  requirement: 'requirementDiagram\n  requirement r1 {\n    id: 1\n    text: works\n    risk: low\n    verifymethod: test\n  }',
  sankey: 'sankey-beta\n  A,B,10\n  B,C,5',
  block: 'block-beta\n  columns 2\n  a b\n  c d',
  c4: 'C4Context\n  Person(user, "User")\n  System(nmsh, "NMSh")\n  Rel(user, nmsh, "uses")',
};

test('real Mermaid in a real browser: the common diagram types become PNG pixels of a sensible size', async t => {
  const reason = await skip();
  if (reason) { t.skip(reason); return; }
  const {engine, done} = await lab();
  try {
    const started = Date.now();
    const renderer = await engine.openDiagramRenderer!(library!);
    t.diagnostic(`Mermaid ${library!.version}: renderer ready in ${Date.now() - started} ms`);
    const drawn: string[] = [], refused: string[] = [];
    for (const [name, source] of Object.entries(TYPES)) {
      const at = Date.now();
      const result = await renderer.render(request(source));
      if (result.ok) {
        const raster = decodePng(result.png);
        assert.equal(raster.width, result.width);
        assert.ok(result.width >= 20 && result.height >= 10 && result.width <= 4096 && result.height <= 4096, `${name}: ${result.width}x${result.height}`);
        // Something was drawn: not a fully transparent picture.
        let opaque = 0;
        for (let i = 3; i < raster.data.length; i += 4) if (raster.data[i]! > 0) opaque += 1;
        assert.ok(opaque > 50, `${name} drew nothing`);
        drawn.push(`${name} (${result.type}, ${result.width}x${result.height}, ${Date.now() - at} ms)`);
      } else refused.push(`${name}: ${result.code} ${result.reason.split('\n')[0]}`);
    }
    t.diagnostic(`drawn: ${drawn.join('; ')}`);
    if (refused.length) t.diagnostic(`not drawn: ${refused.join('; ')}`);
    for (const name of ['flowchart', 'sequence', 'class', 'state', 'er', 'gantt', 'pie', 'journey', 'gitGraph', 'mindmap', 'timeline']) assert.ok(drawn.some(line => line.startsWith(`${name} `)), `${name} was not drawn: ${refused.join('; ')}`);
    const page = engine.pages()[0] as ChromePage;
    const metrics = await page.protocol<{metrics: Array<{name: string; value: number}>}>('Performance.getMetrics').catch(() => undefined);
    const heap = metrics?.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value;
    if (heap) t.diagnostic(`renderer page JS heap after ${Object.keys(TYPES).length} diagrams: ${Math.round(heap / 1048576)} MB`);
    await renderer.close();
    assert.equal(engine.pages().length, 0);
  } finally { await done(); }
});

test('real Mermaid: a syntax error is reported as text, and the renderer keeps working', async t => {
  const reason = await skip();
  if (reason) { t.skip(reason); return; }
  const {engine, done} = await lab();
  try {
    const renderer = await engine.openDiagramRenderer!(library!);
    const bad = await renderer.render(request('flowchart LR\n  A -->'));
    assert.equal(bad.ok, false);
    assert.equal(!bad.ok && bad.code, 'syntax');
    assert.match(!bad.ok ? bad.reason : '', /Parse error|error/iu);
    const unknown = await renderer.render(request('notADiagram\n  x'));
    assert.equal(unknown.ok, false);
    assert.ok((await renderer.render(request(TYPES.flowchart!))).ok);
    await renderer.close();
  } finally { await done(); }
});

test('hostile diagrams: no request leaves the browser, no page script runs, directives cannot loosen security', async t => {
  const reason = await skip();
  if (reason) { t.skip(reason); return; }
  const hits: string[] = [];
  const server = http.createServer((req, res) => { hits.push(req.url ?? ''); res.end('x'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const {engine, done} = await lab();
  try {
    const renderer = await engine.openDiagramRenderer!(library!);
    const page = engine.pages()[0] as ChromePage;
    const blocked: string[] = [];
    page.onEvent(event => { if (event.type === 'blocked') blocked.push(event.url); });
    const hostile = [
      `%%{init: {"securityLevel": "loose", "htmlLabels": true, "flowchart": {"htmlLabels": true}, "themeCSS": "@import url('${origin}/css'); .node rect { fill: url('${origin}/fill') }", "dompurifyConfig": {"ADD_TAGS": ["script", "iframe"]}, "maxTextSize": 99999999}}%%\nflowchart LR\n  A["<img src='${origin}/img' onerror='document.title=1'><script>document.title=2</script>"] --> B["<iframe src='${origin}/frame'></iframe>"]\n  click A href "javascript:document.title=3"\n  click B href "${origin}/link"`,
      `---\nconfig:\n  securityLevel: loose\n  htmlLabels: true\n  themeCSS: "body { background: url('${origin}/front') }"\n---\nflowchart LR\n  X["<img src=${origin}/img2>"] --> Y`,
      `flowchart LR\n  A["<a href='${origin}/a'>link</a>"] --> B("<svg><image href='${origin}/svgimage'/></svg>")\n  style A fill:url(${origin}/style)`,
      `sequenceDiagram\n  Alice->>Bob: <img src="${origin}/seq" onerror="document.title=4">\n  link Alice: Site @ ${origin}/actorlink`,
      `classDiagram\n  class A{\n    +img(src="${origin}/class")\n  }\n  link A "${origin}/classlink" "tip"\n  callback A "alert"`,
      `architecture-beta\n  service s(logos:aws)[S]`,
    ];
    for (const source of hostile) {
      const result = await renderer.render(request(source));
      // Drawn or refused, it never reached the network and never ran page script.
      t.diagnostic(`${source.split('\n').find(line => /^(flowchart|sequenceDiagram|classDiagram|architecture)/u.test(line.trim()))?.trim()}: ${result.ok ? `drawn ${result.width}x${result.height}` : `${result.code}: ${result.reason.split('\n')[0]}`}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.deepEqual(hits, [], `requests reached the server: ${hits.join(', ')}`);
    const title = await page.protocol<{result: {value?: string}}>('Runtime.evaluate', {expression: 'document.title', returnByValue: true});
    assert.equal(title.result.value, 'diagram');
    assert.match(page.url, /^about:blank/u);
    t.diagnostic(`refused in the browser: ${blocked.length} request(s)`);
    await renderer.close();
  } finally {
    await done();
    server.close();
  }
});

test('a library that never finishes is stopped at the timeout; the page is thrown away and a new renderer works', async t => {
  const reason = await skip();
  if (reason) { t.skip(reason); return; }
  const {engine, done} = await lab();
  try {
    const hanging = await engine.openDiagramRenderer!({version: 'test', source: 'globalThis.mermaid = {initialize() {}, async parse() { return {diagramType: "loop"}; }, render() { for (;;) {} }};'});
    const started = Date.now();
    const result = await hanging.render(request('flowchart LR\n A', {timeoutMs: 1500}));
    const took = Date.now() - started;
    assert.equal(!result.ok && result.code, 'timeout');
    assert.ok(took < 8000, `took ${took} ms`);
    assert.equal(hanging.closed, true);
    assert.equal(engine.pages().length, 0);
    const forever = await engine.openDiagramRenderer!({version: 'test', source: 'globalThis.mermaid = {initialize() {}, async parse() { return {}; }, render() { return new Promise(() => {}); }};'});
    assert.equal(((await forever.render(request('x', {timeoutMs: 800}))) as {code: string}).code, 'timeout');
    const fresh = await engine.openDiagramRenderer!(library!);
    assert.ok((await fresh.render(request(TYPES.pie!))).ok);
    await fresh.close();
    await assert.rejects(engine.openDiagramRenderer!({version: 'x', source: 'globalThis.notMermaid = 1;'}), /not a Mermaid library/u);
    assert.equal(engine.pages().length, 0);
  } finally { await done(); }
});

test('a crashed renderer page is reported, never hangs, and the browser stops cleanly afterwards', async t => {
  const reason = await skip();
  if (reason) { t.skip(reason); return; }
  const {engine, done} = await lab({fresh: true});
  try {
    const renderer: DiagramRenderer = await engine.openDiagramRenderer!(library!);
    assert.ok((await renderer.render(request(TYPES.flowchart!))).ok);
    const page = engine.pages()[0] as ChromePage;
    const pending = renderer.render(request(TYPES.sequence!, {timeoutMs: 5000}));
    void page.protocol('Page.crash').catch(() => undefined);
    const result = await pending;
    if (!result.ok) assert.ok(['crashed', 'timeout', 'failed'].includes(result.code), result.code);
    // Whatever the race, a later render on the crashed page does not hang.
    const after = await renderer.render(request(TYPES.pie!, {timeoutMs: 3000}));
    if (!after.ok) assert.ok(['crashed', 'timeout', 'failed'].includes(after.code));
    await renderer.close();
    assert.equal(engine.pages().length, 0);
    const pid = engine.stats().pid;
    await engine.shutdown();
    if (pid) assert.throws(() => process.kill(pid, 0));
  } finally { await done(); }
});

test('repeated open and close leaves no pages behind', async t => {
  const reason = await skip();
  if (reason) { t.skip(reason); return; }
  const {engine, done} = await lab();
  try {
    for (let i = 0; i < 5; i++) {
      const renderer = await engine.openDiagramRenderer!(library!);
      assert.ok((await renderer.render(request(`flowchart LR\n  A${i} --> B${i}`))).ok);
      await renderer.close();
      assert.equal(engine.pages().length, 0);
    }
    assert.equal(engine.stats().pages, 0);
  } finally { await done(); }
});
