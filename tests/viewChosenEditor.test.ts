import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {clearProviderDetection} from '../src/providers/providers.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #434 with #439, together in the release: `o` in /view uses the terminal editor chosen in Settings when VISUAL and EDITOR
 * are unset, in that editor's own file:line form at the first line on screen. It composes the command; nothing runs.
 */
test('o in /view composes the chosen terminal editor\'s command at the line on screen; nothing runs', async () => {
  const saved = {PATH: process.env.PATH, VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR, ZED_TERM: process.env.ZED_TERM, TERM_PROGRAM: process.env.TERM_PROGRAM};
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-view-editor-bin-')));
  const frame = executionFrameFixture(100, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-view-editor-')));
  try {
    writeFileSync(join(bin, 'hx'), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, 'hx'), 0o755);
    process.env.PATH = bin;
    delete process.env.VISUAL; delete process.env.EDITOR; delete process.env.ZED_TERM;
    clearProviderDetection();
    writeFileSync(join(root, 'notes.txt'), Array.from({length: 200}, (_, index) => `line ${index + 1}`).join('\n'));
    frame.app['shellCwd'] = root;
    frame.app['promptConfiguration'] = {...frame.app['promptConfiguration'], terminalEditor: 'hx'};
    const writes: string[] = [];
    Object.defineProperty(frame.session, 'write', {value: (data: string) => { writes.push(data); }, configurable: true});
    frame.app['openViewer']('notes.txt', '/view notes.txt');
    const deadline = Date.now() + 5000;
    while (!frame.app['viewer']) { if (Date.now() > deadline) throw new Error('viewer'); await new Promise(done => setTimeout(done, 10)); }
    frame.capture();
    await frame.app['handleKey']({kind: 'text', value: 'o'});
    for (let i = 0; i < 20 && !frame.app['editor'].text; i += 1) await new Promise(done => setTimeout(done, 10));
    const text = frame.app['editor'].text as string;
    assert.match(text, /^hx /u, `the chosen editor composes the command: ${text}`);
    assert.ok(text.includes(join(root, 'notes.txt')), 'the file shown');
    assert.match(text, /notes\.txt:1(?::\d+)?'?$/u, 'Helix\'s own file:line form, at the first line on screen');
    assert.deepEqual(writes, [], 'nothing was run');
  } finally {
    frame.dispose(); rmSync(root, {recursive: true, force: true}); rmSync(bin, {recursive: true, force: true});
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    clearProviderDetection();
  }
});
