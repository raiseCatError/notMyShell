import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {askKey, blockOptions, createAskState, receiveOutcome, renderAsk, submitText, visibleOptions} from '../src/ask/AskPanel.js';
import {resolveActivity} from '../src/ask/activity.js';
import type {AskContext, AskOutcome, CommandBlock} from '../src/ask/types.js';
import {stripAnsi} from '../src/util/text.js';

const add: CommandBlock = {argv: ['git', 'add', '--', 'a.txt', 'notes/test file.md'], provenance: 'context', risk: 'mutate', run: {kind: 'git', argv: ['git', 'add', '--', 'a.txt', 'notes/test file.md'], risk: 'mutate'}};
const clean: CommandBlock = {argv: ['git', 'clean', '-fd'], provenance: 'context', risk: 'destructive'};
const answer = (block: CommandBlock, extra: Partial<AskOutcome> = {}): AskOutcome => ({kind: 'answer', capability: 'git.status', text: 'Stage 2 files?', block, ...extra} as AskOutcome);

test('command blocks: Copy and Insert never execute; Run only reaches the final Yes/No, starting on No', () => {
  const state = createAskState();
  receiveOutcome(state, answer(add));
  assert.deepEqual(visibleOptions(state).map(option => option.key), ['block:copy', 'block:insert', 'block:run']);
  const rows = renderAsk(state, 100).map(stripAnsi);
  assert.ok(rows.some(row => row.trim() === 'git add -- a.txt \'notes/test file.md\''), 'the command is its own line, quoted');
  assert.deepEqual(askKey(state, {kind: 'enter'}), {kind: 'copy', block: add});
  state.selected = 1;
  assert.deepEqual(askKey(state, {kind: 'enter'}), {kind: 'insert', block: add});
  state.selected = 2;
  assert.equal(askKey(state, {kind: 'enter'}), undefined, 'Run does not execute');
  assert.equal(state.pending?.kind, 'proposal');
  assert.equal(state.confirm, 'no', 'a change starts on No');
  assert.match(stripAnsi(renderAsk(state, 100).join('\n')), /\[ N Don't \]/u);
  assert.equal(askKey(state, {kind: 'enter'}), undefined, 'Enter on No does nothing');
  receiveOutcome(state, answer(add));
  state.selected = 2;
  askKey(state, {kind: 'enter'});
  askKey(state, {kind: 'left'});
  const event = askKey(state, {kind: 'enter'});
  assert.equal(event?.kind, 'execute', 'only the explicit final Yes executes');
  assert.ok(!renderAsk(state, 100).some(row => /always|don't ask again|trust/iu.test(stripAnsi(row))), 'no lasting approval exists');
});

test('typing part of a modifying choice only selects it; mutation still needs the separate Yes', () => {
  const state = createAskState();
  receiveOutcome(state, answer(add));
  const event = submitText(state, 'run');
  assert.equal(event, undefined);
  assert.equal(state.pending?.kind, 'proposal');
  assert.equal(state.confirm, 'no');
});

test('destructive blocks: Copy/Insert only, and "run it" is refused', () => {
  const state = createAskState();
  receiveOutcome(state, answer(clean));
  assert.deepEqual(blockOptions(clean).map(option => option.key), ['block:copy', 'block:insert']);
  assert.equal(submitText(state, 'run it'), undefined);
  assert.match(state.turns.at(-1)!.text, /won't run that/u);
  assert.deepEqual(submitText(state, 'copy it'), {kind: 'copy', block: clean});
});

test('what did I just do: facts, never output; unknown commands are not explained', () => {
  const context = {cwd: '/r', home: '/h', recent: [{command: 'git status', cwd: '/h/proj', branch: 'feature/foo', exitCode: 0, durationMs: 1200, lines: 4},
    {command: 'npm test', cwd: '/h/proj', exitCode: 1, lines: 30}]} as unknown as AskContext;
  const reference = {lookup: (words: string[]) => words[0] === 'git' ? {facts: {path: ['git', 'status'], description: 'Show the working tree status', subcommands: [], options: [{names: ['-s']}], args: [], source: 'catalog'}, rest: []} : undefined};
  const commands = {reference, identity: () => undefined} as never;
  const last = resolveActivity('what did i just do', context, commands)!;
  assert.match((last as {text: string}).text, /^You ran:\n {2}git status\nin ~\/proj on branch feature\/foo\. It exited successfully after 1s \(4 output lines\)\.\n\ngit status: Show the working tree status/u);
  assert.deepEqual((last as {next: Array<{label: string}>}).next.map(option => option.label), ['Explain syntax', 'Show useful options']);
  assert.equal((last as {block: CommandBlock}).block.literal, 'git status', 'Copy/Insert of exactly what was run; never Run');
  const unknown = resolveActivity('what was the last command', {...context, recent: [{command: 'frob --x', exitCode: 2, lines: 0}]} as AskContext, commands)!;
  assert.match((unknown as {text: string}).text, /failed with exit status 2[\s\S]*does not have enough local command knowledge/u);
  const summary = resolveActivity('what have i been doing', context, commands)!;
  assert.match((summary as {text: string}).text, /Recent work[\s\S]*✓ git status[\s\S]*✗ npm test[\s\S]*exit 1/u);
});

test('app: show untracked → add them → exact proposal → Yes → runs visibly → Ask stays open with refreshed facts and next steps', async () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-askgit-')));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], {stdio: 'ignore', env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null'}});
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'a');
  writeFileSync(join(repo, 'test file.md'), 'b');
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'render', {value: () => {}});
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns: 120, rows: 40})});
  instance['startupPending'] = false;
  // Pin the folder: the live shell would otherwise report its own cwd.
  const context = {...instance['context'], root: repo, branch: 'main'};
  Object.defineProperty(instance, 'context', {get: () => context, set: () => {}, configurable: true});
  Object.defineProperty(instance, 'shellCwd', {get: () => repo, set: () => {}, configurable: true});
  const ran: string[] = [];
  instance['submit'] = async () => {
    // Stand-in for the shell: run the exact visible command line's argv and record a completed block.
    const line = instance['editor'].text;
    ran.push(line);
    instance['editor'].clear();
    git('add', '--', 'a.txt', 'test file.md');
    instance['output'].beginCommand(line, [line]);
    instance['output'].complete(0);
  };
  const until = async (check: () => boolean) => { for (let i = 0; i < 300 && !check(); i += 1) await new Promise(resolve => setTimeout(resolve, 10)); };
  try {
    instance['openAsk']('what files are untracked');
    await until(() => !instance['askState']?.busy);
    assert.match(instance['askState']!.turns.at(-1)!.text, /2 untracked files/u);
    await instance['handleAskEvent'](submitText(instance['askState']!, 'add them')!);
    const pending = instance['askState']!.pending!;
    assert.equal(pending.kind === 'answer' && pending.block?.argv.join(' '), 'git add -- a.txt test file.md');
    assert.equal(ran.length, 0, 'nothing ran yet');
    instance['askState']!.selected = 2;
    instance['handleKey']({kind: 'enter'});
    assert.equal(instance['askState']!.pending?.kind, 'proposal');
    assert.equal(ran.length, 0, 'choosing Run is not the confirmation');
    instance['handleKey']({kind: 'left'});
    instance['handleKey']({kind: 'enter'});
    await until(() => instance['askState']?.working === undefined && ran.length > 0 && /staged/u.test(instance['askState']?.turns.at(-1)?.text ?? ''));
    assert.deepEqual(ran, ['git add -- a.txt \'test file.md\'']);
    assert.ok(instance['askState'], 'Ask stays open after the action');
    assert.match(instance['askState']!.turns.at(-1)!.text, /✓ git add[\s\S]*finished[\s\S]*2 files staged/u);
    assert.ok(instance['askState']!.pending?.kind === 'answer' && instance['askState']!.pending.next?.some(option => option.label === 'Commit staged changes'));
  } finally { instance['stop'](0); instance['session'].kill(); rmSync(repo, {recursive: true, force: true}); }
});
