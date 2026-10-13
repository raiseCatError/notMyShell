import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {GithubWorkspaceController} from '../src/githubWorkspace/controller.js';
import {FIXTURE_NOW, FixtureSource} from '../src/githubWorkspace/fixtures.js';
import {githubRepositoryFromRemote, workspaceKey} from '../src/githubWorkspace/host.js';
import {GithubWorkspaceService} from '../src/githubWorkspace/service.js';
import {createGitRunner} from '../src/worktrees/git.js';
import {newWorktreeRequest, worktreeDestination} from '../src/worktrees/host.js';
import {discoverWorktrees} from '../src/worktrees/discovery.js';
import type {Key} from '../src/terminal/keys.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {createRepo} from './helpers/worktreeRepos.js';

const text = (value: string): Key => ({kind: 'text', value});
const key = (kind: 'enter' | 'escape' | 'up' | 'down' | 'backspace'): Key => ({kind});

const apps: TerminalApp[] = [];
after(() => { for (const instance of apps) { instance['stop'](0); instance['session'].kill(); } });

function app(cwd: string): TerminalApp {
  const instance = new TerminalApp();
  apps.push(instance);
  Object.defineProperty(instance, 'render', {value: () => {}});
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns: 100, rows: 30})});
  instance['startupPending'] = false;
  instance['shellCwd'] = cwd;
  return instance;
}

const screen = (instance: TerminalApp, columns = 100): string => stripAnsi(instance['panelContentRows'](columns).join('\n'));

test('slash routing: /worktrees, /github, /prs and /issues open their panels', () => {
  assert.deepEqual(parseSlashCommand('/worktrees'), {kind: 'worktrees'});
  assert.deepEqual(parseSlashCommand('/github'), {kind: 'github', tab: 'prs'});
  assert.deepEqual(parseSlashCommand('/prs'), {kind: 'github', tab: 'prs'});
  assert.deepEqual(parseSlashCommand('/issues'), {kind: 'github', tab: 'issues'});
});

test('GitHub remote: only github.com owner/name; hostile or foreign remotes give no repository', () => {
  for (const url of ['https://github.com/raiseCatError/notMyShell.git', 'https://github.com/raiseCatError/notMyShell', 'git@github.com:raiseCatError/notMyShell.git',
    'ssh://git@github.com/raiseCatError/notMyShell.git', 'https://token@github.com/raiseCatError/notMyShell.git\n']) {
    assert.equal(githubRepositoryFromRemote(url), 'raiseCatError/notMyShell', url);
  }
  for (const url of ['https://gitlab.com/a/b.git', 'https://github.com.evil.example/a/b', 'git@github.com:a/b/c.git', 'https://github.com/a/..', '/srv/git/repo.git',
    'https://github.com/a/b\u001b]0;PWNED\u0007', '']) {
    assert.equal(githubRepositoryFromRemote(url), undefined, JSON.stringify(url));
  }
});

test('GitHub keys: NMSh keys map to the workspace model; Tab and Shift+Tab switch tabs', () => {
  assert.equal(workspaceKey({kind: 'complete'}), 'tab');
  assert.equal(workspaceKey({kind: 'focusPrevious'}), 'shiftTab');
  assert.deepEqual(workspaceKey(text('o')), {char: 'o'});
  assert.equal(workspaceKey(text('ab')), undefined, 'a multi-character chunk is not a command key');
  assert.equal(workspaceKey({kind: 'wheelUp'}), undefined);
});

test('/worktrees outside a repository opens nothing and says why', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-nowt-')));
  try {
    const instance = app(dir);
    await instance['openWorktrees']();
    assert.equal(instance['worktreePanel'], undefined);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('/worktrees: Enter stages a cd in an empty composer and never overwrites a draft', async () => {
  const fixture = await createRepo();
  try {
    const linked = join(fixture.root, 'linked one');
    fixture.git('worktree', 'add', '-q', '-b', 'feature', linked);
    const instance = app(fixture.repo);
    await instance['openWorktrees']();
    assert.match(screen(instance), /feature/u);
    instance['editor'].insert('make test');
    await instance['handleWorktreeKey'](key('down'));
    await instance['handleWorktreeKey'](key('enter'));
    assert.equal(instance['editor'].text, 'make test', 'the draft is kept');
    assert.match(screen(instance), /Your draft is kept/u);
    instance['editor'].clear();
    await instance['handleWorktreeKey'](key('enter'));
    assert.equal(instance['worktreePanel'], undefined, 'the panel hands back to the composer');
    assert.equal(instance['editor'].text, `cd -- '${linked}'`, 'staged, not run');
  } finally { await fixture.dispose(); }
});

test('/worktrees: n plans a new worktree from a branch name; Enter confirms; x previews and removes it', async () => {
  const fixture = await createRepo();
  try {
    const instance = app(fixture.repo);
    await instance['openWorktrees']();
    await instance['handleWorktreeKey'](text('n'));
    for (const ch of 'topic/a') await instance['handleWorktreeKey'](text(ch));
    assert.match(screen(instance), /New worktree branch: topic\/a/u);
    await instance['handleWorktreeKey'](key('enter'));
    const destination = worktreeDestination(fixture.repo, 'topic/a');
    assert.equal(existsSync(destination), false, 'planning changes nothing');
    assert.match(screen(instance), /topic\/a/u);
    await instance['handleWorktreeKey'](key('enter'));
    assert.equal(existsSync(destination), true, 'created only after confirmation');
    assert.match(fixture.git('branch', '--list', 'topic/a'), /topic\/a/u);
    // Removal: preview first, then the explicit Enter.
    await instance['handleWorktreeKey'](text('x'));
    assert.equal(existsSync(destination), true, 'preview removes nothing');
    await instance['handleWorktreeKey'](key('enter'));
    assert.equal(existsSync(destination), false);
    assert.match(fixture.git('branch', '--list', 'topic/a'), /topic\/a/u, 'the branch itself is kept');
  } finally { await fixture.dispose(); }
});

test('/worktrees: removal is refused while a managed agent works inside the worktree', async () => {
  const fixture = await createRepo();
  try {
    const linked = join(fixture.root, 'busy');
    fixture.git('worktree', 'add', '-q', '-b', 'busy', linked);
    const instance = app(fixture.repo);
    instance['agents'].sessions.push({id: 'a1', harness: 'claude', level: 'managed', title: 'Winter', cwd: join(linked, 'src'), startedAt: 0, state: 'working'} as never);
    await instance['openWorktrees']();
    const panel = instance['worktreePanel']!;
    panel.controller.select(linked);
    await instance['handleWorktreeKey'](text('x'));
    assert.equal(panel.controller.state.review, undefined, 'no removal plan');
    assert.match(screen(instance), /Not removed: agent Winter is working there/u);
    assert.equal(existsSync(linked), true);
  } finally { await fixture.dispose(); }
});

test('panels in Safe glyphs and NO_COLOR: no color codes, worktrees in ASCII, every row fits narrow widths', async () => {
  const fixture = await createRepo();
  const before = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    fixture.git('worktree', 'add', '-q', '-b', 'topic/with-a-long-branch-name', join(fixture.root, 'a worktree with a long folder name'));
    const instance = app(fixture.repo);
    instance['promptConfiguration'] = {...instance['promptConfiguration'], glyphStyle: 'safe'};
    await instance['openWorktrees']();
    const controller = new GithubWorkspaceController(new GithubWorkspaceService(new FixtureSource()), {title: 'example/repo (read-only)', clock: () => FIXTURE_NOW});
    await controller.submitQuery('prs');
    for (const columns of [100, 50, 32]) {
      const worktrees = instance['panelContentRows'](columns);
      // The shared panel frame (every panel) ends its rule with a bare reset; no color is ever emitted.
      assert.ok(worktrees.every(row => !/\u001b\[[\d;]*[34]\d/u.test(row) && displayWidth(stripAnsi(row)) <= columns), `worktrees at ${columns}`);
      assert.ok(worktrees.slice(1).every(row => /^[\x20-\x7e]*$/u.test(stripAnsi(row))), `worktrees ASCII at ${columns}`);
    }
    instance['worktreePanel'] = undefined;
    instance['githubPanel'] = {controller, repository: 'example/repo', detach: () => {}};
    for (const columns of [100, 50, 32]) {
      const github = instance['panelContentRows'](columns);
      assert.ok(github.every(row => !/\u001b\[[\d;]*[34]\d/u.test(row) && displayWidth(stripAnsi(row)) <= columns), `github at ${columns}`);
    }
  } finally {
    if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before;
    await fixture.dispose();
  }
});

test('new worktree request: an existing branch is checked out, a new one starts at main HEAD', async () => {
  const fixture = await createRepo();
  try {
    fixture.git('branch', 'exists');
    const git = createGitRunner();
    const snapshot = await discoverWorktrees(git, fixture.repo);
    assert.deepEqual(await newWorktreeRequest(git, snapshot, 'exists'), {kind: 'existingBranch', destination: `${fixture.repo}-exists`, branch: 'exists'});
    fixture.git('tag', 'main', 'HEAD');
    fixture.git('commit', '-q', '--allow-empty', '-m', 'second');
    const fresh = await newWorktreeRequest(git, (await discoverWorktrees(git, fixture.repo)), 'fresh');
    assert.ok('kind' in fresh && fresh.kind === 'newBranch' && fresh.startPoint === 'refs/heads/main', 'the full branch ref: a tag with the same name cannot win');
    assert.deepEqual(await newWorktreeRequest(git, snapshot, '  '), {error: 'Type a branch name first.'});
  } finally { await fixture.dispose(); }
});

test('/github panel: fixture data renders read-only, Esc closes, w routes to /worktrees for the PR branch', async () => {
  const fixture = await createRepo();
  try {
    const instance = app(fixture.repo);
    const controller = new GithubWorkspaceController(new GithubWorkspaceService(new FixtureSource()), {title: 'example/repo (read-only)', clock: () => FIXTURE_NOW});
    instance['githubPanel'] = {controller, repository: 'example/repo', detach: controller.onChange(() => {})};
    await controller.submitQuery('prs');
    for (const columns of [100, 40]) {
      const rows = instance['panelContentRows'](columns).map(stripAnsi);
      assert.ok(rows.every(row => [...row].length <= columns), `fits ${columns} columns`);
    }
    assert.match(screen(instance), /read-only/u);
    instance['handleGithubKey'](key('enter'));
    await controller.loadDetail();
    instance['githubIntent'](instance['githubPanel']!, {type: 'OpenRelatedWorktree', repository: 'example/repo', number: 1, headRef: 'main', worktreeState: 'unknown'});
    assert.equal(instance['githubPanel'], undefined);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(instance['worktreePanel'], 'the worktree manager opens for the PR branch');
    instance['githubPanel'] = {controller, repository: 'example/repo', detach: () => {}};
    instance['worktreePanel'] = undefined;
    instance['githubIntent'](instance['githubPanel']!, {type: 'OpenExternal', url: 'javascript:alert(1)'});
    assert.match(controller.snapshot.message ?? '', /not a github\.com URL/u);
    instance['githubIntent'](instance['githubPanel']!, {type: 'Exit'});
    assert.equal(instance['githubPanel'], undefined);
  } finally { await fixture.dispose(); }
});
