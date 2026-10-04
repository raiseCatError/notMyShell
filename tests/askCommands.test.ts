import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveRequest} from '../src/ask/resolver.js';
import {parseCommandQuestion, type CommandEnvironment} from '../src/ask/commands.js';
import type {AskContext, AskOutcome} from '../src/ask/types.js';
import {BundledCatalog} from '../src/shell/BundledCatalog.js';
import {CommandReference, syntaxOf} from '../src/shell/CommandReference.js';
import {DeclarativeSpecSource} from '../src/shell/CompletionSources.js';

const emptySpecs = mkdtempSync(join(tmpdir(), 'nmsh-specs-'));
test.after(() => rmSync(emptySpecs, {recursive: true, force: true}));

const context = (extra: Partial<AskContext> = {}): AskContext => ({cwd: '/r', home: '/h', worktrees: [], shell: 'zsh', defaultShell: 'zsh', shells: [], sessions: [], transcripts: [],
  recentFiles: [], recentCommands: [], editor: {label: 'Zed', available: true}, providers: [], sessionMode: 'service', now: 0, files: [], ...extra});
function env(installed: Record<string, string> = {git: '/usr/bin/git'}, catalog = new BundledCatalog()): CommandEnvironment {
  return {reference: new CommandReference(catalog, new DeclarativeSpecSource(emptySpecs)), identity: name => installed[name] ? {kind: 'executable', path: installed[name]} : undefined};
}
const text = (outcome: AskOutcome) => outcome.kind === 'answer' ? outcome.text : `${outcome.kind}`;
const ask = (request: string, environment = env(), extra: Partial<AskContext> = {}) => resolveRequest(request, context(extra), {}, environment);

test('command knowledge: lazy lookups, syntax only from facts, inherited options', () => {
  const catalog = new BundledCatalog();
  const reference = new CommandReference(catalog, new DeclarativeSpecSource(emptySpecs));
  const push = reference.lookup(['git', 'push', 'origin'])!;
  assert.deepEqual(push.facts.path, ['git', 'push']);
  assert.deepEqual(push.rest, ['origin']);
  assert.equal(syntaxOf(push.facts), 'git push [options] [remote] [branch]');
  assert.ok(reference.option(push.facts, '--force-with-lease'));
  assert.ok(reference.option(push.facts, '--set-upstream') ?? reference.option(push.facts, '-u'));
  assert.equal(reference.option(push.facts, '--invented-flag'), undefined);
  assert.ok(catalog.loads <= 3, `git push inflated ${catalog.loads} entries, not the catalog`);
  assert.equal(reference.lookup(['definitely-not-a-command']), undefined);
});

test('parse: explain, syntax, options, option', () => {
  assert.deepEqual(parseCommandQuestion('what is git'), {intent: 'explain', words: ['git']});
  assert.deepEqual(parseCommandQuestion('what does git push do'), {intent: 'explain', words: ['git', 'push']});
  assert.deepEqual(parseCommandQuestion('how do i git push'), {intent: 'syntax', words: ['git', 'push']});
  assert.deepEqual(parseCommandQuestion('git pull syntax'), {intent: 'syntax', words: ['git', 'pull']});
  assert.deepEqual(parseCommandQuestion('what flags does git push have'), {intent: 'options', words: ['git', 'push']});
  assert.deepEqual(parseCommandQuestion('what does --force-with-lease do'), {intent: 'option', words: [], option: '--force-with-lease'});
  assert.deepEqual(parseCommandQuestion('what does rg --hidden do'), {intent: 'option', words: ['rg'], option: '--hidden'});
});

test('Local understanding Off: command questions answer from local facts', () => {
  assert.match(text(ask('what is git')), /^git: .*\ngit is installed at \/usr\/bin\/git\./u);
  assert.match(text(ask('what does git push do')), /git push: Update remote refs/u);
  assert.match(text(ask('how do i git push')), /Syntax\n {2}git push \[options\] \[remote\] \[branch\][\s\S]*Useful options/u);
  assert.match(text(ask('git pull syntax')), /git pull \[options\]/u);
  assert.match(text(ask('what flags does git push have')), /Options \(\d+\)[\s\S]*--dry-run/u);
  assert.match(text(ask('what does --force-with-lease do')), /^git push --force-with-lease/u, 'bounded search finds the subcommand');
  assert.match(text(ask('what does rg --hidden do')), /hidden/iu);
  assert.match(text(ask('what is npm ci')), /^npm ci: /u);
  assert.match(text(ask('what is vhs')), /vhs is not installed here/u, 'known but not installed is said truthfully');
  const zoxide = text(ask('what is zoxide'));
  assert.match(zoxide, /^zoxide: /u);
  assert.match(zoxide, /In NMSh: /u, 'a provider tool gets NMSh\'s note too');
});

test('an installed executable NMSh has no facts for is identified, never described from its name', () => {
  const answer = text(ask('what is frobnicate-tool', env({'frobnicate-tool': '/opt/bin/frobnicate-tool'})));
  assert.match(answer, /frobnicate-tool is installed at \/opt\/bin\/frobnicate-tool\. NMSh has no local documentation/u);
  assert.notEqual(ask('what is frobnicate-tool', env({})).kind, 'answer', 'unknown and absent: not answered as a command');
});

test('explaining is not acting: destructive commands can be explained; NMSh words stay NMSh concepts', () => {
  assert.equal(ask('what does git clean do').kind, 'answer');
  assert.equal(ask('what does git push do').kind, 'answer');
  assert.equal(ask('delete untracked files').kind, 'unsafe', 'acting is still refused');
  assert.match(text(ask('what is chroma')), /^Chroma paints/u, 'chroma the NMSh feature, not the catalog command');
  assert.equal(ask('how do i change the shell').kind, 'choose');
});
