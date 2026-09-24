import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildContextLine, buildRichGitShowcaseLine, nativePromptSnapshot, RICH_GIT_SHOWCASE} from '../src/prompt/prompt.js';
import {applyNativeGapChoice, DEFAULT_PROMPT_CONFIGURATION, loadPromptConfiguration, nativeGapChoice, normalizePromptConfiguration, savePromptConfiguration,
  type PromptConfiguration} from '../src/prompt/configuration.js';
import {connectorFadeColor, CONNECTOR_FADE_COLORS, POWERLINE_SHAPES, renderPowerlineBlocks, type ConnectorFadeColors,
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
/** Normal/Wide: both caps cut their color into terminal background; Wide adds one blank cell. */
const notch = (closeColor: typeof WHITE, openColor: typeof WHITE, wide: boolean) =>
  `${RESET}${NEUTRAL}${fg(closeColor)}${WEDGE.close}${wide ? `${RESET}${NEUTRAL} ` : ''}${RESET}${NEUTRAL}${fg(openColor)}${SLASH.open}`;
const COMPACT = 0;
const NORMAL = 1;
const WIDE = 2;

test('Previous: Compact carries darker-A across both caps; Normal/Wide are darker-A / terminal, terminal / B', () => {
  assert.ok(render('previous', COMPACT).includes(transition(fadeA, 0, fadeA)));
  assert.ok(render('previous', NORMAL).includes(notch(FADE_A, GREEN, false)));
  assert.ok(render('previous', WIDE).includes(notch(FADE_A, GREEN, true)));
  const otherB = render('previous', NORMAL, [block('A', PURPLE), block('B', ORANGE)]);
  assert.ok(otherB.includes(`${RESET}${NEUTRAL}${fg(FADE_A)}${WEDGE.close}`), 'B never changes darker-A');
  for (const gap of [COMPACT, NORMAL, WIDE]) {
    assert.ok(!render('previous', gap).includes(fadeB) && !render('previous', gap).includes(fg(FADE_B)));
  }
});

test('Next: Compact carries darker-B across both caps; Normal/Wide are A / terminal, terminal / darker-B', () => {
  assert.ok(render('next', COMPACT).includes(transition(fadeB, 0, fadeB)));
  assert.ok(render('next', NORMAL).includes(notch(PURPLE, FADE_B, false)));
  assert.ok(render('next', WIDE).includes(notch(PURPLE, FADE_B, true)));
  const otherA = render('next', NORMAL, [block('A', ORANGE), block('B', GREEN)]);
  assert.ok(otherA.includes(`${RESET}${NEUTRAL}${fg(FADE_B)}${SLASH.open}`), 'A never changes darker-B');
  for (const gap of [COMPACT, NORMAL, WIDE]) {
    assert.ok(!render('next', gap).includes(fadeA) && !render('next', gap).includes(fg(FADE_A)));
  }
});

test('Mixed: Compact touches darker-A to darker-B; Normal notches both into terminal; Wide adds one blank cell', () => {
  const compact = render('mixed', COMPACT);
  assert.ok(compact.includes(transition(fadeA, 0, fadeB)), 'Compact reuses the two cap cells');
  assert.ok(!compact.includes(`${NEUTRAL} `), 'Compact exposes no terminal-background cell');
  const normal = render('mixed', NORMAL);
  assert.ok(normal.includes(notch(FADE_A, FADE_B, false)), 'Normal caps sit on terminal background');
  assert.ok(!normal.includes(`${NEUTRAL} ${RESET}${NEUTRAL}${fg(FADE_B)}`), 'Normal has no blank spacer');
  assert.ok(!normal.includes(fadeA) && !normal.includes(fadeB), 'Normal paints no faded background');
  assert.ok(render('mixed', WIDE).includes(notch(FADE_A, FADE_B, true)), 'Wide is the Normal notch plus one terminal cell');
  assert.equal(NEUTRAL, '\u001B[49m', 'terminal background is the default, not a computed color');
});

test('Fade colors and Gap never change geometry; width is Compact = Normal, Wide = Normal + 1', () => {
  for (const connector of POWERLINE_SHAPES) {
    for (const fade of POWERLINE_SHAPES) {
      const glyphs = (gap: number) => stripAnsi(renderPowerlineBlocks(blocks, gap, 1, 'flat', true, 'flat', connector, fade)).replaceAll(' ', '');
      for (const gap of [COMPACT, NORMAL, WIDE]) {
        const outputs = CONNECTOR_FADE_COLORS.map(mode => renderPowerlineBlocks(blocks, gap, 1, 'flat', true, 'flat', connector, fade, mode));
        for (const output of outputs) {
          assert.equal(stripAnsi(output), stripAnsi(outputs[0]!), `${connector}/${fade}/${gap}: same glyphs`);
          assert.equal(displayWidth(output), displayWidth(outputs[0]!), `${connector}/${fade}/${gap}: no added width`);
        }
        assert.equal(glyphs(gap), glyphs(COMPACT), `${connector}/${fade}/${gap}: Gap never changes geometry`);
      }
      const width = (gap: number) => displayWidth(renderPowerlineBlocks(blocks, gap, 1, 'flat', true, 'flat', connector, fade));
      const caps = Boolean(powerlineShapeGlyphs(connector).close || powerlineShapeGlyphs(fade).open);
      assert.equal(width(NORMAL), width(COMPACT) + (caps ? 0 : 1), `${connector}/${fade}: Normal adds no spacer beside real caps`);
      assert.equal(width(WIDE), width(NORMAL) + 1, `${connector}/${fade}: Wide is Normal plus exactly one cell`);
      assert.equal(width(3), width(WIDE), `${connector}/${fade}: legacy wider gaps render as Wide`);
    }
  }
  assert.ok(stripAnsi(render('mixed', NORMAL)).includes(`A ${WEDGE.close}${SLASH.open} B`), 'Wedge exits, Slant / enters');
  const rounded = stripAnsi(renderPowerlineBlocks(blocks, WIDE, 1, 'flat', true, 'flat', 'rounded', 'wedge', 'mixed'));
  assert.ok(rounded.includes(`A ${powerlineShapeGlyphs('rounded').close} ${WEDGE.open} B`), 'Rounded exits, Wedge enters');
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
  assert.equal(displayWidth(oneCap), displayWidth(plain) + 1, 'a single real cap is the notch; no spacer is invented');
  assert.ok(oneCap.includes(`${RESET}${NEUTRAL}${fg(FADE_B)}${SLASH.open}`));
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
    value.nmsh.connectorFadeColors = mode;
    return value;
  };
  const context = {cwd: '/r', project: 'r', branch: 'main', git: {staged: 1, modified: 2, untracked: 0, conflicts: 0, ahead: 0, behind: 0}};
  const lines = CONNECTOR_FADE_COLORS.map(mode => buildContextLine(context, 120, config(mode)));
  assert.equal(new Set(lines).size, 3, 'each mode changes the live prompt');
  assert.equal(new Set(lines.map(stripAnsi)).size, 1, 'only colors change');
  const showcase = CONNECTOR_FADE_COLORS.map(mode => buildRichGitShowcaseLine(config(mode), RICH_GIT_SHOWCASE[1]!.git, 60));
  assert.equal(new Set(showcase).size, 3, 'the Rich Git showcase follows Fade colors');
});

test('snapshots record Fade colors; history keeps it after config changes; old snapshots render as Previous', () => {
  const draft = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
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
