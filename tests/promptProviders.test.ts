import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, chmod, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archiveColor} from '../src/prompt/snapshot.js';
import {buildContextLine, NATIVE_LAVENDER_RAMP, nativePromptSnapshot, renderedModules} from '../src/prompt/prompt.js';
import {applyNativeGapChoice, nativeGapChoice, normalizePromptConfiguration, DEFAULT_PROMPT_CONFIGURATION, savePromptConfiguration, loadPromptConfiguration} from '../src/prompt/configuration.js';
import {detectStarship, normalizeStarshipConfigPath, parseStarshipPrompt, renderStarshipPrompt} from '../src/prompt/starship.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {describePromptConfiguration, handlePromptPanelKey, renderPromptPanel} from '../src/prompt/PromptPanel.js';
import {detectToolchains} from '../src/shell/ShellContext.js';
import {stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';

test('NMSh Native defaults to eight contrast-safe lavender shades and cycles by visible order', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.provider, 'nmsh');
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.gapEnabled, true);
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.endStyle, 'fadeWedge');
  assert.equal(NATIVE_LAVENDER_RAMP.length, 8);
  const shades = [...NATIVE_LAVENDER_RAMP, NATIVE_LAVENDER_RAMP[0]!, NATIVE_LAVENDER_RAMP[1]!];
  assert.deepEqual(shades[8], shades[0]);
  assert.deepEqual(shades[9], shades[1]);
  assert.ok(NATIVE_LAVENDER_RAMP.every(color => color.blue > color.red && color.red > color.green));
  assert.ok(NATIVE_LAVENDER_RAMP.every(color => color.red + color.green + color.blue > 150));
});

test('conditional Native modules receive continuous palette indices and selectable gap/end appearance', () => {
  const config = normalizePromptConfiguration({nmsh: {gapEnabled: false, endStyle: 'fadeFlat'}});
  assert.equal(config.nmsh.gapEnabled, false);
  assert.equal(config.nmsh.endStyle, 'fadeFlat');
  const context = {cwd: '/tmp/work', project: 'repo', branch: undefined, exitStatus: 0};
  const modules = renderedModules(context, normalizePromptConfiguration({
    modules: [
      {id: 'project', visible: true, condition: 'always'},
      {id: 'cwd', visible: true, condition: 'always'},
      {id: 'gitBranch', visible: true, condition: 'inRepository'},
      {id: 'exitStatus', visible: true, condition: 'nonzeroExit'},
    ],
  }));
  assert.equal(modules.length, 2);
  assert.deepEqual(modules.map(module => module.background), NATIVE_LAVENDER_RAMP.slice(0, 2));
  assert.deepEqual(nativePromptSnapshot(context, config).segments.map(segment => segment.background), NATIVE_LAVENDER_RAMP.slice(0, 2));
});

test('archive color transform preserves green and purple pigment while reducing emphasis', () => {
  const green = archiveColor({red: 25, green: 180, blue: 90});
  assert.ok(green.green > green.red * 1.5);
  assert.ok(green.green > green.blue * 1.3);
  const purple = archiveColor({red: 145, green: 90, blue: 210});
  assert.ok(purple.blue > purple.green * 1.5);
  assert.ok(purple.red > purple.green * 1.2);
  const white = archiveColor({red: 250, green: 250, blue: 250});
  assert.ok(white.red < 250 && white.green < 250 && white.blue < 250);
  const whiteBg = archiveColor({red: 250, green: 250, blue: 250}, 'background');
  assert.ok(whiteBg.red < 250 && whiteBg.green < 250 && whiteBg.blue < 250);
});

test('Starship config path respects STARSHIP_CONFIG, tilde, and normal defaults', () => {
  assert.equal(normalizeStarshipConfigPath({STARSHIP_CONFIG: '~/theme.toml'}, '/Users/example'), '/Users/example/theme.toml');
  assert.equal(normalizeStarshipConfigPath({XDG_CONFIG_HOME: '/tmp/config'}, '/Users/example'), '/tmp/config/starship.toml');
  assert.equal(normalizeStarshipConfigPath({}, '/Users/example'), '/Users/example/.config/starship.toml');
});

test('Starship ANSI prompt becomes semantic styled spans and multiline output is flattened', () => {
  const parsed = parseStarshipPrompt('path \u001B[38;2;10;210;80mgreen\u001B[0m\nnext');
  assert.equal(parsed.text, 'path green next');
  assert.equal(parsed.normalizedMultiline, true);
  assert.equal(parsed.segments[0]?.text, 'path ');
  assert.deepEqual(parsed.segments[1]?.foreground, {red: 10, green: 210, blue: 80});
  assert.equal(parsed.segments[2]?.text, ' next');
  assert.ok(parsed.segments.every(segment => segment.geometry === 'plain'));
});

test('Starship detection reports missing binaries, and a detected provider is invoked only when refreshed', async () => {
  const missing = await detectStarship({HOME: '/tmp', PATH: ''}, undefined);
  assert.equal(missing.installed, false);
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-starship-'));
  const cwd = join(directory, 'project');
  const binary = join(directory, 'starship');
  await mkdir(cwd);
  await writeFile(binary, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo starship 9.9.9; else printf "\\033[38;2;25;180;90mrepo\\033[0m\\nnext\\n"; fi\n', 'utf8');
  await chmod(binary, 0o755);
  try {
    const status = await detectStarship({HOME: directory, PATH: ''}, binary);
    assert.equal(status.installed, true);
    assert.equal(status.version, 'starship 9.9.9');
    const result = await renderStarshipPrompt({cwd, project: 'repo', branch: 'main', exitStatus: 0}, status, {HOME: directory, PATH: ''});
    assert.equal(result.text, 'repo next');
    assert.equal(result.normalizedMultiline, true);
    assert.deepEqual(result.segments[0]?.foreground, {red: 25, green: 180, blue: 90});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('inactive Starship settings survive provider changes and normal config persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-prompt-config-'));
  const path = join(directory, 'config.json');
  try {
    const config = normalizePromptConfiguration({provider: 'starship', composerLayout: 'oneLine', starship: {configPath: '/tmp/custom.toml'}});
    config.provider = 'nmsh';
    savePromptConfiguration(config, path);
    const restored = loadPromptConfiguration(path);
    assert.equal(restored.provider, 'nmsh');
    assert.equal(restored.composerLayout, 'oneLine');
    assert.equal(restored.starship.configPath, '/tmp/custom.toml');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('onboarding preview uses a dedicated panel and hides the live composer cursor', () => {
  const app = new TerminalApp();
  let frame: TerminalFrame | undefined;
  try {
    app['fetchSuggestions'] = async () => {};
    app['renderer'].render = next => { frame = next; };
    app['context'] = {cwd: '/tmp/work', project: 'work', branch: 'main', exitStatus: 0};
    app['promptPanelState'] = {onboarding: true, step: 'appearance', selectedIndex: 1,
      draft: structuredClone(DEFAULT_PROMPT_CONFIGURATION)};
    app['render']();
    assert.equal(frame?.cursorVisible, false);
    assert.ok(frame?.rows.some(row => row.includes('Prompt setup')));
    assert.ok(frame?.rows.some(row => row.includes('Two-line preview')));
    assert.ok(frame?.rows.some(row => row.includes('Fading wedge')));
    assert.ok(frame?.rows.at(-1)?.includes('Esc skip'), 'the panel occupies the bottom rows instead of leaving the regular composer beneath it');
    const previewRows = app['promptPanelPreview'](80);
    const runtimeRow = buildContextLine(app['context'], 76, app['promptPanelState']!.draft,
      app['promptPanelState']!.draft.placement);
    assert.ok(previewRows.includes(runtimeRow), 'Native onboarding preview uses the runtime segment renderer');
    const panel = renderPromptPanel(app['promptPanelState']!, 80, ['sample preview']);
    assert.ok(panel.some(row => row.includes('Fading wedge')));
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('native themes color by semantic role and flow into archived snapshots', () => {
  const context = {cwd: '/tmp/work', project: 'repo', branch: 'dev', toolchains: ['node' as const, 'go' as const, 'python' as const, 'docker' as const], exitStatus: 2};
  const semantic = normalizePromptConfiguration({nmsh: {palette: 'semantic'}});
  const modules = renderedModules(context, semantic);
  const byText = (text: string) => modules.find(module => module.text.endsWith(text))!;
  assert.deepEqual(byText('repo').background, {red: 172, green: 252, blue: 115}, 'project is #ACFC73');
  assert.deepEqual(byText('node').background, {red: 95, green: 160, blue: 78});
  assert.deepEqual(byText('docker').background, {red: 47, green: 142, blue: 224});
  assert.ok(byText('go').background.blue > byText('go').background.red * 3, 'go stays cyan');
  assert.ok(byText('python').background.red > 200 && byText('python').background.blue < 100, 'python stays yellow');
  assert.ok(Math.max(...Object.values(byText('dev').background)) < 80, 'git is a charcoal segment');
  assert.deepEqual(byText('2').background, {red: 205, green: 115, blue: 123}, 'existing failure color is kept');
  assert.deepEqual(modules.map(module => module.id), ['project', 'cwd', 'gitBranch', 'toolchain', 'toolchain', 'toolchain', 'toolchain', 'exitStatus']);

  const lavender = renderedModules(context, DEFAULT_PROMPT_CONFIGURATION);
  assert.deepEqual(lavender.map(module => module.background), NATIVE_LAVENDER_RAMP.slice(0, 8), 'lavender stays a monotone ramp');
  const cool = renderedModules(context, normalizePromptConfiguration({nmsh: {palette: 'cool'}}));
  assert.notDeepEqual(cool[0]!.background, modules[0]!.background);

  const snapshot = nativePromptSnapshot(context, semantic);
  assert.equal(snapshot.palette, 'semantic');
  assert.deepEqual(snapshot.segments[0]!.background, {red: 172, green: 252, blue: 115});
  const archivedProject = archiveColor(snapshot.segments[0]!.background!, 'background');
  const archivedText = archiveColor(snapshot.segments[0]!.foreground!);
  assert.ok(archivedProject.green > archivedProject.red && archivedProject.green < 160, 'archived lime is a muted green');
  assert.ok(archivedText.red > 150, 'dark live text becomes light muted text in history');
});

test('start style and gap presets change native geometry for live and archived prompts', () => {
  const context = {cwd: '/tmp/work', project: 'repo', exitStatus: 0};
  const pointed = stripAnsi(buildContextLine(context, 40, DEFAULT_PROMPT_CONFIGURATION, 'composer'));
  const flatConfig = normalizePromptConfiguration({nmsh: {startStyle: 'flat'}});
  const flat = stripAnsi(buildContextLine(context, 40, flatConfig, 'composer'));
  assert.ok(pointed.startsWith(''));
  assert.ok(flat.startsWith(' repo'));
  assert.equal([...flat].filter(glyph => glyph === '').length, 0, 'flat start opens every independent segment square');
  assert.equal(nativePromptSnapshot(context, flatConfig).startStyle, 'flat');

  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  assert.equal(nativeGapChoice(config), 'normal');
  applyNativeGapChoice(config, 'compact');
  assert.equal(nativeGapChoice(config), 'compact');
  const compact = stripAnsi(buildContextLine(context, 40, config, 'composer'));
  assert.match(compact, /repo  \/tmp/u, 'compact keeps caps without the neutral space');
  applyNativeGapChoice(config, 'off');
  assert.equal(config.nmsh.gapEnabled, false);
  applyNativeGapChoice(config, 'normal');
  assert.deepEqual([config.nmsh.gapEnabled, config.gap], [true, 1]);
});

test('saved configurations gain new modules at their default position', () => {
  const config = normalizePromptConfiguration({modules: [
    {id: 'project', visible: true, condition: 'always'},
    {id: 'exitStatus', visible: false, condition: 'nonzeroExit'},
  ]});
  assert.deepEqual(config.modules.map(module => module.id), ['project', 'cwd', 'gitBranch', 'toolchain', 'exitStatus']);
  assert.equal(config.modules.at(-1)!.visible, false);
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'neon', startStyle: 'round'}}).nmsh.palette, 'lavender');
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'neon', startStyle: 'round'}}).nmsh.startStyle, 'pointed');
});

test('toolchains are detected from marker files in cwd and repository root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-toolchain-'));
  try {
    await mkdir(join(directory, 'sub'));
    await writeFile(join(directory, 'go.mod'), 'module x\n');
    await writeFile(join(directory, 'sub', 'Dockerfile'), 'FROM scratch\n');
    assert.deepEqual(await detectToolchains([join(directory, 'sub'), directory]), ['go', 'docker']);
    assert.deepEqual(await detectToolchains([join(directory, 'missing')]), []);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('/prompt appearance shows saved values, unsaved changes, and live theme previews', () => {
  const saved = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  const state = {onboarding: false, step: 'appearance' as const, selectedIndex: 0, draft: structuredClone(saved), saved};
  const unchanged = renderPromptPanel(state, 120, ['live preview'], ['L', 'S', 'C']).map(stripAnsi);
  assert.ok(unchanged.some(row => row.includes('Current  Lavender Native · two-line · pointed start · gap normal · fading wedge')));
  assert.ok(unchanged.some(row => row.includes('matches current')));
  assert.ok(unchanged.some(row => /● Lavender Native +✓ L/u.test(row)));

  handlePromptPanelKey({kind: 'right'} as Key, state);
  state.selectedIndex = 1; handlePromptPanelKey({kind: 'right'} as Key, state);
  state.selectedIndex = 2; handlePromptPanelKey({kind: 'left'} as Key, state);
  assert.deepEqual([state.draft.nmsh.palette, state.draft.nmsh.startStyle, nativeGapChoice(state.draft)], ['semantic', 'flat', 'compact']);
  const changed = renderPromptPanel(state, 120, ['live preview'], ['L', 'S', 'C']).map(stripAnsi);
  assert.ok(changed.some(row => row.includes('Theme   ‹ Soft Semantic ›  saved: Lavender Native')));
  assert.ok(changed.some(row => row.includes('Start   ‹ Flat ›  saved: Pointed')));
  assert.ok(changed.some(row => row.includes('Gap     ‹ Compact ›  saved: Normal')));
  assert.ok(changed.some(row => row.includes('unsaved preview')));
  assert.ok(changed.some(row => /○ Lavender Native +✓ L/u.test(row)) && changed.some(row => /● Soft Semantic +S/u.test(row)));
  assert.equal(describePromptConfiguration(saved), 'Lavender Native · two-line · pointed start · gap normal · fading wedge');
});
