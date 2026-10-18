import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {clearProviderDetection} from '../src/providers/providers.js';
import {stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {SETUP_SECTIONS, sectionIndex, setupKey, setupSelectedRow} from '../src/setup/SetupCat.js';

/**
 * #366 (D3) through the real TerminalApp: Settings → Terminal editor lists the curated editors with what is installed
 * here, saves an installed choice, refuses one that is not, and /open then composes the chosen editor's command for
 * the person to run. VISUAL/EDITOR are unset; PATH holds stub executables only; nothing is executed or installed.
 */

async function settled(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(done => setTimeout(done, 10));
  }
}

test('Terminal editor: choose an installed editor, refuse a missing one; /open composes the chosen command', async () => {
  // Hermetic: not inside Zed or VS Code either (the surrounding editor would rightly win).
  const saved = {PATH: process.env.PATH, VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR, ZED_TERM: process.env.ZED_TERM};
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-editors-')));
  const f = executionFrameFixture(100, 30);
  try {
    for (const name of ['hx', 'micro']) { writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, name), 0o755); }
    process.env.PATH = bin;
    delete process.env.VISUAL;
    delete process.env.EDITOR;
    delete process.env.ZED_TERM;
    clearProviderDetection();
    const app = f.app;
    app['startProviderPanel']('editor');
    const state = app['providerPanelState']!;
    assert.equal(state.title, 'Terminal editor');
    await settled(() => Object.keys(state.statuses).length === state.providers.length, 'detection');
    assert.equal(state.statuses.hx?.state, 'installed');
    assert.equal(state.statuses.nvim?.state, 'missing');
    // Highlighting shows the command /open would compose; nothing runs.
    state.selectedIndex = state.providers.findIndex(provider => provider.id === 'hx');
    const preview = app['providerPreview'](state, 96).map(line => stripAnsi(line)).join('\n');
    assert.match(preview, /puts this in the composer for you to run: hx README\.md:12:5/u);
    // A missing editor cannot be chosen: the reason is shown and nothing is saved.
    state.selectedIndex = state.providers.findIndex(provider => provider.id === 'nvim');
    await app['handleProviderPanelKey']({kind: 'enter'}, state);
    assert.match(state.message ?? '', /no curated install for Neovim/u);
    assert.equal(app['promptConfiguration'].terminalEditor, 'environment');
    // An installed one is saved.
    state.selectedIndex = state.providers.findIndex(provider => provider.id === 'hx');
    await app['handleProviderPanelKey']({kind: 'enter'}, state);
    assert.equal(app['promptConfiguration'].terminalEditor, 'hx');
    assert.equal(app['providerPanelState'], undefined);
    // /open composes Helix's own form, quoted for the session's shell, for the person to run.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-editors-files-')));
    try {
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'docs', 'a note.md'), 'x\n');
      await app['openLocation']('/open docs/a note.md:3', 'docs/a note.md:3', root);
      const notes = (app['output'].transcript().lines as Array<Array<{text?: string} | null>>).map(line => line.map(cell => cell?.text ?? ' ').join('').trim()).filter(Boolean).slice(-3).join(' | ');
      assert.equal(app['editor'].text, `hx '${join(root, 'docs', 'a note.md')}:3'`, notes);
    } finally { rmSync(root, {recursive: true, force: true}); }
  } finally {
    f.dispose();
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    clearProviderDetection();
    rmSync(bin, {recursive: true, force: true});
  }
});

test('Setup → Sessions → Terminal editor opens the chooser over Setup and comes back to the same step with the choice', async () => {
  const saved = {PATH: process.env.PATH, VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR, ZED_TERM: process.env.ZED_TERM};
  const bin = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-editors-')));
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    writeFileSync(join(bin, 'hx'), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, 'hx'), 0o755);
    process.env.PATH = bin;
    delete process.env.VISUAL; delete process.env.EDITOR; delete process.env.ZED_TERM;
    clearProviderDetection();
    app['render'] = () => {};
    app['startSetup']('sessions');
    const state = app['setupState']!;
    const goTo = (row: string) => {
      state.section = sectionIndex('sessions'); state.row = 0;
      for (let guard = 0; guard < 80 && setupSelectedRow(state)?.row.id !== row; guard += 1) setupKey(state, {kind: 'down'});
      assert.equal(setupSelectedRow(state)?.row.id, row);
    };
    // An unapplied edit elsewhere in the step waits in the draft.
    goTo('terminalTitle');
    app['handleKey']({kind: 'right'});
    const pending = state.draft.terminalTitle;
    assert.notEqual(pending, state.saved.terminalTitle);
    goTo('setupTerminalEditor');
    const row = state.row;
    app['handleKey']({kind: 'enter'});
    const panel = app['providerPanelState'];
    assert.equal(panel?.family, 'editor', 'the real chooser opens over Setup');
    assert.equal(app['setupState'], undefined);
    await settled(() => Object.keys(panel!.statuses).length === panel!.providers.length, 'detection');
    panel!.selectedIndex = panel!.providers.findIndex(provider => provider.id === 'hx');
    await app['handleProviderPanelKey']({kind: 'enter'}, panel!);
    assert.equal(app['setupState'], state, 'back in the same Setup');
    assert.equal(SETUP_SECTIONS[state.section]!.id, 'sessions');
    assert.equal(state.row, row, 'on the same row');
    assert.equal(state.draft.terminalEditor, 'hx', 'the choice joins the draft');
    assert.equal(state.draft.terminalTitle, pending, 'the other unapplied edit survives');
  } finally {
    app['stop'](0); app['session'].kill(); isolation.restore();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    clearProviderDetection();
    rmSync(bin, {recursive: true, force: true});
  }
});
