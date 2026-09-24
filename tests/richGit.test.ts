import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextLine, buildRichGitShowcaseLine, buildThemePreviewLine, GIT_SEMANTIC_COLORS, GIT_STATE_ROLES, NATIVE_PROMPT_THEMES,
  nativePromptSnapshot, promptRoleColors, renderedModules, RICH_GIT_SHOWCASE,
} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, NATIVE_PALETTE_IDS, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {POWERLINE_SHAPES, renderPowerlineBlocks, resolveConnectorFade, type PowerlineBlock} from '../src/prompt/powerline.js';
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

const blocks: PowerlineBlock[] = [
  {text: 'A', foreground: {red: 255, green: 255, blue: 255}, background: {red: 100, green: 60, blue: 180}},
  {text: 'B', foreground: {red: 255, green: 255, blue: 255}, background: {red: 40, green: 120, blue: 80}},
  {text: 'C', foreground: {red: 255, green: 255, blue: 255}, background: {red: 200, green: 90, blue: 60}},
];

test('Connector fade follows the connector by default, a fixed override sticks, and Off stays solid', () => {
  for (const shape of POWERLINE_SHAPES) assert.equal(resolveConnectorFade('follow', shape), shape);
  assert.equal(resolveConnectorFade('slash', 'rounded'), 'slash');
  assert.equal(resolveConnectorFade('off', 'wedge'), undefined);
  assert.equal(resolveConnectorFade(undefined, 'wedge'), undefined, 'old snapshots render solid connectors');
  const solid = renderPowerlineBlocks(blocks, 0, 0, 'flat', false, 'flat', 'wedge');
  assert.equal(renderPowerlineBlocks(blocks, 0, 0, 'flat', false, 'flat', 'wedge', resolveConnectorFade('off', 'wedge')), solid);
  const faded = renderPowerlineBlocks(blocks, 0, 0, 'flat', false, 'flat', 'wedge', 'wedge');
  assert.notEqual(faded, solid);
  assert.ok(!faded.includes('48;2;40;120;80m\u{E0B0}') , 'the fade cell background is a blend, not the next segment');
});

test('connector fade is exactly one cell, uses the fade shape, and keeps widths predictable', () => {
  for (const shape of POWERLINE_SHAPES) {
    const solid = renderPowerlineBlocks(blocks, 0, 0, 'flat', false, 'flat', shape);
    const faded = renderPowerlineBlocks(blocks, 0, 0, 'flat', false, 'flat', shape, shape);
    const expected = displayWidth(solid) + (powerlineShapeGlyphs(shape).join ? 0 : 2);
    assert.equal(displayWidth(faded), expected, `${shape}: one cell per connector`);
    const glyph = powerlineShapeGlyphs(shape).join || '▒';
    assert.equal([...stripAnsi(faded)].filter(character => character === glyph).length, 2, `${shape}: one fade cell per join`);
  }
  const override = renderPowerlineBlocks(blocks, 0, 0, 'flat', false, 'flat', 'rounded', 'slash');
  assert.ok(stripAnsi(override).includes('') && !stripAnsi(override).includes(''));
  for (const gap of [0, 1, 2]) {
    assert.equal(renderPowerlineBlocks(blocks, gap, 1, 'wedge', true, 'wedge', 'wedge', 'wedge'),
      renderPowerlineBlocks(blocks, gap, 1, 'wedge', true, 'wedge', 'wedge'), 'gapped caps stay solid');
  }
  const fadeEnd = renderPowerlineBlocks(blocks.slice(0, 1), 0, 0, 'fadeWedge', false, 'flat', 'wedge', 'wedge');
  assert.equal([...stripAnsi(fadeEnd)].filter(character => character === '\uE0B0').length, 4, 'End keeps three fade steps plus its cap');
  assert.equal(fadeEnd, renderPowerlineBlocks(blocks.slice(0, 1), 0, 0, 'fadeWedge', false, 'flat', 'wedge'),
    'connector fade never changes Start/End fades');
});

test('connector fade has an ASCII fallback in safe glyph mode', () => {
  setIconStyle('safe');
  try {
    for (const shape of POWERLINE_SHAPES) {
      const plain = stripAnsi(renderPowerlineBlocks(blocks, 0, 0, 'flat', false, 'flat', shape, shape));
      assert.ok([...plain].every(character => character.codePointAt(0)! < 0x80), `${shape}: ${plain}`);
    }
  } finally {
    setIconStyle('nerd');
  }
});

function appearanceState(): PromptPanelState {
  const saved = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  return {onboarding: false, step: 'appearance', selectedIndex: 0, draft: structuredClone(saved), saved};
}
const press = (state: PromptPanelState, kind: Key['kind']) => handlePromptPanelKey({kind} as Key, state);

test('/prompt has Main Prompt and Rich Git views switched with arrows from the view bar', () => {
  const state = appearanceState();
  const rows = renderPromptPanel(state, 120, []);
  const bar = rows.find(row => stripAnsi(row).includes('Main Prompt') && stripAnsi(row).includes('Rich Git'))!;
  assert.match(bar, /\u001B\[48;2;[\d;]+m\u001B\[38;2;[\d;]+m Main Prompt /u, 'the active view is a filled block');
  press(state, 'right');
  assert.equal(state.draft.nmsh.palette, 'brand', '←/→ on a row still edit it');
  press(state, 'left');
  press(state, 'up');
  assert.equal(state.focus, 'tabs');
  press(state, 'right');
  assert.equal(state.view, 'git');
  assert.equal(state.draft.nmsh.palette, 'lavender', 'switching views edits nothing');
  press(state, 'complete');
  assert.equal(state.view, 'git', 'Tab does not switch views');
  press(state, 'down');
  assert.equal(state.focus, 'rows');
  press(state, 'right');
  assert.equal(state.draft.nmsh.gitColors, 'followTheme');
  assert.ok(!onModulesRow(state));
  const git = renderPromptPanel(state, 120, [], ['theme row'], Infinity, ['showcase row']).map(stripAnsi);
  assert.ok(git.some(row => /Colors\s+‹ Follow theme ›/u.test(row)));
  assert.ok(git.some(row => /Geometry\s+Follow main prompt/u.test(row)));
  assert.ok(!git.some(row => row.includes('theme row')), 'the theme gallery stays in Main Prompt');
});

test('showcases render Rich Git state from synthetic data only', () => {
  const theme = stripAnsi(buildThemePreviewLine(config(), 'lavender', 200));
  for (const marker of ['+2', '~1', '?3', '↑2']) assert.ok(theme.includes(marker), `${marker} in ${theme}`);
  const lines = RICH_GIT_SHOWCASE.map(entry => buildRichGitShowcaseLine(config(), entry.git, 60));
  const roles = new Set(RICH_GIT_SHOWCASE.flatMap(entry => renderedModules({cwd: '/', project: 'p', branch: 'main', git: entry.git}, config())
    .map(module => module.role)));
  for (const role of GIT_STATE_ROLES) assert.ok(roles.has(role), `showcase covers ${role}`);
  for (const line of lines) assert.ok(displayWidth(line) <= 60);
  const semantic = buildRichGitShowcaseLine(config(), RICH_GIT_SHOWCASE[1]!.git, 60);
  const gray = buildRichGitShowcaseLine(config(value => { value.nmsh.gitColors = 'grayscale'; }), RICH_GIT_SHOWCASE[1]!.git, 60);
  assert.notEqual(semantic, gray, 'changing Colors changes the showcase');
});

test('snapshots keep Git color mode and connector fade; later changes and old snapshots render as captured', () => {
  const draft = config(value => { value.nmsh.gitColors = 'grayscale'; value.nmsh.connectorFade = 'slash'; value.nmsh.gapEnabled = false; });
  const snapshot = nativePromptSnapshot({cwd: '/r', project: 'r', branch: 'main', git: clean}, draft);
  assert.equal(snapshot.gitColors, 'grayscale');
  assert.equal(snapshot.connectorFade, 'slash');
  assert.ok(snapshot.segments.some(segment => segment.role === 'gitClean' && segment.compact));
  const frozen = JSON.stringify(snapshot);
  draft.nmsh.gitColors = 'semantic';
  draft.nmsh.connectorFade = 'off';
  assert.equal(JSON.stringify(snapshot), frozen);
  const appearance = {...DEFAULT_PROMPT_CONFIGURATION.transcript, divider: false};
  const withFade = renderHistoricalContext({cwd: '/r', prompt: snapshot}, 80, appearance)!.plain;
  assert.ok(withFade.includes(''), 'history uses the captured fade shape');
  const legacy = {...snapshot, connectorFade: undefined, gitColors: undefined,
    segments: [...snapshot.segments.filter(segment => segment.role !== 'gitClean'), {text: '+1 ~2', role: 'gitChanges', geometry: 'powerline' as const}]};
  const oldRow = renderHistoricalContext({cwd: '/r', prompt: legacy}, 80, {...appearance, historyColors: 'theme'})!;
  assert.ok(oldRow.plain.includes('+1 ~2') && !oldRow.plain.includes(''), 'old snapshots keep solid connectors and legacy roles');
});
