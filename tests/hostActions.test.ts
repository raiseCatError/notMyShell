import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configuredEditor, editorArguments, findSourceReferences, parseOpenArgument, resolveHostActions, resolveLocation, type HostEnvironment} from '../src/host/HostActions.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';

function host(env: NodeJS.ProcessEnv, bins: Record<string, string> = {}, help = ''): HostEnvironment {
  return {env, which: name => bins[name], helpText: () => help};
}

test('source references: relative, absolute, ~, line, line+column, quoted with spaces; no false positives', () => {
  const refs = (line: string) => findSourceReferences(line).map(ref => [ref.path, ref.line, ref.column]);
  assert.deepEqual(refs('src/app/TerminalApp.ts:418'), [['src/app/TerminalApp.ts', 418, undefined]]);
  assert.deepEqual(refs('  at fn (src/app/TerminalApp.ts:418:12)'), [['src/app/TerminalApp.ts', 418, 12]]);
  assert.deepEqual(refs('/abs/path/x.py:3: error'), [['/abs/path/x.py', 3, undefined]]);
  assert.deepEqual(refs('~/notes/todo.md:7'), [['~/notes/todo.md', 7, undefined]]);
  assert.deepEqual(refs('error in "My Docs/a file.ts:12:3" here'), [['My Docs/a file.ts', 12, 3]]);
  assert.deepEqual(refs('see http://example.com:8080 and 10:30 and Error: x and a:b'), []);
  assert.deepEqual(parseOpenArgument('src/my file.ts:72:14'), {path: 'src/my file.ts', line: 72, column: 14});
  assert.deepEqual(parseOpenArgument('"src/x.ts"'), {path: 'src/x.ts'});
  assert.equal(parseOpenArgument('  '), undefined);
  assert.deepEqual(parseSlashCommand('/open src/foo.ts:72'), {kind: 'open', target: 'src/foo.ts:72'});
  assert.deepEqual(parseSlashCommand('/open-diff "a b.ts" new.ts'), {kind: 'openDiff', left: 'a b.ts', right: 'new.ts'});
  assert.deepEqual(parseSlashCommand('/open'), {kind: 'open', target: ''});
});

test('location resolution: against the command cwd, not the process; missing, directory and control characters', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-open-')));
  try {
    mkdirSync(join(root, 'proj', 'src'), {recursive: true});
    writeFileSync(join(root, 'proj', 'src', 'a b.ts'), '');
    const ok = resolveLocation({path: 'src/a b.ts', line: 3}, join(root, 'proj'));
    assert.deepEqual(ok, {ok: true, kind: 'file', location: {path: join(root, 'proj', 'src', 'a b.ts'), line: 3}});
    assert.equal(resolveLocation({path: 'src/a b.ts'}, root).ok, false, 'a different cwd does not find it');
    assert.match((resolveLocation({path: 'nope.ts'}, root) as {reason: string}).reason, /does not exist/u);
    assert.equal((resolveLocation({path: 'proj'}, root) as {kind: string}).kind, 'directory');
    assert.equal(resolveLocation({path: 'x\u001b[2J'}, root).ok, false);
    assert.equal(resolveLocation({path: '~/x'}, root, join(root, 'proj')).ok, false);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('HostActions: Zed and VS Code use documented argv forms; paths are single argv elements', () => {
  const file = {path: '/w/my file.ts', line: 418, column: 12};
  const zed = resolveHostActions('auto', host({TERM_PROGRAM: 'zed'}, {zed: '/bin/zed'}, 'Usage: zed [OPTIONS] [PATHS]... --diff <OLD> <NEW>'));
  assert.equal(zed.id, 'zed');
  assert.equal(zed.capabilities.integratedEditor, 'zed');
  assert.deepEqual(zed.openFile(file), {kind: 'spawn', command: '/bin/zed', args: ['/w/my file.ts:418:12'], label: 'zed /w/my file.ts:418:12'});
  assert.deepEqual(zed.openDirectory('/w').kind === 'spawn' && zed.openDirectory('/w').args, ['/w']);
  assert.deepEqual((zed.openDiff('/a', '/b') as {args: string[]}).args, ['--diff', '/a', '/b']);
  const oldZed = resolveHostActions('auto', host({TERM_PROGRAM: 'zed'}, {zed: '/bin/zed'}, 'Usage: zed [PATHS]'));
  assert.equal(oldZed.openDiff('/a', '/b').kind, 'unsupported', 'no undocumented flag is assumed');
  assert.equal(oldZed.capabilities.nativeDiff, false);

  const code = resolveHostActions('auto', host({TERM_PROGRAM: 'vscode'}, {code: '/bin/code'}));
  assert.equal(code.id, 'vscode');
  assert.deepEqual((code.openFile(file) as {args: string[]}).args, ['--goto', '/w/my file.ts:418:12']);
  assert.deepEqual((code.openFile({path: '/w/a.ts'}) as {args: string[]}).args, ['/w/a.ts']);
  assert.deepEqual((code.openDiff('/a', '/b') as {args: string[]}).args, ['--diff', '/a', '/b']);
  assert.equal(code.openFile({path: '/w/$(rm -rf ~).ts', line: 1}).kind === 'spawn' && (code.openFile({path: '/w/$(rm -rf ~).ts', line: 1}) as {args: string[]}).args[1], '/w/$(rm -rf ~).ts:1',
    'shell metacharacters stay inert inside one argv element');
});

test('HostActions: terminals are not editors; VISUAL/EDITOR fallback composes a visible command; unsupported is factual', () => {
  const ghostty = resolveHostActions('auto', host({TERM_PROGRAM: 'ghostty'}));
  assert.equal(ghostty.id, 'none', 'Ghostty is never treated as an editor');
  assert.match((ghostty.openFile({path: '/x'}) as {reason: string}).reason, /VISUAL nor EDITOR/u);
  assert.equal(ghostty.openDiff('/a', '/b').kind, 'unsupported');
  const vim = resolveHostActions('auto', host({TERM_PROGRAM: 'ghostty', EDITOR: 'nvim'}));
  assert.deepEqual(vim.openFile({path: '/w/a b.ts', line: 9, column: 2}), {kind: 'compose', argv: ['nvim', '+9', '/w/a b.ts'], label: 'nvim'});
  assert.equal(vim.openDiff('/a', '/b').kind, 'unsupported');
  assert.deepEqual(editorArguments(['hx'], {path: '/a', line: 3, column: 4}), ['hx', '/a:3:4']);
  assert.deepEqual(editorArguments(['micro'], {path: '/a', line: 3, column: 4}), ['micro', '+3:4', '/a']);
  assert.deepEqual(editorArguments(['my-editor'], {path: '/a', line: 3}), ['my-editor', '/a'], 'no guessed flag for unknown editors');
  assert.deepEqual(configuredEditor({VISUAL: 'emacsclient -t', EDITOR: 'vi'}), ['emacsclient', '-t']);
  const codeEditor = resolveHostActions('auto', host({EDITOR: 'code -w'}, {code: '/bin/code'}));
  assert.equal(codeEditor.id, 'vscode', 'a GUI editor in EDITOR keeps its native integration');
  const forcedMissing = resolveHostActions('zed', host({}, {}));
  assert.match((forcedMissing.openFile({path: '/x'}) as {reason: string}).reason, /^Open with is Zed, but its CLI/u, 'not "detected" when only configured');
  assert.equal(normalizePromptConfiguration({openWith: 'sublime'}).openWith, 'auto');
  assert.equal(normalizePromptConfiguration({openWith: 'vscode'}).openWith, 'vscode');
});

test('HostActions: inside Zed or VS Code without its CLI the message names the editor and its own install step', () => {
  const zed = resolveHostActions('auto', {...host({TERM_PROGRAM: 'zed', ZED_TERM: 'true'}), platform: 'darwin'});
  assert.equal(zed.capabilities.integratedEditor, 'zed');
  assert.equal(zed.capabilities.cliMissing, 'zed');
  const zedReason = (zed.openFile({path: '/x'}) as {reason: string}).reason;
  assert.match(zedReason, /^Zed detected, but its CLI \(zed\) is not on PATH\. In Zed: Cmd\+Shift\+P → "cli: install cli binary"/u);
  assert.doesNotMatch(zedReason, /No editor is known/u);
  const zedLinux = resolveHostActions('auto', {...host({TERM_PROGRAM: 'zed'}), platform: 'linux'});
  assert.match((zedLinux.openDiff('/a', '/b') as {reason: string}).reason, /~\/\.local\/bin/u);
  const code = resolveHostActions('auto', {...host({TERM_PROGRAM: 'vscode'}), platform: 'darwin'});
  assert.equal(code.capabilities.cliMissing, 'code');
  assert.match((code.openFile({path: '/x'}) as {reason: string}).reason, /^VS Code detected, but its CLI \(code\) is not on PATH\. In VS Code: Cmd\+Shift\+P → "Shell Command: Install 'code' command in PATH"/u);
  const zeditor = resolveHostActions('auto', host({TERM_PROGRAM: 'zed'}, {zeditor: '/usr/bin/zeditor'}, '--diff'));
  assert.deepEqual((zeditor.openFile({path: '/a.ts', line: 2}) as {command: string; args: string[]}).args, ['/a.ts:2'], 'installed CLI (any packaged name) works as before');
  const generic = resolveHostActions('auto', host({TERM_PROGRAM: 'Apple_Terminal'}));
  assert.match((generic.openFile({path: '/x'}) as {reason: string}).reason, /No editor is known here/u, 'a plain terminal keeps the generic message');
});
