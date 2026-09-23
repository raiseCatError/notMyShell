import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContextLine, buildInlineContextPrefix, buildPromptLine, NATIVE_LAVENDER_RAMP, nativePaletteColor, renderedModules} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {homedir} from 'node:os';
import {renderPowerlineBlocks} from '../src/prompt/powerline.js';
import {fadePromptColor} from '../src/prompt/snapshot.js';

const A = {red: 100, green: 60, blue: 180};
const B = {red: 40, green: 120, blue: 80};
const blocks = [
  {text: 'A', foreground: {red: 250, green: 250, blue: 250}, background: A},
  {text: 'B', foreground: {red: 250, green: 250, blue: 250}, background: B},
];

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

test('native open uses U+E0D7 and gap-enabled segments close and reopen over neutral background', () => {
  const rendered = buildPromptLine({cwd: '/tmp/work', project: 'repo', branch: 'main'}, 60);
  const plain = stripAnsi(rendered);
  assert.equal(displayWidth(rendered), 60);
  assert.match(plain, /^ repo   \/tmp\/work    main /u);
  assert.ok(rendered.startsWith('\u001B[0m\u001B[49m\u001B[38;2;166;124;243m'));
  assert.match(rendered, /\u001B\[0m\u001B\[49m\u001B\[38;2;166;124;243m/u);
});

test('gap Off joins segments with one E0B0 carrying old FG and new BG', () => {
  const rendered = renderPowerlineBlocks(blocks, 0, 0, 'flat', false);
  assert.equal(stripAnsi(rendered), 'AB');
  assert.equal([...stripAnsi(rendered)].filter(glyph => glyph === '').length, 1);
  assert.equal([...stripAnsi(rendered)].filter(glyph => glyph === '').length, 1);
  assert.ok(rendered.includes('\u001B[0m\u001B[38;2;100;60;180m\u001B[48;2;40;120;80m'));
});

test('gap On closes and opens independently with a genuinely neutral gap', () => {
  const rendered = renderPowerlineBlocks(blocks, 3, 0, 'flat', true);
  assert.equal(stripAnsi(rendered), 'A   B');
  assert.ok(rendered.includes('\u001B[0m\u001B[49m\u001B[38;2;100;60;180m\u001B[0m\u001B[49m   \u001B[0m\u001B[49m\u001B[38;2;40;120;80m'));
});

test('all four endings use their exact terminal shapes', () => {
  const single = blocks.slice(0, 1);
  const flat = renderPowerlineBlocks(single, 0, 0, 'flat', true);
  const wedge = renderPowerlineBlocks(single, 0, 0, 'wedge', true);
  const fadeFlat = renderPowerlineBlocks(single, 0, 0, 'fadeFlat', true);
  const fadeWedge = renderPowerlineBlocks(single, 0, 0, 'fadeWedge', true);
  assert.equal(stripAnsi(flat), 'A');
  assert.equal(stripAnsi(wedge), 'A');
  assert.equal(stripAnsi(fadeFlat), 'A▓▒░ ');
  assert.equal(stripAnsi(fadeWedge), 'A');
  assert.equal([...stripAnsi(wedge)].filter(glyph => glyph === '').length, 1);
  assert.equal([...stripAnsi(fadeWedge)].filter(glyph => glyph === '').length, 4);
  assert.doesNotMatch(stripAnsi(fadeWedge), /[▓▒░▶▸›]/u);
  assert.match(fadeFlat, /\u001B\[0m\u001B\[49m/u, 'density fade is on neutral background');
  const faded = [fadePromptColor(A, 0), fadePromptColor(A, 1), fadePromptColor(A, 2)];
  const chain = [A, ...faded];
  for (let index = 0; index < 3; index += 1) {
    const from = chain[index]!;
    const to = chain[index + 1]!;
    assert.ok(fadeWedge.includes(`\u001B[0m\u001B[38;2;${from.red};${from.green};${from.blue}m\u001B[48;2;${to.red};${to.green};${to.blue}m`));
  }
  const last = faded[2]!;
  assert.ok(fadeWedge.includes(`\u001B[0m\u001B[38;2;${last.red};${last.green};${last.blue}m\u001B[49m`));
  assert.ok(faded.every(color => color.blue > color.green), 'the fade retains its blue-violet pigment');
});

test('one-line Native renders its selected ending before the editor prompt without a header divider', () => {
  const configuration = normalizePromptConfiguration({composerLayout: 'oneLine', nmsh: {endStyle: 'fadeFlat'}});
  const prefix = buildInlineContextPrefix({cwd: '/tmp/work', project: 'work', branch: 'dev'}, 80, configuration);
  assert.ok(displayWidth(prefix) <= 79);
  assert.ok(stripAnsi(prefix).includes('▓▒░'));
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
