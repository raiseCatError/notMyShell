import {fishQuote, posixQuote, type ShellId} from '../shell/adapters/ShellAdapter.js';
import type {CommandReference} from '../shell/CommandReference.js';
import type {GitFacts} from './git.js';
import type {AskContext, AskOption, AskOutcome, AskReferents, CommandBlock} from './types.js';

/**
 * Git help from local facts: commands are built as argv from what Git
 * reports (current branch, real remotes, listed paths) and rendered with the
 * active shell's quoting. A value NMSh does not know is a visible placeholder,
 * never a guess. Read-only commands may run when asked; add, commit, push,
 * pull and fetch run only after the one final Yes/No for the exact command;
 * destructive ones (clean, restore, reset, force push) are Copy/Insert only.
 */

/** Git subcommands Ask may run, and how much each changes. Anything else is never run by Ask. */
export const GIT_RUN_POLICY: Readonly<Record<string, 'read' | 'mutate'>> = {
  status: 'read', diff: 'read', log: 'read', show: 'read', branch: 'read', remote: 'read',
  add: 'mutate', commit: 'mutate', push: 'mutate', pull: 'mutate', fetch: 'mutate', switch: 'mutate',
};

/** A branch name Git accepts (git check-ref-format's main rules), so a created branch is never a guess at quoting. */
export function validBranchName(name: string): boolean {
  return /^[A-Za-z0-9._/-]{1,100}$/u.test(name) && !/^[-/.]|[/.]$|\.\.|\/\/|@\{|\.lock$|^HEAD$/u.test(name);
}

/** Options that make an otherwise allowed subcommand destructive or history-rewriting. */
const DESTRUCTIVE_OPTIONS = /^(?:-f|--force|--force-with-lease|--hard|-D|--delete|--prune|--mirror|--amend|--no-verify)$/u;

/** True when Ask may run this argv (re-checked by the app right before running). */
export function gitRunAllowed(argv: readonly string[]): 'read' | 'mutate' | undefined {
  if (argv[0] !== 'git') return undefined;
  const risk = GIT_RUN_POLICY[argv[1] ?? ''];
  if (!risk || argv.some(arg => DESTRUCTIVE_OPTIONS.test(arg.split('=')[0]!))) return undefined;
  if (argv[1] === 'branch' && argv.length > 2 && !argv.slice(2).every(arg => /^(?:-a|-r|-v|-vv|--list|--show-current)$/u.test(arg))) return undefined;
  // switch only creates a new branch from HEAD (-c <name>) or moves to an existing one; nothing that discards work.
  if (argv[1] === 'switch' && !((argv.length === 4 && argv[2] === '-c' && validBranchName(argv[3]!)) || (argv.length === 3 && validBranchName(argv[2]!)))) return undefined;
  if (argv[1] === 'show' && !argv.slice(2).every(arg => /^(?:--stat|--oneline|--no-patch|-s|HEAD(?:~\d+)?|--format=[\w%:<>() -]+)$/u.test(arg))) return undefined;
  if (argv[1] === 'remote' && argv.length > 2 && !argv.slice(2).every(arg => arg === '-v')) return undefined;
  return risk;
}

/** Render argv for the active shell: plain words stay bare, anything else is single-quoted; placeholders stay as written. */
export function renderCommand(block: Pick<CommandBlock, 'argv' | 'placeholders'>, shell: ShellId): string {
  const quote = shell === 'fish' ? fishQuote : posixQuote;
  return block.argv.map((part, index) => block.placeholders?.includes(index) || /^[\w@%+=:,./-]+$/u.test(part) ? part : quote(part)).join(' ');
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function contextBlock(argv: string[], git: GitFacts | undefined, note: string, extra: Array<[string, string]> = [], placeholders?: number[]): CommandBlock {
  const risk = gitRunAllowed(argv) ?? 'destructive';
  const facts: Array<[string, string]> = [];
  if (git) {
    facts.push(['branch', git.detached ? 'detached HEAD' : git.branch ?? 'unknown']);
    if (/^(?:push|pull|fetch)$/u.test(argv[1] ?? '')) {
      facts.push(['upstream', git.upstream ?? 'none']);
      facts.push(['remotes', git.remotes.join(', ') || 'none']);
    }
  }
  facts.push(...extra);
  return {argv, ...(placeholders?.length ? {placeholders} : {}), provenance: 'context', risk, note, facts,
    ...(risk !== 'destructive' && !placeholders?.length ? {run: {kind: 'git', argv, risk}} : {})};
}

/** The concise state summary Ask opens with for status questions. */
export function gitSummary(git: GitFacts): string {
  const head = git.detached ? 'HEAD is detached (no current branch).' : `You're on ${git.branch}${git.upstream ? `, tracking ${git.upstream}` : ', with no upstream'}.`;
  const lines = [head];
  if (git.ahead || git.behind) lines.push(`${git.ahead ?? 0} ahead, ${git.behind ?? 0} behind ${git.upstream} (as last fetched).`);
  const parts = [
    git.conflicted.length ? plural(git.conflicted.length, 'conflicted file') : '',
    git.staged.length ? `${plural(git.staged.length, 'file')} staged` : 'nothing staged',
    git.modified.length ? plural(git.modified.length, 'modified file') : '',
    git.deleted.length ? plural(git.deleted.length, 'deleted file') : '',
    git.untracked.length ? plural(git.untracked.length, 'untracked file') : '',
  ].filter(Boolean);
  const clean = !git.staged.length && !git.modified.length && !git.deleted.length && !git.untracked.length && !git.conflicted.length;
  lines.push(clean ? 'The working tree is clean.' : parts.join(' · '));
  return lines.join('\n');
}

/** Next steps derived only from the state: no commit offer on a clean tree, conflicts first. */
export function gitNextSteps(git: GitFacts): AskOption[] {
  const next: AskOption[] = [];
  if (git.conflicted.length) next.push({key: 'git:conflicts', label: 'Show conflicted files', refine: 'show conflicted files'});
  if (git.untracked.length) next.push({key: 'git:untracked', label: 'Show untracked files', refine: 'show untracked files'});
  if (git.modified.length || git.deleted.length) next.push({key: 'git:diff', label: 'Show diff', refine: 'git diff'});
  if (git.staged.length) next.push({key: 'git:staged', label: 'Review staged diff', refine: 'show staged diff'}, {key: 'git:commit', label: 'Commit staged changes', refine: 'commit staged changes'});
  else if (git.modified.length || git.untracked.length) next.push({key: 'git:stage', label: 'Stage changes', refine: 'stage all changes'});
  if (!next.length && !git.detached) {
    next.push({key: 'git:log', label: 'Show recent commits', refine: 'show recent commits'});
    if (git.ahead) next.push({key: 'git:push', label: 'Push this branch', refine: 'push this branch'});
  }
  return next.slice(0, 4);
}

function listed(paths: readonly string[], limit = 20): string {
  return `${paths.slice(0, limit).map(path => `  ${path}`).join('\n')}${paths.length > limit ? `\n  … and ${paths.length - limit} more` : ''}`;
}

/** A quoted message: "fix it", 'fix it', “fix it”, or `message fix it` at the end. */
export function commitMessage(raw: string): string | undefined {
  // Paired quotes, double forms first, so an apostrophe inside "it's done" is part of the message.
  for (const pattern of [/"([^"]{1,200})"/u, /“([^”]{1,200})”/u, /‘([^’]{1,200})’/u, /(?:^|\s)'([^']{1,200})'(?=\s|$)/u]) {
    const quoted = pattern.exec(raw);
    if (quoted) return quoted[1]!.trim() || undefined;
  }
  const after = /\b(?:message|msg|-m)\s+(?!["“'‘])(.{1,200})$/iu.exec(raw);
  return after?.[1]!.trim() || undefined;
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

/** "only the second one", "just the first two", "only notes.md": a subset of the files this conversation is about. */
export function refineFiles(text: string, files: readonly string[]): string[] | undefined {
  if (!/\b(?:only|just|except|but not|not)\b/u.test(text)) return undefined;
  const picked = new Set<number>();
  ORDINALS.forEach((word, index) => { if (new RegExp(`\\b${word}\\b`, 'u').test(text) && index < files.length) picked.add(index); });
  const firstN = /\bfirst (two|three|four|\d+)\b/u.exec(text);
  if (firstN) { const count = {two: 2, three: 3, four: 4}[firstN[1] as 'two'] ?? Number(firstN[1]); for (let index = 0; index < Math.min(count, files.length); index += 1) picked.add(index); }
  if (/\blast\b/u.test(text) && files.length) picked.add(files.length - 1);
  files.forEach((file, index) => { const base = file.split('/').pop()!.toLowerCase(); if (base.length > 2 && text.includes(base)) picked.add(index); });
  if (!picked.size) return undefined;
  const chosen = [...picked].sort((a, b) => a - b).map(index => files[index]!);
  return /\b(?:except|but not|not)\b/u.test(text) ? files.filter(file => !chosen.includes(file)) : chosen;
}

const CHANGES = /\b(?:stuff|things|files|what) i(?:'ve| have)? (?:changed|modified|edited|touched)\b|\bmy (?:changes|edits)\b|\bwhat(?:'s| is| did i)? (?:changed|change)\b/u;
const DIFF = /^(?:please )?(?:show|see|view|display)(?: me)? (?:the |my |a )?(?:git )?diff\b/u;
const PRONOUN = /\b(?:them|those|these|it|that|this stuff|these files|those files|the files)\b/u;

function untrackedOutcome(git: GitFacts): AskOutcome {
  if (!git.untracked.length) return {kind: 'answer', capability: 'git.status', text: 'There are no untracked files.', referents: {files: {paths: [], kind: 'untracked'}}};
  return {kind: 'answer', capability: 'git.status', text: `${plural(git.untracked.length, 'untracked file')}:\n${listed(git.untracked)}`,
    referents: {files: {paths: [...git.untracked], kind: 'untracked'}},
    next: [{key: 'git:add-them', label: 'Stage them', refine: 'add them'}, {key: 'git:clean-preview', label: 'Preview what git clean would remove', refine: 'preview git clean'},
      {key: 'git:clean-command', label: 'Show the command to delete them', refine: 'what is the command to delete them'}]};
}

function remoteChoice(git: GitFacts, build: (remote: string) => AskOutcome, verb: string): AskOutcome {
  return {kind: 'choose', reason: 'missing', capability: 'git.status', question: `This branch has no upstream. Which remote should it ${verb}?`,
    options: git.remotes.map(remote => ({key: `remote:${remote}`, label: remote, outcome: build(remote)}))};
}

function pushOutcome(git: GitFacts, reference?: CommandReference): AskOutcome {
  if (git.detached || !git.branch) return {kind: 'answer', capability: 'git.status', text: 'HEAD is detached, so there is no current branch to push. Switch to a branch first (git switch <branch>).'};
  const branch = git.branch;
  if (git.upstream) {
    return answerWithBlock(`Your branch tracks ${git.upstream}, so a plain push sends it there.`, contextBlock(['git', 'push'], git, `Pushes ${branch} to ${git.upstream}.`), {branch});
  }
  // -u is used only when local command knowledge confirms it.
  const push = reference?.lookup(['git', 'push'])?.facts;
  const upstreamFlag = !push || reference!.option(push, '-u') ? '-u' : reference!.option(push, '--set-upstream') ? '--set-upstream' : undefined;
  const build = (remote: string): AskOutcome => {
    const argv = ['git', 'push', ...(upstreamFlag ? [upstreamFlag] : []), remote, branch];
    return answerWithBlock(`${branch} has no upstream yet. This pushes it to ${remote}${upstreamFlag ? ` and sets ${remote}/${branch} as its upstream (${upstreamFlag}), so later a plain git push is enough` : ''}.`,
      contextBlock(argv, git, `Pushes ${branch} to ${remote}${upstreamFlag ? ' and remembers it as the upstream' : ''}.`), {branch, remote});
  };
  if (git.remotes.length === 1) return build(git.remotes[0]!);
  if (!git.remotes.length) {
    const argv = ['git', 'push', ...(upstreamFlag ? [upstreamFlag] : []), '<remote>', branch];
    return answerWithBlock('This repository has no remotes configured, so there is nowhere to push yet (git remote add <name> <url> adds one).',
      contextBlock(argv, git, 'Fill in a remote first.', [], [argv.indexOf('<remote>')]), {branch});
  }
  return remoteChoice(git, build, 'push to');
}

function pullOutcome(git: GitFacts): AskOutcome {
  if (git.detached || !git.branch) return {kind: 'answer', capability: 'git.status', text: 'HEAD is detached, so there is no current branch to pull into.'};
  const branch = git.branch;
  if (git.upstream) return answerWithBlock(`Your branch tracks ${git.upstream}, so a plain pull uses it.`, contextBlock(['git', 'pull'], git, `Fetches ${git.upstream} and integrates it into ${branch}.`), {branch});
  const build = (remote: string) => answerWithBlock(`${branch} has no upstream, so name the remote and branch.`,
    contextBlock(['git', 'pull', remote, branch], git, `Fetches ${remote}/${branch} and integrates it into ${branch}.`), {branch, remote});
  if (git.remotes.length === 1) return build(git.remotes[0]!);
  if (!git.remotes.length) return {kind: 'answer', capability: 'git.status', text: 'This repository has no remotes configured, so there is nothing to pull from.'};
  return remoteChoice(git, build, 'pull from');
}

function answerWithBlock(text: string, block: CommandBlock, referents: AskReferents = {}): AskOutcome {
  return {kind: 'answer', capability: 'git.status', text, block, referents: {...referents, command: block.argv.slice(0, 2), block}};
}

/**
 * Git requests in plain language, resolved against facts. Undefined leaves the
 * request to the rest of the resolver (capabilities, concepts, commands).
 */
export function resolveGit(text: string, raw: string, context: AskContext, reference?: CommandReference): AskOutcome | undefined {
  const git = context.git;
  const refs = context.referents;
  const files = refs?.files;
  const aboutGit = /\b(?:git|branch|upstream|remote|remotes|untracked|staged|stage|unstaged|commit|push|pull|fetch|conflict|conflicts|conflicted|working tree)\b/u.test(text)
    || CHANGES.test(text) || DIFF.test(text);
  const referring = Boolean(files) && PRONOUN.test(text);
  if (!aboutGit && !referring && !(refs?.block && /^(?:actually |no )?(?:only|just|except)\b/u.test(text))) return undefined;
  // Outside a repository only a question about this repository's state gets that answer; explanations and refusals resolve elsewhere.
  if (!context.repoRoot || !git) return !context.repoRoot && /^(?:show|list|what|which|how)\b/u.test(text) && !/^what (?:is|does|do)\b/u.test(text)
    && /\b(?:this branch|my branch|untracked|my changes|this repo|remote am i|remotes)\b/u.test(text)
    ? {kind: 'answer', capability: 'git.status', text: 'This folder is not in a Git repository.'} : undefined;

  // "actually only the second one": refine the files the current command is about.
  if (files?.paths.length && refs?.block) {
    const subset = refineFiles(text, files.paths);
    if (subset?.length) return addOutcome(git, subset, files.kind);
  }
  const question = /\b(?:command|how (?:do|can|would) i|how to|syntax|what would|what's the|what is the)\b/u.test(text);
  // "show me the diff", "show me the stuff i changed": the read-only diff, with the facts first.
  if (DIFF.test(text) || (CHANGES.test(text) && /^(?:show|see|view|what|list)\b/u.test(text))) {
    const staged = /\bstaged\b/u.test(text);
    const summary = gitSummary(git);
    return {kind: 'proposal', capability: 'git.diff', safety: 'read', confidence: 0.95, text: `${summary}\nShow the ${staged ? 'staged' : 'working-tree'} diff?`,
      action: {kind: 'read', command: {id: 'git.diff', ...(staged ? {staged: true} : {})}},
      referents: {files: {paths: [...new Set([...git.modified, ...git.deleted, ...git.untracked])], kind: 'modified'}}};
  }
  if (/\bstaged\b/u.test(text) && /^(?:show|list|see|what|which)\b/u.test(text) && !/\bunstaged\b/u.test(text)) {
    return git.staged.length ? {kind: 'answer', capability: 'git.status', text: `${plural(git.staged.length, 'staged file')}:\n${listed(git.staged)}`, referents: {files: {paths: [...git.staged], kind: 'staged'}},
      next: [{key: 'git:commit', label: 'Commit them', refine: 'commit with message "'}]}
      : {kind: 'answer', capability: 'git.status', text: 'Nothing is staged.', next: gitNextSteps(git)};
  }
  // "what did my last commit do": git show --stat HEAD, read-only.
  if (/\b(?:last|latest|previous|most recent) commit\b/u.test(text) && /\b(?:what|show|did|do|change|changed|contain)\b/u.test(text)) {
    return answerWithBlock('Your last commit, with the files it changed:', {...contextBlock(['git', 'show', '--stat', 'HEAD'], git, 'Shows the newest commit\'s message and changed files.'), risk: 'read'});
  }
  // "make a new branch called test": git switch -c, a mutating action behind the final Yes.
  const newBranch = /\b(?:make|create|start|new|add|open)\b.*\bbranch\b(?:.*\b(?:called|named)\b)?\s+["']?([\w./-]+)["']?$/u.exec(text);
  if (newBranch && /\b(?:make|create|start|new)\b/u.test(text) && !/^(?:what|which)\b/u.test(text)) {
    const name = newBranch[1]!;
    if (name === 'branch' || !validBranchName(name)) return {kind: 'answer', capability: 'git.status', text: `"${name}" isn't a valid branch name.`};
    return answerWithBlock(`Create ${name} from ${git.detached ? 'the current commit' : git.branch ?? 'HEAD'} and switch to it:`, contextBlock(['git', 'switch', '-c', name], git, `Creates ${name} at the current commit; your working tree is kept.`),
      {branch: name});
  }
  if (/\bforce[- ]?push\b|\bpush\b.*\b(?:--force|-f)\b/u.test(text)) {
    return answerWithBlock('A force push replaces the remote branch\'s history. Ask won\'t run it; here is the safer form to copy if you mean it.',
      {...contextBlock(['git', 'push', '--force-with-lease'], git, 'Overwrites the remote branch only if it still matches what you last fetched.'), risk: 'destructive'});
  }
  if (/\b(?:delete|remove|clean|get rid of|wipe)\b/u.test(text) && (/\buntracked\b/u.test(text) || (files?.kind === 'untracked' && (PRONOUN.test(text) || /\bstuff\b/u.test(text))))) {
    if (!question && !/\bpreview\b/u.test(text)) return undefined; // an action request stays with the safety policy (refused, with a preview offered)
    const count = git.untracked.length;
    return {kind: 'answer', capability: 'git.status',
      text: `${count ? `${plural(count, 'untracked file')} in this repository.` : 'There are no untracked files right now.'} Preview first; deleting is permanent and Ask won't run it.\n\nPreview only\n  git clean -nd\n\nDelete untracked files (permanent)`,
      block: {...contextBlock(['git', 'clean', '-fd'], git, 'Permanently removes untracked files and directories (ignored files are kept).'), risk: 'destructive'},
      referents: {files: {paths: [...git.untracked], kind: 'untracked'}, command: ['git', 'clean']},
      next: [{key: 'git:clean-preview', label: 'Preview what would be removed', refine: 'preview git clean'}]};
  }
  if (/\bpreview\b.*\bclean\b|\bclean\b.*\b(?:-n|dry run|preview)\b/u.test(text)) {
    return answerWithBlock('A dry run lists what git clean would remove, without removing anything.',
      {...contextBlock(['git', 'clean', '-nd'], git, 'Lists untracked files and directories git clean -fd would remove.'), risk: 'read', run: {kind: 'git', argv: ['git', 'clean', '-nd'], risk: 'read'}});
  }
  if (/\buntracked\b/u.test(text) || (files?.kind === 'untracked' && /^(?:show|list|see)\b/u.test(text) && PRONOUN.test(text))) return untrackedOutcome(git);
  if (/\bconflict/u.test(text)) {
    return git.conflicted.length ? {kind: 'answer', capability: 'git.status', text: `${plural(git.conflicted.length, 'conflicted file')}:\n${listed(git.conflicted)}\nResolve each, then git add it.`,
      referents: {files: {paths: [...git.conflicted], kind: 'conflicted'}}} : {kind: 'answer', capability: 'git.status', text: 'There are no merge conflicts.'};
  }
  if (/\b(?:add|stage)\b/u.test(text)) {
    if (referring && files?.paths.length) return addOutcome(git, files.paths, files.kind);
    if (/\b(?:all|everything|changes)\b/u.test(text)) {
      const paths = [...new Set([...git.modified, ...git.deleted, ...git.untracked])];
      if (!paths.length) return {kind: 'answer', capability: 'git.status', text: 'There is nothing to stage.'};
      return answerWithBlock(`Stage all ${plural(paths.length, 'change')} (modified, deleted and untracked)?`, contextBlock(['git', 'add', '-A'], git, 'Stages every change in the working tree.'),
        {files: {paths, kind: 'mentioned'}});
    }
  }
  if (/\bcommit\b/u.test(text) && !/\b(?:recent|last|latest|history|log)\b/u.test(text)) {
    if (!git.staged.length) return {kind: 'answer', capability: 'git.status', text: 'Nothing is staged, so there is nothing to commit yet.', next: gitNextSteps(git)};
    const message = commitMessage(raw);
    if (!message) return {kind: 'choose', reason: 'missing', capability: 'git.status', question: `${plural(git.staged.length, 'file')} staged. What should the commit message be?`,
      options: [{key: 'commit:message', label: 'Type: commit with message "…"', refine: 'commit with message "'}]};
    return answerWithBlock(`Commit ${plural(git.staged.length, 'staged file')} on ${git.branch ?? 'detached HEAD'}:`, contextBlock(['git', 'commit', '-m', message], git, 'Records the staged changes as a new commit.'));
  }
  if (/\bpush\b/u.test(text) && /\b(?:branch|this|it|my|changes|commits|upstream)\b/u.test(text)) return pushOutcome(git, reference);
  if (/\bpull\b/u.test(text) && /\b(?:branch|this|it|my|changes|latest|upstream)\b/u.test(text)) return pullOutcome(git);
  // "how do i push", "what's the syntax to push": a plain push is not a force push; the syntax, then this branch's exact command.
  if (/\b(?:push|pull)\b/u.test(text) && (question || /^(?:git )?(?:push|pull)$/u.test(text) || /^how\b/u.test(text))) {
    const verb = /\bpush\b/u.test(text) ? 'push' : 'pull';
    const syntax = verb === 'push' ? 'git push [<remote> [<branch>]] sends your commits to a remote. It never rewrites history unless you add --force.' : 'git pull [<remote> [<branch>]] fetches a remote branch and integrates it into yours.';
    const contextual = verb === 'push' ? pushOutcome(git, reference) : pullOutcome(git);
    return contextual.kind === 'answer' ? {...contextual, text: `${syntax}\n\nHere:\n${contextual.text}`} : contextual;
  }
  if (/\bfetch\b/u.test(text)) return git.remotes.length ? answerWithBlock('Fetching downloads new commits from remotes without changing your branch.', contextBlock(['git', 'fetch', '--all'].filter(arg => arg !== '--all' || git.remotes.length > 1), git, 'Updates remote-tracking branches only.'))
    : {kind: 'answer', capability: 'git.status', text: 'This repository has no remotes to fetch from.'};
  if (/\bremotes?\b/u.test(text) || /\bupstream\b/u.test(text)) {
    const upstream = git.upstream ? `${git.branch} tracks ${git.upstream}.` : git.detached ? 'HEAD is detached (no upstream).' : `${git.branch} has no upstream.`;
    return {kind: 'answer', capability: 'git.status', text: `${git.remotes.length ? `Remotes: ${git.remotes.join(', ')}.` : 'No remotes are configured.'} ${upstream}`};
  }
  if (/\b(?:git status|status of (?:the )?repo|what changed|what(?:'s| is) changed|working tree|repo status)\b/u.test(text) || /^(?:show |check )?(?:my )?git(?: status)?$/u.test(text)) {
    // The facts first; the full status is the existing read-only action, shown in the transcript when confirmed.
    return {kind: 'proposal', capability: 'git.status', safety: 'read', confidence: 0.95, text: `${gitSummary(git)}\nShow the full git status?`,
      action: {kind: 'read', command: {id: 'git.status'}}};
  }
  return undefined;
}

function addOutcome(git: GitFacts, paths: readonly string[], kind: NonNullable<AskReferents['files']>['kind']): AskOutcome {
  const argv = ['git', 'add', '--', ...paths];
  return answerWithBlock(`Stage ${paths.length === 1 ? paths[0] : plural(paths.length, 'file')}?`, contextBlock(argv, git, `Stages ${plural(paths.length, 'file')} for the next commit.`),
    {files: {paths: [...paths], kind}});
}
