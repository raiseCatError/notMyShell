import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadFileDocument, outputDocument, resolveViewPath, type ViewDocument} from '../src/viewer/document.js';
import {createViewer, renderViewer, viewerKey, type ViewerState} from '../src/viewer/ViewerPanel.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-view-')));
const text = (value: string): Key => ({kind: 'text', value});
const press = (state: ViewerState, keys: Array<Key | string>, columns = 80, height = 24) => {
  let action;
  for (const key of keys) action = viewerKey(state, typeof key === 'string' ? text(key) : key, columns, height);
  return action;
};
const draw = (state: ViewerState, columns = 80, height = 24) => renderViewer(state, columns, height);
const shown = (rows: string[]) => rows.map(row => stripAnsi(row));
async function load(path: string, options: Parameters<typeof loadFileDocument>[2] = {}): Promise<ViewDocument> {
  const result = await loadFileDocument(path, '/', options);
  if (!result.ok) throw new Error(result.reason);
  return result.document;
}

test('/view parses a path, an output number or nothing', () => {
  assert.deepEqual(parseSlashCommand('/view README.md'), {kind: 'view', target: 'README.md'});
  assert.deepEqual(parseSlashCommand('/view 2'), {kind: 'view', target: '2'});
  assert.deepEqual(parseSlashCommand('/view'), {kind: 'view', target: ''});
  assert.notEqual(parseSlashCommand('/viewer')?.kind, 'view');
  assert.equal(resolveViewPath('~/notes.md', '/work', '/home/me'), '/home/me/notes.md');
  assert.equal(resolveViewPath('docs/a.md', '/work', '/home/me'), '/work/docs/a.md');
});

test('files: only regular, decodable text is read, within limits, and every refusal says why', async () => {
  const root = scratch();
  try {
    writeFileSync(join(root, 'a.ts'), 'const a = 1;\r\nconst b = 2;\r\n');
    const code = await load(join(root, 'a.ts'));
    assert.deepEqual(code.lines, ['const a = 1;', 'const b = 2;']);
    assert.equal(code.lineEnding, 'crlf');
    assert.equal(code.format, 'text');
    assert.equal(code.language, 'js');
    assert.equal(code.complete, true);

    mkdirSync(join(root, 'dir'));
    assert.match((await loadFileDocument(join(root, 'dir'), '/') as {reason: string}).reason, /is a directory/u);
    assert.match((await loadFileDocument(join(root, 'missing.txt'), '/') as {reason: string}).reason, /does not exist/u);
    writeFileSync(join(root, 'bin'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2]));
    assert.match((await loadFileDocument(join(root, 'bin'), '/') as {reason: string}).reason, /binary/u);
    writeFileSync(join(root, 'utf16.txt'), Buffer.from([0xff, 0xfe, 0x61, 0x00]));
    assert.match((await loadFileDocument(join(root, 'utf16.txt'), '/') as {reason: string}).reason, /UTF-16.*\/open it in your editor/u);

    if (spawnSync('mkfifo', [join(root, 'pipe')]).status === 0) {
      // Opening a FIFO must not wait for a writer: it is refused at once.
      const started = Date.now();
      assert.match((await loadFileDocument(join(root, 'pipe'), '/') as {reason: string}).reason, /not a regular file/u);
      assert.ok(Date.now() - started < 2000);
    }
    if (process.getuid?.() !== 0) {
      writeFileSync(join(root, 'secret.txt'), 'x');
      chmodSync(join(root, 'secret.txt'), 0o000);
      assert.match((await loadFileDocument(join(root, 'secret.txt'), '/') as {reason: string}).reason, /permission denied/u);
      chmodSync(join(root, 'secret.txt'), 0o600);
    }

    writeFileSync(join(root, 'bad.txt'), Buffer.from([0x61, 0xff, 0x62, 0x0a]));
    const bad = await load(join(root, 'bad.txt'));
    assert.deepEqual(bad.lines, ['a�b']);
    assert.match(bad.notes.join(' '), /Not valid UTF-8/u);

    // A cut never splits a UTF-8 sequence, and says what it left out.
    writeFileSync(join(root, 'big.txt'), 'é'.repeat(100));
    const cut = await load(join(root, 'big.txt'), {maxBytes: 51});
    assert.equal(cut.text, 'é'.repeat(25));
    assert.equal(cut.complete, false);
    assert.match(cut.notes[0]!, /Showing the first/u);
    assert.match(cut.notes[0]!, /press o to open it in your editor/u, 'the note names the way to the rest');
    writeFileSync(join(root, 'many.txt'), Array.from({length: 50}, (_, index) => `line ${index}`).join('\n'));
    const many = await load(join(root, 'many.txt'), {maxLines: 10});
    assert.equal(many.lines.length, 10);
    assert.equal(many.complete, false);
    assert.match(many.notes[0]!, /press o to open it in your editor/u);

    symlinkSync(join(root, 'a.ts'), join(root, 'link.ts'));
    const linked = await load(join(root, 'link.ts'));
    assert.ok(linked.origin.kind === 'file' && linked.origin.symlink && linked.origin.realPath === join(root, 'a.ts'));
    assert.match(shown(draw(createViewer(linked), 400)).join('\n'), new RegExp(`→ ${join(root, 'a.ts').replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}`, 'u'));

    // A file name is untrusted text too: its controls never reach the transcript or the header as controls.
    const hostileName = join(root, 'evil\u001b[2J\u202e.txt');
    const missing = await loadFileDocument(hostileName, '/') as {reason: string};
    assert.doesNotMatch(missing.reason, /[\u001b\u202e]/u);
    assert.match(missing.reason, /evil␛\[2J·\.txt does not exist/u);
    writeFileSync(hostileName, 'x\n');
    assert.doesNotMatch(draw(createViewer(await load(hostileName))).join('').replace(/\u001b\[[0-9;]*m/gu, ''), /[\u001b\u202e]/u);

    // Reading changes nothing.
    assert.equal(readFileSync(join(root, 'a.ts'), 'utf8'), 'const a = 1;\r\nconst b = 2;\r\n');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('hostile text is drawn inert at every width: no terminal controls, no bidi tricks, nothing wider than the panel', () => {
  const hostile = ['\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007 \u001b[2J\u001b[31mred', 'admin‮gnp.exe', 'zero​width\ttab', '中文字符 and emoji 🎉', 'x'.repeat(500)].join('\n');
  const document = outputDocument({command: 'cat hostile', output: hostile}, 1);
  for (const columns of [32, 80, 120]) {
    const rows = draw(createViewer(document), columns, 24);
    for (const row of rows) {
      const visible = stripAnsi(row);
      assert.doesNotMatch(row.replace(/\u001b\[[0-9;]*m/gu, ''), /\u001b/u, 'only NMSh SGR styling remains');
      assert.doesNotMatch(visible, /[‮​]/u, 'format characters are shown as marks');
      assert.ok(displayWidth(visible) <= columns, `row fits ${columns} columns`);
    }
    const joined = shown(rows).join('\n');
    assert.match(joined, /␛\]8;;https:\/\/evil/u, 'escape sequences are visible text, never links or colors');
    assert.match(joined, /admin·gnp\.exe/u);
  }
  assert.equal(document.format, 'text', 'command output is never implicitly Markdown');
});

test('Markdown files render, switch to source with m, and output whose command is a diff reads as a diff', async () => {
  const root = scratch();
  try {
    writeFileSync(join(root, 'README.md'), '# Title\n\nSome **bold** text and `code`.\n\n- one\n- two\n');
    const document = await load(join(root, 'README.md'));
    const viewer = createViewer(document);
    assert.equal(viewer.rendered, true);
    const rendered = shown(draw(viewer)).join('\n');
    assert.match(rendered, /Title/u);
    assert.doesNotMatch(rendered, /\*\*bold\*\*/u, 'rendered, not source');
    press(viewer, ['m']);
    assert.match(shown(draw(viewer)).join('\n'), /\*\*bold\*\*/u, 'source on m');
    const diff = outputDocument({command: 'git diff', output: 'diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n'}, 1);
    assert.equal(diff.format, 'diff');
    assert.equal(outputDocument({command: 'cat notes.md', output: '# not markdown here\n'}, 1).format, 'text');
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('o hands a file to the person\'s editor at the first line on screen; output has no file and offers nothing', async () => {
  const root = scratch();
  try {
    const path = join(root, 'notes.txt');
    writeFileSync(path, Array.from({length: 200}, (_, index) => `line ${index + 1}`).join('\n'));
    const viewer = createViewer(await load(path));
    draw(viewer);
    assert.deepEqual(press(viewer, ['o']), {kind: 'open', path, line: 1});
    press(viewer, [':', '4', '2', {kind: 'enter'}]);
    assert.deepEqual(press(viewer, ['o']), {kind: 'open', path, line: 42}, 'the line at the top of the view');
    assert.match(shown(draw(viewer)).join('\n'), /o open in editor/u, 'the footer offers it for files');

    // Rendered Markdown rows are not source lines: the file opens at its start; the source view keeps the line.
    writeFileSync(join(root, 'README.md'), `# Title\n\n${'text\n\n'.repeat(80)}`);
    const markdown = createViewer(await load(join(root, 'README.md')));
    draw(markdown);
    press(markdown, [{kind: 'pageDown'}]);
    assert.deepEqual(press(markdown, ['o']), {kind: 'open', path: join(root, 'README.md')});
    press(markdown, ['m', 'G']);
    draw(markdown);
    const source = press(markdown, ['o']);
    assert.equal(source?.kind, 'open');
    assert.ok(source?.kind === 'open' && source.line === markdown.top + 1 && source.line > 1);

    const output = createViewer(outputDocument({command: 'seq 3', output: '1\n2\n3\n'}, 1));
    assert.equal(press(output, ['o']), undefined, 'stored output is not a file');
    assert.doesNotMatch(shown(draw(output)).join('\n'), /open in editor/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('search finds, counts and steps through matches, wrapping with a note; Esc clears it before closing', () => {
  const document = outputDocument({command: 'log', output: Array.from({length: 300}, (_, index) => index % 50 === 7 ? `ERROR at ${index}` : `ok ${index}`).join('\n')}, 1);
  const viewer = createViewer(document);
  draw(viewer);
  press(viewer, ['/', ...'error'.split(''), {kind: 'enter'}]);
  assert.equal(viewer.matchCount, 6, 'smart case: a lowercase query ignores case');
  assert.equal(viewer.match?.unit, 7);
  draw(viewer);
  press(viewer, ['n']);
  assert.equal(viewer.match?.unit, 57);
  press(viewer, ['N', 'N']);
  assert.equal(viewer.match?.unit, 257, 'wrapped to the bottom');
  assert.match(viewer.note ?? '', /wrapped/u);
  const rows = shown(draw(viewer)).join('\n');
  assert.match(rows, /6 matches for “error”/u);
  assert.equal(press(viewer, [{kind: 'escape'}]), undefined, 'first Esc clears the search');
  assert.equal(viewer.query, undefined);
  assert.deepEqual(press(viewer, [{kind: 'escape'}]), {kind: 'close'});
});

test('navigation: page, end, go to line, wrap off with horizontal scroll, line numbers, mouse wheel, copy all', () => {
  const lines = Array.from({length: 1000}, (_, index) => `${index + 1}: ${'word '.repeat(30)}`);
  const viewer = createViewer(outputDocument({command: 'seq', output: lines.join('\n')}, 3));
  draw(viewer);
  press(viewer, [{kind: 'pageDown'}]);
  assert.ok(viewer.top > 0);
  press(viewer, ['G']);
  draw(viewer);
  assert.equal(viewer.shown?.last, 999, 'End shows the last line at the bottom');
  press(viewer, [':', '5', '0', '0', {kind: 'enter'}]);
  assert.equal(viewer.top, 499);
  assert.match(shown(draw(viewer)).join('\n'), /^\s+500 500: word/mu, 'numbered from the source line');
  press(viewer, ['w', {kind: 'right'}, {kind: 'right'}]);
  assert.equal(viewer.wrap, false);
  assert.equal(viewer.left, 16);
  assert.match(shown(draw(viewer)).join('\n'), /‹/u, 'more to the left is marked');
  press(viewer, [{kind: 'wheelDown'}]);
  assert.equal(viewer.top, 502);
  press(viewer, ['l']);
  assert.equal(viewer.numbers, false);
  assert.deepEqual(press(viewer, ['c']), {kind: 'copy', text: lines.join('\n'), lines: 1000});
  assert.match(shown(draw(viewer)).join('\n'), /output 3 · 1,000 lines/u);
});

test('bounded: a 200,000-line document opens and jumps to its end quickly, and one huge line wraps to a summary', () => {
  const big = createViewer(outputDocument({command: 'big', output: Array.from({length: 200_000}, (_, index) => `row ${index}`).join('\n')}, 1));
  const started = performance.now();
  draw(big, 120, 40);
  press(big, ['G'], 120, 40);
  draw(big, 120, 40);
  assert.equal(big.shown?.last, 199_999);
  assert.ok(performance.now() - started < 1500, `took ${Math.round(performance.now() - started)}ms`);
  const wide = createViewer(outputDocument({command: 'one line', output: 'y'.repeat(1_000_000)}, 1));
  const rows = shown(draw(wide, 80, 400));
  assert.ok(rows.some(row => /more characters on this line/u.test(row)));
  assert.ok(rows.length <= 400);
});

test('narrow and tiny panels still fit and keep the close control reachable', () => {
  const viewer = createViewer(outputDocument({command: 'x', output: 'a\nb\nc'}, 1));
  for (const [columns, height] of [[32, 10], [20, 6], [80, 3]] as const) {
    const rows = draw(viewer, columns, height);
    assert.ok(rows.length <= height, `${columns}x${height}: ${rows.length} rows`);
    for (const row of rows) assert.ok(displayWidth(stripAnsi(row)) <= columns);
  }
  assert.deepEqual(press(viewer, ['q']), {kind: 'close'});
});
