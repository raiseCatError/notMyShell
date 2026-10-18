import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';

/** A completed command block, as the shell would have produced it. */
function completed(app: TerminalApp, command: string, output: string, exitCode = 0): number {
  const buffer = app['output'];
  const startId = buffer.beginCommand(command, [`$ ${command}`]);
  buffer.write(output);
  buffer.complete(exitCode);
  return startId;
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

const transcriptText = (app: TerminalApp) => (app['output'].transcript().lines as Array<Array<{text?: string} | null>>)
  .map(line => line.map(cell => cell?.text ?? ' ').join('')).join('\n');

test('/view and View output open the native viewer on stored output; it owns keys until Esc and never writes to the transcript', async () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  app['render'] = () => {};
  try {
    completed(app, 'printf a', 'first\r\n');
    const startId = completed(app, 'printf b', 'second\tline\r\nthird\r\n', 2);
    const before = JSON.stringify(app['output'].transcript());
    app['openViewer']('', '/view');
    const viewer = app['viewer']!;
    assert.equal(viewer.document.title, 'printf b');
    assert.deepEqual(viewer.document.lines, ['second\tline', 'third'], 'the text /copy copies, tabs as written');
    assert.ok(viewer.document.origin.kind === 'output' && viewer.document.origin.exitCode === 2 && viewer.document.origin.number === 1);
    assert.equal(app['hasModalInput'](), true);
    app['handleKey']({kind: 'text', value: 'x'});
    assert.equal(app['editor'].text, '', 'keys belong to the viewer, not the composer');
    app['handleKey']({kind: 'escape'});
    assert.equal(app['viewer'], undefined);
    app['openViewer']('2', '/view 2');
    assert.equal(app['viewer']?.document.title, 'printf a');
    app['handleKey']({kind: 'escape'});
    await app['runBlockAction'](startId, 'view');
    assert.equal(app['viewer']?.document.title, 'printf b');
    app['handleKey']({kind: 'escape'});
    assert.equal(JSON.stringify(app['output'].transcript()), before, 'viewing writes nothing to the transcript');
    app['openViewer']('9', '/view 9');
    assert.equal(app['viewer'], undefined);
    assert.match(transcriptText(app), /No completed command output at 9\./u);
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});

test('/view <file> reads relative to the shell directory; a missing file is reported in the transcript', async () => {
  const isolation = isolateConfig();
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-viewapp-')));
  const app = new TerminalApp();
  app['render'] = () => {};
  try {
    app['shellCwd'] = root;
    writeFileSync(join(root, 'notes.md'), '# Notes\n\nhello\n');
    app['openViewer']('notes.md', '/view notes.md');
    await until(() => app['viewer'] !== undefined, 'the viewer');
    assert.equal(app['viewer']!.document.format, 'markdown');
    assert.equal(app['viewer']!.rendered, true);
    app['handleKey']({kind: 'escape'});
    app['openViewer']('missing.txt', '/view missing.txt');
    await until(() => /does not exist/u.test(transcriptText(app)), 'the missing-file notice');
    assert.equal(app['viewer'], undefined);
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); rmSync(root, {recursive: true, force: true}); }
});
