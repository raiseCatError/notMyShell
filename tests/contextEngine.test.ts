import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION, DEFAULT_CONTEXT_RAIL, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {buildContextLine, nativePromptSnapshot} from '../src/prompt/prompt.js';
import * as prompt from '../src/prompt/prompt.js';
import {planScreen, regionOf, regionAt, cursorScreenRow, type ScreenPlanInput} from '../src/app/screenPlan.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';
import {mkdtemp, writeFile, mkdir, chmod, symlink, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {resolvePromptContext} from '../src/shell/ShellContext.js';
import {readKubeContext, readDockerContext} from '../src/prompt/commandContext.js';
import {ContextEngine} from '../src/context/engine.js';
import {docker, kubernetes} from '../src/context/capabilities/infrastructure.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {promptFacts, type ContextFact} from '../src/context/facts.js';
import {routeModule} from '../src/context/surfaceRouter.js';
import * as panel from '../src/prompt/PromptPanel.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {mock} from 'node:test';
import fsPromises from 'node:fs/promises';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {runContextGit} from '../src/context/trustedServices.js';


const config = () => structuredClone(DEFAULT_PROMPT_CONFIGURATION);

test('legacy left/right modules retain their placement and acquire an inert Auto Rail', () => {
  const legacy = config();
  legacy.modules[1]!.placement = 'right';
  const old = JSON.parse(JSON.stringify(legacy));
  delete old.contextRail;
  const migrated = normalizePromptConfiguration(old);
  assert.deepEqual(migrated.modules, legacy.modules);
  assert.deepEqual(migrated.contextRail, {...DEFAULT_CONTEXT_RAIL});
  const context = {cwd: '/workspace', project: 'workspace', exitStatus: 0};
  assert.equal(buildContextLine(context, 100, migrated), buildContextLine(context, 100, legacy));
  assert.deepEqual(nativePromptSnapshot(context, migrated), nativePromptSnapshot(context, legacy));
});

test('new explicit surface settings survive normalization without a dead Status Strip choice', () => {
  const value = config() as any;
  value.modules[1].surface = 'contextRail';
  value.modules[2].surface = 'hidden';
  value.modules[3].surface = 'statusStrip';
  value.modules[4].surface = 'statusStrip';
  const exit = value.modules.findIndex((module: {id: string}) => module.id === 'exitStatus');
  value.modules[exit].surface = 'statusStrip';
  value.contextRail = {mode: 'always', rows: 2, theme: 'choose', palette: 'ocean', style: 'minimal', overflow: 'wrap'};
  const migrated = normalizePromptConfiguration(value);
  assert.equal(migrated.modules[1]!.surface, 'contextRail');
  assert.equal(migrated.modules[2]!.surface, 'hidden');
  assert.equal(migrated.modules[3]!.surface, 'statusStrip', 'built-in context may route to the Status Strip');
  assert.equal(migrated.modules.find(module => module.id === 'exitStatus')!.surface, undefined, 'the exit status cannot: no dead choice');
  assert.deepEqual(migrated.contextRail, {...DEFAULT_CONTEXT_RAIL, spacing: 'attached', mode: 'always', rows: 2, theme: 'choose', palette: 'ocean', style: 'minimal', overflow: 'priority'});
});


const railConfig = () => {
  const c = config();
  c.modules = [{id: 'kubeContext', visible: true, condition: 'onCommand', surface: 'contextRail'}];
  return c;
};
const context = {cwd: '/workspace', project: 'workspace', kubeContext: 'production', commandWords: ['kubectl']};

test('Rail modes, rows and show-on-command use resolved context without entering prompt snapshots', () => {
  assert.equal(typeof prompt.buildContextRail, 'function', 'Rail rendering exists');
  const c = railConfig();
  assert.match(stripAnsi(prompt.buildContextRail(context, 80, c)[0]!), /production/);
  assert.deepEqual(prompt.buildContextRail({...context, commandWords: ['echo']}, 80, c), []);
  assert.ok(!stripAnsi(buildContextLine(context, 80, c)).includes('production'));
  assert.deepEqual(nativePromptSnapshot(context, c).segments, []);
  c.contextRail.mode = 'off';
  assert.deepEqual(prompt.buildContextRail(context, 80, c), []);
  c.contextRail.mode = 'always'; c.contextRail.rows = 2;
  assert.deepEqual(prompt.buildContextRail({...context, commandWords: []}, 80, c), ['', '']);
  assert.equal(prompt.buildContextRail(context, 80, c).length, 2);
});

test('contextual display strings neutralize controls and bidi and bound huge values', () => {
  const c = config(); c.modules = [{id: 'gitBranch', visible: true, condition: 'always'}];
  const hostile = {...context, branch: 'safe\x1b[2J\u202eevil' + 'x'.repeat(100000)};
  const snapshot = nativePromptSnapshot(hostile, c);
  const text = snapshot.segments[0]!.text;
  assert.ok(!/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(text));
  assert.ok(text.length < 1100, 'bounded before painting and snapshotting');
});

for (const position of ['bottom', 'top', 'flow'] as const) {
  test(`Rail geometry consumes view capacity and preserves ${position} input anchor`, () => {
    const base: ScreenPlanInput = {rows: 24, inputRows: 1, suggestions: 2, running: false, detached: false, hasOutput: true,
      contextPlacement: 'header', hasVisibleContext: true, composerLayout: 'twoLine', composerPosition: position, transcriptRows: 5};
    for (const count of [1, 2]) {
      const before = planScreen(base), after = planScreen({...base, contextRailRows: count});
      const rail = regionOf(after, 'contextRail');
      assert.ok(rail); assert.equal(rail.height, count);
      assert.equal(cursorScreenRow(after, 0), cursorScreenRow(before, 0));
      const group = regionOf(after, 'prompt')!;
      const edge = regionOf(after, 'separator')!;
      if (position === 'top') assert.ok(rail.top >= edge.top + edge.height);
      else assert.equal(rail.top + rail.height, group.top);
      assert.equal(after.ptyRows, before.ptyRows - count);
      assert.equal(regionAt(after, rail.top)?.region.kind, 'contextRail');
      assert.ok(!regionOf(planScreen({...base, contextRailRows: count, panelRows: 6}), 'contextRail'));
    }
  });
}


async function exists(path: string): Promise<boolean> { return access(path).then(() => true, () => false); }

test('hostile workspace collection ignores fake PATH Git, fsmonitor, filters and executable metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nmsh-hostile-'));
  const oldPath = process.env.PATH;
  try {
    const marker = join(root, 'EXECUTED');
    const script = `#!/bin/sh\n/usr/bin/touch '${marker}'\n`;
    await writeFile(join(root, 'git'), script); await chmod(join(root, 'git'), 0o755);
    await writeFile(join(root, '.envrc'), script); await writeFile(join(root, 'theme.zsh'), script);
    await writeFile(join(root, 'setup.py'), script);
    execFileSync('/usr/bin/git', ['init', '-q', root]);
    execFileSync('/usr/bin/git', ['-C', root, 'config', 'core.fsmonitor', join(root, 'git')]);
    execFileSync('/usr/bin/git', ['-C', root, 'config', 'filter.evil.clean', join(root, 'git')]);
    await writeFile(join(root, '.gitattributes'), '* filter=evil\n');
    process.env.PATH = root;
    const resolved = await resolvePromptContext(root);
    assert.equal(resolved.project, root.split('/').at(-1));
    assert.ok(resolved.branch, 'trusted Git still supplies the branch');
    for (let i = 0; i < 25; i++) { buildContextLine(resolved, 80, config()); prompt.buildContextRail(resolved, 80, railConfig()); }
    assert.equal(await exists(marker), false, 'collection and rendering never run project code');
  } finally { process.env.PATH = oldPath; await rm(root, {recursive: true, force: true}); }
});

test('command metadata ignores symlinks, oversized files and kubeconfig exec', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nmsh-metadata-'));
  try {
    await mkdir(join(root, '.kube')); await mkdir(join(root, '.docker'));
    const source = join(root, 'source'); await writeFile(source, 'current-context: secret-symlink\n');
    await symlink(source, join(root, '.kube', 'config'));
    assert.equal(await readKubeContext({}, root), undefined);
    await rm(join(root, '.kube', 'config'));
    await writeFile(join(root, '.kube', 'config'), 'current-context: oversize\n' + 'x'.repeat(300000));
    assert.equal(await readKubeContext({}, root), undefined);
    await writeFile(join(root, '.docker', 'config.json'), '{"currentContext":"oversize","padding":"' + 'x'.repeat(300000) + '"}');
    assert.equal(await readDockerContext({}, root), 'default');
    await writeFile(join(root, '.kube', 'config'), 'current-context: safe\nusers:\n- user:\n    exec:\n      command: ./git\n');
    assert.equal(await readKubeContext({}, root), 'safe');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('render and geometry never initiate command-context reads', () => {
  const app = new TerminalApp();
  try {
    let reads = 0;
    app['contextEngine'] = new ContextEngine({capabilities: [{...kubernetes, resolve: async () => { reads++; return {value: {context: 'safe'}, evidence: 'fixture'}; }},
      {...docker, resolve: async () => { reads++; return {value: {context: 'safe'}, evidence: 'fixture'}; }}]});
    app['contextEngine'].stage(app['contextScope']('/workspace', undefined)); app['contextEngine'].commit();
    app['editor'].insert('kubectl get pods');
    app['promptConfiguration'] = railConfig();
    Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
    app['renderer'].render = (() => {}) as never;
    for (let i = 0; i < 10; i++) { app['promptContext'](); app['planFrame'](80, 24); app['render'](); }
    assert.equal(reads, 0);
  } finally { app['stop'](0); app['session'].kill(); }
});


function branchFact(persistence: ContextFact<string>['persistence'], sensitivity: ContextFact<string>['sensitivity'] = 'public'): ContextFact<string> {
  return {value: 'POLICY_VALUE', source: {capability: 'workspace.git.branch', evidence: 'test fixture'}, collectedAt: 123,
    freshness: 'fresh', trust: 'workspace', sensitivity, persistence, resolution: 'bounded-async'};
}

test('fact policy excludes secrets and never-store from every surface and display-only from snapshots', () => {
  const c = config(); c.modules = [{id: 'gitBranch', visible: true, condition: 'always'}];
  for (const persistence of ['snapshot-safe', 'display-only', 'never-store'] as const) for (const sensitivity of ['public', 'secret'] as const) {
    const live = {...context, branch: 'legacy-value', facts: {branch: branchFact(persistence, sensitivity)}};
    const allowed = persistence !== 'never-store' && sensitivity !== 'secret';
    assert.equal(stripAnsi(buildContextLine(live, 100, c)).includes('POLICY_VALUE'), allowed);
    c.modules[0]!.surface = 'contextRail';
    assert.equal(prompt.buildContextRail(live, 100, c).map(stripAnsi).join('').includes('POLICY_VALUE'), allowed);
    delete c.modules[0]!.surface;
    const snapshot = JSON.stringify(nativePromptSnapshot(live, c));
    assert.equal(snapshot.includes('POLICY_VALUE'), persistence === 'snapshot-safe' && sensitivity !== 'secret');
    assert.ok(!snapshot.includes('legacy-value'), 'metadata policy cannot fall back to unsafe legacy strings');
  }
  const facts = promptFacts(context, 123);
  assert.equal(facts.project!.collectedAt, 123);
  assert.equal(facts.project!.source.capability, 'workspace.identity');
  assert.equal(promptFacts(context).project!.freshness, 'unknown');
});

test('routing honors legacy sides, explicit surfaces, opt-in Auto and Hidden', () => {
  const module = {id: 'kubeContext' as const, visible: true, condition: 'onCommand' as const};
  assert.equal(routeModule(module), 'mainPrompt');
  assert.equal(routeModule({...module, placement: 'right'}), 'rightContext');
  assert.equal(routeModule({...module, surface: 'auto'}), 'contextRail');
  assert.equal(routeModule({...module, surface: 'mainPrompt', placement: 'right'}), 'mainPrompt');
  assert.equal(routeModule({...module, surface: 'hidden'}), 'hidden');
  assert.equal(routeModule({...module, visible: false, surface: 'contextRail'}), 'hidden');
});

test('Rail /prompt controls edit draft only and use bounded surface choices', () => {
  assert.equal(typeof panel.contextRailRows, 'function', 'Rail controls exist');
  const draft = config(), saved = config();
  const state: panel.PromptPanelState = {step: 'appearance', view: 'rail', onboarding: false, selectedIndex: 0, draft, saved};
  assert.deepEqual(panel.contextRailRows(draft).map(row => row.label), ['Mode', 'Rows', 'Relation', 'Direction', 'Integration', 'Spacing', 'Divider Anchor', 'Theme', 'Style', 'Overflow']);
  panel.handlePromptPanelKey({kind: 'right'}, state);
  assert.equal(draft.contextRail.mode, 'always'); assert.equal(saved.contextRail.mode, 'auto');
  state.selectedIndex = 1; panel.handlePromptPanelKey({kind: 'right'}, state); assert.equal(draft.contextRail.rows, 2);
  state.selectedIndex = panel.contextRailRows(draft).findIndex(row => row.label === 'Theme'); panel.handlePromptPanelKey({kind: 'right'}, state); assert.equal(draft.contextRail.theme, 'choose');
  assert.ok(panel.contextRailRows(draft).some(row => row.id === 'railPalette'));
  assert.ok(panel.PROMPT_VIEWS.includes('Context Rail'));
});

test('Rail priority overflow stays within two rows under narrow, NO_COLOR and Safe modes', () => {
  const c = config(); c.contextRail.style = 'minimal';
  c.modules = [{id: 'project', visible: true, condition: 'always', surface: 'contextRail'},
    {id: 'exitStatus', visible: true, condition: 'always', surface: 'contextRail'}];
  const data = {...context, project: 'LOW_PRIORITY_PROJECT', exitStatus: 42};
  const old = process.env.NO_COLOR;
  try {
    process.env.NO_COLOR = '1'; setIconStyle('safe');
    for (const rows of [1, 2] as const) for (let width = 1; width <= 80; width++) {
      c.contextRail.rows = rows;
      const lines = prompt.buildContextRail(data, width, c);
      assert.equal(lines.length, rows); assert.ok(lines.every(line => displayWidth(line) <= width));
      assert.ok(lines.every(line => line === stripAnsi(line)), 'NO_COLOR produces plain Rail');
    }
    c.contextRail.rows = 1;
    const squeezed = prompt.buildContextRail(data, 8, c).map(stripAnsi).join('');
    assert.match(squeezed, /42/); assert.ok(!squeezed.includes('LOW_PRIORITY'));
  } finally { if (old === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = old; setIconStyle('nerd'); }
});

test('Rail follow/chosen themes change semantic colors and restore Main theme context', () => {
  const c = railConfig(); c.contextRail.style = 'soft';
  const old = process.env.NMSH_COLOR, no = process.env.NO_COLOR;
  try {
    delete process.env.NO_COLOR; process.env.NMSH_COLOR = 'truecolor';
    const original = prompt.buildContextRail(context, 80, c);
    c.nmsh.palette = 'ocean'; const followed = prompt.buildContextRail(context, 80, c);
    assert.notDeepEqual(original, followed);
    c.contextRail.theme = 'choose'; c.contextRail.palette = 'forest';
    const chosen = prompt.buildContextRail(context, 80, c);
    assert.notDeepEqual(chosen, followed);
    c.nmsh.palette = 'warm'; assert.deepEqual(prompt.buildContextRail(context, 80, c), chosen);
  } finally { if (old === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = old; if (no === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = no; }
});

test('Always Rail reserves rows in empty Top and Flow layouts and regions never overlap', () => {
  for (const composerPosition of ['top', 'bottom', 'flow'] as const) for (const transcriptRows of [0, 1, 5, 50]) {
    for (const running of [false, true]) for (const contextRailRows of [1, 2]) {
      const plan = planScreen({rows: 24, inputRows: 1, suggestions: 2, running, detached: false, hasOutput: transcriptRows > 0,
        contextPlacement: 'header', hasVisibleContext: false, composerLayout: 'twoLine', composerPosition, transcriptRows, contextRailRows});
      assert.equal(regionOf(plan, 'contextRail')?.height, contextRailRows, `${composerPosition}, ${transcriptRows} transcript rows`);
      for (let i = 1; i < plan.regions.length; i++) {
        const before = plan.regions[i - 1]!, after = plan.regions[i]!;
        assert.ok(before.top + before.height <= after.top, `${before.kind} overlaps ${after.kind}`);
      }
      assert.ok(plan.regions.every(region => region.top >= 0 && region.top + region.height <= plan.rows));
    }
  }
});

test('explicit Right Context overrides a legacy left placement in a one-line prompt', () => {
  const c = config(); c.modules = [{id: 'project', visible: true, condition: 'always', surface: 'rightContext'}];
  assert.ok(!stripAnsi(prompt.buildInlineContextPrefix(context, 80, c)).includes('workspace'));
  assert.match(stripAnsi(prompt.buildRightContext(context, 80, c)), /workspace/);
});


test('pure contextual rendering performs no filesystem, process or network work and reuses inventory', () => {
  const c = config(); c.modules = [{id: 'discoveredTools', visible: true, condition: 'always', surface: 'contextRail'}];
  const inventory = {pathKey: '/fixture', discoveredAt: 123, executables: [{id: 'executable:fake', name: 'fake', path: '/fixture/fake', family: 'path' as const, evidence: 'fixture'}],
    measurements: {directoriesRead: 1, entriesInspected: 1, executableChecks: 1}};
  const data = {...context, discovery: inventory};
  let calls = 0;
  const forbidden = () => { calls++; throw new Error('Context renderer attempted I/O'); };
  const spies = [mock.method(fsPromises, 'open', forbidden), mock.method(fsPromises, 'readFile', forbidden),
    mock.method(fsPromises, 'readdir', forbidden), mock.method(fsPromises, 'stat', forbidden), mock.method(fsPromises, 'access', forbidden),
    mock.method(childProcess.ChildProcess.prototype, 'spawn', forbidden), mock.method(http, 'request', forbidden), mock.method(https, 'request', forbidden),
    mock.method(globalThis, 'fetch', forbidden)];
  syncBuiltinESMExports();
  try {
    for (let i = 0; i < 30; i++) {
      assert.match(prompt.buildContextRail(data, 80, c).map(stripAnsi).join(''), /1 local tools/);
      buildContextLine(data, 80, c); nativePromptSnapshot(data, c);
    }
    assert.equal(calls, 0);
    assert.equal(data.discovery, inventory);
    assert.deepEqual(inventory.measurements, {directoriesRead: 1, entriesInspected: 1, executableChecks: 1});
  } finally { spies.forEach(spy => spy.mock.restore()); syncBuiltinESMExports(); }
});

test('editor demand requests cached facts outside render and late results obey current command visibility', async () => {
  const app = new TerminalApp();
  try {
    app['promptConfiguration'] = railConfig();
    let reads = 0;
    let finish: (value: string) => void = () => {};
    app['contextEngine'] = new ContextEngine({capabilities: [{...kubernetes, resolve: () => { reads++; return new Promise(resolve => { finish = context => resolve({value: {context}, evidence: 'fixture'}); }); }},
      {...docker, resolve: async () => ({value: {context: 'unused'}, evidence: 'fixture'})}]});
    app['contextEngine'].stage(app['contextScope']('/workspace', undefined)); app['contextEngine'].commit();
    app['editor'].insert('kubectl');
    app['requestContextDemand'](); app['requestContextDemand']();
    assert.equal(reads, 1, 'demand coalesces');
    app['editor'].clear(); app['editor'].insert('echo');
    finish('production'); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(app['contextRailRows'](80), []);
    app['editor'].clear(); app['editor'].insert('kubectl get pods');
    assert.match(app['contextRailRows'](80).map(stripAnsi).join(''), /production/);
    app['promptConfiguration'].modules[0]!.surface = 'hidden'; app['requestContextDemand']();
    assert.deepEqual(app['contextRailRows'](80), []);
  } finally { app['stop'](0); app['session'].kill(); }
});

test('live Rail stays outside transcript/copy and yields the full screen to passthrough', () => {
  const app = new TerminalApp();
  try {
    app['promptConfiguration'] = config();
    app['promptConfiguration'].modules = [{id: 'kubeContext', visible: true, condition: 'always', surface: 'contextRail'}];
    app['context'] = {...context, kubeContext: 'RAIL_ONLY_VALUE'};
    app['output'].beginCommand('echo ok', ['echo ok'], app['historicalContext'](context.cwd, context, 'echo ok'));
    app['output'].write('ok\n'); app['output'].complete(0);
    Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
    Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 24})});
    let frame: {rows: string[]; cursorRow: number} | undefined;
    app['renderer'].render = ((value: typeof frame) => { frame = value; }) as never;
    app['render']();
    const plan = app['planFrame'](80, 24);
    const region = regionOf(plan, 'contextRail')!;
    assert.match(stripAnsi(frame!.rows[region.top]!), /RAIL_ONLY_VALUE/);
    assert.ok(!JSON.stringify(app['output'].transcript()).includes('RAIL_ONLY_VALUE'));
    assert.equal(regionOf(plan, 'prompt'), undefined, 'Rail alone does not allocate a Main Prompt row');
    const sizes: number[] = [];
    app['session'].resize = ((_columns: number, rows: number) => { sizes.push(rows); }) as never;
    app['passthrough'] = true; app['onResize'](); assert.equal(sizes.at(-1), 24);
    assert.deepEqual(app['contextRailRows'](80), []);
  } finally { app['stop'](0); app['session'].kill(); }
});

test('historical context metadata cannot bypass fact snapshot policy', () => {
  const app = new TerminalApp();
  try {
    app['promptConfiguration'] = config();
    app['context'] = {...context, branch: 'POLICY_VALUE', facts: {branch: branchFact('never-store', 'secret')}};
    const historical = app['historicalContext'](context.cwd, app['context'], 'echo ok');
    assert.ok(!JSON.stringify(historical).includes('POLICY_VALUE'));
  } finally { app['stop'](0); app['session'].kill(); }
});

test('all fact-derived segments, including Git operation text, pass the display boundary', () => {
  const c = config(); c.modules = [{id: 'gitStatus', visible: true, condition: 'inRepository'}];
  const data = {...context, branch: 'main', git: {staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0, operation: '\x1b[2J\u202eHOSTILE' as any}};
  const snapshot = nativePromptSnapshot(data, c);
  assert.ok(snapshot.segments.every(segment => !/[\x00-\x1f\u202e]/u.test(segment.text)));
});

test('chosen Rail theme survives saving while Follow Main is temporarily selected', () => {
  const c = config(); c.contextRail.palette = 'ocean';
  assert.equal(normalizePromptConfiguration(c).contextRail.palette, 'ocean');
});


test('live fact updates retain sensitivity and persistence policies', () => {
  const app = new TerminalApp();
  try {
    const facts = promptFacts({...context, exitStatus: 1, shell: {current: 'zsh', differs: false}});
    app['context'] = {...context, facts: {...facts,
      kubeContext: {...facts.kubeContext!, sensitivity: 'secret', persistence: 'never-store'},
      shell: {...facts.shell!, persistence: 'display-only'}, exitStatus: {...facts.exitStatus!, persistence: 'never-store'}}};
    app['promptConfiguration'] = railConfig();
    const live = app['promptContext']('kubectl');
    assert.equal(live.facts?.kubeContext?.sensitivity, 'secret');
    assert.equal(live.facts?.kubeContext?.persistence, 'never-store');
    assert.equal(live.facts?.shell?.persistence, 'display-only');
    assert.equal(live.facts?.exitStatus?.persistence, 'never-store');
    assert.deepEqual(app['contextRailRows'](80), []);
  } finally { app['stop'](0); app['session'].kill(); }
});

test('external provider snapshots fail closed when facts cannot be persisted', () => {
  const app = new TerminalApp();
  try {
    app['effectivePromptProvider'] = 'starship';
    app['externalPrompt'] = {segments: [{text: 'POLICY_VALUE', role: 'context'}]} as any;
    app['context'] = {...context, branch: 'POLICY_VALUE', facts: {branch: branchFact('display-only', 'private')}};
    assert.ok(!JSON.stringify(app['currentPromptSnapshot']()).includes('POLICY_VALUE'));
    app['context'] = {...context};
    assert.match(JSON.stringify(app['currentPromptSnapshot']()), /POLICY_VALUE/);
  } finally { app['stop'](0); app['session'].kill(); }
});



test('Git context rejects executable operations and partial-clone status before remote access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nmsh-partial-'));
  try {
    execFileSync('/usr/bin/git', ['init', '-q', root]);
    const marker = join(root, 'EXECUTED');
    execFileSync('/usr/bin/git', ['-C', root, 'config', 'remote.origin.promisor', 'true']);
    execFileSync('/usr/bin/git', ['-C', root, 'config', 'remote.origin.uploadpack', `touch '${marker}'; /usr/bin/git-upload-pack`]);
    await assert.rejects(runContextGit(root, ['status', '--porcelain=v1', '--branch', '--untracked-files=normal']), /future safe status capability/);
    await assert.rejects(runContextGit(root, ['fetch']), /Unsupported contextual Git operation/);
    assert.equal(await exists(marker), false);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('Git context never descends into a submodule with executable clean filters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nmsh-submodule-'));
  const git = (cwd: string, args: string[]) => execFileSync('/usr/bin/git', ['-C', cwd, ...args], {env: {...process.env,
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'}});
  try {
    const source = join(root, 'source'), parent = join(root, 'parent');
    await mkdir(source); await mkdir(parent);
    git(source, ['init', '-q']); await writeFile(join(source, 'f'), 'one\n');
    git(source, ['add', 'f']); git(source, ['commit', '-qm', 'fixture']);
    git(parent, ['init', '-q']); git(parent, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'sub']);
    git(parent, ['add', '.']); git(parent, ['commit', '-qm', 'fixture']);
    const sub = join(parent, 'sub'), marker = join(root, 'EXECUTED');
    await writeFile(join(sub, '.gitattributes'), 'f filter=evil\n');
    git(sub, ['add', '.gitattributes']); git(sub, ['commit', '-qm', 'attributes']);
    git(sub, ['config', 'filter.evil.clean', `touch '${marker}'; cat`]);
    await writeFile(join(sub, 'f'), 'two\n');
    await runContextGit(parent, ['status', '--porcelain=v1', '--branch', '--untracked-files=normal']);
    assert.equal(await exists(marker), false, 'submodule filters are never evaluated');
  } finally { await rm(root, {recursive: true, force: true}); }
});


test('short Flow Rail follows the newest transcript rows and detached clipping keeps PTY capacity stable', () => {
  const input: ScreenPlanInput = {rows: 24, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: true,
    contextPlacement: 'header', hasVisibleContext: false, composerLayout: 'oneLine', composerPosition: 'flow', transcriptRows: 5, contextRailRows: 2};
  const following = planScreen(input);
  assert.equal(following.viewportRows, following.transcript.height, 'FOLLOW uses the actually visible rows');
  const clipped = planScreen({...input, detached: true, transcriptRows: 100, viewStart: 0});
  assert.equal(regionOf(clipped, 'input'), undefined);
  assert.equal(regionOf(clipped, 'contextRail'), undefined);
  assert.equal(clipped.ptyRows, following.ptyRows, 'scrolling cannot resize the shell');
});


test('Flow input group makes only the bounded empty-to-growing Rail exception', () => {
  const input: ScreenPlanInput = {rows: 24, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: false,
    contextPlacement: 'header', hasVisibleContext: false, composerLayout: 'oneLine', composerDividers: false, composerPosition: 'flow', transcriptRows: 0};
  const baseline = planScreen(input);
  assert.equal(cursorScreenRow(baseline, 0), 0);
  for (const height of [1, 2]) {
    const empty = planScreen({...input, contextRailRows: height});
    assert.equal(cursorScreenRow(empty, 0), height);
    assert.equal(regionOf(empty, 'contextRail')!.top, 0);
    for (const total of [1, 2, 5, 50]) {
      const ordinary = planScreen({...input, hasOutput: true, transcriptRows: total});
      const withRail = planScreen({...input, hasOutput: true, transcriptRows: total, contextRailRows: height});
      const shift = cursorScreenRow(withRail, 0) - cursorScreenRow(ordinary, 0);
      assert.equal(shift, Math.max(0, height - ordinary.transcript.height));
      assert.ok(shift <= height);
      const rail = regionOf(withRail, 'contextRail')!, composer = regionOf(withRail, 'input')!;
      assert.equal(rail.top + rail.height, composer.top);
    }
  }
  const c = railConfig();
  assert.equal(prompt.buildContextRail({...context, commandWords: ['echo']}, 80, c).length, 0);
  c.contextRail.mode = 'off'; assert.equal(prompt.buildContextRail(context, 80, c).length, 0);
  c.contextRail.mode = 'always'; c.contextRail.rows = 2;
  assert.equal(prompt.buildContextRail({...context, commandWords: ['echo']}, 80, c).length, 2);
});


test('Always Rail reserves a blank live Bottom row and explains an empty Current preview', () => {
  const app = new TerminalApp();
  try {
    const c = config();
    c.composerPosition = 'bottom'; c.contextRail.mode = 'always'; c.contextRail.spacing = 'attached';
    c.modules = [{id: 'project', visible: true, condition: 'always', surface: 'mainPrompt'},
      {id: 'shell', visible: true, condition: 'always', surface: 'rightContext'},
      {id: 'kubeContext', visible: true, condition: 'onCommand', surface: 'contextRail'}];
    app['promptConfiguration'] = c;
    app['context'] = {cwd: '/tmp/nmsh-context-qa', project: 'nmsh-context-qa', branch: 'rail-qa', exitStatus: 0};
    app['dimensions'] = () => ({columns: 100, rows: 30});
    app['fetchSuggestions'] = async () => {};
    let frame: import('../src/terminal/TerminalRenderer.js').TerminalFrame | undefined;
    app['renderer'].render = next => { frame = next; };
    const reserved = app['planFrame'](100, 30);
    const rail = regionOf(reserved, 'contextRail')!;
    assert.equal(rail.height, 1);
    assert.equal(rail.top + rail.height, regionOf(reserved, 'prompt')!.top);
    app['render']();
    assert.equal(frame!.rows[rail.top], '');
    c.contextRail.mode = 'off';
    const off = app['planFrame'](100, 30);
    assert.equal(regionOf(off, 'contextRail'), undefined);
    assert.equal(cursorScreenRow(reserved, 0), cursorScreenRow(off, 0));
    assert.equal(reserved.viewportRows, off.viewportRows - 1);
    c.contextRail.mode = 'always';
    app['promptPanelState'] = {step: 'appearance', view: 'rail', onboarding: false, selectedIndex: 0, draft: c, saved: c};
    const preview = app['promptPanelPreview'](100).map(stripAnsi).join('\n');
    assert.match(preview, /No visible Rail context/);
    assert.match(preview, /Always reserves 1 row/);
  } finally { app['stop'](0); app['session'].kill(); }
});

test('saved Rail routing reaches the real frontend renderer and command-context collection', async () => {
  const {LiveSandbox} = await import('./helpers/liveFrontend.js');
  const c = config();
  c.contextRail.mode = 'always'; c.composerPosition = 'bottom'; c.welcome = 'none';
  c.onboardingComplete = true; c.glyphChoiceComplete = true; c.toolsSetupComplete = true; c.updateChecks = false;
  c.modules = [{id: 'project', visible: true, condition: 'always', surface: 'mainPrompt'},
    {id: 'shell', visible: true, condition: 'always', surface: 'rightContext'},
    {id: 'gitBranch', visible: true, condition: 'inRepository', surface: 'contextRail'},
    {id: 'gitStatus', visible: true, condition: 'inRepository', surface: 'contextRail'},
    {id: 'toolchain', visible: true, condition: 'always', surface: 'contextRail'},
    {id: 'kubeContext', visible: true, condition: 'onCommand', surface: 'contextRail'}];
  const box = new LiveSandbox(c);
  try {
    const workspace = join(box.home, 'nmsh-context-qa');
    await mkdir(workspace); await mkdir(join(box.home, '.kube'));
    await writeFile(join(box.home, '.kube', 'config'), 'current-context: QA-KUBE\n');
    await writeFile(join(workspace, 'package.json'), '{}');
    await writeFile(join(workspace, 'pyproject.toml'), '[project]\nname = "qa"\n');
    await writeFile(join(workspace, 'Dockerfile'), 'FROM scratch\n');
    await writeFile(join(workspace, 'README.md'), 'dirty\n');
    const git = (args: string[]) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args],
      {cwd: workspace, env: {...box.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'}});
    git(['init', '-q', '-b', 'rail-qa']); git(['add', 'README.md']);
    git(['-c', 'user.name=NMSh QA', '-c', 'user.email=qa@example.invalid', 'commit', '-q', '-m', 'QA fixture']);
    await writeFile(join(workspace, 'README.md'), 'modified README\n');
    const frontend = box.launch();
    await frontend.waitFor(/❯/);
    const mark = frontend.mark;
    await frontend.run(`cd ${workspace}`, /rail-qa/);
    const updates = [...frontend.output.slice(mark).matchAll(/\x1b\[(\d+);1H\x1b\[2K([\s\S]*?)(?=\x1b\[\d+;\d+H|$)/gu)];
    assert.ok(updates.some(update => stripAnsi(update[2]!).includes('rail-qa') && Number(update[1]) < 29),
      'Rail branch is painted above the Bottom input, through TerminalRenderer');
    frontend.pty.write('kubectl get pods');
    await frontend.waitFor(/QA-KUBE/, mark);
    assert.ok(!(await box.transcripts().list()).some(session => session.transcript.records.some(record => /QA-KUBE/.test(record.output ?? ''))),
      'live Rail context stays out of PTY command output');
  } finally { await box.dispose(); }
});
