import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContextLine, buildInlineContextPrefix, buildPromptLine, GIT_SEMANTIC_COLORS, NATIVE_PROMPT_THEMES, NMSH_BRAND_LAVENDER, promptRoleColors, renderedModules} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, NATIVE_PALETTE_IDS, normalizePromptConfiguration} from '../src/prompt/configuration.js';
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

test('NMSh is the default provider and Lavender Native is a role-based lavender/violet family', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.provider, 'nmsh');
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.gapEnabled, true);
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.endStyle, 'fadeWedge');
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.palette, 'lavender');
  assert.deepEqual(NMSH_BRAND_LAVENDER, {red: 166, green: 124, blue: 243}, '#A67CF3');
  const lavender = NATIVE_PROMPT_THEMES.lavender;
  assert.deepEqual(lavender.colors('project').background, NMSH_BRAND_LAVENDER);
  const roles = ['project', 'cwd', 'gitBranch', 'node', 'go', 'python', 'docker'] as const;
  const backgrounds = roles.map(role => lavender.colors(role).background);
  assert.equal(new Set(backgrounds.map(color => JSON.stringify(color))).size, roles.length, 'modules use related shades, not one repeated color');
  assert.ok(backgrounds.every(color => color.blue > color.green && color.red > color.green), 'every shade stays in the violet family');
});

test('conditional modules take their role colors in visible order', () => {
  const config = normalizePromptConfiguration({modules: [
    {id: 'project', visible: true, condition: 'always'},
    {id: 'cwd', visible: true, condition: 'always'},
    {id: 'gitBranch', visible: true, condition: 'inRepository'},
    {id: 'exitStatus', visible: true, condition: 'nonzeroExit'},
  ]});
  const modules = renderedModules({cwd: '/tmp/work', project: 'repo', exitStatus: 0}, config);
  assert.equal(modules.length, 2);
  assert.deepEqual(modules.map(module => module.background), [
    NATIVE_PROMPT_THEMES.lavender.colors('project').background,
    NATIVE_PROMPT_THEMES.lavender.colors('cwd').background,
  ]);
});

test('Git state renders one semantic segment per state; clean repositories add a compact marker', () => {
  const context = {cwd: '/tmp/repo', project: 'repo', branch: 'main',
    git: {staged: 2, modified: 3, untracked: 1, conflicts: 1, ahead: 2, behind: 1, operation: 'rebase' as const}};
  const modules = renderedModules(context, DEFAULT_PROMPT_CONFIGURATION).filter(module => module.id === 'gitBranch');
  assert.deepEqual(modules.map(module => module.role),
    ['gitBranch', 'gitStaged', 'gitModified', 'gitUntracked', 'gitConflict', 'gitDiverged', 'gitOperation']);
  assert.deepEqual(modules.map(module => module.text.slice(module.role === 'gitBranch' ? -5 : 0)),
    ['main*', '+2', '~3', '?1', '!1', '↑2 ↓1', 'rebase']);
  const clean = renderedModules({...context, git: {...context.git, staged: 0, modified: 0, untracked: 0,
    conflicts: 0, ahead: 0, behind: 0, operation: undefined}}, DEFAULT_PROMPT_CONFIGURATION)
    .filter(module => module.id === 'gitBranch');
  assert.deepEqual(clean.map(module => module.role), ['gitBranch', 'gitClean']);
  assert.ok(clean[0]!.text.endsWith('main'));
  assert.equal(clean[1]!.text, '', 'the clean marker carries no glyph of its own');
  assert.equal(clean[1]!.compact, true);
});

test('clean marker appears only for a probed, genuinely clean working tree', () => {
  const clean = {staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0};
  const roles = (git: typeof clean & {operation?: 'merge' | 'rebase' | 'cherry-pick'} | undefined, branch: string | undefined = 'main') =>
    renderedModules({cwd: '/tmp/repo', project: 'repo', ...(branch ? {branch} : {}), ...(git ? {git} : {})}, DEFAULT_PROMPT_CONFIGURATION)
      .map(module => module.role);
  assert.ok(roles(clean).includes('gitClean'));
  assert.ok(roles({...clean, ahead: 1, behind: 2}).includes('gitClean'), 'ahead/behind is not a dirty working tree');
  for (const dirty of [{staged: 1}, {modified: 1}, {untracked: 1}, {conflicts: 1}, {operation: 'merge' as const},
    {operation: 'rebase' as const}, {operation: 'cherry-pick' as const}]) {
    assert.ok(!roles({...clean, ...dirty}).includes('gitClean'), JSON.stringify(dirty));
  }
  assert.ok(!roles(undefined).includes('gitClean'), 'a failed or timed-out probe is unknown, not clean');
  assert.ok(!roles(undefined, undefined).includes('gitClean'), 'outside a repository');
  const marker = renderedModules({cwd: '/tmp/repo', project: 'repo', branch: 'main', git: clean}, DEFAULT_PROMPT_CONFIGURATION)
    .find(module => module.role === 'gitClean')!;
  assert.deepEqual(marker.background, GIT_SEMANTIC_COLORS.gitClean.background, 'semantic success green by default');
  for (const id of NATIVE_PALETTE_IDS) {
    assert.deepEqual(promptRoleColors('gitClean', id, 'followTheme'), NATIVE_PROMPT_THEMES[id].colors('success'),
      `${id}: Follow theme uses the theme's success role`);
  }
});

test('native open uses U+E0D7 and gap-enabled segments close and reopen over neutral background', () => {
  const rendered = buildPromptLine({cwd: '/tmp/work', project: 'repo', branch: 'main'}, 60);
  const plain = stripAnsi(rendered);
  assert.equal(displayWidth(rendered), 60);
  assert.match(plain, /^ repo ▒ \/tmp\/work ▒  main /u);
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
