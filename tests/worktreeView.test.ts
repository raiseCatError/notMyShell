import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createGitRunner, type GitRunner} from '../src/worktrees/git.js';
import {WorktreeManagerController} from '../src/worktrees/controller.js';
import {buildWorktreeView, renderWorktreeView, type WorktreeView} from '../src/worktrees/view.js';
import type {WorktreeRecord} from '../src/worktrees/model.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {createRepo} from './helpers/worktreeRepos.js';

const git = createGitRunner();
const ESCAPE = /\u001b/u;
const CONTROL = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

function record(overrides: Partial<WorktreeRecord> & {path: string}): WorktreeRecord {
  return {id: overrides.path, detached: false, bare: false, main: false, locked: false, prunable: false, pathState: 'present',
    status: {kind: 'clean'}, head: 'a'.repeat(40), ...overrides};
}

const rows: WorktreeRecord[] = [
  record({path: '/Users/me/Projects/notMyShell', ref: 'refs/heads/master', branch: 'master', main: true}),
  record({path: '/private/tmp/notMyShell-foo', ref: 'refs/heads/feature/foo', branch: 'feature/foo',
    status: {kind: 'dirty', counts: {staged: 0, unstaged: 2, conflicted: 0, untracked: 1, partial: false}}}),
  record({path: '/private/tmp/notMyShell-bar', ref: 'refs/heads/feature/bar', branch: 'feature/bar', locked: true}),
  record({path: '/private/tmp/evil\u001b]0;PWN\u0007\u202edir', ref: 'refs/heads/x\u001b[31m', branch: 'x\u001b[31m', lockedReason: 'r\u009b2J', locked: true}),
];

function view(selected = rows[0]!.id, extra: Partial<WorktreeView['state']> = {}): WorktreeView {
  return {
    state: {loading: false, query: '', searching: false, snapshot: {commonDir: '/x/.git', worktrees: rows, truncated: false, discoveredAt: 0}, ...extra},
    rows, selectedId: selected,
    actions: [{id: 'navigate', available: true}, {id: 'new', available: true}, {id: 'remove', available: false, reason: 'The main worktree cannot be removed'},
      {id: 'refresh', available: true}, {id: 'search', available: true}],
  };
}

test('renders branch, path and factual state per worktree; selection is marked without color', () => {
  const lines = renderWorktreeView(view(), {columns: 80, rows: 40, glyphs: 'safe', level: 'none', home: '/Users/me'});
  const text = lines.join('\n');
  assert.doesNotMatch(text, ESCAPE, 'NO_COLOR emits no escapes');
  assert.match(text, /^Worktrees \(4\)/u);
  assert.match(text, /^> master$/mu);
  assert.match(text, /^ {4}~\/Projects\/notMyShell$/mu);
  assert.match(text, /^ {4}main worktree - clean$/mu);
  assert.match(text, /^ {2}feature\/foo$/mu);
  assert.match(text, /^ {4}2 modified - 1 untracked$/mu);
  assert.match(text, /^ {4}locked - clean$/mu);
  assert.match(text, /x unavailable: The main worktree cannot be removed/u);
  assert.match(text, /Up\/Down select - Enter open - n new - r refresh - \/ search - Esc back/u);
  assert.doesNotMatch(text, /x remove/u, 'unavailable actions are not offered');
  assert.ok(/^[\x20-\x7e\n]*$/u.test(text), 'Safe mode is ASCII');
});

test('hostile names render inert in every mode; Unicode glyph mode uses the Unicode marker', () => {
  for (const level of ['none', 'ansi256', 'truecolor'] as const) {
    for (const glyphs of ['safe', 'nerd'] as const) {
      const lines = renderWorktreeView(view(rows[3]!.id), {columns: 60, rows: 40, glyphs, level});
      for (const line of lines) assert.doesNotMatch(stripAnsi(line), CONTROL);
      const plain = lines.map(stripAnsi).join('\n');
      assert.doesNotMatch(plain, /PWN\u0007|\]0;/u);
      assert.match(plain, glyphs === 'nerd' ? /^› x$/mu : /^> x$/mu);
    }
  }
});

test('every width fits in display cells and keeps branch, path leaf, state and controls', () => {
  const wide = [...rows, record({path: '/tmp/表示テスト/ünïcødé-worktree-with-a-very-long-name', ref: 'refs/heads/機能/ブランチ', branch: '機能/ブランチ'})];
  for (const columns of [12, 20, 28, 40, 60, 120]) {
    for (const glyphs of ['safe', 'nerd'] as const) {
      const v = {...view(wide[4]!.id), rows: wide};
      const lines = renderWorktreeView(v, {columns, rows: 60, glyphs, level: 'truecolor'});
      for (const line of lines) assert.ok(displayWidth(line) <= columns, `${columns}: ${JSON.stringify(stripAnsi(line))}`);
      const plain = lines.map(stripAnsi).join('\n');
      if (columns >= 28) {
        assert.match(plain, /機能\/ブランチ/u);
        assert.match(plain, /very-long-name$/mu, 'path leaf survives truncation');
        assert.doesNotMatch(plain, /^ {4}~[^/]/mu, 'truncation never imitates ~');
        assert.match(plain, /refresh/u);
        assert.match(plain, /Esc back/u);
      }
    }
  }
});

test('short terminals window around the selection and keep the footer', () => {
  const many = Array.from({length: 30}, (_, index) => record({path: `/w/${index}`, ref: `refs/heads/b${index}`, branch: `b${index}`}));
  const v: WorktreeView = {...view(), rows: many, selectedId: '/w/20', state: {...view().state, snapshot: {commonDir: '/x', worktrees: many, truncated: false, discoveredAt: 0}}};
  const lines = renderWorktreeView(v, {columns: 50, rows: 16, glyphs: 'safe', level: 'none'});
  assert.ok(lines.length <= 16);
  const text = lines.join('\n');
  assert.match(text, /^> b20$/mu);
  assert.match(text, /Worktrees \(30\) \d+-\d+\/30/u);
  assert.match(text, /Esc back/u);
});

test('stale snapshots, errors and reviews are explicit', () => {
  let text = renderWorktreeView(view(rows[0]!.id, {error: 'Git timed out'}), {columns: 60, rows: 40, glyphs: 'safe', level: 'none'}).join('\n');
  assert.match(text, /stale: Git timed out/u);
  assert.match(text, /master/u, 'last snapshot still shown');
  text = renderWorktreeView({...view(), rows: [], state: {loading: false, query: '', searching: false, error: 'Not a Git repository'}},
    {columns: 60, rows: 40, glyphs: 'safe', level: 'none'}).join('\n');
  assert.match(text, /unavailable: Not a Git repository/u);
});

test('controller: discovery, stable selection across refresh, local search, keys and intents', async () => {
  const fx = await createRepo();
  try {
    const foo = join(fx.root, 'foo');
    const bar = join(fx.root, 'bar');
    fx.git('worktree', 'add', '-q', '-b', 'feature/foo', '--', foo, 'HEAD');
    fx.git('worktree', 'add', '-q', '-b', 'feature/bar', '--', bar, 'HEAD');
    await writeFile(join(foo, 'u.txt'), 'u');
    let calls = 0;
    let failing = false;
    const counting: GitRunner = async (cwd, args, options) => {
      calls += 1;
      if (failing && args[0] === 'worktree') return {stdout: '', stderr: 'fatal: simulated', code: 128, truncated: false, timedOut: false};
      return git(cwd, args, options);
    };
    const controller = new WorktreeManagerController({git: counting, repository: fx.repo, currentPath: () => fx.repo,
      resources: path => path === bar ? {resourceId: 'session:bar'} : undefined});
    await controller.refresh();
    assert.equal(controller.visible().length, 3);
    assert.equal(controller.selected()?.path, fx.repo);
    assert.deepEqual(await controller.handleKey({kind: 'enter'}), {kind: 'navigate', intent: {kind: 'cd', path: fx.repo}});
    assert.equal(controller.actions().find(action => action.id === 'remove')?.available, false);
    assert.deepEqual(controller.actions().find(action => action.id === 'relatedPr'), {id: 'relatedPr', available: false, reason: 'No pull request evidence yet'});

    // Rendering and search do no Git I/O.
    const before = calls;
    renderWorktreeView(buildWorktreeView(controller), {columns: 80, rows: 30, glyphs: 'nerd', level: 'truecolor'});
    await controller.handleKey({kind: 'text', value: '/'});
    for (const character of 'untracked') await controller.handleKey({kind: 'text', value: character});
    assert.equal(calls, before);
    assert.deepEqual(controller.visible().map(row => row.path), [foo]);
    assert.equal((await controller.handleKey({kind: 'escape'})).kind, 'changed');
    assert.equal(controller.state.query, '');
    assert.equal((await controller.handleKey({kind: 'escape'})).kind, 'back');

    // Select by stable identity; it survives refresh, and a failed refresh keeps the snapshot (stale).
    assert.ok(controller.select(bar));
    assert.deepEqual(controller.navigationIntent(), {kind: 'focusExistingResource', resourceId: 'session:bar', path: bar});
    assert.equal(controller.diffIntent()?.worktreePath, bar);
    await controller.handleKey({kind: 'text', value: 'r'});
    assert.equal(controller.selected()?.path, bar);
    failing = true;
    await controller.refresh();
    assert.equal(controller.state.error, 'simulated');
    assert.equal(controller.visible().length, 3);
    assert.equal(controller.actions().find(action => action.id === 'remove')?.available, false, 'no removal from a stale list');
    failing = false;
    await controller.refresh();
    assert.equal(controller.state.error, undefined);

    // x previews; Esc cancels; x + Enter removes after revalidation.
    assert.equal(controller.actions().find(action => action.id === 'remove')?.available, true);
    await controller.handleKey({kind: 'text', value: 'x'});
    assert.equal(controller.state.review?.kind, 'remove');
    const preview = renderWorktreeView(buildWorktreeView(controller), {columns: 80, rows: 30, glyphs: 'safe', level: 'none'}).join('\n');
    assert.match(preview, /Remove worktree\?/u);
    assert.match(preview, /Enter confirm - Esc cancel/u);
    await controller.handleKey({kind: 'escape'});
    assert.equal(controller.state.review, undefined);
    await controller.handleKey({kind: 'text', value: 'x'});
    assert.deepEqual(await controller.handleKey({kind: 'enter'}), {kind: 'removed', path: bar});
    assert.equal(controller.visible().length, 2);

    // Untracked work: x explains instead of previewing.
    controller.select(foo);
    await controller.handleKey({kind: 'text', value: 'x'});
    assert.equal(controller.state.review, undefined);
    assert.equal(controller.state.message, 'Has untracked files');

    // n hands off to the host for input, then plan → confirm.
    assert.deepEqual(await controller.handleKey({kind: 'text', value: 'n'}), {kind: 'requestNewWorktree'});
    const created = join(fx.root, 'created');
    assert.ok(await controller.planNew({kind: 'newBranch', destination: created, branch: 'made', startPoint: 'HEAD'}));
    assert.deepEqual(await controller.handleKey({kind: 'enter'}), {kind: 'created', path: created});
    assert.equal(controller.selected()?.path, created);
  } finally { await fx.dispose(); }
});
