import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_PROMPT_THEMES, buildThemePreviewLine, renderedModules, themePreviewContext} from '../src/prompt/prompt.js';
import {NEUTRAL_PROMPT_DARK, NEUTRAL_PROMPT_LIGHT, neutralPromptText} from '../src/prompt/powerline.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {appearanceRows} from '../src/prompt/PromptPanel.js';

const configure = (palette: string, textColors: 'neutral' | 'theme', extra: Partial<PromptConfiguration['nmsh']> = {}): PromptConfiguration => {
  const configuration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  configuration.nmsh = {...configuration.nmsh, palette: palette as never, textColors, ...extra};
  return configuration;
};
const context = themePreviewContext('/home/u');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

test('every built-in theme supports Neutral and Theme; Neutral keeps every fill and only changes text', () => {
  const themes = Object.keys(NATIVE_PROMPT_THEMES);
  assert.ok(themes.length >= 10);
  for (const palette of themes) {
    const theme = renderedModules(context, configure(palette, 'theme'));
    const neutral = renderedModules(context, configure(palette, 'neutral'));
    assert.equal(theme.length, neutral.length, palette);
    theme.forEach((module, index) => {
      const other = neutral[index]!;
      assert.ok(same(module.background, other.background), `${palette}: ${module.role} keeps its fill`);
      assert.ok(same(other.foreground, NEUTRAL_PROMPT_LIGHT) || same(other.foreground, NEUTRAL_PROMPT_DARK), `${palette}: ${module.role} text is a neutral tone`);
    });
  }
});

test('bright fills get the dark neutral; dark fills the light neutral; the choice is static', () => {
  assert.deepEqual(neutralPromptText({red: 250, green: 230, blue: 120}), NEUTRAL_PROMPT_DARK);
  assert.deepEqual(neutralPromptText({red: 40, green: 44, blue: 60}), NEUTRAL_PROMPT_LIGHT);
  assert.deepEqual(neutralPromptText({red: 40, green: 44, blue: 60}), neutralPromptText({red: 40, green: 44, blue: 60}));
});

test('Chroma never flips Neutral text between frames', () => {
  const configuration = configure('gruvbox' in NATIVE_PROMPT_THEMES ? 'gruvbox' : 'lavender', 'neutral');
  configuration.presentation = {...configuration.presentation, preset: 'theme', motion: 'travel', reducedMotion: false, effectsOff: false};
  const foregrounds = (time: number) => [...buildThemePreviewLine(configuration, configuration.nmsh.palette, 120, time).matchAll(/\u001b\[38;2;(\d+;\d+;\d+)m/gu)].map(match => match[1]);
  const textTones = (time: number) => new Set(foregrounds(time).filter(tone => tone === '236;236;240' || tone === '24;24;28'));
  const first = textTones(0);
  for (const time of [400, 1300, 2700, 5100]) assert.deepEqual(textTones(time), first, `frame ${time}`);
});

test('migration: older configs keep Theme text; /prompt offers Text colors next to Theme; switching never changes the theme', () => {
  const old = normalizePromptConfiguration({nmsh: {palette: 'lavender'}});
  assert.equal(old.nmsh.textColors, 'theme');
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'lavender', textColors: 'neutral'}}).nmsh.textColors, 'neutral');
  const configuration = configure('lavender', 'theme');
  const rows = appearanceRows(configuration);
  const index = rows.findIndex(row => row.id === 'textColors');
  assert.ok(index > 0 && rows[index - 1]!.id !== 'style' && rows[index + 1]!.id === 'style', 'between Theme and Style');
  rows[index]!.change!(configuration, 1);
  assert.equal(configuration.nmsh.textColors, 'neutral');
  assert.equal(configuration.nmsh.palette, 'lavender');
});

test('text-only styles: the label is neutral, caps keep the theme color; explicit module text colors are kept', () => {
  const minimal = renderedModules(context, configure('lavender', 'neutral', {style: 'outline'}));
  assert.ok(minimal.every(module => module.neutralText));
  const custom = configure('lavender', 'neutral');
  custom.modules = custom.modules.map(module => module.id === custom.modules[0]!.id ? {...module, foreground: '#ff0000'} : module);
  const first = renderedModules(context, custom).find(module => module.id === custom.modules[0]!.id);
  if (first) assert.deepEqual(first.foreground, {red: 255, green: 0, blue: 0});
});
