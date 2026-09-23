import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, chmod, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archiveColor} from '../src/prompt/snapshot.js';
import {NATIVE_LAVENDER_RAMP, nativePromptSnapshot, renderedModules} from '../src/prompt/prompt.js';
import {normalizePromptConfiguration, DEFAULT_PROMPT_CONFIGURATION, savePromptConfiguration, loadPromptConfiguration} from '../src/prompt/configuration.js';
import {detectStarship, normalizeStarshipConfigPath, parseStarshipPrompt, renderStarshipPrompt} from '../src/prompt/starship.js';

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
