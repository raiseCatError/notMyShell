import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextLine, buildRichGitShowcaseLine, buildThemePreviewLine, GIT_SEMANTIC_COLORS, GIT_STATE_ROLES, NATIVE_PROMPT_THEMES,
  nativePromptSnapshot, promptRoleColors, renderedModules, RICH_GIT_SHOWCASE,
} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, NATIVE_PALETTE_IDS, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {connectorFadeColor, POWERLINE_SHAPES, renderPowerlineBlocks, resolveConnectorFade, type PowerlineBlock} from '../src/prompt/powerline.js';
import {handlePromptPanelKey, onModulesRow, renderPromptPanel, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {renderHistoricalContext} from '../src/output/OutputBuffer.js';
import {powerlineShapeGlyphs, setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const config = (patch: (value: PromptConfiguration) => void = () => {}): PromptConfiguration => {
  const value = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  patch(value);
  return value;
};
const clean = {staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0};
const gitRoles = (git: typeof clean) => renderedModules({cwd: '/r', project: 'r', branch: 'main', git}, config())
  .filter(module => module.id === 'gitBranch').map(module => module.role);
const chroma = (color: {red: number; green: number; blue: number}) => Math.max(color.red, color.green, color.blue) - Math.min(color.red, color.green, color.blue);

test('Rich Git colors default to Semantic and old configs normalize without losing settings', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.gitColors, 'semantic');
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.connectorFade, 'follow');
  const legacy = normalizePromptConfiguration({provider: 'nmsh', onboardingComplete: true, glyphStyle: 'safe', glyphChoiceComplete: true,
    nmsh: {palette: 'warm', connector: 'rounded', startStyle: 'flat', endStyle: 'wedge', gapEnabled: false, icons: 'off'},
    transcript: {divider: false}});
  assert.equal(legacy.nmsh.gitColors, 'semantic');
  assert.equal(legacy.nmsh.connectorFade, 'follow');
  assert.deepEqual([legacy.nmsh.palette, legacy.nmsh.connector, legacy.nmsh.startStyle, legacy.nmsh.endStyle, legacy.nmsh.gapEnabled, legacy.nmsh.icons],
    ['warm', 'rounded', 'flat', 'wedge', false, 'off']);
  assert.equal(legacy.onboardingComplete, true);
  assert.equal(legacy.glyphStyle, 'safe');
  assert.equal(legacy.transcript.divider, false);
  assert.equal(normalizePromptConfiguration({nmsh: {gitColors: 'neon', connectorFade: 'zigzag'}}).nmsh.gitColors, 'semantic');
  assert.equal(normalizePromptConfiguration({nmsh: {connectorFade: 'zigzag'}}).nmsh.connectorFade, 'follow');
});

test('Semantic ignores the theme, Follow theme uses it, Grayscale removes hue; the branch always follows the theme', () => {
  for (const palette of NATIVE_PALETTE_IDS) {
    for (const role of GIT_STATE_ROLES) {
      assert.deepEqual(promptRoleColors(role, palette, 'semantic'), GIT_SEMANTIC_COLORS[role], `${palette}/${role}`);
      assert.deepEqual(promptRoleColors(role, palette, 'followTheme'), NATIVE_PROMPT_THEMES[palette].colors(role));
      assert.ok(chroma(promptRoleColors(role, palette, 'grayscale').background) <= 2, `${role} grayscale has no hue`);
    }
    for (const mode of ['semantic', 'followTheme', 'grayscale'] as const) {
      assert.deepEqual(promptRoleColors('gitBranch', palette, mode), NATIVE_PROMPT_THEMES[palette].colors('gitBranch'));
    }
  }
  const grayscaleTheme = renderedModules({cwd: '/r', project: 'r', branch: 'main', git: {...clean, modified: 1}},
    config(value => { value.nmsh.palette = 'grayscale'; }));
  assert.deepEqual(grayscaleTheme.find(module => module.role === 'gitModified')!.background, GIT_SEMANTIC_COLORS.gitModified.background,
    'a grayscale Main Prompt keeps semantic Git colors by default');
  const followed = renderedModules({cwd: '/r', project: 'r', branch: 'main', git: {...clean, modified: 1}},
    config(value => { value.nmsh.palette = 'grayscale'; value.nmsh.gitColors = 'followTheme'; }));
  assert.ok(chroma(followed.find(module => module.role === 'gitModified')!.background) <= 4, 'Follow theme under Grayscale is gray');
});

test('each semantic Git role has its own color', () => {
  const backgrounds = GIT_STATE_ROLES.map(role => JSON.stringify(GIT_SEMANTIC_COLORS[role].background));
  assert.equal(new Set(backgrounds).size, GIT_STATE_ROLES.length);
});

test('ahead only, behind only, and diverged tracking use distinct roles', () => {
  assert.ok(gitRoles({...clean, ahead: 2}).includes('gitAhead'));
  assert.ok(gitRoles({...clean, behind: 1}).includes('gitBehind'));
  const diverged = gitRoles({...clean, ahead: 2, behind: 1});
  assert.ok(diverged.includes('gitDiverged') && !diverged.includes('gitAhead') && !diverged.includes('gitBehind'));
  const text = renderedModules({cwd: '/r', project: 'r', branch: 'main', git: {...clean, ahead: 2, behind: 1}}, config())
    .find(module => module.role === 'gitDiverged')!.text;
  assert.equal(text, '↑2 ↓1');
});

test('Git state segments and the clean marker take the Main Prompt connector geometry', () => {
  for (const connector of POWERLINE_SHAPES) {
    const value = config(draft => { draft.nmsh.connector = connector; draft.nmsh.gapEnabled = false; draft.nmsh.connectorFade = 'off'; });
    const line = stripAnsi(buildContextLine({cwd: '/r', project: 'r', branch: 'main', git: {...clean, staged: 1, modified: 1}}, 120, value, 'composer'));
    const join = powerlineShapeGlyphs(connector).join;
    if (join) assert.ok(line.includes(`${join} +1 ${join} ~1 `), `${connector}: ${line}`);
    else assert.ok(line.includes(' +1  ~1 '), `${connector}: ${line}`);
    const cleanLine = buildContextLine({cwd: '/r', project: 'r', branch: 'main', git: clean}, 120, value, 'composer');
    assert.ok(!stripAnsi(cleanLine).includes(''), 'no fixed clean glyph');
    const green = GIT_SEMANTIC_COLORS.gitClean.background;
    assert.ok(cleanLine.includes(`48;2;${green.red};${green.green};${green.blue}m `), `${connector}: clean marker is one green cell`);
  }
});

const WHITE = {red: 255, green: 255, blue: 255};
const PURPLE = {red: 100, green: 60, blue: 180};
const GREEN = {red: 40, green: 120, blue: 80};
const blocks: PowerlineBlock[] = [
  {text: 'A', foreground: WHITE, background: PURPLE},
  {text: 'B', foreground: WHITE, background: GREEN},
];
const fg = (color: typeof WHITE) => `\u001B[38;2;${color.red};${color.green};${color.blue}m`;
const bg = (color: typeof WHITE) => `\u001B[48;2;${color.red};${color.green};${color.blue}m`;

test('Connector fade resolves: Follow connector tracks it, a fixed shape sticks, Off and old snapshots have none', () => {
  for (const shape of POWERLINE_SHAPES) assert.equal(resolveConnectorFade('follow', shape), shape);
  assert.equal(resolveConnectorFade('slash', 'rounded'), 'slash');
  assert.equal(resolveConnectorFade('off', 'wedge'), undefined);
  assert.equal(resolveConnectorFade(undefined, 'wedge'), undefined);
});

const RESET = '\u001B[0m';
const fadeA = connectorFadeColor(PURPLE);

test('fade color comes only from the left segment: one darker step of its hue', () => {
  assert.notDeepEqual(fadeA, PURPLE);
  const lightness = (color: typeof WHITE) => color.red + color.green + color.blue;
  assert.ok(lightness(fadeA) < lightness(PURPLE), 'darker than the left segment');
  const other = [{...blocks[0]!}, {...blocks[1]!, background: {red: 220, green: 40, blue: 40}}];
  const withGreen = renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'wedge', 'wedge');
  const withRed = renderPowerlineBlocks(other, 1, 1, 'flat', true, 'flat', 'wedge', 'wedge');
  for (const rendered of [withGreen, withRed]) assert.ok(rendered.includes(bg(fadeA)), 'changing B never changes the fade');
});

test('Connector shapes the close cap and Connector fade only the open cap; Previous darkens only the exit cap in Normal', () => {
  for (const connector of POWERLINE_SHAPES) {
    for (const fade of POWERLINE_SHAPES) {
      const rendered = renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', connector, fade);
      const close = powerlineShapeGlyphs(connector).close;
      const open = powerlineShapeGlyphs(fade).open;
      // Normal Previous: [A|darkA][darkA][darkA|B]; Flat + Flat is one terminal cell.
      const expected = !close && !open ? `${RESET}\u001B[49m `
        : `${RESET}${bg(fadeA)}${close ? `${fg(PURPLE)}${close}` : ' '}${RESET}${bg(fadeA)} ${RESET}${bg(fadeA)}${open ? `${fg(GREEN)}${open}` : ' '}`;
      assert.ok(rendered.includes(expected), `${connector} + fade ${fade}`);
    }
  }
  const mixed = stripAnsi(renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'wedge', 'slash'));
  assert.ok(mixed.includes(' '), 'Wedge exit, Slant / entry');
  assert.ok(!mixed.includes(' '), 'the exit is not replaced by the fade shape');
  assert.ok(stripAnsi(renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'rounded', 'wedge')).includes(' '),
    'Rounded exit, Wedge entry');
  assert.ok(stripAnsi(renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'rounded', resolveConnectorFade('follow', 'rounded')))
    .includes(' '), 'Follow connector matches both sides');
});

test('Off restores neutral gaps; Gap Off stays joined; widths never change', () => {
  const neutral = renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'wedge');
  assert.equal(renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'wedge', undefined), neutral);
  assert.ok(!neutral.includes(bg(fadeA)));
  const joined = renderPowerlineBlocks(blocks, 0, 1, 'flat', false, 'flat', 'wedge', 'wedge');
  assert.equal(joined, renderPowerlineBlocks(blocks, 0, 1, 'flat', false, 'flat', 'wedge'), 'Gap Off is an ordinary joined connector');
  for (const shape of POWERLINE_SHAPES) {
    const width = (gap: number, fade?: typeof shape) => displayWidth(renderPowerlineBlocks(blocks, gap, 1, 'flat', true, 'flat', shape, fade));
    assert.equal(width(0, shape), width(0), `${shape} Compact adds no width`);
    assert.equal(width(1, shape), width(1), `${shape} Normal: the bridge cell takes the unfaded gap cell's place`);
    for (const gap of [2, 3]) assert.equal(width(gap, shape), width(1, shape) + 1, `${shape} Wide is Normal plus one cell`);
  }
});

test('Compact fades through its touching caps; Normal bridges darker-A to B; Wide notches through terminal', () => {
  const compact = renderPowerlineBlocks(blocks, 0, 1, 'flat', true, 'flat', 'wedge', 'wedge');
  assert.ok(compact.includes(`${RESET}${bg(fadeA)}${fg(PURPLE)}${powerlineShapeGlyphs('wedge').close}${RESET}${bg(fadeA)}${fg(GREEN)}`), 'caps sit on darker-A');
  const wedge = powerlineShapeGlyphs('wedge');
  const normal = renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'wedge', 'wedge');
  assert.ok(normal.includes(`${RESET}${bg(fadeA)}${fg(PURPLE)}${wedge.close}${RESET}${bg(fadeA)} ${RESET}${bg(fadeA)}${fg(GREEN)}${wedge.open}`),
    'Normal: darkA region, then one darkA/B bridge');
  const wide = renderPowerlineBlocks(blocks, 2, 1, 'flat', true, 'flat', 'wedge', 'wedge');
  assert.ok(wide.includes(`${RESET}${bg(fadeA)} ${RESET}\u001B[49m${fg(fadeA)}${wedge.close}${RESET}\u001B[49m${fg(GREEN)}${wedge.open}`),
    'Wide: darkA cut into terminal background, then terminal/B');
  const flatCompact = renderPowerlineBlocks(blocks, 0, 1, 'flat', true, 'flat', 'flat', 'flat');
  assert.equal(displayWidth(flatCompact), displayWidth(renderPowerlineBlocks(blocks, 0, 1, 'flat', true, 'flat', 'flat')),
    'Flat + Compact has zero cells to color and adds none');
  assert.ok(!flatCompact.includes(bg(fadeA)), 'Flat + Compact shows no fade');
  assert.ok(!renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'flat', 'flat').includes(bg(fadeA)), 'Flat never colors the gap');
  assert.ok(!renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'wedge', 'wedge').includes('\u001B[49m '), 'Normal has no terminal-background hole');
});

test('Start/End fades are unchanged, output ends neutral, and safe mode stays ASCII', () => {
  const end = renderPowerlineBlocks(blocks, 1, 0, 'fadeWedge', true, 'fadeWedge', 'wedge', 'wedge');
  assert.equal([...stripAnsi(end)].filter(character => character === '').length, 8, 'three-step start and end plus one connector');
  assert.ok(end.endsWith('\u001B[0m\u001B[49m'));
  setIconStyle('safe');
  try {
    for (const shape of POWERLINE_SHAPES) {
      const rendered = stripAnsi(renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'wedge', shape));
      assert.ok([...rendered].every(character => character.codePointAt(0)! < 0x80), `${shape}: ${rendered}`);
    }
  } finally {
    setIconStyle('nerd');
  }
});

const dirty = {...clean, staged: 1, modified: 1};
const line = (patch: (value: PromptConfiguration) => void, git = dirty) => stripAnsi(buildContextLine(
  {cwd: '/r', project: 'r', branch: 'main', git}, 160,
  config(value => { value.modules = value.modules.map(module => ({...module, visible: module.id === 'project' || module.id === 'gitBranch'})); patch(value); }),
  'composer'));

test('Rich Git Enabled defaults On; Off keeps the plain branch and hides every state', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.gitEnabled, true);
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'cool'}}).nmsh.gitEnabled, true);
  assert.equal(normalizePromptConfiguration({nmsh: {gitEnabled: false}}).nmsh.gitEnabled, false);
  const off = config(value => { value.nmsh.gitEnabled = false; });
  for (const entry of RICH_GIT_SHOWCASE) {
    const roles = renderedModules({cwd: '/r', project: 'r', branch: 'main', git: entry.git}, off).map(module => module.role);
    assert.ok(roles.includes('gitBranch'), entry.label);
    assert.ok(!roles.some(role => (GIT_STATE_ROLES as readonly string[]).includes(role)), entry.label);
  }
  assert.ok(!line(value => { value.nmsh.gitEnabled = false; }).includes('main*'), 'no dirty mark either');
  assert.match(line(() => {}), /\+1.*~1/u, 'On restores state');
  const theme = stripAnsi(buildThemePreviewLine(off, 'lavender', 200));
  assert.ok(!theme.includes('+2') && theme.includes('main'), 'the theme gallery omits Rich Git when it is off');
});

test('Rich Git geometry follows the Main Prompt by default and a fixed shape overrides only Git state', () => {
  for (const connector of POWERLINE_SHAPES) {
    const plain = line(value => { value.nmsh.gapEnabled = false; value.nmsh.connector = connector; });
    const join = powerlineShapeGlyphs(connector).join;
    if (join) assert.ok(plain.includes(`${join} +1 ${join} ~1`), `${connector}: ${plain}`);
  }
  for (const connector of ['wedge', 'flat'] as const) {
    const plain = line(value => { value.nmsh.gapEnabled = false; value.nmsh.connector = connector; value.nmsh.gitGeometry = 'rounded'; });
    assert.ok(plain.includes('main*  +1  ~1'), `${connector}: Git region is rounded: ${plain}`);
    if (connector === 'wedge') assert.ok(plain.includes('r  '), 'project → branch keeps the Main Prompt connector');
  }
  const cleanLine = buildContextLine({cwd: '/r', project: 'r', branch: 'main', git: clean}, 160,
    config(value => { value.nmsh.gapEnabled = false; value.nmsh.gitGeometry = 'slash'; }), 'composer');
  assert.ok(stripAnsi(cleanLine).includes('main  '), 'the clean marker enters with Rich Git geometry');
});

test('Rich Git connector fade: follow main, follow geometry, off, or a fixed shape — only the entry cap changes', () => {
  const branchFade = bg(connectorFadeColor(NATIVE_PROMPT_THEMES.lavender.colors('gitBranch').background));
  const gap = (gitConnectorFade: PromptConfiguration['nmsh']['gitConnectorFade'], patch: (value: PromptConfiguration) => void = () => {}) => {
    const value = config(draft => {
      draft.modules = draft.modules.map(module => ({...module, visible: module.id === 'project' || module.id === 'gitBranch'}));
      draft.nmsh.gitGeometry = 'rounded'; draft.nmsh.gitConnectorFade = gitConnectorFade; patch(draft);
    });
    return buildContextLine({cwd: '/r', project: 'r', branch: 'main', git: dirty}, 160, value, 'composer');
  };
  assert.ok(stripAnsi(gap('followMain')).includes('  +1'), 'Follow connector on the Main Prompt means Rich Git geometry');
  assert.ok(gap('followMain').includes(branchFade));
  assert.ok(stripAnsi(gap('followMain', value => { value.nmsh.connectorFade = 'slash'; })).includes('  +1'),
    'inherits a fixed Main fade for the entry cap; the exit stays Rounded');
  assert.ok(!gap('followMain', value => { value.nmsh.connectorFade = 'off'; }).includes(branchFade), 'inherits Main Off');
  assert.ok(gap('followGeometry', value => { value.nmsh.connectorFade = 'off'; }).includes(branchFade));
  assert.ok(!gap('off').includes(branchFade));
  assert.ok(stripAnsi(gap('backslash')).includes('  +1'), 'a fixed Rich Git fade changes only the entry');
  assert.equal(normalizePromptConfiguration({}).nmsh.gitConnectorFade, 'followMain');
  assert.equal(normalizePromptConfiguration({}).nmsh.gitGeometry, 'follow');
});

function appearanceState(): PromptPanelState {
  const saved = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  return {onboarding: false, step: 'appearance', selectedIndex: 0, draft: structuredClone(saved), saved};
}
const press = (state: PromptPanelState, kind: Key['kind'], value?: string) =>
  handlePromptPanelKey((value ? {kind, value} : {kind}) as Key, state);

test('/prompt Main Prompt and Rich Git views: arrows switch views and edit every Rich Git row', () => {
  const state = appearanceState();
  const bar = renderPromptPanel(state, 120, []).find(row => stripAnsi(row).includes('Main Prompt') && stripAnsi(row).includes('Rich Git'))!;
  assert.match(bar, /\u001B\[48;2;[\d;]+m\u001B\[38;2;[\d;]+m Main Prompt /u, 'the active view is a filled block');
  press(state, 'right');
  assert.equal(state.draft.nmsh.palette, 'brand', '←/→ on a row still edit it');
  press(state, 'left');
  press(state, 'up');
  press(state, 'right');
  assert.equal(state.view, 'git');
  press(state, 'complete');
  assert.equal(state.view, 'git', 'Tab does not switch views');
  press(state, 'down');
  press(state, 'text', ' ');
  assert.equal(state.draft.nmsh.gitEnabled, false, 'Space toggles Enabled');
  press(state, 'right');
  assert.equal(state.draft.nmsh.gitEnabled, true);
  press(state, 'down'); press(state, 'right');
  assert.equal(state.draft.nmsh.gitColors, 'followTheme');
  press(state, 'down'); press(state, 'right');
  assert.equal(state.draft.nmsh.gitGeometry, 'wedge');
  press(state, 'down'); press(state, 'right');
  assert.equal(state.draft.nmsh.gitConnectorFade, 'followGeometry');
  assert.ok(!onModulesRow(state));
  const rows = renderPromptPanel(state, 140, [], ['theme row'], Infinity, RICH_GIT_SHOWCASE.map(() => 'sample')).map(stripAnsi);
  for (const pattern of [/Enabled\s+‹ On ›/u, /Colors\s+‹ Follow theme ›/u, /Geometry\s+‹ Wedge ›/u, /Connector fade\s+‹ Follow Rich Git geometry ›/u]) {
    assert.ok(rows.some(row => pattern.test(row)), String(pattern));
  }
  assert.ok(!rows.some(row => row.includes('theme row')), 'the theme gallery stays in Main Prompt');
  state.draft.nmsh.gitEnabled = false;
  const off = renderPromptPanel(state, 140, [], [], Infinity, RICH_GIT_SHOWCASE.map(() => 'sample')).map(stripAnsi);
  assert.ok(off.some(row => row.includes('Rich Git is off')), 'a disabled showcase says so');
});

test('the Rich Git showcase covers every state from synthetic data and reacts to each setting', () => {
  const theme = stripAnsi(buildThemePreviewLine(config(), 'lavender', 200));
  for (const marker of ['+2', '~1', '?3', '↑2']) assert.ok(theme.includes(marker), `${marker} in ${theme}`);
  const roles = new Set(RICH_GIT_SHOWCASE.flatMap(entry => renderedModules({cwd: '/', project: 'p', branch: 'main', git: entry.git}, config())
    .map(module => module.role)));
  for (const role of GIT_STATE_ROLES) assert.ok(roles.has(role), `showcase covers ${role}`);
  const sample = (patch: (value: PromptConfiguration) => void = () => {}) => buildRichGitShowcaseLine(config(patch), RICH_GIT_SHOWCASE[1]!.git, 60);
  const base = sample();
  assert.ok(displayWidth(base) <= 60);
  for (const [name, patch] of [
    ['Enabled', (value: PromptConfiguration) => { value.nmsh.gitEnabled = false; }],
    ['Colors', (value: PromptConfiguration) => { value.nmsh.gitColors = 'grayscale'; }],
    ['Geometry', (value: PromptConfiguration) => { value.nmsh.gitGeometry = 'slash'; }],
    ['Connector fade', (value: PromptConfiguration) => { value.nmsh.gitConnectorFade = 'off'; }],
    ['Main gap', (value: PromptConfiguration) => { value.nmsh.gapEnabled = false; }],
  ] as const) assert.notEqual(sample(patch), base, `${name} changes the showcase`);
});

test('snapshots keep every Rich Git setting and resolved geometry; later changes and old snapshots render as captured', () => {
  const draft = config(value => {
    value.nmsh.gitColors = 'grayscale'; value.nmsh.gitGeometry = 'slash'; value.nmsh.gitConnectorFade = 'off';
  });
  const snapshot = nativePromptSnapshot({cwd: '/r', project: 'r', branch: 'main', git: {...clean, staged: 1}}, draft);
  assert.deepEqual([snapshot.gitEnabled, snapshot.gitColors, snapshot.gitGeometry, snapshot.gitConnectorFade, snapshot.connectorFade],
    [true, 'grayscale', 'slash', 'off', 'follow']);
  const staged = snapshot.segments.find(segment => segment.role === 'gitStaged')!;
  assert.deepEqual([staged.shape, staged.fade], ['slash', 'off']);
  const frozen = JSON.stringify(snapshot);
  draft.nmsh.gitGeometry = 'rounded';
  draft.nmsh.connectorFade = 'off';
  assert.equal(JSON.stringify(snapshot), frozen);
  const appearance = {...DEFAULT_PROMPT_CONFIGURATION.transcript, divider: false};
  const row = renderHistoricalContext({cwd: '/r', prompt: snapshot}, 100, appearance)!.plain;
  assert.ok(row.includes('\uE0BC \uE0BA +1'), `history keeps the captured Rich Git geometry and fade Off: ${row}`);
  const history = renderHistoricalContext({cwd: '/r', prompt: snapshot}, 100, appearance)!.ansi;
  assert.match(history, /\u001B\[0m\u001B\[48;2;([\d;]+)m\u001B\[38;2;[\d;]+m\uE0B0\u001B\[0m\u001B\[48;2;\1m \u001B\[0m\u001B\[48;2;\1m\u001B\[38;2;[\d;]+m[\uE000-\uF8FF]/u,
    'history keeps the captured Main Prompt fade: Normal darkA region then one bridge');
  const legacy = {...snapshot, connectorFade: undefined, gitColors: undefined, gitGeometry: undefined, gitConnectorFade: undefined,
    segments: [...snapshot.segments.filter(segment => !segment.role?.startsWith('gitS')).map(({shape, fade, ...segment}) => segment),
      {text: '+1 ~2', role: 'gitChanges', geometry: 'powerline' as const}]};
  const old = renderHistoricalContext({cwd: '/r', prompt: legacy}, 100, {...appearance, historyColors: 'theme'})!;
  assert.ok(old.plain.includes('+1 ~2'), 'old snapshots keep legacy roles');
  assert.ok(/\uE0B0\u001B\[0m\u001B\[49m \u001B\[0m\u001B\[49m/u.test(old.ansi), 'old snapshots keep neutral gaps');
});
