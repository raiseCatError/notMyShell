import {execFileSync} from 'node:child_process';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** Disposable repositories for worktree tests. Never touches the notMyShell checkout. */
export interface Fixture {
  readonly root: string;
  readonly repo: string;
  git(...args: string[]): string;
  gitIn(cwd: string, ...args: string[]): string;
  dispose(): Promise<void>;
}

const ENV = {...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'};

export async function createRepo(): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nmsh-wt-')));
  const repo = join(root, 'repo');
  const gitIn = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', cwd, ...args], {env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  execFileSync('git', ['init', '-q', '-b', 'main', repo], {env: ENV});
  gitIn(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  return {root, repo, gitIn, git: (...args) => gitIn(repo, ...args), dispose: () => rm(root, {recursive: true, force: true})};
}
