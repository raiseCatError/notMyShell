import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  CATPPUCCIN_ACCENTS, THEME_FAMILIES, THEME_VARIANTS, accentedVariant, familyVariants, themeVariant,
} from '../src/appearance/themeFamilies.js';
import {
  exportTheme, importBase16, importTheme, importWindowsTerminal, normalizeCustomTheme, parseHexInput, PROMPT_THEME_ROLES,
  UI_THEME_ROLES, validateTheme, type CustomTheme,
} from '../src/appearance/customTheme.js';
import {cloneFromPalette, familyOf, selectFamily, variantOptions} from '../src/appearance/themeSelection.js';
import {applyUiTheme, defaultUiColors, uiColorsFor, uiThemeInput} from '../src/appearance/uiTheme.js';
import {createThemeEditor, createThemeStudio, editorKey, readThemeImport, renderThemeStudio, studioKey, STUDIO_ROWS, themeDefaults, writeThemeExport} from '../src/appearance/ThemeStudio.js';
import {
  DEFAULT_PROMPT_CONFIGURATION, NATIVE_PALETTE_IDS, normalizePromptConfiguration, THEME_PALETTE_IDS, THIRD_PARTY_PALETTE_IDS,
} from '../src/prompt/configuration.js';
import {NATIVE_PROMPT_THEMES, setThemeContext, themeChromaStops, buildThemePreviewLine} from '../src/prompt/prompt.js';
import {contrastRatio, parseHexColor} from '../src/chroma/color.js';
import {UI_COLORS} from '../src/ui/palette.js';
import {colorPickerKey, createColorPicker, hsvToRgb, renderColorPicker, rgbToHsv, xterm256} from '../src/ui/ColorPicker.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {setIconStyle} from '../src/ui/glyphs.js';

const HEX = /^#[0-9a-f]{6}$/u;
const plain = (rows: string[]) => rows.map(stripAnsi).join('\n');

test('theme families: canonical variants, valid ids, licenses recorded, NMSh themes unchanged', () => {
  assert.deepEqual(THEME_FAMILIES.map(family => family.id), ['nmsh', 'catppuccin', 'dracula', 'tokyonight', 'gruvbox', 'rosepine', 'nord', 'solarized', 'onedark', 'custom']);
  for (const family of THEME_FAMILIES.filter(item => item.id !== 'nmsh' && item.id !== 'custom')) {
    assert.ok(family.source?.startsWith('https://github.com/'), family.id);
    assert.ok(family.license, family.id);
  }
  assert.deepEqual(familyVariants('catppuccin').map(variant => variant.variant), ['Latte', 'Frappé', 'Macchiato', 'Mocha']);
  assert.deepEqual(familyVariants('tokyonight').map(variant => variant.variant), ['Night', 'Storm', 'Moon', 'Day']);
  assert.deepEqual(familyVariants('rosepine').map(variant => variant.variant), ['Main', 'Moon', 'Dawn']);
  assert.deepEqual(familyVariants('gruvbox').map(variant => variant.variant), ['Dark', 'Light']);
  assert.deepEqual(familyVariants('solarized').map(variant => variant.variant), ['Dark', 'Light']);
  assert.ok(!THEME_VARIANTS.some(variant => /alucard/iu.test(variant.id)), 'Alucard is not bundled without a licensed canonical source');
  assert.deepEqual(THEME_VARIANTS.map(variant => variant.id), [...THIRD_PARTY_PALETTE_IDS]);
  // Canonical spot checks against the upstream files.
  assert.equal(themeVariant('catppuccinMocha')!.accents!.mauve, '#cba6f7');
  assert.equal(themeVariant('nord')!.roles.project, '#88c0d0');
  assert.equal(themeVariant('dracula')!.roles.project, '#bd93f9');
  assert.equal(themeVariant('tokyonightNight')!.roles.project, '#7aa2f7');
  assert.equal(themeVariant('solarizedDark')!.roles.project, '#268bd2');
  assert.equal(themeVariant('rosePine')!.roles.project, '#c4a7e7');
  assert.equal(themeVariant('oneDark')!.roles.project, '#61afef');
  assert.equal(NATIVE_PALETTE_IDS.length, 12, 'the NMSh family keeps its twelve themes');
});

test('every bundled variant: valid colors, readable module text, distinct adjacent identity fills', () => {
  for (const variant of THEME_VARIANTS) {
    for (const [role, hex] of Object.entries(variant.roles)) assert.match(hex, HEX, `${variant.id}.${role}`);
    for (const [role, hex] of Object.entries(variant.ui)) assert.match(hex as string, HEX, `${variant.id}.ui.${role}`);
    const theme = NATIVE_PROMPT_THEMES[variant.id as keyof typeof NATIVE_PROMPT_THEMES];
    assert.ok(theme, variant.id);
    for (const role of ['project', 'cwd', 'gitBranch', 'node', 'go', 'python', 'docker', 'kubernetes', 'success', 'failure'] as const) {
      const colors = theme.colors(role);
      assert.ok(contrastRatio(colors.foreground, colors.background) >= 4.5, `${variant.id}.${role} text contrast`);
    }
    assert.notEqual(variant.roles.project, variant.roles.cwd, `${variant.id}: project and path differ`);
    assert.notEqual(variant.roles.cwd, variant.roles.gitBranch, `${variant.id}: path and branch differ`);
    assert.ok(themeChromaStops(variant.id as never).length >= 1, `${variant.id} Current Theme Chroma`);
    // Light variants never override NMSh's text tiers (the terminal background is unknown).
    if (!variant.dark) assert.equal(variant.ui.primary, undefined, `${variant.id} keeps text tiers`);
  }
});

test('Catppuccin: four flavors, fourteen accents, accent recolors project and NMSh accent, never status', () => {
  assert.equal(CATPPUCCIN_ACCENTS.length, 14);
  const mocha = themeVariant('catppuccinMocha')!;
  const green = accentedVariant(mocha, 'green');
  assert.equal(green.roles.project, mocha.accents!.green);
  assert.equal(green.ui.accent, mocha.accents!.green);
  assert.equal(green.roles.success, mocha.roles.success, 'success stays green');
  assert.equal(green.roles.node, mocha.accents!.mauve, 'a module that equalled the accent keeps a distinct fill');
  assert.equal(accentedVariant(mocha, 'mauve'), mocha);
  setThemeContext('peach', undefined);
  try {
    assert.equal(NATIVE_PROMPT_THEMES.catppuccinMocha.colors('project').background.red, parseHexColor('#fab387')!.red);
  } finally { setThemeContext('mauve', undefined); }
  assert.equal(normalizePromptConfiguration({nmsh: {accent: 'peach'}}).nmsh.accent, 'peach');
  assert.equal(normalizePromptConfiguration({nmsh: {accent: 'nope'}}).nmsh.accent, 'mauve');
});

test('family normalization: ids load, unknowns fall back, family/variant are derived', () => {
  for (const id of THEME_PALETTE_IDS.filter(item => item !== 'custom')) assert.equal(normalizePromptConfiguration({nmsh: {palette: id}}).nmsh.palette, id);
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'random-site-theme'}}).nmsh.palette, 'lavender');
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'semantic'}}).nmsh.palette, 'brand', 'retired id still migrates');
  assert.equal(normalizePromptConfiguration({nmsh: {palette: 'custom'}}).nmsh.palette, 'lavender', 'custom without a theme falls back');
  assert.equal(familyOf('catppuccinFrappe'), 'catppuccin');
  assert.equal(familyOf('ocean'), 'nmsh');
  assert.deepEqual(variantOptions('dracula').map(option => option.label), ['Dracula']);
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  assert.equal(selectFamily(config, 'catppuccin').nmsh.palette, 'catppuccinMocha');
  assert.equal(selectFamily(config, 'tokyonight').nmsh.palette, 'tokyonightNight');
  const custom = selectFamily(config, 'custom');
  assert.equal(custom.nmsh.palette, 'custom');
  assert.ok(custom.customTheme, 'choosing Custom clones the current theme');
  assert.equal(config.customTheme, undefined, 'selection never mutates its input');
});

test('chrome: NMSh themes keep the shipped chrome; families recolor NMSh UI and restore cleanly', () => {
  const shipped = defaultUiColors();
  assert.equal(uiThemeInput('lavender', 'mauve', undefined), undefined);
  try {
    applyUiTheme(uiColorsFor(uiThemeInput('nord', 'mauve', undefined)));
    assert.deepEqual({...UI_COLORS.accent}, parseHexColor('#88c0d0'));
    assert.deepEqual({...UI_COLORS.primary}, parseHexColor('#eceff4'));
    applyUiTheme(uiColorsFor(uiThemeInput('catppuccinLatte', 'mauve', undefined)));
    assert.deepEqual({...UI_COLORS.primary}, shipped.primary, 'light variants keep NMSh text tiers');
    assert.deepEqual({...UI_COLORS.accent}, parseHexColor('#8839ef'));
  } finally { applyUiTheme(undefined); }
  assert.deepEqual({...UI_COLORS.accent}, shipped.accent);
});

function sampleTheme(): CustomTheme {
  return cloneFromPalette('nord', 'mauve', 'My Nord');
}

test('custom theme: clone, edit, invalid colors rejected, export/import round trip keeps unknown fields', () => {
  const theme = sampleTheme();
  assert.equal(theme.basedOn, 'Nord');
  assert.equal(theme.prompt.project, '#88c0d0');
  for (const role of PROMPT_THEME_ROLES) assert.match(theme.prompt[role], HEX);
  for (const role of UI_THEME_ROLES) assert.match(theme.ui[role], HEX);
  assert.equal(validateTheme({...theme, prompt: {...theme.prompt, project: 'red'}}).ok, false);
  assert.equal(validateTheme({...theme, ui: {...theme.ui, accent: '#12345'}}).ok, false);
  assert.equal(validateTheme({...theme, name: '\u001b[31mx'}).ok, false);
  assert.equal(validateTheme({...theme, schema: 'other'}).ok, false);
  const json = JSON.parse(exportTheme({...theme, extra: {futureRoles: {glow: '#ffffff'}}}));
  assert.deepEqual(json.futureRoles, {glow: '#ffffff'});
  const back = importTheme(JSON.stringify({...json, version: 2}), themeDefaults());
  assert.ok(!('errors' in back));
  if ('errors' in back) return;
  assert.equal(back.format, 'nmsh');
  assert.deepEqual(back.theme.prompt, theme.prompt);
  assert.deepEqual(back.theme.extra, {futureRoles: {glow: '#ffffff'}}, 'unknown future fields survive');
  assert.match(back.warnings[0]!, /newer than this NMSh/u);
  assert.equal(parseHexInput('ABC'), '#aabbcc');
  assert.equal(parseHexInput('#12345g'), undefined);
  assert.equal(normalizeCustomTheme({...theme, prompt: {}}), undefined);
  // A config with a custom theme loads it; a broken one is dropped and the palette falls back.
  assert.equal(normalizePromptConfiguration({customTheme: theme, nmsh: {palette: 'custom'}}).nmsh.palette, 'custom');
  assert.equal(normalizePromptConfiguration({customTheme: {...theme, ui: {}}, nmsh: {palette: 'custom'}}).nmsh.palette, 'lavender');
});

test('palette imports map explicitly onto NMSh roles and say so; garbage is rejected', () => {
  const base16 = `scheme: "Ocean Test"\nauthor: "x"\nbase00: "2b303b"\nbase01: "343d46"\nbase02: "4f5b66"\nbase03: "65737e"\nbase04: "a7adba"\nbase05: "c0c5ce"\nbase06: "dfe1e8"\nbase07: "eff1f5"\nbase08: "bf616a"\nbase09: "d08770"\nbase0A: "ebcb8b"\nbase0B: "a3be8c"\nbase0C: "96b5b4"\nbase0D: "8fa1b3"\nbase0E: "b48ead"\nbase0F: "ab7967"\n`;
  const imported = importBase16(base16, themeDefaults())!;
  assert.equal(imported.theme.name, 'Ocean Test');
  assert.equal(imported.theme.prompt.project, '#b48ead');
  assert.equal(imported.theme.prompt.failure, '#bf616a');
  assert.equal(imported.theme.dark, true);
  assert.match(imported.warnings[0]!, /not lossless/u);
  const wt = importWindowsTerminal(JSON.stringify({name: 'Campbell', background: '#0C0C0C', foreground: '#CCCCCC', black: '#0C0C0C', red: '#C50F1F',
    green: '#13A10E', yellow: '#C19C00', blue: '#0037DA', purple: '#881798', cyan: '#3A96DD', brightBlack: '#767676', brightPurple: '#B4009E'}), themeDefaults())!;
  assert.equal(wt.theme.prompt.gitBranch, '#0037da');
  assert.equal(validateTheme(wt.theme).ok, true);
  // Untrusted names never carry terminal controls to the screen.
  const hostile = importBase16(base16.replace('scheme: "Ocean Test"', 'scheme: "Evil\u001b]0;pwned\u0007\u001b[2J"'), themeDefaults())!;
  assert.equal(hostile.theme.name, 'Evil]0;pwned[2J');
  const hostileJson = importBase16(JSON.stringify({scheme: '\u001b[31mRed', base00: '000000', base01: '111111', base02: '222222', base03: '333333',
    base05: 'dddddd', base08: 'ff0000', base09: 'ff8800', base0A: 'ffff00', base0B: '00ff00', base0C: '00ffff', base0D: '0000ff', base0E: 'ff00ff'}), themeDefaults())!;
  assert.equal(hostileJson.theme.name, '[31mRed');
  const hostileWt = importWindowsTerminal(JSON.stringify({name: 'A\u009b2JB', background: '#000000', foreground: '#ffffff', black: '#000000', red: '#ff0000',
    green: '#00ff00', yellow: '#ffff00', blue: '#0000ff', purple: '#ff00ff', cyan: '#00ffff', brightBlack: '#444444', brightPurple: '#ff88ff'}), themeDefaults())!;
  assert.equal(hostileWt.theme.name, 'A2JB');
  for (const theme of [hostile.theme, hostileJson.theme, hostileWt.theme]) assert.equal(validateTheme(theme).ok, true);
  assert.ok('errors' in importTheme('{"hello": 1}', themeDefaults()));
  assert.ok('errors' in importTheme('rm -rf / ; $(boom)', themeDefaults()));
  assert.ok('errors' in importTheme('x'.repeat(300 * 1024), themeDefaults()));
});

test('custom themes compose with Chroma and render through the real prompt renderer', () => {
  const theme = sampleTheme();
  setThemeContext('mauve', theme);
  try {
    assert.ok(themeChromaStops('custom').length >= 1);
    const config = {...structuredClone(DEFAULT_PROMPT_CONFIGURATION), customTheme: theme};
    config.nmsh.palette = 'custom';
    const line = buildThemePreviewLine(config, 'custom', 60);
    assert.ok(displayWidth(line) <= 60);
    assert.match(line, /\u001b\[48;2;136;192;208m/u, 'the custom project fill is used');
    // Current Theme Chroma derives its stops from the custom theme, not the default lavender.
    assert.notDeepEqual(themeChromaStops('custom'), themeChromaStops('lavender'));
    config.presentation.preset = 'theme';
    assert.notEqual(buildThemePreviewLine(config, 'custom', 60), line, 'Chroma still applies over a custom theme');
  } finally { setThemeContext('mauve', undefined); }
});

test('Theme Studio: edits through the picker, imports with preview, exports NMSh Theme JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nmsh-studio-'));
  try {
    const editor = createThemeEditor(undefined, 'nord');
    assert.equal(editor.draft.prompt.project, '#88c0d0');
    editor.selected = STUDIO_ROWS.findIndex(row => row.kind === 'role' && row.role === 'project');
    editorKey(editor, {kind: 'enter'}, 'truecolor');
    assert.ok(editor.picker);
    editorKey(editor, {kind: 'text', value: '#'}, 'truecolor');
    for (const character of 'ff8800') editorKey(editor, {kind: 'text', value: character}, 'truecolor');
    editorKey(editor, {kind: 'enter'}, 'truecolor');
    assert.equal(editor.picker, undefined);
    assert.equal(editor.draft.prompt.project, '#ff8800');
    const exported = writeThemeExport(editor.draft, join(directory, 'themes'));
    assert.match(exported, /my-nord\.nmsh-theme\.json$/u);
    const preview = readThemeImport(exported, directory);
    assert.ok(!('errors' in preview) && preview.theme.prompt.project === '#ff8800');
    await writeFile(join(directory, 'bad.json'), '{"schema":"nmsh-theme","version":1,"name":"x","prompt":{},"ui":{}}');
    const bad = readThemeImport('bad.json', directory);
    assert.ok('errors' in bad && bad.errors.some(error => /prompt\.project/u.test(error)));
    // The Import tab parses and previews first; Enter returns the save action, Esc stores nothing.
    const context = {themes: [], accent: 'mauve' as const, pinnedTo: () => []};
    const studio = createThemeStudio(context, 'import');
    for (const character of exported) studioKey(studio, {kind: 'text', value: character}, 'truecolor', directory, context);
    studioKey(studio, {kind: 'enter'}, 'truecolor', directory, context);
    assert.ok(studio.importPreview, 'import shows a preview before use');
    assert.match(plain(renderThemeStudio(studio, context, 90, 30, 'truecolor', [])), /Import preview · My Nord/u);
    const action = studioKey(studio, {kind: 'enter'}, 'truecolor', directory, context);
    assert.equal(action?.kind, 'importTheme');
    assert.equal(action?.kind === 'importTheme' && action.origin.kind, 'nmsh');
    editor.selected = STUDIO_ROWS.findIndex(row => row.kind === 'save');
    assert.equal(editorKey(editor, {kind: 'enter'}, 'truecolor')?.kind, 'save');
    assert.equal(JSON.parse(await readFile(exported, 'utf8')).schema, 'nmsh-theme');
    for (const width of [56, 90]) assert.ok(renderThemeStudio(createThemeStudio(context), context, width, 20, 'truecolor', []).every(row => displayWidth(row) <= width));
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('color picker: truecolor field and hue, 256-color grid, NO_COLOR channels, hex entry and invalid hex', () => {
  assert.deepEqual(hsvToRgb(0, 1, 1), {red: 255, green: 0, blue: 0});
  const hsv = rgbToHsv({red: 0, green: 128, blue: 255});
  assert.ok(Math.abs(hsv.h - 209.9) < 1);
  assert.deepEqual(xterm256(16), {red: 0, green: 0, blue: 0});
  assert.deepEqual(xterm256(231), {red: 255, green: 255, blue: 255});
  assert.deepEqual(xterm256(244), {red: 128, green: 128, blue: 128});
  const truecolor = createColorPicker('#336699', 'truecolor');
  assert.equal(truecolor.focus, 'field');
  colorPickerKey(truecolor, {kind: 'right'}, 'truecolor');
  assert.notEqual(truecolor.hex, '#336699');
  colorPickerKey(truecolor, {kind: 'complete'}, 'truecolor');
  assert.equal(truecolor.focus, 'hue');
  const hue = truecolor.hue;
  colorPickerKey(truecolor, {kind: 'right'}, 'truecolor');
  assert.equal(Math.round(truecolor.hue - hue), 6);
  const rows = renderColorPicker(truecolor, 'Accent', 60, 'truecolor');
  assert.ok(rows.some(row => row.includes('▀')), 'half-block field');
  assert.ok(rows.every(row => displayWidth(row) <= 60));
  const previousColor = process.env.NMSH_COLOR;
  process.env.NMSH_COLOR = '256';
  try {
  const grid = createColorPicker('#336699', 'ansi256');
  assert.equal(grid.focus, 'grid');
  colorPickerKey(grid, {kind: 'down'}, 'ansi256');
  assert.match(plain(renderColorPicker(grid, 'Accent', 60, 'ansi256')), /Nearest 256-color: \d+/u);
  assert.ok(renderColorPicker(grid, 'Accent', 60, 'ansi256').every(row => !/\u001b\[(?:38|48);2;/u.test(row)), 'no truecolor escapes on 256-color hosts');
  } finally { if (previousColor === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = previousColor; }
  const previousNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
  const none = createColorPicker('#336699', 'none');
  assert.equal(none.focus, 'channels');
  colorPickerKey(none, {kind: 'right'}, 'none');
  assert.equal(none.color.red, 0x34);
  const text = renderColorPicker(none, 'Accent', 60, 'none');
  assert.ok(text.every(row => !/\u001b\[(?:38|48);/u.test(row)), 'NO_COLOR is textual');
  assert.match(plain(text), /Red\s+52/u);
  colorPickerKey(none, {kind: 'text', value: '#'}, 'none');
  for (const character of 'zz') colorPickerKey(none, {kind: 'text', value: character}, 'none');
  colorPickerKey(none, {kind: 'text', value: '12'}, 'none');
  assert.equal(colorPickerKey(none, {kind: 'enter'}, 'none'), 'changed');
  assert.match(none.error!, /#rrggbb/u);
  assert.equal(colorPickerKey(none, {kind: 'escape'}, 'none'), 'changed', 'Esc first abandons the hex edit');
  assert.equal(colorPickerKey(none, {kind: 'escape'}, 'none'), 'cancel');
  } finally { if (previousNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = previousNoColor; }
  setIconStyle('safe');
  try { assert.ok(renderColorPicker(createColorPicker('#ffffff', 'truecolor'), 'x', 50, 'truecolor').some(row => row.includes('+'))); }
  finally { setIconStyle('nerd'); }
});
