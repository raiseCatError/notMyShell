import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readArgv, resolveRequest, pickOption, CAPABILITIES} from '../src/ask/resolver.js';
import {listProjectFiles} from '../src/ask/files.js';
import {parseWorktrees} from '../src/ask/git.js';
import {askKey, askTranscriptText, createAskState, receiveOutcome, renderAsk, submitText, visibleOptions, ASK_GREETING} from '../src/ask/AskPanel.js';
import type {AskContext, AskOutcome} from '../src/ask/types.js';
import {parseSlashCommand, slashSuggestions} from '../src/commands/slashCommands.js';
import {stripAnsi} from '../src/util/text.js';

const NOW = new Date(2026, 9, 4, 15, 0).getTime();
const day = (offset: number, hour: number) => new Date(2026, 9, 4 + offset, hour, 30).toISOString();
let root = '';
function context(extra: Partial<AskContext> = {}): AskContext {
  return {cwd: root, home: '/home/u', repoRoot: root, branch: 'feature/x', dirty: true, worktrees: [{path: root, branch: 'feature/x', current: true}],
    shell: 'zsh', defaultShell: 'zsh',
    shells: [{id: 'zsh', label: 'zsh', installed: true, installable: true}, {id: 'fish', label: 'Fish', installed: true, installable: true}, {id: 'bash', label: 'Bash', installed: false, installable: true}],
    sessions: [{id: 'me', state: 'attached', current: true, cwd: root, createdAt: NOW, shell: 'zsh'}],
    transcripts: [
      {id: 't-today', createdAt: day(0, 9), startCwd: root, finalCwd: root, project: 'p', commandCount: 3},
      {id: 't-y1', createdAt: day(-1, 10), startCwd: root, finalCwd: root, project: 'p', commandCount: 5},
      {id: 't-y2', createdAt: day(-1, 20), startCwd: '/elsewhere', finalCwd: '/elsewhere', project: 'q', commandCount: 1},
    ],
    recentFiles: [], recentCommands: ['npm test'], editor: {label: 'Zed', available: true},
    providers: [{family: 'suggestions', id: 'nmsh', label: 'NMSh Native', active: true, available: true}, {family: 'suggestions', id: 'deja', label: 'Deja', active: false, available: true},
      {family: 'prompt', id: 'nmsh', label: 'NMSh Native', active: true, available: true}],
    sessionMode: 'service', now: NOW, files: listProjectFiles(root), ...extra};
}
const resolve = (text: string, extra: Partial<AskContext> = {}, rejected?: Set<string>) => resolveRequest(text, context(extra), {rejected});
const kind = (outcome: AskOutcome) => outcome.kind === 'proposal' ? `proposal:${outcome.action.kind}` : outcome.kind;

test.before(() => {
  root = mkdtempSync(join(tmpdir(), 'nmsh-ask-'));
  for (const dir of ['src', 'src/prompt', 'tests', 'node_modules/pkg', '.git']) mkdirSync(join(root, dir), {recursive: true});
  for (const file of ['package.json', 'src/config.ts', 'src/prompt/configuration.ts', 'tests/configuration.test.ts', 'node_modules/pkg/config.js', '.git/config', 'README.md']) writeFileSync(join(root, file), '');
});
test.after(() => rmSync(root, {recursive: true, force: true}));

test('deterministic: shell questions and switching', () => {
  assert.match((resolve('what shell am i using') as {text: string}).text, /This session runs zsh/u);
  const fish = resolve('switch to fish');
  assert.equal(kind(fish), 'proposal:switchShell');
  assert.deepEqual(fish.kind === 'proposal' && fish.action, {kind: 'switchShell', shell: 'fish'});
  assert.equal(kind(resolve('install bash')), 'proposal:installShell');
  assert.equal(kind(resolve('install fish')), 'answer', 'an installed shell is not reinstalled');
  assert.match((resolve('how do i leave nmsh but come back') as {text: string}).text, /nmsh. there returns to it/u);
  assert.equal(kind(resolve('make fish my default shell')), 'proposal:setting');
});

test('deterministic: sessions, transcripts and temporal requests', () => {
  assert.deepEqual((resolve('show my sessions') as {action: unknown}).action, {kind: 'slash', slash: {kind: 'sessions'}, label: '/sessions'});
  assert.deepEqual((resolve('show old terminal output') as {action: unknown}).action, {kind: 'slash', slash: {kind: 'resume'}, label: '/resume'});
  const yesterday = resolve("resume yesterday's session");
  assert.equal(yesterday.kind, 'choose', 'two transcripts from yesterday: a picker');
  assert.deepEqual(yesterday.kind === 'choose' && yesterday.options.map(option => option.key), ['transcript:t-y1', 'transcript:t-y2']);
  const here = resolve('resume yesterday\'s session in this repo');
  assert.deepEqual(here.kind === 'proposal' && here.action, {kind: 'resumeTranscript', id: 't-y1'}, 'repository context narrows to one');
  assert.deepEqual((resolve('resume the last session') as {action: unknown}).action, {kind: 'resumeTranscript', id: 't-today'});
  assert.equal(resolve('resume this morning\'s session').kind, 'proposal');
  const live = resolve('resume the bash session', {sessions: [{id: 'me', state: 'attached', current: true, cwd: root, createdAt: NOW}, {id: 'b1', state: 'detached', current: false, cwd: root, createdAt: NOW, shell: 'bash'}]});
  assert.deepEqual(live.kind === 'proposal' && live.action, {kind: 'attachSession', id: 'b1'});
});

test('deterministic: Git read-only capabilities use fixed argv; worktrees are factual', () => {
  const status = resolve('check git status');
  assert.deepEqual(status.kind === 'proposal' && status.action, {kind: 'read', command: {id: 'git.status'}});
  assert.equal(status.kind === 'proposal' && status.safety, 'read');
  assert.deepEqual(readArgv({id: 'git.diff'}), ['git', 'diff']);
  assert.deepEqual((resolve('show git diff') as {action: unknown}).action, {kind: 'read', command: {id: 'git.diff'}});
  assert.match((resolve('what branch am i on') as {text: string}).text, /feature\/x/u);
  assert.match((resolve('show my worktrees') as {text: string}).text, /one worktree/u);
  const worktrees = [{path: root, branch: 'feature/x', current: true}, {path: '/w/release', branch: 'release', current: false}, {path: '/w/test', branch: 'test', current: false}];
  const which = resolve('show changes in my other worktree', {worktrees});
  assert.equal(which.kind === 'choose' && which.question, 'Which worktree?');
  const one = resolve('show changes in my other worktree', {worktrees: worktrees.slice(0, 2)});
  assert.deepEqual(one.kind === 'proposal' && one.action, {kind: 'read', command: {id: 'git.diff', cwd: '/w/release'}});
  assert.deepEqual(readArgv({id: 'git.diff', cwd: '/w/a b; rm -rf ~'}), ['git', '-C', '/w/a b; rm -rf ~', 'diff'], 'a path stays one argv element');
  assert.match((resolve('what branch am i on', {repoRoot: undefined, branch: undefined}) as {text: string}).text, /not in a Git repository/u);
  assert.deepEqual(parseWorktrees('worktree /a\nHEAD x\nbranch refs/heads/main\n\nworktree /b\ndetached\n', '/a'), [{path: '/a', current: true, branch: 'main'}, {path: '/b', current: false}]);
});

test('deterministic: files resolve to existing paths only, bounded, noisy trees skipped', () => {
  const files = listProjectFiles(root);
  assert.ok(!files.some(file => file.startsWith('node_modules') || file.startsWith('.git')));
  const exact = resolve('open package.json');
  assert.deepEqual(exact.kind === 'proposal' && exact.action, {kind: 'openFile', path: join(root, 'package.json')});
  assert.deepEqual((resolve('open package json') as {action: unknown}).action, {kind: 'openFile', path: join(root, 'package.json')});
  const config = resolve('open config');
  assert.equal(config.kind, 'choose');
  assert.deepEqual(config.kind === 'choose' && config.options.map(option => option.label), ['src/config.ts', 'src/prompt/configuration.ts', 'tests/configuration.test.ts']);
  assert.deepEqual((resolve('open src config') as {action: unknown}).action, {kind: 'openFile', path: join(root, 'src/config.ts')});
  assert.equal(resolve('open nothing-like-this').kind, 'answer');
  const recent = resolve('open this in zed', {recentFiles: [join(root, 'README.md')]});
  assert.deepEqual(recent.kind === 'proposal' && recent.action, {kind: 'openFile', path: join(root, 'README.md')}, 'recent factual references resolve "this"');
});

test('deterministic: settings, theme, providers, help', () => {
  assert.deepEqual((resolve('open settings') as {action: unknown}).action, {kind: 'slash', slash: {kind: 'settings', view: 'config'}, label: '/settings'});
  assert.equal((resolve('change theme') as {action: {label: string}}).action.label, '/appearance');
  assert.match((resolve('what does /resume do') as {text: string}).text, /^\/resume: Browse archived/u);
  assert.match((resolve('what can you do') as {text: string}).text, /never runs destructive/u);
  assert.match((resolve('what prompt provider am i using') as {text: string}).text, /prompt: NMSh Native/u);
  const deja = resolve('switch suggestions to deja');
  assert.deepEqual(deja.kind === 'proposal' && deja.action, {kind: 'setting', setting: 'suggestions', value: 'deja', label: 'suggestions: Deja'});
  assert.deepEqual((resolve('turn local understanding off') as {action: unknown}).action, {kind: 'setting', setting: 'localUnderstanding', value: 'off', label: 'Local understanding: off'});
  assert.match((resolve('why cannot i open files', {editor: {label: 'Zed', available: false, reason: 'Zed detected, but its CLI (zed) is not on PATH.'}}) as {text: string}).text, /CLI \(zed\) is not on PATH/u);
});

test('outcomes are distinct: unsafe, unsupported, ambiguous, missing and unclear', () => {
  const unsafe = resolve('delete all untracked files');
  assert.equal(unsafe.kind, 'unsafe');
  assert.match(unsafe.kind === 'unsafe' ? unsafe.text : '', /I understand that you want to delete untracked files/u);
  assert.equal(unsafe.kind === 'unsafe' && unsafe.alternative?.label, 'Show Git status');
  for (const request of ['git reset --hard', 'push my commits', 'sudo rm -rf /', 'rm -rf node_modules', 'kill that process']) assert.equal(resolve(request).kind, 'unsafe', request);
  assert.equal(resolve('write a function that sorts things').kind, 'unsupported');
  const vague = resolve('show the thing from earlier', {recentFiles: [join(root, 'README.md')]});
  assert.equal(vague.kind, 'choose');
  assert.ok(vague.kind === 'choose' && vague.reason === 'ambiguous' && vague.options.length >= 2 && vague.options.length <= 5);
  assert.equal(resolve('switch shell').kind === 'choose' && (resolve('switch shell') as {reason: string}).reason, 'missing');
  const unclear = resolve('flibbertigibbet');
  assert.equal(unclear.kind, 'unclear');
  assert.deepEqual(unclear.kind === 'unclear' && unclear.categories.map(option => option.key), ['cat:git', 'cat:files', 'cat:sessions', 'cat:shell']);
  assert.deepEqual((resolve('flibbertigibbet', {repoRoot: undefined, transcripts: []}) as {categories: Array<{key: string}>}).categories.map(option => option.key), ['cat:files', 'cat:shell'],
    'categories follow what actually exists here');
});

test('rejected interpretations are not offered again in the same interaction', () => {
  const first = resolve('show the thing from earlier', {recentFiles: [join(root, 'README.md')]});
  const keys = first.kind === 'choose' ? first.options.map(option => option.key) : [];
  const rejected = new Set(keys.slice(0, 1));
  const second = resolve('show the thing from earlier', {recentFiles: [join(root, 'README.md')]}, rejected);
  assert.ok(second.kind === 'choose' || second.kind === 'proposal');
  if (second.kind === 'choose') assert.ok(!second.options.some(option => rejected.has(option.key)));
});

test('choices: numbers, ordinals and words that name exactly one option', () => {
  const options = [{key: 'a', label: 'Yesterday 10:30 zsh'}, {key: 'b', label: 'Previous Git diff'}, {key: 'c', label: 'The bash session'}];
  assert.equal(pickOption('2', options), 1);
  assert.equal(pickOption('the second one', options), 1);
  assert.equal(pickOption('the bash one', options), 2);
  assert.equal(pickOption('9', options), undefined);
  assert.equal(pickOption('session', options), 2);
});

test('Ask surface: empty /ask greets and waits; Esc closes with nothing to record; Enter submits', () => {
  assert.deepEqual(parseSlashCommand('/ask'), {kind: 'ask', request: ''});
  assert.deepEqual(parseSlashCommand('/ask open package.json'), {kind: 'ask', request: 'open package.json'});
  assert.ok(slashSuggestions('/as').some(item => item.name === '/ask'));
  const state = createAskState();
  assert.match(stripAnsi(renderAsk(state, 100).join('\n')), new RegExp(`Ask NMSh[\\s\\S]*${ASK_GREETING}`, 'u'));
  assert.equal(state.input, '');
  assert.deepEqual(askKey(state, {kind: 'escape'}), {kind: 'close'});
  assert.equal(askTranscriptText(state), undefined, 'an abandoned Ask leaves no transcript');
  for (const char of 'git status') askKey(state, {kind: 'text', value: char});
  assert.deepEqual(askKey(state, {kind: 'enter'}), {kind: 'resolve', text: 'git status'});
  assert.deepEqual(askKey(createAskState(), {kind: 'interrupt'}), {kind: 'close'});
});

test('Ask surface: pickers by number and typing, None of these, clarification keeps the request, confirmations', () => {
  const state = createAskState();
  submitText(state, 'open config');
  receiveOutcome(state, resolve('open config'));
  assert.equal(visibleOptions(state).length, 4, 'three files and None of these');
  for (const char of 'prompt') askKey(state, {kind: 'text', value: char});
  assert.deepEqual(visibleOptions(state).map(option => option.label), ['src/prompt/configuration.ts', 'None of these'], 'typing narrows the picker');
  state.input = '';
  const picked = submitText(state, '2');
  assert.equal(picked, undefined, 'a file open is confirmed first');
  assert.equal(state.pending?.kind === 'proposal' && state.pending.action.kind, 'openFile');
  assert.equal(state.confirm, 'yes');
  assert.deepEqual(askKey(state, {kind: 'text', value: 'y'}), {kind: 'execute', action: {kind: 'openFile', path: join(root, 'src/prompt/configuration.ts')}, outcome: state.pending});

  const vague = createAskState();
  submitText(vague, 'show the old one');
  receiveOutcome(vague, resolve('show the old one', {recentFiles: [join(root, 'README.md')]}));
  const none = visibleOptions(vague).length;
  assert.equal(submitText(vague, String(none)), undefined, 'None of these');
  assert.equal(vague.pending, undefined);
  assert.ok(vague.rejected.size >= 2);
  assert.match(vague.turns.at(-1)!.text, /Tell me a little more/u);
  assert.deepEqual(submitText(vague, 'the bash one'), {kind: 'resolve', text: 'the bash one'});

  const clarify = createAskState();
  submitText(clarify, 'resume yesterday\'s session');
  receiveOutcome(clarify, resolve("resume yesterday's session"));
  assert.deepEqual(submitText(clarify, 'in this repo'), {kind: 'resolve', text: 'resume yesterday\'s session in this repo'}, 'clarification refines the original request');

  const install = createAskState();
  submitText(install, 'install bash');
  receiveOutcome(install, resolve('install bash'));
  assert.equal(install.confirm, 'no', 'installs start on No');
  assert.equal(askKey(install, {kind: 'enter'}), undefined, 'Enter on No does nothing');
  assert.equal(install.pending, undefined);
  const nav = createAskState();
  submitText(nav, 'show my sessions');
  assert.equal(receiveOutcome(nav, resolve('show my sessions'))?.kind, 'execute', 'plain navigation needs no extra Yes');
});

test('Ask transcript text: one request line, then visible turns; never model data', () => {
  const state = createAskState();
  submitText(state, 'open config');
  receiveOutcome(state, resolve('open config'));
  submitText(state, '1');
  const recorded = askTranscriptText(state)!;
  assert.equal(recorded.request, 'open config');
  assert.match(recorded.body, /^Ask: I found 3 matches\. Which one\?\nYou: 1\nAsk: Open src\/config\.ts in Zed\?$/u);
});

test('safety: every capability is typed; read actions are fixed argv; request text is data', () => {
  assert.ok(CAPABILITIES.every(capability => ['answer', 'navigate', 'read', 'install', 'refused'].includes(capability.safety)));
  const injected = resolve('find $(whoami) | tee out; echo `id` in the transcript');
  assert.equal(injected.kind, 'proposal');
  assert.equal(injected.kind === 'proposal' && injected.action.kind, 'slash', 'find text stays an NMSh /find argument, never a shell command');
  for (const id of ['git.status', 'git.diff', 'git.log'] as const) {
    const argv = readArgv({id});
    assert.equal(argv[0], 'git');
    assert.ok(!argv.some(part => /^(?:-c|sh|bash|zsh)$/u.test(part) || /[|;&$`<>]/u.test(part)));
  }
});
