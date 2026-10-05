import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveRequest} from '../src/ask/resolver.js';
import {parseStatusV2, type GitFacts} from '../src/ask/git.js';
import {commitMessage, gitNextSteps, gitRunAllowed, refineFiles, renderCommand} from '../src/ask/gitAssist.js';
import type {AskContext, AskOutcome, AskReferents} from '../src/ask/types.js';
import {BundledCatalog} from '../src/shell/BundledCatalog.js';
import {CommandReference} from '../src/shell/CommandReference.js';
import {DeclarativeSpecSource} from '../src/shell/CompletionSources.js';

const specs = mkdtempSync(join(tmpdir(), 'nmsh-specs-'));
test.after(() => rmSync(specs, {recursive: true, force: true}));
const commands = {reference: new CommandReference(new BundledCatalog(), new DeclarativeSpecSource(specs)), identity: () => ({kind: 'executable' as const, path: '/usr/bin/git'})};
const facts = (extra: Partial<GitFacts> = {}): GitFacts => ({detached: false, branch: 'feature/foo', remotes: ['origin'], staged: [], modified: [], deleted: [], renamed: [], untracked: [], conflicted: [], ...extra});
const context = (git: GitFacts, referents?: AskReferents): AskContext => ({cwd: '/r', home: '/h', repoRoot: '/r', branch: git.branch, worktrees: [], shell: 'zsh', defaultShell: 'zsh', shells: [], sessions: [],
  transcripts: [], recentFiles: [], recentCommands: [], editor: {label: 'Zed', available: true}, providers: [], sessionMode: 'service', now: 0, git, ...(referents ? {referents} : {})});
const ask = (text: string, git: GitFacts, referents?: AskReferents) => resolveRequest(text, context(git, referents), {}, commands);
const command = (outcome: AskOutcome, shell: 'zsh' | 'fish' = 'zsh') => outcome.kind === 'answer' && outcome.block ? renderCommand(outcome.block, shell) : undefined;

test('porcelain v2: branch, upstream, ahead/behind, staged/modified/untracked/renamed/conflicted, detached', () => {
  const out = ['# branch.oid abc', '# branch.head feature/foo', '# branch.upstream origin/feature/foo', '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 a b src/staged.ts', '1 .M N... 100644 100644 100644 a b src/mod ified.ts', '2 R. N... 100644 100644 100644 a b R100 new.ts', 'old.ts',
    'u UU N... 100644 100644 100644 100644 a b c conflict.ts', '? notes/test file.md', ''].join('\0');
  const parsed = parseStatusV2(out, ['origin']);
  assert.equal(parsed.branch, 'feature/foo');
  assert.equal(parsed.upstream, 'origin/feature/foo');
  assert.deepEqual([parsed.ahead, parsed.behind], [2, 1]);
  assert.deepEqual(parsed.staged, ['src/staged.ts', 'new.ts']);
  assert.deepEqual(parsed.modified, ['src/mod ified.ts']);
  assert.deepEqual(parsed.renamed, ['new.ts']);
  assert.deepEqual(parsed.conflicted, ['conflict.ts']);
  assert.deepEqual(parsed.untracked, ['notes/test file.md']);
  assert.equal(parseStatusV2('# branch.head (detached)\0').detached, true);
});

test('A: one remote, no upstream → git push -u origin feature/foo, with the facts it used', () => {
  const outcome = ask('how do i push this branch', facts());
  assert.equal(command(outcome), 'git push -u origin feature/foo');
  assert.ok(outcome.kind === 'answer' && outcome.block?.facts?.some(([key, value]) => key === 'upstream' && value === 'none'));
  assert.equal(outcome.kind === 'answer' && outcome.block?.risk, 'mutate');
  assert.ok(outcome.kind === 'answer' && outcome.block?.run, 'push may run, only after the final Yes/No');
});

test('B: upstream configured → plain git push', () => {
  assert.equal(command(ask('how do i push this branch', facts({upstream: 'origin/feature/foo'}))), 'git push');
  assert.equal(command(ask('how do i pull this branch', facts({upstream: 'origin/feature/foo'}))), 'git pull');
});

test('C: several remotes, no upstream → ask which; never guess', () => {
  const outcome = ask('how do i push this branch', facts({remotes: ['origin', 'fork']}));
  assert.equal(outcome.kind, 'choose');
  assert.deepEqual(outcome.kind === 'choose' && outcome.options.map(option => option.label), ['origin', 'fork']);
  const fork = outcome.kind === 'choose' ? outcome.options[1]!.outcome! : outcome;
  assert.equal(command(fork), 'git push -u fork feature/foo');
  const none = ask('how do i push this branch', facts({remotes: []}));
  assert.equal(command(none), 'git push -u <remote> feature/foo', 'missing values are placeholders');
  assert.ok(none.kind === 'answer' && !none.block?.run, 'a placeholder command never runs');
});

test('D: detached HEAD → no pretend branch', () => {
  const outcome = ask('how do i push this branch', facts({detached: true, branch: undefined}));
  assert.equal(outcome.kind, 'answer');
  assert.match(outcome.kind === 'answer' ? outcome.text : '', /detached/u);
  assert.equal(command(outcome), undefined);
});

test('E: untracked conversation — refuse, show them, show the command (never run it)', () => {
  const git = facts({untracked: ['a.txt', 'notes/test file.md']});
  const refused = ask('delete all untracked files', git);
  assert.equal(refused.kind, 'unsafe');
  const referents = refused.kind === 'unsafe' ? refused.referents : undefined;
  assert.deepEqual(referents?.files?.paths, ['a.txt', 'notes/test file.md']);
  const shown = ask('show them', git, referents);
  assert.match(shown.kind === 'answer' ? shown.text : '', /2 untracked files:\n {2}a\.txt\n {2}notes\/test file\.md/u);
  const how = ask('what\'s the command to delete this stuff', git, shown.kind === 'answer' ? shown.referents : referents);
  assert.equal(command(how), 'git clean -fd');
  assert.ok(how.kind === 'answer' && how.block?.risk === 'destructive' && !how.block.run, 'destructive: Copy/Insert only');
  assert.match(how.kind === 'answer' ? how.text : '', /git clean -nd/u);
});

test('referents: add them, refine to the second one, quoted paths', () => {
  const git = facts({untracked: ['a.txt', 'notes/test file.md']});
  const shown = ask('show untracked files', git);
  const add = ask('add them', git, shown.kind === 'answer' ? shown.referents : undefined);
  assert.equal(command(add), 'git add -- a.txt \'notes/test file.md\'');
  assert.equal(command(add, 'fish'), 'git add -- a.txt \'notes/test file.md\'');
  const only = ask('actually only the second one', git, add.kind === 'answer' ? add.referents : undefined);
  assert.equal(command(only), 'git add -- \'notes/test file.md\'');
  assert.deepEqual(refineFiles('everything except the first', ['x', 'y', 'z']), ['y', 'z']);
});

test('commit: message extracted and quoted; nothing staged says so', () => {
  const git = facts({staged: ['src/a.ts']});
  assert.equal(commitMessage('yeah, commit with message "fix prompt spacing"'), 'fix prompt spacing');
  const outcome = ask('yeah, commit with message "fix prompt spacing"', git);
  assert.equal(command(outcome), 'git commit -m \'fix prompt spacing\'');
  assert.equal(command(ask('commit with message "it\'s done"', git)), 'git commit -m \'it\'\\\'\'s done\'');
  const tricky = ask('commit with message "$(rm -rf ~); `x`"', git);
  assert.equal(command(tricky), 'git commit -m \'$(rm -rf ~); `x`\'', 'shell syntax stays inert inside quotes');
  assert.equal(ask('commit with message "x"', facts()).kind, 'answer');
  assert.match((ask('commit with message "x"', facts()) as {text: string}).text, /Nothing is staged/u);
  assert.equal(ask('commit staged changes', git).kind, 'choose', 'no message: ask for one');
});

test('next steps come from the state; clean trees never offer commit', () => {
  assert.deepEqual(gitNextSteps(facts()).map(option => option.label), ['Show recent commits']);
  assert.ok(gitNextSteps(facts({staged: ['a']})).some(option => option.label === 'Commit staged changes'));
  assert.ok(gitNextSteps(facts({untracked: ['a']})).some(option => option.label === 'Show untracked files'));
  assert.equal(gitNextSteps(facts({conflicted: ['a']}))[0]!.label, 'Show conflicted files');
  assert.ok(gitNextSteps(facts({ahead: 1})).some(option => option.label === 'Push this branch'));
});

test('run policy: allowlist only; destructive forms never run', () => {
  assert.equal(gitRunAllowed(['git', 'status']), 'read');
  assert.equal(gitRunAllowed(['git', 'add', '--', 'a']), 'mutate');
  assert.equal(gitRunAllowed(['git', 'push', '--force']), undefined);
  assert.equal(gitRunAllowed(['git', 'push', '--force-with-lease']), undefined);
  assert.equal(gitRunAllowed(['git', 'clean', '-fd']), undefined);
  assert.equal(gitRunAllowed(['git', 'reset', '--hard']), undefined);
  assert.equal(gitRunAllowed(['git', 'branch', '-D', 'x']), undefined);
  assert.equal(gitRunAllowed(['rm', '-rf', '/']), undefined);
  assert.equal(ask('force push this branch', facts()).kind === 'answer' && (ask('force push this branch', facts()) as {block?: {run?: unknown}}).block?.run, undefined);
});

test('remotes and status from facts', () => {
  assert.match((ask('what remote am i using', facts({upstream: 'origin/feature/foo'})) as {text: string}).text, /Remotes: origin\. feature\/foo tracks origin\/feature\/foo\./u);
  const status = ask('git status', facts({untracked: ['a', 'b', 'c'], modified: ['m', 'n']}));
  assert.equal(status.kind, 'proposal', 'the existing read-only status action, now with the facts');
  assert.match((status as {text: string}).text, /You're on feature\/foo, with no upstream\.\nnothing staged · 2 modified files · 3 untracked files/u);
});
