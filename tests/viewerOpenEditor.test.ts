import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveHostActions, type HostActionAdapter} from '../src/host/HostActions.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #366: from `/view` to the person's own editor. `o` hands the file shown, at the first line on screen, to the same
 * bridge `/open` uses: a GUI editor is launched with argv, a terminal editor gets a reviewed command in the composer
 * (never run), and with no editor known the viewer says how to set one. No shell is started; nothing is executed.
 */

const host = (env: NodeJS.ProcessEnv) => ({env, platform: 'darwin' as const, which: () => undefined, helpText: () => ''});

async function fixture(name = 'notes.txt') {
  const frame = executionFrameFixture(100, 30);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-view-open-')));
  const path = join(root, name);
  writeFileSync(path, Array.from({length: 200}, (_, index) => `line ${index + 1}`).join('\n'));
  frame.app['shellCwd'] = root;
  const useEditor = (adapter: HostActionAdapter) => Object.defineProperty(frame.app, 'hostActions', {value: () => adapter, configurable: true});
  const open = async () => {
    frame.app['openViewer'](name, `/view ${name}`);
    const deadline = Date.now() + 5000;
    while (!frame.app['viewer']) {
      if (Date.now() > deadline) throw new Error('the viewer did not open');
      await new Promise(done => setTimeout(done, 10));
    }
    frame.capture();
    return frame.app['viewer']!;
  };
  const key = (value: string) => frame.app['handleKey']({kind: 'text', value});
  const enter = () => frame.app['handleKey']({kind: 'enter'});
  const transcript = () => (frame.app['output'].transcript().lines as Array<Array<{text?: string} | null>>)
    .map(line => line.map(cell => cell?.text ?? ' ').join('')).join('\n');
  const screen = () => frame.capture().frame.rows.map(row => stripAnsi(row)).join('\n');
  return {...frame, root, path, useEditor, open, key, enter, transcript, screen,
    cleanup() { frame.dispose(); rmSync(root, {recursive: true, force: true}); }};
}

test('a terminal editor gets a reviewed command in the composer at the line on screen; nothing runs', async () => {
  const f = await fixture();
  try {
    f.useEditor(resolveHostActions('editor', host({EDITOR: 'nvim'})));
    await f.open();
    f.key(':'); f.key('4'); f.key('1'); f.enter();
    f.key('o');
    assert.equal(f.app['viewer'], undefined, 'the viewer closes so the command is in view');
    assert.equal(f.app['editor'].text, `nvim +41 ${f.path}`);
    assert.match(f.transcript(), /Ready to open in nvim: press Enter to run it\./u);
    // CaptureSession.submit throws if anything is submitted; reaching here means nothing ran.
  } finally { f.cleanup(); }
});

test('a file name with spaces and shell characters stays one quoted argument', async () => {
  const name = 'my notes; rm -rf ~ $(x).txt';
  const f = await fixture(name);
  try {
    f.useEditor(resolveHostActions('editor', host({VISUAL: 'hx'})));
    await f.open();
    f.key('o');
    assert.equal(f.app['editor'].text, `hx '${f.path}:1'`, 'Helix takes path:line; the whole argument is quoted');
  } finally { f.cleanup(); }
});

test('a draft in the composer is never replaced: the viewer stays open and says why', async () => {
  const f = await fixture();
  try {
    f.useEditor(resolveHostActions('editor', host({EDITOR: 'vim'})));
    f.app['editor'].insert('git status --short');
    await f.open();
    f.key('o');
    assert.ok(f.app['viewer'], 'still viewing');
    assert.equal(f.app['editor'].text, 'git status --short', 'the draft is untouched');
    assert.match(f.screen(), /composer has a draft/u);
  } finally { f.cleanup(); }
});

test('a GUI editor is launched with argv and the viewer stays; a launch failure and no editor are said in the viewer', async () => {
  const f = await fixture();
  try {
    const launched: Array<{command: string; args: string[]}> = [];
    const gui = (command: string): HostActionAdapter => ({
      id: 'zed', label: 'Zed', capabilities: {nativeFileOpen: true, nativeDirectoryOpen: true, nativeDiff: true},
      openFile: location => { launched.push({command, args: [`${location.path}:${location.line}`]}); return {kind: 'spawn', command, args: ['-e', '0'], label: 'Zed'}; },
      openDirectory: () => ({kind: 'unsupported', reason: 'n/a'}), openDiff: () => ({kind: 'unsupported', reason: 'n/a'}),
    });
    f.useEditor(gui(process.execPath));
    const viewer = await f.open();
    f.key('G');
    f.capture();
    f.key('o');
    await new Promise(done => setTimeout(done, 200));
    assert.equal(launched.length, 1);
    assert.equal(launched[0]!.args[0], `${f.path}:${viewer.top + 1}`);
    assert.equal(f.app['viewer'], viewer, 'a GUI editor opens beside NMSh; the viewer stays');
    assert.match(f.screen(), /Opened in Zed\./u);
    assert.equal(f.app['editor'].text, '');

    f.useEditor(gui(join(f.root, 'no-such-editor')));
    f.key('o');
    await new Promise(done => setTimeout(done, 200));
    assert.match(f.screen(), /Could not start Zed/u);

    f.useEditor(resolveHostActions('auto', host({})));
    f.key('o');
    assert.match(f.screen(), /No editor is known here/u);
    assert.equal(f.app['editor'].text, '');
  } finally { f.cleanup(); }
});
