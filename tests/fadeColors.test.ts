import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildContextLine, buildRichGitShowcaseLine, nativePromptSnapshot, RICH_GIT_SHOWCASE} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, loadPromptConfiguration, normalizePromptConfiguration, savePromptConfiguration,
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

test('Previous: Compact carries darker-A across both caps; Normal is darker-A then terminal background', () => {
  assert.ok(render('previous', 0).includes(transition(fadeA, 0, fadeA)));
  assert.ok(render('previous', 1).includes(transition(fadeA, 1, NEUTRAL)));
  const otherB = render('previous', 1, [block('A', PURPLE), block('B', ORANGE)]);
  assert.ok(otherB.includes(`${RESET}${fadeA}${fg(PURPLE)}${WEDGE.close}`), 'B never changes darker-A');
  assert.ok(!render('previous', 0).includes(fadeB) && !render('previous', 1).includes(fadeB));
});

test('Next: Compact carries darker-B across both caps; Normal is terminal background then darker-B', () => {
  assert.ok(render('next', 0).includes(transition(fadeB, 0, fadeB)));
  assert.ok(render('next', 1).includes(transition(NEUTRAL, 1, fadeB)));
  const otherA = render('next', 1, [block('A', ORANGE), block('B', GREEN)]);
  assert.ok(otherA.includes(`${RESET}${fadeB}${fg(GREEN)}${SLASH.open}`), 'A never changes darker-B');
  assert.ok(!render('next', 0).includes(fadeA) && !render('next', 1).includes(fadeA));
});

test('Mixed: darker-A on the exit, darker-B on the entry, terminal background between in Normal', () => {
  assert.ok(render('mixed', 0).includes(transition(fadeA, 0, fadeB)), 'Compact reuses the two cap cells');
  for (const gap of [1, 2, 3]) assert.ok(render('mixed', gap).includes(transition(fadeA, gap, fadeB)), `gap ${gap} stays neutral`);
});

test('Fade colors never change geometry or width, and never fill the gap', () => {
  for (const connector of POWERLINE_SHAPES) {
    for (const fade of POWERLINE_SHAPES) {
      for (const gap of [0, 1, 2, 3]) {
        const outputs = CONNECTOR_FADE_COLORS.map(mode => renderPowerlineBlocks(blocks, gap, 1, 'flat', true, 'flat', connector, fade, mode));
        for (const output of outputs) {
          assert.equal(stripAnsi(output), stripAnsi(outputs[0]!), `${connector}/${fade}/${gap}: same glyphs`);
          assert.equal(displayWidth(output), displayWidth(outputs[0]!), `${connector}/${fade}/${gap}: no added width`);
          if (gap) assert.ok(output.includes(`${RESET}${NEUTRAL}${' '.repeat(gap)}`), `${connector}/${fade}/${gap}: gap is terminal background`);
        }
      }
    }
  }
  assert.ok(stripAnsi(render('mixed', 1)).includes(`A ${WEDGE.close} ${SLASH.open} B`), 'Wedge exits, Slant / enters');
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
