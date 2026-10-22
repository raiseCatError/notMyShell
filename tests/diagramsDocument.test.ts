import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DiagramRenderer, DiagramRenderRequest, DiagramRenderResult} from '../src/browser/types.js';
import type {LoadedImage} from '../src/graphics/service.js';
import {DiagramService, type DiagramPlacer} from '../src/diagrams/service.js';
import {DocumentDiagrams, type DiagramMode} from '../src/diagrams/document.js';
import {codeBlocks, renderMarkdown, type DiagramProvider} from '../src/markdown/render.js';
import {createDocumentSession, documentSessionKey, renderDocumentSession, setDocumentMode, type DocumentSession} from '../src/viewer/DocumentWorkspace.js';
import {openForEdit} from '../src/viewer/fileEdit.js';
import {decodeKeys} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {ViewerLook} from '../src/viewer/ViewerPanel.js';

/**
 * #462 Mermaid: how a diagram fence reads in every view. The source is the only truth: a drawn diagram replaces the fence's rows,
 * never its text; anything not drawn shows the fence exactly as written with the reason under it.
 */
const FLOW = ['flowchart LR', '  A[Start] --> B{Ok?}', '  B -->|yes| C[Done]'];
const DOC = ['# Title', '', 'Before the diagram.', '', '```mermaid', ...FLOW, '```', '', 'After the diagram.', '', '```js', 'const x = 1;', '```', '', 'The end.'].join('\n');
const THEME = {scheme: 'dark' as const, text: '#ffffff', accent: '#c5b9e8', line: '#b0b8c2'};

/** A provider whose every diagram is drawn as `rows` rows of "▒" (what the graphics service would place), or refused. */
function fixed(rows: number, note?: string): DiagramProvider & {asked: string[]} {
  const asked: string[] = [];
  return {asked, slot: source => { asked.push(source); return note ? {index: -1, note, place: () => undefined} : {index: 0, type: 'flowchart-v2', place: (columns, maxRows) => { const height = Math.min(rows, maxRows), width = Math.min(columns, 12); return {lines: Array.from({length: height}, () => '▒'.repeat(width)), columns: width, rows: height}; }}; }};
}

test('a drawn diagram takes the fence\'s rows: picture rows, a caption, the fence\'s source line, and the code numbering stays aligned', () => {
  const rows = renderMarkdown(DOC, 60, {diagrams: fixed(4), level: 'truecolor'});
  const picture = rows.filter(row => row.kind === 'image');
  assert.equal(picture.length, 4);
  assert.ok(picture.every(row => row.diagram === 0 && row.line === 4));
  assert.equal(picture[0]!.plain, '[diagram: flowchart-v2]');
  const caption = rows.find(row => /mermaid · flowchart/u.test(row.plain));
  assert.ok(caption);
  assert.equal(caption!.line, 4);
  // The JS fence is still code block 1 (copy-code numbering counts the diagram as block 0, as codeBlocks does).
  assert.ok(rows.filter(row => row.kind === 'code').every(row => row.code === 1));
  assert.deepEqual(codeBlocks(DOC).map(block => block.language), ['mermaid', 'js']);
  assert.ok(!rows.some(row => row.plain.includes('flowchart LR')));
});

test('not drawn: the fence exactly as written, then one dim line with the reason', () => {
  const rows = renderMarkdown(DOC, 70, {diagrams: fixed(4, 'Mermaid is not installed.'), level: 'none'});
  const plain = rows.map(row => row.plain);
  const at = plain.findIndex(line => line.includes('flowchart LR'));
  assert.ok(at >= 0);
  assert.deepEqual(plain.slice(at, at + 3).map(line => line.replace(/^[│|] /u, '').trimEnd()), FLOW.map(line => line.trimEnd()));
  assert.match(plain[at + 3]!, /\(diagram not drawn: Mermaid is not installed\.\)/u);
  // Without a provider (agent replies, GitHub bodies) a mermaid fence is ordinary code, with no note.
  assert.ok(!renderMarkdown(DOC, 70, {level: 'none'}).some(row => /diagram not drawn/u.test(row.plain)));
  // An unclosed fence is never sent to be drawn.
  const open = fixed(4);
  const unclosed = renderMarkdown('```mermaid\nflowchart LR\n  A --> B', 70, {diagrams: open, level: 'none'});
  assert.equal(open.asked.length, 0);
  assert.ok(unclosed.some(row => /fence is not closed/u.test(row.plain)));
});

test('30/50/80/120 columns: no row is wider than the view, drawn or not; NO_COLOR and Safe Glyphs keep it plain text', () => {
  for (const columns of [30, 50, 80, 120]) {
    for (const provider of [fixed(30), fixed(3, 'a long reason that has to wrap across several rows when the terminal is narrow')]) {
      for (const options of [{level: 'truecolor' as const, glyphs: 'nerd' as const}, {level: 'none' as const, glyphs: 'safe' as const}]) {
        const rows = renderMarkdown(DOC, columns, {diagrams: provider, maxDiagramRows: 10, ...options});
        for (const row of rows) assert.ok(displayWidth(row.ansi) <= columns, `${columns}: ${JSON.stringify(row.plain)}`);
        // No colour without colour (bold and italic are not colour): structure never depends on it.
        if (options.level === 'none') assert.ok(rows.every(row => !/\u001b\[(?:[0-9;]*;)?(?:3[0-8]|4[0-8]|9[0-7]|10[0-7])(?:;|m)/u.test(row.ansi)), rows.map(row => JSON.stringify(row.ansi)).join('\n'));
        if (options.glyphs === 'safe') assert.ok(rows.every(row => !/[◇│…]/u.test(row.plain)), rows.map(row => row.plain).join('\n'));
      }
    }
    // The picture never takes more rows than allowed.
    assert.equal(renderMarkdown(DOC, columns, {diagrams: fixed(30), maxDiagramRows: 10}).filter(row => row.kind === 'image').length, 10);
  }
});

test('diagrams nested in quotes, lists and details are drawn too, and keep their index for the enlarged view', () => {
  const text = ['> ```mermaid', '> flowchart LR', '>   A --> B', '> ```', '', '- item', '', '  ```mermaid', '  flowchart LR', '    C --> D', '  ```'].join('\n');
  const provider = fixed(2);
  const rows = renderMarkdown(text, 60, {diagrams: provider});
  assert.deepEqual(provider.asked, ['flowchart LR\n  A --> B', 'flowchart LR\n  C --> D']);
  assert.equal(rows.filter(row => row.diagram === 0 && row.kind === 'quote').length, 3);
});

// ---- The workspace: Source, Preview, Split and Hybrid over one buffer --------------------------------------------------

class InstantRenderer implements DiagramRenderer {
  closed = false;
  sources: string[] = [];
  async render(request: DiagramRenderRequest): Promise<DiagramRenderResult> { this.sources.push(request.source); return {ok: true, png: new Uint8Array(8), width: 80, height: 40, type: 'flowchart-v2'}; }
  async close(): Promise<void> { this.closed = true; }
}

function diagramLab(mode: DiagramMode = 'auto') {
  const renderer = new InstantRenderer();
  const tasks: Array<() => void> = [];
  const service = new DiagramService({
    backend: {
      blocked: async () => undefined,
      library: async () => ({ok: true, path: '/m.js', version: '12.2.0', source: '//'}),
      open: async () => renderer,
      decode: async (_png, name, key) => ({key, name, path: name, info: {format: 'png', width: 80, height: 40}, raster: {width: 80, height: 40, data: new Uint8Array(80 * 40 * 4)}, fileBytes: 8}) as unknown as LoadedImage,
    },
    settleMs: 0,
    schedule: fn => { tasks.push(fn); return {cancel: () => { const at = tasks.indexOf(fn); if (at >= 0) tasks.splice(at, 1); }}; },
  });
  const placer: DiagramPlacer = {place: (_image, request) => ({kind: 'kitty-placeholder', columns: Math.min(request.columns, 10), rows: 3, lines: Array.from({length: 3}, () => '▒'.repeat(Math.min(request.columns, 10))), owner: request.owner}), releaseOwner: () => {}};
  const diagrams = new DocumentDiagrams(() => service, {mode: () => mode, theme: () => THEME, placer, changed: () => {}});
  const settle = async () => { for (let round = 0; round < 5; round++) { while (tasks.length) tasks.shift()!(); for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); } };
  return {service, renderer, diagrams, settle, look: {diagrams} as ViewerLook};
}

async function openDoc(content = `${DOC}\n`, mode: 'edit' | 'source' = 'source') {
  const root = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'nmsh-diagram-doc-')));
  const path = join(root, 'doc.md');
  writeFileSync(path, content);
  const opened = await openForEdit(path, '/');
  if (!opened.ok) throw new Error(opened.reason);
  return {root, state: createDocumentSession(opened.file, mode)};
}
const press = (state: DocumentSession, bytes: string, look: ViewerLook, columns = 100, height = 30) => { const actions = []; for (const key of decodeKeys(bytes)) actions.push(documentSessionKey(state, key, columns, height, look)); return actions; };
const draw = (state: DocumentSession, look: ViewerLook, columns = 100, height = 40) => renderDocumentSession(state, columns, height, look).map(row => stripAnsi(row)).join('\n');

test('Source shows the fence as text; Preview draws it once asked (D); the buffer is never touched', async () => {
  const {root, state} = await openDoc();
  const {diagrams, settle, renderer, look} = diagramLab('manual');
  try {
    const before = state.editor.buffer.lines.join('\n');
    assert.match(draw(state, look), /flowchart LR/u);
    press(state, 'h', look);
    assert.equal(state.mode, 'preview');
    assert.match(draw(state, look), /diagram not drawn: not drawn yet: press D/u);
    assert.match(draw(state, look), /D draw diagrams/u);
    const actions = press(state, 'D', look);
    assert.deepEqual(actions, [{kind: 'diagrams'}]);
    diagrams.request();
    draw(state, look);
    await settle();
    const shown = draw(state, look);
    assert.match(shown, /▒▒▒/u);
    assert.match(shown, /mermaid · flowchart/u);
    assert.doesNotMatch(shown, /flowchart LR/u);
    assert.deepEqual(renderer.sources, [FLOW.join('\n')]);
    assert.equal(state.editor.buffer.lines.join('\n'), before);
    assert.equal(state.editor.buffer.dirty, false);
  } finally { diagrams.close(); rmSync(root, {recursive: true, force: true}); }
});

test('Hybrid: the active diagram block is its exact source and stays editable; leaving it draws the edited diagram; undo and redo restore the text', async () => {
  const {root, state} = await openDoc(`${DOC}\n`, 'edit');
  const {diagrams, settle, renderer, look} = diagramLab('auto');
  try {
    press(state, '\u001bOR', look); // F3: hybrid
    assert.equal(state.mode, 'hybrid');
    state.editor.buffer.caret = {line: 0, column: 0};
    draw(state, look);
    await settle();
    assert.match(draw(state, look), /▒▒▒/u);
    // Into the fence: its exact source, caret and all.
    state.editor.buffer.caret = {line: 6, column: 0};
    const editing = draw(state, look);
    for (const line of FLOW) assert.ok(editing.includes(line.trim()), line);
    assert.doesNotMatch(editing, /▒▒▒/u);
    const drawnBefore = renderer.sources.length;
    // Typing inside the fence draws nothing while the block is open.
    state.editor.buffer.caret = {line: 6, column: FLOW[1]!.length};
    press(state, ' --> E', look);
    draw(state, look);
    await settle();
    assert.equal(renderer.sources.length, drawnBefore);
    assert.equal(state.editor.buffer.lines[6], `${FLOW[1]} --> E`);
    // Leaving the block draws the edited text.
    state.editor.buffer.caret = {line: 0, column: 0};
    draw(state, look);
    await settle();
    assert.equal(renderer.sources.at(-1), [FLOW[0], `${FLOW[1]} --> E`, FLOW[2]].join('\n'));
    // Undo and redo go through the text, never through the picture.
    for (let i = 0; i < 6; i++) state.editor.buffer.undo();
    assert.equal(state.editor.buffer.lines.join('\n'), DOC);
    draw(state, look);
    await settle();
    assert.equal(renderer.sources.filter(source => source === FLOW.join('\n')).length, 1, 'the original drawing came from the cache');
    for (let i = 0; i < 6; i++) state.editor.buffer.redo();
    assert.equal(state.editor.buffer.lines[6], `${FLOW[1]} --> E`);
  } finally { diagrams.close(); rmSync(root, {recursive: true, force: true}); }
});

test('Hybrid: a diagram arriving below the top does not move the view; F1 › Diagrams asks for drawing from the editor', async () => {
  const filler = Array.from({length: 40}, (_, i) => `Line ${i}.`).join('\n\n');
  const {root, state} = await openDoc(`${filler}\n\n${DOC}\n`, 'edit');
  const {diagrams, settle, look} = diagramLab('manual');
  try {
    press(state, '\u001bOR', look);
    state.editor.buffer.caret = {line: 10, column: 0};
    draw(state, look, 100, 20);
    const top = {...state.hybrid!.top};
    const actions = press(state, '\u001bOP', look); // F1: the Markdown menu
    assert.match(draw(state, look, 160, 20), /g diagrams/u);
    actions.push(...press(state, 'g', look));
    assert.deepEqual(actions.filter(Boolean), [{kind: 'diagrams'}]);
    diagrams.request();
    draw(state, look, 100, 20);
    await settle();
    draw(state, look, 100, 20);
    assert.deepEqual(state.hybrid!.top, top);
  } finally { diagrams.close(); rmSync(root, {recursive: true, force: true}); }
});

test('Split: typing in the text pane draws only the text that is on screen once typing pauses', async () => {
  const {root, state} = await openDoc(`${DOC}\n`, 'edit');
  const {diagrams, settle, renderer, service, look} = diagramLab('auto');
  try {
    setDocumentMode(state, 'split');
    state.editor.buffer.caret = {line: 6, column: FLOW[1]!.length};
    for (const char of ' --> XYZ') { press(state, char, look, 140); draw(state, look, 140); }
    await settle();
    assert.equal(renderer.sources.length, 1);
    assert.equal(renderer.sources[0], [FLOW[0], `${FLOW[1]} --> XYZ`, FLOW[2]].join('\n'));
    assert.equal(service.stats.dropped, 7);
    // D in the preview pane asks for drawing too.
    state.split!.focus = 'preview';
    assert.deepEqual(press(state, 'D', look, 140), [{kind: 'diagrams'}]);
  } finally { diagrams.close(); rmSync(root, {recursive: true, force: true}); }
});
