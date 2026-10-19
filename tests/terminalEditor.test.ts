import test from 'node:test';
import assert from 'node:assert/strict';
import {editorArguments, resolveHostActions, type HostEnvironment} from '../src/host/HostActions.js';
import {TERMINAL_EDITORS, installedTerminalEditors} from '../src/host/terminalEditors.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {PROVIDER_FAMILIES, selectProvider} from '../src/providers/families.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';

/**
 * #366 (decision D3): with VISUAL and EDITOR unset, /open and `o` in /view can use a terminal editor the person chose
 * from the ones installed here. Explicit choices win: Open with Zed or VS Code, the editor NMSh runs inside, then
 * VISUAL/EDITOR, then the chosen editor. Nothing is assumed installed, nothing is installed, nothing is run.
 */

function host(env: NodeJS.ProcessEnv, bins: Record<string, string> = {}): HostEnvironment {
  return {env, which: name => bins[name], helpText: () => ''};
}
const target = {path: '/w/notes.md', line: 12, column: 5};

test('terminal editor: used only when VISUAL and EDITOR are unset, and only when installed', () => {
  const chosen = resolveHostActions('auto', host({}, {hx: '/opt/bin/hx'}), 'hx');
  assert.deepEqual(chosen.openFile(target), {kind: 'compose', argv: ['hx', '/w/notes.md:12:5'], label: 'Helix'});
  // An explicit preference in the environment wins over NMSh's own choice.
  const env = resolveHostActions('auto', host({EDITOR: 'vim'}, {hx: '/opt/bin/hx'}), 'hx');
  assert.deepEqual(env.openFile(target), {kind: 'compose', argv: ['vim', '+12', '/w/notes.md'], label: 'vim'});
  // So does the editor NMSh runs inside, and an explicit Open with.
  const zed = resolveHostActions('auto', host({TERM_PROGRAM: 'zed'}, {zed: '/opt/bin/zed', hx: '/opt/bin/hx'}), 'hx');
  assert.equal(zed.id, 'zed');
  const code = resolveHostActions('vscode', host({}, {code: '/opt/bin/code', hx: '/opt/bin/hx'}), 'hx');
  assert.equal(code.id, 'vscode');
  // Open with VISUAL/EDITOR and nothing set: the chosen editor stands in.
  const editorChoice = resolveHostActions('editor', host({}, {micro: '/opt/bin/micro'}), 'micro');
  assert.deepEqual(editorChoice.openFile(target), {kind: 'compose', argv: ['micro', '+12:5', '/w/notes.md'], label: 'Micro'});
  // Chosen but not installed here: said plainly; nothing else is guessed.
  const missing = resolveHostActions('auto', host({}, {}), 'nvim');
  const reason = (missing.openFile(target) as {kind: string; reason: string});
  assert.equal(reason.kind, 'unsupported');
  assert.match(reason.reason, /Neovim \(nvim\) is chosen in Settings → Terminal editor but is not on PATH/u);
});

test('terminal editor: with none chosen, the message names the editors installed here and where to choose', () => {
  const none = resolveHostActions('auto', host({}, {nvim: '/opt/bin/nvim', micro: '/opt/bin/micro'}), 'environment');
  const reason = (none.openFile(target) as {reason: string}).reason;
  assert.match(reason, /VISUAL nor EDITOR/u);
  assert.match(reason, /\/settings → Terminal editor/u);
  assert.match(reason, /installed here: Neovim, Micro/u);
  const bare = resolveHostActions('auto', host({}, {}), 'environment');
  assert.doesNotMatch((bare.openFile(target) as {reason: string}).reason, /installed here/u, 'no list when none is installed');
  assert.deepEqual(installedTerminalEditors(host({}, {kak: '/k', emacs: '/e'})).map(editor => editor.id), ['emacs', 'kak'], 'catalog order');
});

test('terminal editor: each editor gets only the line and column forms its documentation describes', () => {
  const argv = (id: string) => {
    const editor = TERMINAL_EDITORS.find(item => item.id === id)!;
    return editorArguments(editor.argv!, target);
  };
  assert.deepEqual(argv('nvim'), ['nvim', '+12', '/w/notes.md'], 'Vim and Neovim: +N (no column flag)');
  assert.deepEqual(argv('vim'), ['vim', '+12', '/w/notes.md']);
  assert.deepEqual(argv('hx'), ['hx', '/w/notes.md:12:5'], 'Helix: path:N:C');
  assert.deepEqual(argv('micro'), ['micro', '+12:5', '/w/notes.md'], 'Micro: +N:C');
  assert.deepEqual(argv('nano'), ['nano', '+12,5', '/w/notes.md'], 'nano: +N,C');
  assert.deepEqual(argv('emacs'), ['emacs', '-nw', '+12:5', '/w/notes.md'], 'Emacs in the terminal: -nw, +N:C');
  assert.deepEqual(argv('kak'), ['kak', '+12', '/w/notes.md'], 'Kakoune: +N');
  assert.deepEqual(editorArguments(['nano'], {path: '/a', line: 3}), ['nano', '+3', '/a'], 'no column: none passed');
  assert.deepEqual(editorArguments(['nano'], {path: '/a'}), ['nano', '/a'], 'no line: the file alone');
  // Paths stay one argument; nothing is joined into shell text here.
  assert.deepEqual(editorArguments(['micro'], {path: '/w/a b; rm -rf ~.md', line: 1}), ['micro', '+1', '/w/a b; rm -rf ~.md']);
});

test('terminal editor: a setting of its own, normalized; a provider family for /providers, Ask and Settings', () => {
  assert.equal(normalizePromptConfiguration({}).terminalEditor, 'environment', 'VISUAL/EDITOR by default');
  assert.equal(normalizePromptConfiguration({terminalEditor: 'hx'}).terminalEditor, 'hx');
  assert.equal(normalizePromptConfiguration({terminalEditor: 'sublime'}).terminalEditor, 'environment', 'unknown values fall back');
  const family = PROVIDER_FAMILIES.find(item => item.family === 'editor');
  assert.ok(family, 'the Terminal editor family is listed with the others');
  assert.equal(family.title, 'Terminal editor');
  assert.equal(family.fallback, 'environment');
  const base = normalizePromptConfiguration({});
  assert.equal(selectProvider(base, 'editor', 'micro')?.terminalEditor, 'micro');
  assert.equal(selectProvider(base, 'editor', 'notepad'), undefined, 'unknown editors change nothing');
  for (const editor of TERMINAL_EDITORS) {
    assert.equal(editor.install, undefined, `${editor.label}: NMSh never installs an editor`);
    assert.equal(editor.recipe, undefined, `${editor.label}: no install recipe`);
    assert.equal(editor.versionArgs, undefined, `${editor.label}: detection never runs the editor`);
  }
  const row = SETTINGS_ROWS.find(item => item.id === 'terminalEditor');
  assert.ok(row && row.control === 'child' && row.destination === 'editor', 'Settings → Sessions → Terminal editor opens the chooser');
  assert.equal(row.category, 'Sessions');
});
