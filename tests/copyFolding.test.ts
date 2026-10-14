import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {OutputBuffer} from '../src/output/OutputBuffer.js';

/**
 * Folding is presentation; copying reads stored data. No copy path changes what is folded, unless "Auto-expand copied
 * output" is On, and then only the blocks whose text was actually copied, after the clipboard accepted it.
 * The clipboard is a stand-in tool first on PATH (the person's clipboard is never touched); it can be made to fail.
 */
function clipboardStub() {
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-clip-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const clip = join(dir, 'clip.txt');
  const failFlag = join(dir, 'fail');
  for (const name of ['pbcopy', 'xclip', 'wl-copy']) {
    writeFileSync(join(bin, name), `#!/bin/sh\n[ -e ${JSON.stringify(failFlag)} ] && exit 1\ncat > ${JSON.stringify(clip)}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const previous = {PATH: process.env.PATH, DISPLAY: process.env.DISPLAY};
  process.env.PATH = `${bin}:${process.env.PATH}`;
  if (process.platform === 'linux') process.env.DISPLAY = ':nmsh-test';
  return {
    read: () => { try { return readFileSync(clip, 'utf8'); } catch { return ''; } },
    failing: (on: boolean) => { if (on) writeFileSync(failFlag, ''); else rmSync(failFlag, {force: true}); },
    restore: () => { process.env.PATH = previous.PATH; if (previous.DISPLAY === undefined) delete process.env.DISPLAY; else process.env.DISPLAY = previous.DISPLAY; rmSync(dir, {recursive: true, force: true}); },
  };
}

const lines = (count: number, prefix: string) => Array.from({length: count}, (_, index) => `${prefix} ${index}\n`).join('');

function app(autoExpand = false) {
  const instance = new TerminalApp();
  const output = instance['output'] as OutputBuffer;
  output.setOutputFolding('smart');
  const add = (command: string, text: string, exitCode = 0) => {
    output.beginCommand(command, [`❯ ${command}`]);
    output.write(text);
    output.complete(exitCode);
    output.setCompletionLifecycle(exitCode ? `✘ Command failed · exit ${exitCode} · 1 ms` : '✔ Completed · 1 ms');
  };
  // Oldest first: three long (Smart folds them) and one silent. /copy 1 is "long-c".
  add('long-a', lines(300, 'a'));
  add('silent', '');
  add('long-b', lines(300, 'b'), 2);
  add('long-c', lines(300, 'c'));
  instance['promptConfiguration'].copy = {mode: 'quick', includeStatus: false, autoExpand};
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns: 100, rows: 30})});
  instance['renderer'].render = (() => {}) as never;
  const folds = () => Object.fromEntries(output.recentShellCommands().map(record => [record.command, Boolean(record.expanded)]));
  /** Type a command and wait for its outcome: the copy note (success, nothing to copy, or failure) or a panel. */
  const type = async (text: string) => {
    instance['clipboardNote'] = undefined;
    for (const char of text) await instance['handleKey']({kind: 'text', value: char});
    await instance['handleKey']({kind: 'enter'});
    const deadline = Date.now() + 5000;
    while (!instance['clipboardNote'] && !instance['copyPicker'] && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  };
  const done = () => { instance['stop'](0); instance['session'].kill(); };
  return {instance, output, folds, type, done};
}

// A silent block has nothing to fold: it reads as expanded throughout.
const ALL_FOLDED = {'long-c': false, 'long-b': false, silent: true, 'long-a': false};

test('Auto-expand Off (default): no copy path changes folding; every copy reads the full stored output', async () => {
  const clip = clipboardStub();
  const {instance, folds, type, done, output} = app(false);
  try {
    assert.deepEqual(folds(), ALL_FOLDED, 'Smart folded the long blocks (silent has nothing to fold)');
    for (const command of ['/copy', '/copy 2', '/copy -4', '/copy 2-4', '/copy 1,4', '/cp', '/cp -2 --status', '/copy latest']) {
      await type(command);
      assert.deepEqual(folds(), ALL_FOLDED, command);
    }
    await type('/copy 1-4');
    assert.equal(clip.read().split('\n').length, 900, 'all 900 lines, though every block is folded');
    // The picker, direct block Copy and the Actions menu's copies.
    await type('/copy ui');
    await instance['handleKey']({kind: 'text', value: 'a'});
    instance['clipboardNote'] = undefined;
    await instance['handleKey']({kind: 'enter'});
    while (!instance['clipboardNote']) await new Promise(resolve => setTimeout(resolve, 20));
    const target = output.recentShellCommands()[2]!;
    await instance['copyBlock'](target.startId);
    for (const action of ['copyOutput', 'copyBoth', 'copyCommand'] as const) await instance['runBlockAction'](target.startId, action);
    assert.deepEqual(folds(), ALL_FOLDED);
    assert.equal(instance['historyViewport'].detached, false, 'no scroll change');
  } finally { done(); clip.restore(); }
});

test('Auto-expand On: exactly the copied blocks unfold, after success; silent and unselected blocks are untouched', async () => {
  const clip = clipboardStub();
  const {instance, folds, type, done, output} = app(true);
  try {
    await type('/copy 2-3');
    assert.deepEqual(folds(), {...ALL_FOLDED, 'long-b': true}, 'long-b was copied; silent added nothing');
    await type('/cp 4,1');
    assert.deepEqual(folds(), {'long-c': true, 'long-b': true, silent: true, 'long-a': true});
    // A person can fold a copied block again; it stays folded.
    instance['output'].toggleExpanded(0);
    assert.equal(folds()['long-c'], false);
    // A failed clipboard write expands nothing.
    clip.failing(true);
    instance['output'].toggleExpanded(1);
    const before = folds();
    await type('/copy -4');
    assert.deepEqual(folds(), before, 'nothing changes when the copy fails');
    clip.failing(false);
    // Block Copy expands only that block.
    const fresh = app(true);
    try {
      const target = fresh.output.recentShellCommands()[3]!;
      await fresh.instance['copyBlock'](target.startId);
      assert.deepEqual(fresh.folds(), {...ALL_FOLDED, 'long-a': true});
    } finally { fresh.done(); }
    assert.ok(output.recentShellCommands().length === 4);
  } finally { done(); clip.restore(); }
});

test('Auto-expand persists, is exported with the copy category, and defaults Off', async () => {
  const {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} = await import('../src/prompt/configuration.js');
  const {exportSettings} = await import('../src/configuration/portability.js');
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.copy.autoExpand, false);
  assert.equal(normalizePromptConfiguration({copy: {autoExpand: true}}).copy.autoExpand, true);
  const exported = exportSettings({...DEFAULT_PROMPT_CONFIGURATION, copy: {mode: 'quick', includeStatus: false, autoExpand: true}}, ['copy']);
  assert.deepEqual(exported.categories.copy, {copy: {mode: 'quick', includeStatus: false, autoExpand: true}});
});
