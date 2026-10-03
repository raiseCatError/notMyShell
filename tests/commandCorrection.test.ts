import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CommandCorrectionService, correctionTarget, renderCorrection, type CommandCorrection} from '../src/shell/CommandCorrection.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const correction: CommandCorrection = {correction: true, original: 'gti status', insertion: 'git status', name: 'git status', description: 'Correction'};
const diagnostic = 'zsh: command not found: gti\n';
function cleanup(app: TerminalApp): void { app['stop'](0); app['session'].kill(); }

test('deterministic one-edit matching requires an unambiguous safe command', () => {
  assert.equal(correctionTarget('gti', ['git', 'grep', 'npm']), 'git');
  assert.equal(correctionTarget('grpe', ['grep']), 'grep');
  assert.equal(correctionTarget('gitt', ['git']), 'git');
  assert.equal(correctionTarget('pythom', ['python']), 'python');
  for (const [typed, names] of [['gti', ['git', 'gtd']], ['git', ['git']], ['gxx', ['git']],
    ['nmp', ['npm', 'nmap']], ['rmdri', ['rmdir']], ['rg', ['rgt']], ['Gti', ['git']]] as const)
    assert.equal(correctionTarget(typed, names), undefined);
});

test('only a simple exit-127 command-not-found diagnostic and executable files can suggest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-correction-test-'));
  try {
    await writeFile(join(directory, 'git'), '#!/bin/sh\nexit 0\n', {mode: 0o700});
    await writeFile(join(directory, 'gtd'), 'not executable', {mode: 0o600});
    const service = new CommandCorrectionService({PATH: directory});
    assert.equal((await service.suggest('gti status', 127, diagnostic))?.insertion, 'git status');
    assert.equal((await service.suggest('gti status', 127, 'zsh:1: command not found: gti\n'))?.insertion, 'git status');
    for (const command of [' gti status', 'gti | cat', 'gti; pwd', 'gti $(pwd)', 'gti "status"', 'gti >file', 'gti\nstatus', 'X=1 gti', '/tmp/gti', 'sudo gti'])
      assert.equal(await service.suggest(command, 127, diagnostic), undefined);
    assert.equal(await service.suggest('gti status', 1, diagnostic), undefined);
    assert.equal(await service.suggest('gti status', 127, 'unrelated failure'), undefined);
    assert.equal(await service.suggest('git status', 127, 'zsh: command not found: git\n'), undefined);
    await writeFile(join(directory, 'gti'), '#!/bin/sh\nexit 127\n', {mode: 0o700});
    assert.equal(await new CommandCorrectionService({PATH: directory}).suggest('gti status', 127, diagnostic), undefined);
    const controller = new AbortController(); controller.abort();
    assert.equal(await service.suggest('gti status', 127, diagnostic, controller.signal), undefined);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('Tab edits, Escape dismisses, and Enter never executes a suggestion automatically', async () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  const submitted: string[] = [];
  app['session'].submit = ((text: string) => submitted.push(text)) as never;
  try {
    const before = app['output'].transcript();
    app['correction'] = correction;
    assert.deepEqual(app['composerSuggestions'](), [correction]);
    app['handleKey']({kind: 'complete'});
    assert.equal(app['editor'].text, 'git status');
    assert.deepEqual(submitted, []);
    assert.deepEqual(app['output'].transcript(), before);
    assert.equal(app['correction'], undefined);
    app['editor'].clear(); app['correction'] = correction;
    app['handleKey']({kind: 'escape'});
    assert.equal(app['correction'], undefined);
    assert.equal(app['editor'].text, '');
    app['correction'] = correction;
    await app['submit']();
    assert.deepEqual(submitted, []);
    assert.equal(app['correction'], undefined);
  } finally { cleanup(app); }
});

test('typing cancels pending correction and late results never repaint after ABA buffer changes', async () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  let complete!: (value: CommandCorrection) => void;
  app['correctionService'].suggest = () => new Promise(resolve => { complete = resolve; });
  try {
    const pending = app['suggestCorrection']('gti status', 127, diagnostic);
    app['handleKey']({kind: 'text', value: 'x'});
    app['handleKey']({kind: 'backspace'});
    complete(correction); await pending;
    assert.equal(app['editor'].text, '');
    assert.equal(app['correction'], undefined);
  } finally { cleanup(app); }
});

test('correction uses Safe glyphs, no-color and clips cleanly in narrow terminals', () => {
  const noColor = process.env.NO_COLOR;
  process.env.NO_COLOR = '1'; setIconStyle('safe');
  try {
    for (const width of [1, 8, 24, 80]) {
      const row = renderCorrection(correction, width);
      assert.ok(displayWidth(row) <= width);
      assert.doesNotMatch(stripAnsi(row), /[\ue000-\uf8ff]/u);
      assert.doesNotMatch(row, /\u001b\[(?:38|48);/u);
    }
    assert.match(stripAnsi(renderCorrection(correction, 100)), /Tab.*edit.*Esc.*dismiss/u);
  } finally { setIconStyle('nerd'); if (noColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = noColor; }
});

test('multi-key input cannot Tab-insert completion from an older buffer before render', () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  try {
    app['editor'].insert('git st');
    app['shellSuggestions'] = [{context: {buffer: 'git s', cwd: app['context'].cwd}, insertion: 'git stash'}] as never;
    app['handleKey']({kind: 'complete'});
    assert.equal(app['editor'].text, 'git st');
    assert.deepEqual(app['shellSuggestions'], []);
  } finally { cleanup(app); }
});
