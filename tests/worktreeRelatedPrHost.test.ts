import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {PrSummary} from '../src/githubWorkspace/model.js';
import {createRepo} from './helpers/worktreeRepos.js';

const pr = (number: number, extra: Partial<PrSummary> = {}): PrSummary => ({ref: {kind: 'pr', owner: 'acme', repo: 'app', number}, title: `PR ${number}`,
  state: 'open', draft: false, headRef: 'main', headRepository: 'acme/app', reviewDecision: 'none', mergeable: 'unknown', checks: 'unknown', ...extra} as PrSummary);

/** A frontend in the fixture repository; github.com origin and /github are the test's. */
function app(cwd: string, origin: string | undefined): {app: TerminalApp; opened: Array<PrSummary['ref'] | undefined>} {
  const instance = new TerminalApp();
  const opened: Array<PrSummary['ref'] | undefined> = [];
  Object.defineProperty(instance, 'render', {value: () => {}});
  instance['startupPending'] = false;
  instance['shellCwd'] = cwd;
  Object.defineProperty(instance, 'canonicalShellCwd', {value: () => cwd});
  Object.defineProperty(instance, 'githubOrigin', {value: async () => origin});
  Object.defineProperty(instance, 'openGithub', {value: async (_tab: string, ref?: PrSummary['ref']) => { opened.push(ref); }});
  return {app: instance, opened};
}

test('/worktrees: a related PR comes only from the last /github listing of the same repository; p opens it in /github', async () => {
  const fixture = await createRepo();
  const same = app(fixture.repo, 'acme/app');
  const other = app(fixture.repo, 'acme/other');
  try {
    for (const {app: instance} of [same, other]) instance['githubListing'] = {repository: 'acme/app', prs: [pr(7)]};
    await same.app['openWorktrees']();
    const controller = same.app['worktreePanel']!.controller;
    assert.deepEqual(controller.relatedPrs().map(related => related.pr.ref.number), [7]);
    await same.app['handleWorktreeKey']({kind: 'text', value: 'p'});
    assert.deepEqual(same.opened, [pr(7).ref]);
    assert.equal(same.app['worktreePanel'], undefined, 'the manager closes; /github shows the PR');
    // A listing of another repository is not evidence here, even for the same branch name.
    await other.app['openWorktrees']();
    assert.deepEqual(other.app['worktreePanel']!.controller.relatedPrs(), []);
  } finally {
    for (const {app: instance} of [same, other]) { instance['stop'](0); instance['session'].kill(); }
    await fixture.dispose();
  }
});
