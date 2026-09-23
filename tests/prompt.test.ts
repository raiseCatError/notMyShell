import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContextLine, buildInlineContextPrefix, buildPromptLine, NATIVE_LAVENDER_RAMP, nativePaletteColor, renderedModules} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {homedir} from 'node:os';

test('NMSh is the default provider with an eight-step darker lavender ramp that wraps', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.provider, 'nmsh');
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.gapEnabled, true);
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.endStyle, 'fadeWedge');
  assert.equal(NATIVE_LAVENDER_RAMP.length, 8);
  assert.deepEqual(nativePaletteColor(8), NATIVE_LAVENDER_RAMP[0]);
  assert.deepEqual(nativePaletteColor(9), NATIVE_LAVENDER_RAMP[1]);
  assert.ok(NATIVE_LAVENDER_RAMP[0]!.red > NATIVE_LAVENDER_RAMP[7]!.red);
  assert.ok(NATIVE_LAVENDER_RAMP[7]!.blue > NATIVE_LAVENDER_RAMP[7]!.red, 'darkest shade retains violet pigment');
  assert.ok(NATIVE_LAVENDER_RAMP.every(color => color.red + color.green + color.blue > 150));
});

test('conditional modules receive a continuous ramp by visible order', () => {
  const config = normalizePromptConfiguration({modules: [
    {id: 'project', visible: true, condition: 'always'},
    {id: 'cwd', visible: true, condition: 'always'},
    {id: 'gitBranch', visible: true, condition: 'inRepository'},
    {id: 'exitStatus', visible: true, condition: 'nonzeroExit'},
  ]});
  const modules = renderedModules({cwd: '/tmp/work', project: 'repo', exitStatus: 0}, config);
  assert.equal(modules.length, 2);
  assert.deepEqual(modules.map(module => module.background), NATIVE_LAVENDER_RAMP.slice(0, 2));
});

test('Powerline segment edges belong to their segment and keep every cap on neutral background', () => {
  const rendered = buildPromptLine({cwd: '/tmp/work', project: 'repo', branch: 'main'}, 60);
  const plain = stripAnsi(rendered);
  assert.equal(displayWidth(rendered), 60);
  assert.match(plain, /^ repo   \/tmp\/work    main ▒░/u);
  assert.doesNotMatch(plain, //u);
  assert.match(rendered, /\u001B\[0m\u001B\[49m\u001B\[38;2;127;94;187m/u);
  assert.match(rendered, /\u001B\[0m\u001B\[49m\u001B\[38;2;127;94;187m/u);
  assert.match(rendered, /\u001B\[0m\u001B\[49m\u001B\[38;2;110;77;164m▒░/u);
});

test('NMSh native gap On and Off are independent from internal spacing', () => {
  const context = {cwd: '/tmp/work', project: 'repo', branch: 'main'};
  const config = normalizePromptConfiguration({gap: 2, spacing: 0, nmsh: {gapEnabled: true}});
  const withGap = stripAnsi(buildContextLine(context, 80, config, 'composer'));
  assert.ok(withGap.includes('  '), withGap);
  config.nmsh.gapEnabled = false;
  const touching = stripAnsi(buildContextLine(context, 80, config, 'composer'));
  assert.ok(touching.includes(''), touching);
  assert.ok(!touching.includes(' '));
});

test('all four end styles have their semantic two-line treatment', () => {
  const context = {cwd: '/tmp/work', project: 'work', branch: 'main'};
  const render = (endStyle: 'fadeWedge' | 'wedge' | 'fadeFlat' | 'flat') => buildContextLine(context, 80,
    normalizePromptConfiguration({nmsh: {endStyle}}), 'header');
  const fadeWedge = stripAnsi(render('fadeWedge'));
  const wedge = stripAnsi(render('wedge'));
  const fadeFlat = stripAnsi(render('fadeFlat'));
  const flat = stripAnsi(render('flat'));
  assert.ok(fadeWedge.includes('▒░'), fadeWedge);
  assert.ok(wedge.includes('─'), wedge);
  assert.ok(fadeFlat.includes('▓▒░'), fadeFlat);
  assert.ok(flat.includes('─'), flat);
  assert.doesNotMatch(wedge, /[▓▒░]/u);
  assert.doesNotMatch(flat, /[▓▒░]/u);
  assert.match(render('fadeFlat'), /\u001B\[49m\u001B\[38;2;110;77;164m▓▒░/u, 'density fade uses terminal-neutral background');
});

test('one-line Native keeps the selected composer row free of header divider and fade tail', () => {
  const configuration = normalizePromptConfiguration({composerLayout: 'oneLine', nmsh: {endStyle: 'fadeFlat'}});
  const prefix = buildInlineContextPrefix({cwd: '/tmp/work', project: 'work', branch: 'dev'}, 80, configuration);
  assert.ok(displayWidth(prefix) <= 79);
  assert.ok(!stripAnsi(prefix).includes('▓▒░'));
  assert.ok(!stripAnsi(prefix).includes('─'));
  assert.ok(stripAnsi(prefix).endsWith('❯ '));
});

test('custom module colors remain supported and narrow widths never leave orphan caps', () => {
  const configuration = normalizePromptConfiguration({modules: [
    {id: 'project', visible: true, foreground: '#abcdef', background: '#012345'},
  ]});
  assert.match(buildContextLine({cwd: '/tmp', project: 'repo'}, 40, configuration, 'composer'), /48;2;1;35;69m/u);
  for (let width = 1; width <= 32; width += 1) {
    const rendered = buildPromptLine({cwd: '/tmp/notMyShell', project: 'notMyShell', branch: 'long-branch'}, width);
    assert.equal(displayWidth(rendered), width, `width ${width}`);
    assert.equal(stripAnsi(rendered).split('\n').length, 1);
  }
});

test('legacy config fields survive migration and invalid provider/appearance values fall back safely', () => {
  const normalized = normalizePromptConfiguration({placement: 'composer', composerLayout: 'oneLine', gap: 2,
    provider: 'future', nmsh: {gapEnabled: 'yes', endStyle: 'triangles'}});
  assert.equal(normalized.provider, 'nmsh');
  assert.equal(normalized.composerLayout, 'oneLine');
  assert.equal(normalized.placement, 'composer');
  assert.equal(normalized.gap, 2);
  assert.equal(normalized.nmsh.gapEnabled, true);
  assert.equal(normalized.nmsh.endStyle, 'fadeWedge');
  assert.equal(normalizePromptConfiguration({composerLayout: 'wrong'}).composerLayout, 'twoLine');
});

test('prompt context sanitizes terminal controls and duplicate HOME paths stay collapsed', () => {
  const home = buildContextLine({cwd: homedir(), project: '~'}, 50, DEFAULT_PROMPT_CONFIGURATION, 'composer');
  assert.equal(stripAnsi(home).split('~').length - 1, 1);
  const rendered = stripAnsi(buildPromptLine({cwd: '/tmp/repo\u001B[2J', project: 'repo\u0007', branch: 'main\nbranch'}, 80));
  assert.ok(!rendered.includes('\u001B'));
  assert.ok(!rendered.includes('\u0007'));
  assert.ok(rendered.includes('�'));
});
