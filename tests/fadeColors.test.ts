import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildContextLine, buildRichGitShowcaseLine, nativePromptSnapshot, RICH_GIT_SHOWCASE} from '../src/prompt/prompt.js';
import {applyNativeGapChoice, DEFAULT_PROMPT_CONFIGURATION, loadPromptConfiguration, nativeGapChoice, normalizePromptConfiguration, savePromptConfiguration,
  type PromptConfiguration} from '../src/prompt/configuration.js';
import {connectorFadeColor, CONNECTOR_FADE_COLORS, fadeColorChoices, POWERLINE_SHAPES, renderPowerlineBlocks, type ConnectorFadeColors,
  type PowerlineBlock} from '../src/prompt/powerline.js';
import {renderHistoricalContext} from '../src/output/OutputBuffer.js';
import {powerlineShapeGlyphs} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const WHITE = {red: 240, green: 240, blue: 240};
const PURPLE = {red: 100, green: 60, blue: 180};
const GREEN = {red: 40, green: 120, blue: 80};
const ORANGE = {red: 200, green: 120, blue: 30};
const block = (text: string, background: typeof WHITE): PowerlineBlock => ({text, foreground: WHITE, background});
const blocks = [block('A', PURPLE), block('B', GREEN)];
const RESET = '\u001B[0m';
const NEUTRAL = '\u001B[49m';
const fg = (color: typeof WHITE) => `\u001B[38;2;${color.red};${color.green};${color.blue}m`;
const bg = (color: typeof WHITE) => `\u001B[48;2;${color.red};${color.green};${color.blue}m`;
const fadeA = bg(connectorFadeColor(PURPLE));
const fadeB = bg(connectorFadeColor(GREEN));
const WEDGE = powerlineShapeGlyphs('wedge');
const SLASH = powerlineShapeGlyphs('slash');

/** Wedge exit, Slant / entry: the geometry every color mode must keep. */
const render = (colors: ConnectorFadeColors, gap: number, input = blocks) =>
  renderPowerlineBlocks(input, gap, 1, 'flat', true, 'flat', 'wedge', 'slash', colors);
/** The transition between A and B: close cell, gap, open cell. */
const transition = (close: string, gap: number, open: string) =>
  `${RESET}${close}${fg(PURPLE)}${WEDGE.close}${gap ? `${RESET}${NEUTRAL}${' '.repeat(gap)}` : ''}${RESET}${open}${fg(GREEN)}${SLASH.open}`;

test('Fade colors defaults to Previous, persists every mode, and old configs normalize without onboarding', async () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.nmsh.connectorFadeColors, 'previous');
  const legacy = normalizePromptConfiguration({onboardingComplete: true, nmsh: {connector: 'rounded', connectorFade: 'slash', palette: 'warm'}});
  assert.equal(legacy.nmsh.connectorFadeColors, 'previous');
  assert.deepEqual([legacy.onboardingComplete, legacy.nmsh.connector, legacy.nmsh.connectorFade, legacy.nmsh.palette],
    [true, 'rounded', 'slash', 'warm']);
  assert.equal(normalizePromptConfiguration({nmsh: {connectorFadeColors: 'rainbow'}}).nmsh.connectorFadeColors, 'previous');
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-fade-colors-'));
  try {
    for (const mode of CONNECTOR_FADE_COLORS) {
      const path = join(directory, `${mode}.json`);
      const value: PromptConfiguration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
      value.nmsh.connectorFadeColors = mode;
      savePromptConfiguration(value, path);
      assert.equal(loadPromptConfiguration(path).nmsh.connectorFadeColors, mode, `${mode} persists`);
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

const FADE_A = connectorFadeColor(PURPLE);
const FADE_B = connectorFadeColor(GREEN);
type Zone = typeof WHITE | undefined;
const zone = (color: Zone) => color ? bg(color) : NEUTRAL;
/** Wedge exit cell: close glyph painted in `from` over `to`. */
const exit = (from: typeof WHITE, to: Zone) => `${RESET}${zone(to)}${fg(from)}${WEDGE.close}`;
/** Slant / entry cell: open glyph painted in `to` over `from`. */
const entry = (from: Zone, to: typeof WHITE) => `${RESET}${zone(from)}${fg(to)}${SLASH.open}`;
const solid = (color: typeof WHITE) => `${RESET}${bg(color)} `;
const COMPACT = 0;
const NORMAL = 1;
const WIDE = 2;
const between = (output: string) => output.slice(output.indexOf(' A ') + 3, output.indexOf(' B '));

test('Compact: Previous and Next are one-sided; Mixed resolves to Previous', () => {
  assert.ok(render('previous', COMPACT).includes(transition(fadeA, 0, fadeA)));
  assert.ok(render('next', COMPACT).includes(transition(fadeB, 0, fadeB)));
  assert.equal(render('mixed', COMPACT), render('previous', COMPACT), 'Mixed never renders in Compact');
  assert.ok(!render('next', COMPACT).includes(fadeA) && !render('previous', COMPACT).includes(fadeB));
});

test('Normal: one bridge cell between the fade regions, no terminal-background hole', () => {
  const previous = render('previous', NORMAL);
  assert.ok(previous.includes(exit(PURPLE, FADE_A) + solid(FADE_A) + entry(FADE_A, GREEN)), 'A | darkA | darkA/B | B');
  const next = render('next', NORMAL);
  assert.ok(next.includes(exit(PURPLE, FADE_B) + solid(FADE_B) + entry(FADE_B, GREEN)), 'A | A/darkB | darkB | B');
  const mixed = render('mixed', NORMAL);
  assert.ok(mixed.includes(exit(PURPLE, FADE_A) + entry(FADE_A, FADE_B) + entry(FADE_B, GREEN)), 'A | darkA | darkA/darkB | darkB | B');
  for (const output of [previous, next, mixed]) assert.ok(!between(output).includes(NEUTRAL), 'Normal exposes no terminal background');
  assert.ok(!previous.includes(fg(FADE_B)) && !previous.includes(fadeB), 'Previous never computes darkB');
  assert.ok(!next.includes(fg(FADE_A)) && !next.includes(fadeA), 'Next never computes darkA');
  const otherB = render('previous', NORMAL, [block('A', PURPLE), block('B', ORANGE)]);
  assert.ok(otherB.includes(exit(PURPLE, FADE_A)), 'B never changes darkA');
});

test('Wide: the center becomes two cells through the actual terminal background', () => {
  assert.ok(render('previous', WIDE).includes(exit(PURPLE, FADE_A) + solid(FADE_A) + exit(FADE_A, undefined) + entry(undefined, GREEN)));
  assert.ok(render('next', WIDE).includes(exit(PURPLE, undefined) + entry(undefined, FADE_B) + solid(FADE_B) + entry(FADE_B, GREEN)));
  assert.ok(render('mixed', WIDE).includes(exit(PURPLE, FADE_A) + exit(FADE_A, undefined) + entry(undefined, FADE_B) + entry(FADE_B, GREEN)));
  assert.ok(!render('previous', WIDE).includes(fadeB) && !render('next', WIDE).includes(fadeA));
  assert.equal(NEUTRAL, '\u001B[49m', 'terminal background is the default, not a computed color');
});

test('Width: Compact < Normal = Compact + 1 < Wide = Normal + 1 for shaped caps; geometry stays independent', () => {
  for (const connector of POWERLINE_SHAPES) {
    for (const fade of POWERLINE_SHAPES) {
      if (connector === 'flat' || fade === 'flat') continue;
      const width = (gap: number, mode: ConnectorFadeColors) =>
        displayWidth(renderPowerlineBlocks(blocks, gap, 1, 'flat', true, 'flat', connector, fade, mode));
      for (const mode of CONNECTOR_FADE_COLORS) {
        assert.equal(width(NORMAL, mode), width(COMPACT, mode) + 1, `${connector}/${fade}/${mode}: Normal is Compact + 1`);
        assert.equal(width(WIDE, mode), width(NORMAL, mode) + 1, `${connector}/${fade}/${mode}: Wide is Normal + 1`);
        assert.equal(width(3, mode), width(WIDE, mode), 'legacy wider gaps render as Wide');
        const off = displayWidth(renderPowerlineBlocks(blocks, NORMAL, 1, 'flat', true, 'flat', connector));
        assert.equal(width(NORMAL, mode), off, 'Normal matches the unfaded Normal gap width');
      }
    }
  }
  const mixed = stripAnsi(render('mixed', NORMAL));
  assert.ok(mixed.includes(`A ${WEDGE.close}${SLASH.open}${SLASH.open} B`), 'Wedge exits, Slant / enters; the bridge sits between');
  const rounded = stripAnsi(renderPowerlineBlocks(blocks, WIDE, 1, 'flat', true, 'flat', 'rounded', 'wedge', 'mixed'));
  const ROUNDED = powerlineShapeGlyphs('rounded');
  assert.ok(rounded.includes(`A ${ROUNDED.close}${ROUNDED.close}${WEDGE.open}${WEDGE.open} B`), 'Rounded exits, Wedge enters');
});

test('Flat + Flat fallback: Compact 0, Normal 1, Wide 2 terminal cells, never colored', () => {
  const plain = renderPowerlineBlocks(blocks, 0, 1, 'flat', true, 'flat', 'flat', 'flat');
  for (const mode of CONNECTOR_FADE_COLORS) {
    for (const [gap, cells] of [[COMPACT, 0], [NORMAL, 1], [WIDE, 2]] as const) {
      const output = renderPowerlineBlocks(blocks, gap, 1, 'flat', true, 'flat', 'flat', 'flat', mode);
      assert.equal(displayWidth(output), displayWidth(plain) + cells, `${mode} gap ${gap}`);
      if (cells) assert.ok(output.includes(`${RESET}${NEUTRAL}${' '.repeat(cells)}`));
      assert.ok(!output.includes(fadeA) && !output.includes(fadeB) && !output.includes(fg(FADE_A)) && !output.includes(fg(FADE_B)));
    }
  }
  const oneCap = renderPowerlineBlocks(blocks, NORMAL, 1, 'flat', true, 'flat', 'flat', 'slash', 'mixed');
  assert.ok(oneCap.includes(`${RESET}${fadeA} ${entry(FADE_A, FADE_B)}${entry(FADE_B, GREEN)}`), 'a Flat exit is a plain darkA cell');
});

test('Mixed is valid only with Normal or Wide; Gap changes and config normalization resolve it to Previous', () => {
  assert.deepEqual(fadeColorChoices(true, 0), ['previous', 'next']);
  assert.deepEqual(fadeColorChoices(false, 1), ['previous', 'next']);
  assert.deepEqual(fadeColorChoices(true, 1), ['previous', 'next', 'mixed']);
  assert.deepEqual(fadeColorChoices(true, 2), ['previous', 'next', 'mixed']);
  for (const choice of ['compact', 'off'] as const) {
    const value = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
    value.nmsh.connectorFadeColors = 'mixed';
    applyNativeGapChoice(value, choice);
    assert.equal(value.nmsh.connectorFadeColors, 'previous', `${choice} resolves Mixed`);
  }
  const wide = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  wide.nmsh.connectorFadeColors = 'mixed';
  applyNativeGapChoice(wide, 'wide');
  assert.equal(wide.nmsh.connectorFadeColors, 'mixed', 'Wide keeps Mixed');
  assert.equal(normalizePromptConfiguration({gap: 0, nmsh: {connectorFadeColors: 'mixed'}}).nmsh.connectorFadeColors, 'previous');
  assert.equal(normalizePromptConfiguration({gap: 1, nmsh: {gapEnabled: false, connectorFadeColors: 'mixed'}}).nmsh.connectorFadeColors, 'previous');
  assert.equal(normalizePromptConfiguration({gap: 1, nmsh: {connectorFadeColors: 'mixed'}}).nmsh.connectorFadeColors, 'mixed');
  assert.equal(normalizePromptConfiguration({gap: 0, nmsh: {connectorFadeColors: 'next'}}).nmsh.connectorFadeColors, 'next');
});

test('Gap cycles Off, Compact, Normal, Wide; old gap widths normalize', () => {
  const value = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  for (const [choice, gap] of [['compact', 0], ['normal', 1], ['wide', 2]] as const) {
    applyNativeGapChoice(value, choice);
    assert.deepEqual([value.nmsh.gapEnabled, value.gap, nativeGapChoice(value)], [true, gap, choice]);
  }
  applyNativeGapChoice(value, 'off');
  assert.equal(nativeGapChoice(value), 'off');
  assert.equal(nativeGapChoice(normalizePromptConfiguration({gap: 3, nmsh: {gapEnabled: true}})), 'wide', 'legacy width 3 reads as Wide');
  assert.equal(nativeGapChoice(normalizePromptConfiguration({gap: 1})), 'normal');
  assert.equal(nativeGapChoice(normalizePromptConfiguration({gap: 0})), 'compact');
});

test('Flat + Compact has no cells, so every mode renders identically with no fade and no extra width', () => {
  const outputs = CONNECTOR_FADE_COLORS.map(mode => renderPowerlineBlocks(blocks, 0, 1, 'flat', true, 'flat', 'flat', 'flat', mode));
  for (const output of outputs) {
    assert.equal(output, outputs[0]);
    assert.ok(!output.includes(fadeA) && !output.includes(fadeB));
  }
  assert.equal(displayWidth(outputs[0]!), displayWidth(renderPowerlineBlocks(blocks, 0, 1, 'flat', true, 'flat', 'flat')));
});

test('Fade Off and Gap Off ignore Fade colors', () => {
  for (const mode of CONNECTOR_FADE_COLORS) {
    assert.equal(renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'wedge', undefined, mode),
      renderPowerlineBlocks(blocks, 1, 1, 'flat', true, 'flat', 'wedge'));
    assert.equal(renderPowerlineBlocks(blocks, 0, 1, 'flat', false, 'flat', 'wedge', 'slash', mode),
      renderPowerlineBlocks(blocks, 0, 1, 'flat', false, 'flat', 'wedge'));
  }
});

test('live prompt, Rich Git transitions, and the showcase honor Fade colors', () => {
  const config = (mode: ConnectorFadeColors) => {
    const value = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
    value.nmsh.connectorFade = 'follow';
    value.nmsh.connectorFadeColors = mode;
    return value;
  };
  const context = {cwd: '/r', project: 'r', branch: 'main', git: {staged: 1, modified: 2, untracked: 0, conflicts: 0, ahead: 0, behind: 0}};
  const lines = CONNECTOR_FADE_COLORS.map(mode => buildContextLine(context, 120, config(mode)));
  assert.equal(new Set(lines).size, 3, 'each mode changes the live prompt');
  assert.equal(stripAnsi(lines[0]!), stripAnsi(lines[1]!), 'Previous and Next differ only in color');
  assert.equal(displayWidth(lines[2]!), displayWidth(lines[0]!), 'Mixed swaps the solid cell for a bridge glyph, same width');
  const showcase = CONNECTOR_FADE_COLORS.map(mode => buildRichGitShowcaseLine(config(mode), RICH_GIT_SHOWCASE[1]!.git, 60));
  assert.equal(new Set(showcase).size, 3, 'the Rich Git showcase follows Fade colors');
});

test('snapshots record Fade colors; history keeps it after config changes; old snapshots render as Previous', () => {
  const draft = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  draft.nmsh.connectorFade = 'follow';
  draft.nmsh.connectorFadeColors = 'next';
  const context = {cwd: '/r', project: 'r', branch: 'main'};
  const snapshot = nativePromptSnapshot(context, draft);
  assert.equal(snapshot.connectorFadeColors, 'next');
  const appearance = {...DEFAULT_PROMPT_CONFIGURATION.transcript, divider: false};
  const before = renderHistoricalContext({cwd: '/r', prompt: snapshot}, 100, appearance)!.ansi;
  draft.nmsh.connectorFadeColors = 'mixed';
  assert.equal(renderHistoricalContext({cwd: '/r', prompt: snapshot}, 100, appearance)!.ansi, before);
  const {connectorFadeColors: _, ...legacy} = snapshot;
  const old = renderHistoricalContext({cwd: '/r', prompt: legacy}, 100, appearance)!.ansi;
  assert.equal(old, renderHistoricalContext({cwd: '/r', prompt: {...snapshot, connectorFadeColors: 'previous'}}, 100, appearance)!.ansi);
  assert.notEqual(old, before);
});
