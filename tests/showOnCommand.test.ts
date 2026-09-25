import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CommandContextCache, commandWords, readDockerContext, readKubeContext} from '../src/prompt/commandContext.js';
import {buildContextLine, isOnCommandRelevant, nativePromptSnapshot, renderedModules} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, hasVisibleContextModule, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {handlePromptPanelKey, renderPromptPanel} from '../src/prompt/PromptPanel.js';
import {renderHistoricalContext} from '../src/output/OutputBuffer.js';
import {stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';
import type {PromptContext} from '../src/shell/ShellContext.js';

const base: PromptContext = {cwd: '/work', project: 'work', toolchains: ['node', 'python'], kubeContext: 'prod-eu', dockerContext: 'colima'};
const roles = (context: PromptContext, configuration = DEFAULT_PROMPT_CONFIGURATION) =>
  renderedModules(context, configuration).map(module => module.role);

test('command words: every simple command, past assignments and precommands, never executed', () => {
  assert.deepEqual(commandWords('kubectl get pods'), ['kubectl']);
  assert.deepEqual(commandWords('FOO=1 sudo -E helm ls | grep x && docker ps; echo hi'), ['helm', 'grep', 'docker', 'echo']);
  assert.deepEqual(commandWords('env -i /usr/local/bin/kubectl version'), ['kubectl']);
  assert.deepEqual(commandWords('(cd x && npm test)'), ['cd', 'npm']);
  assert.deepEqual(commandWords('echo kubectl'), ['echo'], 'arguments are not commands');
  assert.deepEqual(commandWords('   '), []);
  assert.deepEqual(commandWords('$(rm -rf /)'), ['$', 'rm'], 'substitutions are only tokenized, never run');
});

test('Kubernetes and Docker contexts appear only while their commands are typed', () => {
  assert.deepEqual(roles({...base, commandWords: []}), ['project', 'cwd', 'node', 'python']);
  assert.ok(roles({...base, commandWords: commandWords('kubectl get pods')}).includes('kubernetes'));
  assert.ok(!roles({...base, commandWords: commandWords('kubectl get pods')}).includes('docker'));
  const docker = renderedModules({...base, commandWords: ['docker']}, DEFAULT_PROMPT_CONFIGURATION).find(module => module.id === 'dockerContext');
  assert.match(docker?.text ?? '', /colima/u);
  assert.equal(roles({...base, kubeContext: undefined, commandWords: ['kubectl']}).includes('kubernetes'), false, 'unresolved lookups show nothing');
});

test('Always shows the context without a command; hidden modules never show', () => {
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  config.modules.find(module => module.id === 'kubeContext')!.condition = 'always';
  config.modules.find(module => module.id === 'dockerContext')!.visible = false;
  assert.ok(roles({...base, commandWords: []}, config).includes('kubernetes'));
  assert.ok(!roles({...base, commandWords: ['docker']}, config).includes('docker'));
});

test('toolchains on command show only the toolchains the command is about', () => {
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  config.modules.find(module => module.id === 'toolchain')!.condition = 'onCommand';
  assert.deepEqual(roles({...base, commandWords: []}, config), ['project', 'cwd']);
  assert.deepEqual(roles({...base, commandWords: ['npm']}, config), ['project', 'cwd', 'node']);
  assert.deepEqual(roles({...base, commandWords: ['uv', 'pnpm']}, config), ['project', 'cwd', 'node', 'python']);
  assert.deepEqual(roles({...base, commandWords: ['go']}, config), ['project', 'cwd'], 'undetected toolchains stay hidden');
});

test('configuration: on-command defaults, only eligible modules accept it, and it persists', () => {
  const kube = DEFAULT_PROMPT_CONFIGURATION.modules.find(module => module.id === 'kubeContext');
  assert.deepEqual(kube, {id: 'kubeContext', visible: true, condition: 'onCommand'});
  const config = normalizePromptConfiguration({modules: [
    {id: 'project', visible: true, condition: 'onCommand'},
    {id: 'toolchain', visible: true, condition: 'onCommand'},
  ]});
  assert.equal(config.modules.find(module => module.id === 'project')!.condition, 'always');
  assert.equal(config.modules.find(module => module.id === 'toolchain')!.condition, 'onCommand');
  assert.deepEqual(normalizePromptConfiguration(JSON.parse(JSON.stringify(config))).modules, config.modules);
});

test('layout visibility counts on-command modules only when relevant', () => {
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  config.modules = config.modules.map(module => ({...module, visible: module.id === 'kubeContext'}));
  assert.equal(hasVisibleContextModule(config, {commandWords: []}, isOnCommandRelevant), false);
  assert.equal(hasVisibleContextModule(config, {commandWords: ['helm']}, isOnCommandRelevant), true);
});

test('/prompt modules: ←→ switches on command and always; rows say so', () => {
  const saved = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const index = saved.modules.findIndex(module => module.id === 'dockerContext');
  const state = {onboarding: false, step: 'modules' as const, selectedIndex: index, draft: structuredClone(saved), saved};
  assert.ok(stripAnsi(renderPromptPanel(state, 120, []).join('\n')).includes('‹ on command ›'));
  handlePromptPanelKey({kind: 'right'} as Key, state);
  assert.equal(state.draft.modules[index]!.condition, 'always');
  handlePromptPanelKey({kind: 'left'} as Key, state);
  assert.equal(state.draft.modules[index]!.condition, 'onCommand');
});

test('snapshots capture the context shown at submission; history stays as captured', () => {
  const context = {...base, commandWords: commandWords('kubectl apply -f x.yaml')};
  const snapshot = nativePromptSnapshot(context, DEFAULT_PROMPT_CONFIGURATION);
  assert.ok(snapshot.segments.some(segment => segment.role === 'kubernetes' && segment.text.includes('prod-eu')));
  const row = renderHistoricalContext({cwd: '/work', project: 'work', prompt: snapshot}, 120)!;
  assert.ok(row.plain.includes('prod-eu'));
  assert.ok(!stripAnsi(buildContextLine({...base, commandWords: []}, 120, DEFAULT_PROMPT_CONFIGURATION)).includes('prod-eu'));
});

test('lookups read kubeconfig and Docker config files only', async () => {
  const home = await mkdtemp(join(tmpdir(), 'nmsh-ctx-'));
  try {
    assert.equal(await readKubeContext({}, home), undefined);
    assert.equal(await readDockerContext({}, home), 'default');
    await mkdir(join(home, '.kube'));
    await writeFile(join(home, '.kube', 'config'), 'apiVersion: v1\ncurrent-context: "dev-cluster"\nkind: Config\n');
    assert.equal(await readKubeContext({}, home), 'dev-cluster');
    const other = join(home, 'other.yaml');
    await writeFile(other, 'current-context: staging\n');
    assert.equal(await readKubeContext({KUBECONFIG: `${join(home, 'missing')}:${other}`}, home), 'staging');
    await mkdir(join(home, '.docker'));
    await writeFile(join(home, '.docker', 'config.json'), JSON.stringify({currentContext: 'colima'}));
    assert.equal(await readDockerContext({}, home), 'colima');
    assert.equal(await readDockerContext({DOCKER_CONTEXT: 'remote'}, home), 'remote');
    await writeFile(join(home, '.docker', 'config.json'), '{not json');
    assert.equal(await readDockerContext({}, home), 'default');
  } finally {
    await rm(home, {recursive: true, force: true});
  }
});

test('the lookup cache answers immediately and refreshes in the background', async () => {
  let clock = 0;
  let reads = 0;
  let updates = 0;
  let value = 'a';
  const cache = new CommandContextCache(() => { updates += 1; }, {
    kubeContext: async () => { reads += 1; return value; },
    dockerContext: async () => undefined,
  }, 1000, () => clock);
  assert.equal(cache.get('kubeContext'), undefined, 'first access never waits');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cache.get('kubeContext'), 'a');
  assert.equal(updates, 1);
  cache.get('kubeContext');
  assert.equal(reads, 1, 'fresh values are not re-read');
  value = 'b';
  clock = 2000;
  assert.equal(cache.get('kubeContext'), 'a', 'stale values still answer immediately');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cache.get('kubeContext'), 'b');
  assert.equal(updates, 2);
});
