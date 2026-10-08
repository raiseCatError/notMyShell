import test from 'node:test';
import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, normalizeStatusStrip, type PromptConfiguration, type StatusStripSettings} from '../src/prompt/configuration.js';
import {renderStatusStrip, stripStatsFromFacts, stripVisible, type StripModuleItem} from '../src/status/StatusStrip.js';
import {applyStripPreset, createStripStudio, matchingStripPreset, renderStripStudio, stripModules, stripPresetChanges, stripStudioControls, stripStudioKey} from '../src/status/StripStudio.js';
import {contextDemand, statusStripDemand} from '../src/context/demand.js';
import {planScreen, regionOf, withStatusRow, type ScreenPlanInput} from '../src/app/screenPlan.js';
import {nativePromptSnapshot, statusStripModules} from '../src/prompt/prompt.js';
import {CORE_CAPABILITIES} from '../src/context/registry.js';
import {cpuPercent} from '../src/context/capabilities/system.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {ContextFacts} from '../src/context/facts.js';

const AT = new Date(2026, 0, 1, 17, 8);
const STATS = {cpu: 34, memory: {used: 6 * 1024 ** 3, total: 8 * 1024 ** 3}, battery: {percent: 74, charging: false}, uptimeSeconds: 93_600};
const strip = (patch: Partial<StatusStripSettings> = {}): StatusStripSettings => ({...normalizeStatusStrip({}), enabled: true, ...patch});
const plain = (text: string) => stripAnsi(text);
const MODULES: StripModuleItem[] = [{id: 'cwd', text: '~/Projects/notMyShell', priority: 70, zone: 'left', compact: ['notMyShell']},
  {id: 'gitBranch', text: 'main', priority: 80, zone: 'left'}, {id: 'node', text: 'Node 22', priority: 45, zone: 'center'}, {id: 'shell', text: 'zsh', priority: 50, zone: 'right'}];

test('old settings migrate without moving or enabling anything; Off stays Off', () => {
  assert.deepEqual(normalizeStatusStrip({enabled: true, clock: true, battery: false}),
    {enabled: true, clock: true, battery: false, cpu: false, ram: false, uptime: false, ramDisplay: 'percent', edge: 'top', style: 'plain', separator: 'dot', nativeZone: 'right'},
    'pre-2.0 strips stay at the top, plain, right-aligned');
  assert.equal(normalizeStatusStrip({}).enabled, false, 'missing means Off');
  assert.equal(normalizeStatusStrip({enabled: false, edge: 'bottom'}).enabled, false);
  assert.equal(normalizeStatusStrip({edge: 'sideways', style: 'neon', separator: 7, nativeZone: 'up'}).edge, 'top', 'invalid values fall back');
  const config = normalizePromptConfiguration({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), modules: [{id: 'nmsh.system:memory', visible: true, condition: 'always', surface: 'statusStrip'}]});
  assert.equal(config.modules.find(module => module.id === 'nmsh.system:memory')!.stripZone, undefined, 'old strip modules get no zone (rendered Right, where they were)');
  assert.equal(normalizePromptConfiguration({...structuredClone(DEFAULT_PROMPT_CONFIGURATION),
    modules: [{id: 'shell', visible: true, condition: 'always', surface: 'statusStrip', stripZone: 'center'}]}).modules.find(module => module.id === 'shell')!.stripZone, 'center');
});

test('the default layout reproduces the original right-aligned row', () => {
  const row = plain(renderStatusStrip(strip({ram: true, cpu: true}), STATS, 80, AT));
  assert.equal(displayWidth(row), 79, 'one cell of margin at the right edge');
  assert.match(row, /^ +\S.*CPU 34% · .*RAM 75% · .*74% · .*17:08$/u);
  assert.equal(renderStatusStrip(strip({enabled: false}), STATS, 120, AT), '', 'Off renders nothing');
});

test('left, center and right groups never overlap, the center is centered when it fits, and empty groups take no room', () => {
  for (const columns of [30, 40, 50, 60, 80, 120, 200]) {
    const row = plain(renderStatusStrip(strip({ram: true}), STATS, columns, AT, undefined, MODULES));
    assert.ok(displayWidth(row) <= columns, `${columns}: fits (${displayWidth(row)})`);
    assert.equal(plain(renderStatusStrip(strip({ram: true}), STATS, columns, AT, undefined, MODULES)), row, `${columns}: deterministic`);
    if (row.includes('Node 22') && row.includes('main')) assert.ok(row.indexOf('Node 22') > row.indexOf('main') + 4, 'center after left with a gap');
  }
  const wide = plain(renderStatusStrip(strip(), STATS, 120, AT, undefined, MODULES));
  assert.ok(wide.startsWith(' ~/Projects/notMyShell · main'), 'left group anchors at the left edge');
  assert.ok(Math.abs(wide.indexOf('Node 22') + 3.5 - 60) <= 2, 'center group centered');
  assert.match(wide, /zsh · .*74% · .*17:08$/u, 'right group at the right edge, modules before system items');
  const leftOnly = plain(renderStatusStrip(strip({clock: false, battery: false}), {}, 80, AT, undefined, [MODULES[0]!]));
  assert.equal(leftOnly, ' ~/Projects/notMyShell', 'an empty center and right add nothing');
});

test('width fitting: compact forms first, then lowest priority, the center before the edges; Unicode is measured in cells', () => {
  const at = (columns: number, modules = MODULES) => plain(renderStatusStrip(strip({ram: true, ramDisplay: 'both'}), STATS, columns, AT, undefined, modules));
  assert.match(at(200), /RAM 75% · 6\.0\/8\.0 GB/u);
  assert.doesNotMatch(at(80), /GB/u, 'RAM compacts to percent before anything drops');
  assert.match(at(60), /notMyShell/u);
  assert.doesNotMatch(at(60), /Node 22/u, 'the center group yields before the edge anchors');
  assert.match(at(40), /main/u, 'Git branch (highest priority) survives');
  const cjk: StripModuleItem[] = [{text: '東京プロジェクト', priority: 60, zone: 'left'}, {text: 'ブランチ', priority: 80, zone: 'left'}];
  for (const columns of [30, 40, 50]) {
    const row = plain(renderStatusStrip(strip(), STATS, columns, AT, undefined, cjk));
    assert.ok(displayWidth(row) <= columns, `wide characters fit at ${columns}`);
  }
  const long: StripModuleItem[] = [{text: `feature/${'x'.repeat(200)}`, priority: 80, zone: 'left'}];
  assert.ok(displayWidth(plain(renderStatusStrip(strip(), STATS, 80, AT, undefined, long))) <= 80, 'a huge branch name never overflows');
  assert.equal(stripVisible(strip(), 29, 40), false, 'too narrow: no row');
  assert.equal(stripVisible(strip(), 80, 7), false, 'too short: no row');
  assert.equal(stripVisible(strip(), 80, 24), true);
});

test('Keep Awake keeps full → short → glyph, after everything else; no battery hardware means no battery item', () => {
  const awake = {full: 'Awake · Display', short: 'Awake', glyph: '☕'};
  assert.match(plain(renderStatusStrip(strip({cpu: true}), STATS, 100, AT, awake)), /17:08 · Awake · Display$/u);
  assert.equal(plain(renderStatusStrip(strip({cpu: true}), STATS, 30, AT, {...awake, full: 'Awake · Display and System and more'})).trim(), 'Awake');
  const noBattery = plain(renderStatusStrip(strip(), {...STATS, battery: undefined}, 80, AT));
  assert.equal(noBattery.trim(), plain(renderStatusStrip(strip({battery: false}), STATS, 80, AT)).trim());
  assert.doesNotMatch(noBattery, /%/u);
});

test('styles: Divided uses a bar (ASCII in Safe glyphs), Powerline reuses the prompt geometry, NO_COLOR and every color depth stay valid', () => {
  const saved = {icons: process.env.NMSH_ICONS, color: process.env.NMSH_COLOR};
  try {
    process.env.NMSH_ICONS = 'nerd';
    assert.match(plain(renderStatusStrip(strip({separator: 'bar'}), STATS, 80, AT, undefined, MODULES)), /notMyShell │ main/u);
    process.env.NMSH_ICONS = 'safe';
    const safe = plain(renderStatusStrip(strip({separator: 'bar'}), STATS, 80, AT, undefined, MODULES));
    assert.match(safe, /notMyShell \| main/u);
    assert.ok(/^[\x20-\x7e]*$/u.test(safe.replace(/[0-9:%]/gu, '')), 'Safe glyphs: ASCII only');
    const powerline = plain(renderStatusStrip(strip({style: 'powerline'}), STATS, 80, AT, undefined, MODULES));
    assert.ok(displayWidth(powerline) <= 80);
    assert.match(powerline, /notMyShell/u);
    for (const level of ['none', '16', '256', 'truecolor']) {
      process.env.NMSH_COLOR = level;
      for (const style of ['plain', 'powerline'] as const) {
        const row = renderStatusStrip(strip({style}), STATS, 80, AT, undefined, MODULES);
        assert.ok(displayWidth(stripAnsi(row)) <= 80, `${level}/${style}`);
        if (level === 'none') assert.doesNotMatch(row, /\u001b\[[0-9;]*(?:3[0-8]|4[0-8]|9[0-7]|10[0-7])(?:;|m)/u, 'NO_COLOR: no color escapes (only resets)');
        if (level === '16') assert.doesNotMatch(row, /\u001b\[[34]8;/u, '16 colors: no extended color');
        if (level === '256') assert.doesNotMatch(row, /\u001b\[[34]8;2;/u, '256 colors: no truecolor');
        for (const sequence of row.match(/\u001b[^m]*m/gu) ?? []) assert.match(sequence, /^\u001b\[[0-9;]*m$/u, 'only SGR sequences');
      }
    }
  } finally {
    if (saved.icons === undefined) delete process.env.NMSH_ICONS; else process.env.NMSH_ICONS = saved.icons;
    if (saved.color === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = saved.color;
  }
});

test('hostile module text loses whole control sequences and bidi formatting', () => {
  const hostile: StripModuleItem[] = [{text: 'evil\u001b]0;PWNED\u0007\u001b[2J‮x', priority: 50, zone: 'left'}];
  const row = renderStatusStrip(strip(), STATS, 80, AT, undefined, hostile);
  assert.doesNotMatch(row, /PWNED|\u001b\]|\u001b\[2J|‮/u);
  assert.match(plain(row), /evilx/u);
});

test('edges: Top shifts the plan down one row; Bottom is the pane\'s last row and nothing else moves (inside tmux: above tmux\'s own bar)', () => {
  const input = (position: 'bottom' | 'top' | 'flow'): ScreenPlanInput => ({rows: 23, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: true,
    contextPlacement: 'composer', hasVisibleContext: true, composerLayout: 'twoLine', composerPosition: position, transcriptRows: 40});
  for (const position of ['bottom', 'top', 'flow'] as const) {
    const base = planScreen(input(position));
    const top = withStatusRow(base, 'top');
    const bottom = withStatusRow(base, 'bottom');
    assert.equal(regionOf(top, 'status')!.top, 0, `${position}: top row`);
    assert.equal(top.transcript.top, base.transcript.top + 1);
    assert.equal(regionOf(bottom, 'status')!.top, 23, `${position}: the last row of a 24-row pane`);
    assert.equal(bottom.rows, 24, 'never beyond the pane');
    assert.deepEqual(bottom.regions.filter(region => region.kind !== 'status'), base.regions, `${position}: nothing else moves`);
    assert.equal(bottom.ptyRows, base.ptyRows, 'the shell keeps its size');
    const occupied = new Set<number>();
    for (const region of bottom.regions) for (let row = region.top; row < region.top + region.height; row++) {
      assert.ok(!occupied.has(row), `${position}: row ${row} painted once`);
      occupied.add(row);
    }
  }
  assert.equal(withStatusRow(planScreen(input('bottom'))).regions[0]!.kind, 'status', 'the default edge stays Top');
});

test('demand: the strip\'s items are Context Engine facts, demanded only while it shows and only when switched on', () => {
  assert.deepEqual(statusStripDemand(strip(), true).map(([id]) => id), ['system.time', 'system.battery']);
  assert.deepEqual(statusStripDemand(strip({cpu: true, ram: true, uptime: true}), true).map(([id]) => id),
    ['system.time', 'system.cpu', 'system.memory', 'system.battery', 'system.uptime']);
  assert.deepEqual(statusStripDemand(strip(), false), [], 'hidden strip: nothing');
  assert.deepEqual(statusStripDemand(strip({enabled: false}), true), [], 'Off: nothing');
  const configuration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  configuration.statusStrip = strip({clock: false, battery: false});
  configuration.modules = configuration.modules.map(module => module.id === 'nmsh.system:memory' ? {...module, visible: false, surface: 'statusStrip' as const} : module);
  const demand = contextDemand(configuration, {commandWords: [], nativePrompt: true, railVisible: false, statusStripVisible: true, inRepository: false});
  assert.ok(!demand.has('system.memory'), 'a hidden strip module demands nothing');
  const ids = new Set(CORE_CAPABILITIES.map(capability => capability.id));
  for (const id of ['system.time', 'system.cpu', 'system.memory', 'system.battery', 'system.uptime']) assert.ok(ids.has(id), `${id} is a Context Engine capability`);
  assert.equal(cpuPercent({idle: 100, total: 200}, {idle: 150, total: 300}), 50);
  assert.equal(cpuPercent({idle: 100, total: 200}, {idle: 100, total: 200}), undefined, 'no interval: no value');
});

test('the strip reads resolved facts (no second sampler) and rendering performs no I/O', () => {
  const fact = (value: unknown) => ({value, source: {capability: 'x', evidence: 'x'}, collectedAt: 0, freshness: 'fresh', trust: 'session',
    sensitivity: 'public', persistence: 'display-only', resolution: 'cheap'});
  const facts = {'system.cpu': fact({percent: 12}), 'system.memory': fact({usedPercent: 50, usedBytes: 4, totalBytes: 8}), 'system.battery': fact({percent: 9, charging: true}),
    'system.uptime': fact({seconds: 60}), 'system.time': fact({now: AT.getTime()})} as unknown as ContextFacts;
  assert.deepEqual(stripStatsFromFacts(facts), {cpu: 12, memory: {used: 4, total: 8}, battery: {percent: 9, charging: true}, uptimeSeconds: 60, now: AT.getTime()});
  const saved = {read: fs.readFileSync, readdir: fs.readdirSync, spawn: childProcess.spawn, execFile: childProcess.execFile, spawnSync: childProcess.spawnSync};
  const forbid = () => { throw new Error('I/O during strip rendering'); };
  Object.assign(fs, {readFileSync: forbid, readdirSync: forbid});
  Object.assign(childProcess, {spawn: forbid, execFile: forbid, spawnSync: forbid});
  syncBuiltinESMExports();
  try {
    const settings = strip({cpu: true, ram: true, uptime: true});
    const row = renderStatusStrip(settings, stripStatsFromFacts(facts), 120, undefined, undefined, MODULES);
    assert.match(plain(row), /CPU 12%/u);
    assert.match(plain(row), /17:08/u, 'the clock is the system.time fact');
    const configuration = {...structuredClone(DEFAULT_PROMPT_CONFIGURATION), statusStrip: settings};
    renderStripStudio(createStripStudio(), configuration, 100, 60, (c, w) => renderStatusStrip(c.statusStrip, stripStatsFromFacts(facts), w));
  } finally {
    Object.assign(fs, {readFileSync: saved.read, readdirSync: saved.readdir});
    Object.assign(childProcess, {spawn: saved.spawn, execFile: saved.execFile, spawnSync: saved.spawnSync});
    syncBuiltinESMExports();
  }
});

test('routed modules carry their strip group; strip content never reaches prompt snapshots', () => {
  const configuration = normalizePromptConfiguration({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), statusStrip: {enabled: true},
    modules: [...DEFAULT_PROMPT_CONFIGURATION.modules.filter(module => module.id !== 'gitBranch'),
      {id: 'gitBranch', visible: true, condition: 'always', surface: 'statusStrip', stripZone: 'left'}]});
  const context = {cwd: '/w/repo', project: 'repo', root: '/w/repo', branch: 'feature/strip'};
  assert.deepEqual(statusStripModules(context, configuration).map(module => module.text.trim().split(' ').at(-1)), ['feature/strip']);
  assert.ok(!JSON.stringify(nativePromptSnapshot(context, configuration).segments).includes('feature/strip'), 'live strip only: no strip module in the history snapshot\'s segments');
});

test('presets are small, transparent and reversible, and never touch cloud or agent modules', () => {
  const base: PromptConfiguration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  base.statusStrip = strip();
  assert.equal(matchingStripPreset(base), 'minimal', 'the default strip is Minimal');
  const developer = applyStripPreset(base, 'developer');
  assert.equal(matchingStripPreset(developer), 'developer');
  assert.ok(stripPresetChanges(base, 'developer').some(change => /Git branch: to the strip \(left\), leaving the Main Prompt/u.test(change)), 'says what leaves the prompt');
  for (const module of developer.modules.filter(item => /cloud|agent/u.test(item.id))) {
    assert.deepEqual(module, base.modules.find(item => item.id === module.id), `${module.id} untouched`);
  }
  assert.equal(applyStripPreset(base, 'system').statusStrip.cpu, true);
  assert.equal(applyStripPreset({...base, statusStrip: {...base.statusStrip, enabled: false}}, 'system').statusStrip.enabled, false, 'a preset never turns the strip on');
  const custom = {...base, statusStrip: {...base.statusStrip, uptime: true}};
  assert.equal(matchingStripPreset(custom), 'custom', 'manual edits read as Custom');
  const state = createStripStudio();
  stripStudioKey(state, {kind: 'right'}, base);
  assert.equal(state.pending, 'developer', 'arrows only preview');
  assert.equal(stripStudioKey(state, {kind: 'escape'}, base), undefined, 'Esc cancels the preview first');
  assert.equal(state.pending, undefined);
  stripStudioKey(state, {kind: 'right'}, base);
  const applied = stripStudioKey(state, {kind: 'enter'}, base);
  assert.equal(applied?.kind, 'change');
  const undone = stripStudioKey(state, {kind: 'text', value: 'u'}, applied!.kind === 'change' ? applied.configuration : base);
  assert.deepEqual(undone, {kind: 'change', configuration: base}, 'U restores exactly what was there');
});

test('Studio: module rows change group and order, X takes a module off the strip, and the preview is the real renderer', () => {
  const configuration: PromptConfiguration = applyStripPreset({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), statusStrip: strip()}, 'developer');
  const state = createStripStudio();
  const rendered = renderStripStudio(state, configuration, 100, 80, (c, w) => `PREVIEW:${w}:${c.statusStrip.separator}`).map(stripAnsi);
  assert.ok(rendered.some(row => row.includes('Modules on the strip')));
  assert.ok(rendered.some(row => row.includes('PREVIEW:96:dot')), 'the live preview at the panel width');
  assert.ok(rendered.some(row => row.includes('PREVIEW:50:dot')), 'and at 50 columns');
  while (!stripStudioControls(state, configuration).some(([, action]) => action === 'group')) stripStudioKey(state, {kind: 'down'}, configuration);
  const first = stripModules(configuration)[0]!;
  const zone = stripStudioKey(state, {kind: 'right'}, configuration);
  assert.equal(zone?.kind === 'change' && zone.configuration.modules.find(module => module.id === first.id)!.stripZone, first.stripZone === 'left' ? 'center' : 'left');
  const order = stripStudioKey(state, {kind: 'selectDown'}, configuration);
  assert.equal(order?.kind === 'change' && stripModules(order.configuration)[1]!.id, first.id, 'Shift+↓ moves it later on the strip');
  state.selected -= 1;
  const off = stripStudioKey(state, {kind: 'text', value: 'x'}, configuration);
  assert.equal(off?.kind === 'change' && off.configuration.modules.find(module => module.id === first.id)!.surface, undefined, 'back to its prompt surface');
});
