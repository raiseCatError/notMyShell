import test from 'node:test';
import assert from 'node:assert/strict';
import {fitPowerlineBlocks, PROMPT_STYLES, renderPowerlineBlocks, type PowerlineBlock, type PromptStyle} from '../src/prompt/powerline.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {buildContextLine, nativePromptSnapshot, themePreviewContext} from '../src/prompt/prompt.js';
import {renderHistoricalContext} from '../src/output/OutputBuffer.js';
import {powerlineShapeGlyphs, setIconStyle} from '../src/ui/glyphs.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const blocks = (style: PromptStyle): PowerlineBlock[] => [
  {style, text: 'notMyShell', foreground: {red: 240, green: 240, blue: 240}, background: {red: 120, green: 90, blue: 200}},
  {style, text: '~/src', foreground: {red: 240, green: 240, blue: 240}, background: {red: 70, green: 65, blue: 98}},
  {style, text: '', compact: true, foreground: {red: 240, green: 240, blue: 240}, background: {red: 90, green: 160, blue: 110}},
];
const withStyle = (style: PromptStyle): PromptConfiguration =>
  ({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), nmsh: {...DEFAULT_PROMPT_CONFIGURATION.nmsh, style}});
const PRIVATE_USE = /[-]/u;

test('every style renders every segment; Minimal and Outline draw no filled blocks', () => {
  for (const style of PROMPT_STYLES) {
    const plain = stripAnsi(renderPowerlineBlocks(blocks(style), 1, 1, 'fadeWedge'));
    assert.match(plain, /notMyShell/u, style);
    assert.match(plain, /~\/src/u, style);
  }
  for (const style of ['minimal', 'outline'] as const) {
    assert.doesNotMatch(renderPowerlineBlocks(blocks(style), 1, 1), /\u001B\[48;/u, `${style} has no background fill`);
  }
  assert.match(renderPowerlineBlocks(blocks('outline'), 1, 1), / notMyShell /u);
  const soft = stripAnsi(renderPowerlineBlocks(blocks('soft'), 0, 1, 'wedge', false, 'wedge', 'wedge'));
  const rounded = powerlineShapeGlyphs('rounded');
  assert.ok(soft.includes(rounded.open) && soft.includes(rounded.close), 'Soft uses rounded caps');
  assert.match(soft, /notMyShell \S +\S/u, 'Soft keeps segments separated even when the gap is off');
});

test('Safe glyph mode: no private-use glyphs in any style', () => {
  setIconStyle('safe');
  try {
    for (const style of PROMPT_STYLES) {
      assert.doesNotMatch(renderPowerlineBlocks(blocks(style), 1, 1, 'fadeWedge'), PRIVATE_USE, style);
    }
    assert.match(stripAnsi(renderPowerlineBlocks(blocks('outline'), 1, 1)), /^\( notMyShell \) \( ~\/src \) \( \* \)$/u);
  } finally {
    setIconStyle('nerd');
  }
});

test('narrow widths and left/right placement stay within the row for every style', () => {
  for (const style of PROMPT_STYLES) {
    for (const width of [4, 12, 20, 40]) {
      assert.ok(displayWidth(fitPowerlineBlocks(blocks(style), 1, 1, width, 'fadeWedge')) <= width, `${style} @${width}`);
    }
    const config = withStyle(style);
    config.modules = config.modules.map(module => module.id === 'gitBranch' ? {...module, placement: 'right' as const} : module);
    for (const placement of ['header', 'composer'] as const) {
      for (const width of [30, 80]) {
        assert.ok(displayWidth(buildContextLine(themePreviewContext(), width, config, placement)) <= width, `${style} ${placement} @${width}`);
      }
    }
  }
});

test('history snapshots record the style and replay it muted', () => {
  const snapshot = nativePromptSnapshot(themePreviewContext(), withStyle('minimal'));
  assert.equal(snapshot.style, 'minimal');
  assert.equal(nativePromptSnapshot(themePreviewContext(), withStyle('powerline')).style, undefined, 'Powerline snapshots are unchanged');
  const header = renderHistoricalContext({cwd: '/tmp', prompt: snapshot}, 100)!;
  assert.doesNotMatch(header.ansi.split('─')[0]!, /\u001B\[48;2;/u, 'archived Minimal prompt has no filled blocks');
  assert.ok(displayWidth(header.plain) <= 100);
});

test('style persists under nmsh.style (default Powerline) and is editable in /settings', () => {
  assert.equal(normalizePromptConfiguration({}).nmsh.style, 'powerline');
  assert.equal(normalizePromptConfiguration({nmsh: {style: 'outline'}}).nmsh.style, 'outline');
  assert.equal(normalizePromptConfiguration({nmsh: {style: 'glass'}}).nmsh.style, 'powerline');
  const row = SETTINGS_ROWS.find(candidate => candidate.id === 'promptStyle')!;
  assert.ok(row.control === 'enum');
  assert.deepEqual(row.options, ['Powerline', 'Soft', 'Minimal', 'Outline', 'Breadcrumb', 'Compact', 'Ribbon']);
});
