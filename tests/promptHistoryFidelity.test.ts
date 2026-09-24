import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../src/app/TerminalApp.js';
import type {StarshipPromptResult} from '../src/prompt/starship.js';

/** History snapshots must record the NMSh prompt that was live at submission, nothing else. */
async function withApp(run: (app: TerminalApp) => Promise<void> | void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-history-fidelity-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  const app = new TerminalApp();
  try {
    app['context'] = {cwd: '/tmp/repo', project: 'repo', branch: 'main',
      git: {staged: 0, modified: 1, untracked: 0, conflicts: 0, ahead: 0, behind: 0}};
    await run(app);
  } finally {
    app['stop'](0);
    app['session'].kill();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    await rm(directory, {recursive: true, force: true});
  }
}

const external = (text: string): StarshipPromptResult =>
  ({text, segments: [{text, geometry: 'plain'}]} as unknown as StarshipPromptResult);

test('NMSh Native live prompt produces an NMSh Native snapshot, even with a stale external prompt', () => withApp(app => {
  app['promptConfiguration'].provider = 'nmsh';
  app['effectivePromptProvider'] = 'nmsh';
  app['externalPrompt'] = external('~/repo on  main ✔');
  const snapshot = app['currentPromptSnapshot']();
  assert.equal(snapshot.provider, 'nmsh');
  assert.ok(!JSON.stringify(snapshot).includes('✔'), 'no stale external/right-side status leaks in');
  assert.ok(snapshot.segments.some(segment => segment.role === 'gitBranch'));
}));

test('a selected, working Starship or Powerlevel10k provider is what history records', () => withApp(app => {
  for (const provider of ['starship', 'powerlevel10k'] as const) {
    app['promptConfiguration'].provider = provider;
    app['effectivePromptProvider'] = provider;
    app['externalPrompt'] = external(`${provider}-prompt`);
    const snapshot = app['currentPromptSnapshot']();
    assert.equal(snapshot.provider, provider);
    assert.equal(snapshot.segments[0]!.text, `${provider}-prompt`);
  }
}));

test('a failed external provider falls back to a truthful NMSh Native snapshot', () => withApp(async app => {
  app['promptConfiguration'].provider = 'starship';
  app['renderExternalPrompt'] = async () => { throw new Error('starship missing'); };
  await app['refreshProviderPrompt']();
  assert.equal(app['effectivePromptProvider'], 'nmsh');
  assert.equal(app['currentPromptSnapshot']().provider, 'nmsh');
}));

test('a snapshot captures configuration at submission and later changes do not mutate it', () => withApp(app => {
  app['effectivePromptProvider'] = 'nmsh';
  const snapshot = app['currentPromptSnapshot']();
  const frozen = JSON.stringify(snapshot);
  app['promptConfiguration'].nmsh.palette = 'grayscale';
  app['promptConfiguration'].provider = 'starship';
  app['promptConfiguration'].modules.forEach(module => { module.visible = false; });
  app['context'].branch = 'other';
  assert.equal(JSON.stringify(snapshot), frozen);
  assert.equal(snapshot.palette, 'lavender');
}));
