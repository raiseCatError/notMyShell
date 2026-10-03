import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StarshipConfigAdapter} from '../src/prompt/StarshipConfigAdapter.js';
import {configurationKey, createConfigurationPanel, renderConfigurationPanel} from '../src/tools/ConfigurationPanel.js';
import type {SupportedConfiguration} from '../src/tools/SupportedConfiguration.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

test('native adapter refuses unrelated rewrites, unsupported values and forged proposals without exposing config', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-config-safety-'));
  const path = join(directory, 'starship.toml');
  const original = '# SECRET-UNKNOWN\n[custom]\nsecret = "never-print"\n';
  await writeFile(path, original);
  const run = async (_binary: string, args: string[], options: {env?: NodeJS.ProcessEnv}) => {
    if (args[0] === 'config') await writeFile(options.env!.STARSHIP_CONFIG!, '[directory]\ndisabled = true\n');
    return {stdout: 'disabled = true\n', stderr: ''};
  };
  const adapter = new StarshipConfigAdapter({installed: true, binary: '/fake', configPath: path, configExists: true},
    run as ConstructorParameters<typeof StarshipConfigAdapter>[1]);
  try {
    await assert.rejects(adapter.propose('directory', true), error => {
      assert.doesNotMatch(String(error), /SECRET|never-print/u); return /outside/u.test(String(error));
    });
    await assert.rejects(adapter.propose('arbitrary' as 'directory', true), /Unsupported/u);
    await assert.rejects(adapter.propose('directory', 'yes' as unknown as boolean), /boolean/u);
    await assert.rejects(adapter.apply({path, module: 'directory', disabled: true, original,
      proposed: 'bad', existed: true, diff: []}), /prepared/u);
    assert.equal(await readFile(path, 'utf8'), original);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('shared panel defaults to cancel; keyboard-only preview/apply and narrow NO_COLOR work', async () => {
  let applied = 0;
  let value = true;
  const adapter: SupportedConfiguration = {id: 'fixture', label: 'Fixture',
    fields: [{id: 'enabled', label: 'Enabled', description: 'A supported value'}],
    read: async () => ({enabled: value}),
    prepare: async (_field, next) => ({preview: [`enabled: ${next}`], apply: async () => { applied++; value = next; }})};
  const panel = await createConfigurationPanel(adapter);
  await configurationKey(panel, {kind: 'enter'});
  assert.equal(applied, 0);
  await configurationKey(panel, {kind: 'enter'});
  assert.equal(applied, 0, 'default No cancels');
  await configurationKey(panel, {kind: 'enter'});
  const old = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    for (const width of [1, 12, 30, 80]) {
      const rows = renderConfigurationPanel(panel, width, 24);
      assert.ok(rows.every(row => displayWidth(row) <= width));
      assert.ok(rows.every(row => !/\u001B\[(?:38|48);/u.test(row)));
    }
    assert.match(renderConfigurationPanel(panel, 80, 24).map(stripAnsi).join('\n'), /Review supported change/u);
  } finally { if (old === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = old; }
  await configurationKey(panel, {kind: 'right'});
  await configurationKey(panel, {kind: 'enter'});
  assert.equal(applied, 1);
  assert.equal(panel.values.enabled, false);
  assert.equal(await configurationKey(panel, {kind: 'escape'}), true);
});

test('failed apply drops stale preview and returns a factual secret-free error', async () => {
  const adapter: SupportedConfiguration = {id: 'fixture', label: 'Fixture', fields: [{id: 'x', label: 'X', description: ''}],
    read: async () => ({x: true}), prepare: async () => ({preview: ['X off'], apply: async () => { throw new Error('secret-output'); }})};
  const panel = await createConfigurationPanel(adapter);
  await configurationKey(panel, {kind: 'enter'});
  await configurationKey(panel, {kind: 'right'});
  await configurationKey(panel, {kind: 'enter'});
  assert.equal(panel.review, undefined);
  assert.doesNotMatch(panel.message!, /secret-output/u);
});
