import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StarshipConfigAdapter} from '../src/prompt/StarshipConfigAdapter.js';
import {renderPromptPanel, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {stripAnsi} from '../src/util/text.js';

test('Starship module changes are previewed, backed up, and preserve unrelated config', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-starship-adapter-'));
  const path = join(directory, 'starship.toml');
  const original = '# User note\n[custom]\nunknown = "keep me"\n';
  await writeFile(path, original);
  const run = async (_binary: string, args: string[], options: {env?: NodeJS.ProcessEnv}) => {
    const staged = options.env?.STARSHIP_CONFIG;
    assert.ok(staged);
    if (args[0] === 'config') {
      const source = await readFile(staged, 'utf8');
      await writeFile(staged, `${source}\n[directory]\ndisabled = ${args[2]}\n`);
      return {stdout: '', stderr: ''};
    }
    const text = await readFile(staged, 'utf8');
    return {stdout: `[directory]\ndisabled = ${/\[directory\]\s+disabled = true/u.test(text) ? 'true' : 'false'}\n`, stderr: ''};
  };
  try {
    const adapter = new StarshipConfigAdapter({installed: true, binary: '/fake/starship', configPath: path, configExists: true},
      run as ConstructorParameters<typeof StarshipConfigAdapter>[1]);
    const proposal = await adapter.propose('directory', true);
    assert.equal(await readFile(path, 'utf8'), original);
    assert.match(proposal.diff.join('\n'), /disabled = true/u);
    const backup = await adapter.apply(proposal);
    assert.ok(backup);
    assert.equal(await readFile(backup, 'utf8'), original);
    assert.match(await readFile(path, 'utf8'), /unknown = "keep me"/u);
    assert.equal(await adapter.disabled('directory'), true);
    assert.equal((await readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('Starship adapter rejects intervening edits and symlink configs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-starship-guard-'));
  const path = join(directory, 'starship.toml');
  await writeFile(path, '# original\n');
  const run = async (_binary: string, args: string[], options: {env?: NodeJS.ProcessEnv}) => {
    if (args[0] === 'config') await writeFile(options.env!.STARSHIP_CONFIG!, '[git_branch]\ndisabled = true\n');
    return {stdout: '[git_branch]\ndisabled = true\n', stderr: ''};
  };
  const adapter = new StarshipConfigAdapter({installed: true, binary: '/fake/starship', configPath: path, configExists: true},
    run as ConstructorParameters<typeof StarshipConfigAdapter>[1]);
  try {
    const proposal = await adapter.propose('git_branch', true);
    await writeFile(path, '# changed by user\n');
    await assert.rejects(adapter.apply(proposal), /changed since preview/u);
    assert.equal(await readFile(path, 'utf8'), '# changed by user\n');
    await rm(path);
    await symlink(join(directory, 'target.toml'), path);
    await assert.rejects(adapter.propose('git_branch', true), /regular file/u);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('Starship adapter leaves the user config untouched when CLI validation fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-starship-invalid-'));
  const path = join(directory, 'starship.toml');
  await writeFile(path, '# keep\n');
  const run = async (_binary: string, args: string[], options: {env?: NodeJS.ProcessEnv}) => {
    if (args[0] === 'config') await writeFile(options.env!.STARSHIP_CONFIG!, '[directory]\ndisabled = true\n');
    return {stdout: '[directory]\ndisabled = false\n', stderr: ''};
  };
  try {
    const adapter = new StarshipConfigAdapter({installed: true, binary: '/fake/starship', configPath: path, configExists: true},
      run as ConstructorParameters<typeof StarshipConfigAdapter>[1]);
    await assert.rejects(adapter.propose('directory', true), /did not accept/u);
    assert.equal(await readFile(path, 'utf8'), '# keep\n');
    assert.deepEqual(await readdir(directory), ['starship.toml']);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('Starship panel offers a module editor with explicit review', () => {
  const state: PromptPanelState = {onboarding: false, step: 'starship', selectedIndex: 0,
    draft: normalizePromptConfiguration({provider: 'starship'}),
    starshipStatus: {installed: true, binary: '/fake/starship', configPath: '/tmp/starship.toml', configExists: true}};
  assert.match(renderPromptPanel(state, 120, []).map(stripAnsi).join('\n'), /Configure modules/u);
  state.step = 'starshipModules';
  state.starshipModules = [false, true, false, false, false, false, false];
  assert.match(renderPromptPanel(state, 120, []).map(stripAnsi).join('\n'), /git_branch\s+Disabled/u);
  state.step = 'starshipConfirm';
  state.starshipProposal = {path: '/tmp/starship.toml', module: 'git_branch', disabled: false,
    original: '', existed: false, proposed: '', diff: ['+ disabled = false']};
  const review = renderPromptPanel(state, 120, []).map(stripAnsi).join('\n');
  assert.match(review, /Review Starship config change/u);
  assert.match(review, /Apply reviewed change/u);
});
