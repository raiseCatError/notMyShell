import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {encodePng} from '../src/graphics/pngEncode.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

const settle = async (until: () => boolean) => { for (let i = 0; i < 300 && !until(); i += 1) await new Promise(done => setTimeout(done, 10)); };

function fixture() {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'doc-ws-'));
  const frame = executionFrameFixture(110, 40);
  const app = frame.app;
  app['shellCwd'] = dir;
  const screen = () => frame.capture().frame.rows.map(row => stripAnsi(row)).join('\n');
  const key = (value: Parameters<typeof app['handleKey']>[0]) => app['handleKey'](value);
  const type = (text: string) => { for (const char of text) key({kind: 'text', value: char}); };
  const view = async (target: string) => { app['openViewer'](target, `/view ${target}`); await settle(() => Boolean(app['docSession'] || app['viewer'] || app['imageView'])); };
  const edit = async (target: string) => { await app['runSlash'](`/edit ${target}`, {kind: 'editFile', target}); await settle(() => Boolean(app['docSession'] || app['textEditor'])); };
  return {dir, app, frame, screen, key, type, view, edit, done: () => { frame.dispose(); rmSync(dir, {recursive: true, force: true}); }};
}
const read = (dir: string, name: string) => readFileSync(join(dir, name));

test('/edit page.html opens the editor on the workspace directly; Ctrl+S writes atomically keeping BOM and CRLF', async () => {
  const f = fixture();
  try {
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<h1>Hi</h1>\r\n<p>there</p>\r\n')]);
    writeFileSync(join(f.dir, 'page.html'), original);
    await f.edit('page.html');
    assert.equal(f.app['docSession'].mode, 'edit');
    assert.equal(f.app['textEditor'], undefined, 'the same editor, inside the workspace');
    f.type('<!-- ');
    assert.match(f.screen(), /edited/u);
    assert.deepEqual(read(f.dir, 'page.html'), original, 'nothing is written until Ctrl+S');
    f.key({kind: 'sendToProgram'});
    await settle(() => !f.app['docSession'].editor.buffer.dirty);
    const saved = read(f.dir, 'page.html');
    assert.deepEqual([...saved.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the BOM is kept');
    assert.equal(saved.toString('utf8', 3), '<!-- <h1>Hi</h1>\r\n<p>there</p>\r\n', 'CRLF and the final newline are kept');
    f.key({kind: 'escape'});
    assert.equal(f.app['docSession'].mode, 'source');
    f.key({kind: 'escape'});
    assert.equal(f.app['docSession'], undefined);
    assert.equal(f.app['editor'].text, '', 'the composer is as it was');
  } finally { f.done(); }
});

test('/view page.html opens source-first; e edits, h previews the unsaved buffer without saving, e returns to the same caret', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'page.html'), '<h1>Title</h1>\n<p>Body</p>\n');
    await f.view('page.html');
    assert.equal(f.app['docSession'].mode, 'source');
    assert.match(f.screen(), /<h1>Title<\/h1>/u);
    assert.match(f.screen(), /h preview/u);
    f.key({kind: 'text', value: 'e'});
    f.key({kind: 'bufferEnd'});
    f.type('<p>NEW-UNSAVED</p>');
    f.key({kind: 'toggleDetails'});
    assert.equal(f.app['docSession'].mode, 'preview');
    assert.match(f.screen(), /NEW-UNSAVED/u);
    assert.equal(read(f.dir, 'page.html').toString(), '<h1>Title</h1>\n<p>Body</p>\n', 'previewing never saves');
    f.key({kind: 'toggleDetails'});
    assert.equal(f.app['docSession'].mode, 'edit');
    f.type('x');
    assert.match(f.app['docSession'].editor.buffer.lines.join('\n'), /NEW-UNSAVED<\/p>x/u, 'typing continues where the caret was');
  } finally { f.done(); }
});

test('disk conflicts: a save over a changed file asks; Reload discards edits only after the person says so', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'doc.md'), '# One\n');
    await f.edit('doc.md');
    f.type('mine ');
    writeFileSync(join(f.dir, 'doc.md'), '# Changed elsewhere\n');
    f.key({kind: 'sendToProgram'});
    await settle(() => Boolean(f.app['docSession'].editor.dialog));
    assert.equal(f.app['docSession'].editor.dialog.kind, 'conflict');
    assert.match(f.screen(), /changed on disk|Overwrite/u);
    assert.equal(read(f.dir, 'doc.md').toString(), '# Changed elsewhere\n', 'nothing was overwritten');
    f.key({kind: 'escape'});
    assert.equal(f.app['docSession'].editor.dialog, undefined, 'Keep editing');
    assert.match(f.app['docSession'].editor.buffer.lines[0], /^mine /u);
    // R in navigation with edits asks first, then reloads.
    f.key({kind: 'escape'});
    f.key({kind: 'text', value: 'R'});
    assert.ok(f.app['docSession'].editor.dialog, 'asks before discarding');
    f.key({kind: 'text', value: 'r'});
    await settle(() => !f.app['docSession'].editor.buffer.dirty);
    assert.equal(f.app['docSession'].editor.buffer.lines[0], '# Changed elsewhere');
    assert.match(f.screen(), /Reloaded from disk/u);
  } finally { f.done(); }
});

test('files that cannot be edited safely stay readable: /view falls back to the read-only viewer and says why; /edit reports it', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, 'big.md'), `${'x'.repeat(1_100_000)}\n`);
    await f.view('big.md');
    await settle(() => Boolean(f.app['viewer']));
    assert.equal(f.app['docSession'], undefined);
    assert.ok(f.app['viewer'], 'readable in the viewer');
    assert.match(f.screen(), /Read-only:/u);
    f.key({kind: 'escape'});
    await f.app['runSlash']('/edit big.md', {kind: 'editFile', target: 'big.md'});
    await settle(() => /too large|cannot|refus|larger/iu.test(f.frame.capture().frame.rows.map(row => stripAnsi(row)).join('\n')));
    assert.equal(f.app['docSession'], undefined);
    f.app['openViewer']('missing.md', '/view missing.md');
    await settle(() => /does not exist/u.test(f.screen()));
    assert.equal(f.app['docSession'], undefined, '/view never creates a file');
    writeFileSync(join(f.dir, 'ro.md'), '# ro\n');
    chmodSync(join(f.dir, 'ro.md'), 0o444);
    await f.view('ro.md');
    assert.ok(f.app['viewer'] || f.app['docSession']);
    f.key({kind: 'escape'});
  } finally { f.done(); }
});

test('the native preview draws local images of the current buffer, and closing the workspace releases them', async () => {
  const f = fixture();
  try {
    const data = new Uint8ClampedArray(32 * 16 * 4).fill(180);
    writeFileSync(join(f.dir, 'logo.png'), encodePng({width: 32, height: 16, data}));
    writeFileSync(join(f.dir, 'page.md'), '# Page\n');
    await f.edit('page.md');
    f.key({kind: 'bufferEnd'});
    f.type('\n![Logo](logo.png)\n');
    f.key({kind: 'toggleDetails'});
    await settle(() => f.app['viewerImages']?.version > 1 || /[▀▄█▌▐▘▝▖▗▙▛▜▟▞▚]/u.test(f.frame.capture().frame.rows.join('')));
    f.screen();
    assert.ok(f.app['viewerImages'], 'images of the unsaved buffer were found');
    assert.match(f.frame.capture().frame.rows.join(''), /[▀▄█▌▐▘▝▖▗▙▛▜▟▞▚]/u);
    f.key({kind: 'escape'});
    f.key({kind: 'escape'});
    f.app['docSession'] && f.key({kind: 'text', value: 'd'});
    await settle(() => !f.app['docSession']);
    assert.equal(f.app['viewerImages'], undefined, 'closing the document closes its images');
  } finally { f.done(); }
});

// ---- #462 Mermaid diagrams in the app -----------------------------------------------------------------------------------

const MERMAID_DOC = '# Plan\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nText after.\n';

test('Mermaid on request (default): opening and previewing a document starts nothing; D asks, the reason shows, closing lets go of everything', async () => {
  const f = fixture();
  try {
    f.app['promptConfiguration'] = {...f.app['promptConfiguration'], browser: 'off'};
    writeFileSync(join(f.dir, 'plan.md'), MERMAID_DOC);
    await f.view('plan.md');
    f.key({kind: 'text', value: 'h'});
    assert.match(f.screen(), /diagram not drawn: not drawn yet: press D/u);
    assert.match(f.screen(), /flowchart LR/u, 'the fence shows exactly as written');
    assert.equal(f.app['diagramService'], undefined, 'no diagram service exists until the person asks');
    assert.equal(f.app['browserHost'], undefined, 'nothing browser-related was created');
    f.key({kind: 'text', value: 'D'});
    assert.ok(f.app['diagramService']);
    await settle(() => /real browser, which is off/u.test(f.screen()));
    assert.match(f.screen(), /diagram not drawn: Diagrams are drawn by the real browser, which is off/u);
    assert.equal(f.app['browserHost'], undefined, 'the browser setting is off: no host either');
    assert.equal(readFileSync(join(f.dir, 'plan.md'), 'utf8'), MERMAID_DOC, 'the document is never rewritten');
    f.key({kind: 'escape'});
    f.key({kind: 'escape'});
    assert.equal(f.app['docSession'], undefined);
    f.frame.capture();
    assert.equal(f.app['diagrams'], undefined, 'the closed document\'s diagrams are released');
    assert.equal(f.app['diagramService'].stats.documents, 0);
    assert.equal(f.app['diagramService'].stats.rendererOpen, false);
    f.type('echo ok');
    assert.equal(f.app['editor'].text, 'echo ok', 'typing goes back to the composer');
  } finally { f.done(); }
});

test('Mermaid automatic: the preview draws the diagram from the drawing service; Off keeps the fence as code with the reason', async () => {
  const f = fixture();
  try {
    f.app['promptConfiguration'] = {...f.app['promptConfiguration'], browser: 'off', diagrams: 'auto'};
    const {DiagramService} = await import('../src/diagrams/service.js');
    const drawn: string[] = [];
    f.app['diagramService'] = new DiagramService({settleMs: 0, backend: {
      blocked: async () => undefined,
      library: async () => ({ok: true, path: '/m.js', version: '12.2.0', source: '//'}),
      open: async () => ({closed: false, render: async (request: {source: string}) => { drawn.push(request.source); return {ok: true, png: encodePng({width: 40, height: 20, data: new Uint8Array(40 * 20 * 4).fill(200)}), width: 40, height: 20, type: 'flowchart-v2'}; }, close: async () => {}}),
      decode: (png: Uint8Array, name: string, key: string) => f.app['graphicsService']().fromPng(png, name, key),
    }});
    writeFileSync(join(f.dir, 'plan.md'), MERMAID_DOC);
    await f.view('plan.md');
    f.key({kind: 'text', value: 'h'});
    f.screen();
    await settle(() => /mermaid · flowchart/u.test(f.screen()));
    assert.match(f.screen(), /mermaid · flowchart/u);
    assert.deepEqual(drawn, ['flowchart LR\n  A --> B']);
    assert.doesNotMatch(f.screen(), /flowchart LR/u);
    f.app['promptConfiguration'] = {...f.app['promptConfiguration'], diagrams: 'off'};
    assert.match(f.screen(), /diagram not drawn: Mermaid diagrams are off/u);
    assert.match(f.screen(), /flowchart LR/u);
  } finally { f.done(); }
});
