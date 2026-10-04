import {parseHexColor} from '../chroma/color.js';
import {rgbTo16, rgbTo256} from '../chroma/escape.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {sgrRgb, type SemanticPalette} from '../appearance/semanticPalette.js';
import type {BridgeEnvironment} from './environment.js';

/**
 * Target mappers: each translates the one resolved semantic palette into a
 * target's documented roles. None of them reads themes, configuration or
 * files; generation, validation and writing live elsewhere. Static palette
 * data only: Chroma never leaks into a generated artifact.
 */

const ESC = '\u001B';
const HEX = /^#[0-9a-f]{6}$/u;

// ---- fzf --------------------------------------------------------------------

/** fzf color names by the release that introduced them; older fzf rejects unknown names. */
const FZF_GATED: ReadonlyArray<[name: string, since: [number, number]]> = [['border', [0, 23]], ['gutter', [0, 23]], ['separator', [0, 35]], ['label', [0, 35]],
  ['scrollbar', [0, 36]], ['query', [0, 42]], ['disabled', [0, 42]]];

export function parseFzfVersion(text: string | undefined): [number, number] | undefined {
  const match = /^(\d+)\.(\d+)/u.exec(text?.trim() ?? '');
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function fzfColor(hex: string, level: ColorLevel): string {
  const rgb = parseHexColor(hex)!;
  return level === 'truecolor' ? hex : level === 'ansi256' ? String(rgbTo256(rgb)) : String(rgbTo16(rgb));
}

/**
 * fzf `--color` for one NMSh-owned launch. `bg` stays the terminal default
 * unless the theme carries a real terminal background. Returns no argument
 * at all when color is unavailable (NO_COLOR or no color capability).
 */
export function fzfColorArgs(palette: SemanticPalette, level: ColorLevel, version?: [number, number]): string[] {
  if (level === 'none') return [];
  const roles: Record<string, string> = {
    fg: palette.text.primary, hl: palette.accent, 'fg+': palette.selectionForeground, 'bg+': palette.selection, 'hl+': palette.accent,
    info: palette.text.subtle, prompt: palette.accent, pointer: palette.accent, marker: palette.success, spinner: palette.info, header: palette.text.secondary,
    border: palette.separator, gutter: palette.background ?? '', separator: palette.separator, label: palette.text.secondary, scrollbar: palette.separator,
    query: palette.text.primary, disabled: palette.text.subtle,
  };
  const at = (since: [number, number]) => !version || version[0] > since[0] || (version[0] === since[0] && version[1] >= since[1]);
  const allowed = (name: string) => { const gate = FZF_GATED.find(([gated]) => gated === name); return !gate || at(gate[1]); };
  const parts = [`bg:${palette.background ? fzfColor(palette.background, level) : '-1'}`];
  for (const [name, hex] of Object.entries(roles)) {
    if (name === 'gutter' && !hex) { if (allowed('gutter')) parts.push('gutter:-1'); continue; }
    if (HEX.test(hex) && allowed(name)) parts.push(`${name}:${fzfColor(hex, level)}`);
  }
  return [`--color=${parts.join(',')}`];
}

/**
 * Precedence for NMSh-owned fzf launches: Theme Bridge colors first, then the
 * launching surface's explicit options (fzf applies later `--color` values
 * over earlier ones, so explicit options win). FZF_DEFAULT_OPTS is not read
 * for NMSh-owned launches at all.
 */
export function withFzfTheme(callerArgs: readonly string[], bridgeArgs: readonly string[]): string[] {
  return [...bridgeArgs, ...callerArgs];
}

// ---- less / man ---------------------------------------------------------------

const sgr = (hex: string, extra = '') => `${ESC}[${extra}38;2;${sgrRgb(hex)}m`;
const sgr256 = (hex: string, extra = '') => `${ESC}[${extra}38;5;${rgbTo256(parseHexColor(hex)!)}m`;

/**
 * less's documented termcap overrides (bold, underline, standout, blink),
 * which color man pages and less's own prompt/search highlight. GROFF_NO_SGR
 * makes GNU groff emit the overstrike formatting those overrides recolor;
 * BSD/macOS mandoc already does. LESS itself (the user's options) is never set.
 */
export function pagerEnvironment(palette: SemanticPalette, level: ColorLevel): BridgeEnvironment {
  if (level === 'none') return {};
  const color = level === 'truecolor' ? sgr : sgr256;
  const reverse = level === 'truecolor'
    ? `${ESC}[38;2;${sgrRgb(palette.selectionForeground)};48;2;${sgrRgb(palette.selection)}m`
    : `${ESC}[38;5;${rgbTo256(parseHexColor(palette.selectionForeground)!)};48;5;${rgbTo256(parseHexColor(palette.selection)!)}m`;
  return {
    LESS_TERMCAP_md: color(palette.accent, '1;'), LESS_TERMCAP_mb: color(palette.failure, '1;'), LESS_TERMCAP_me: `${ESC}[0m`,
    LESS_TERMCAP_us: color(palette.success, '4;'), LESS_TERMCAP_ue: `${ESC}[0m`,
    LESS_TERMCAP_so: reverse, LESS_TERMCAP_se: `${ESC}[0m`,
    GROFF_NO_SGR: '1',
  };
}

// ---- LS_COLORS ------------------------------------------------------------------

const lsColor = (hex: string, level: ColorLevel, extra = '') => {
  const rgb = parseHexColor(hex)!;
  return `${extra}${level === 'truecolor' ? `38;2;${rgb.red};${rgb.green};${rgb.blue}` : `38;5;${rgbTo256(rgb)}`}`;
};

/**
 * A deliberately small LS_COLORS: file kinds plus a few broad extension
 * groups, from semantic roles. Not an extension database; vivid (when
 * installed) is the rich path.
 */
export function lsColorsFallback(palette: SemanticPalette, level: ColorLevel): string | undefined {
  if (level === 'none') return undefined;
  const c = (hex: string, extra = '') => lsColor(hex, level, extra);
  const entries: Array<[string, string]> = [
    ['di', c(palette.ansi[4]!, '1;')], ['ln', c(palette.ansi[6]!)], ['so', c(palette.ansi[5]!)], ['pi', c(palette.warning)],
    ['ex', c(palette.success, '1;')], ['bd', c(palette.warning, '1;')], ['cd', c(palette.warning)], ['or', c(palette.failure, '1;')],
    ['mi', c(palette.failure)], ['su', c(palette.failure, '7;')], ['sg', c(palette.warning, '7;')], ['tw', c(palette.success, '7;')], ['ow', c(palette.ansi[4]!, '7;')],
  ];
  const groups: Array<[string[], string]> = [
    [['tar', 'tgz', 'gz', 'zip', 'bz2', 'xz', 'zst', '7z', 'rar'], c(palette.failure)],
    [['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'mp4', 'mov', 'mp3', 'flac'], c(palette.ansi[5]!)],
    [['md', 'txt', 'rst', 'pdf'], c(palette.text.secondary)],
    [['json', 'yaml', 'yml', 'toml', 'ini', 'conf'], c(palette.info)],
    [['log', 'tmp', 'bak', 'swp', 'lock'], c(palette.text.subtle)],
  ];
  return [...entries.map(([key, value]) => `${key}=${value}`), ...groups.flatMap(([extensions, value]) => extensions.map(extension => `*.${extension}=${value}`))].join(':');
}

/** vivid's documented theme file format (core + broad categories), colors as palette entries. */
export function vividTheme(palette: SemanticPalette): string {
  const hex = (value: string) => `"${value.slice(1)}"`;
  return `# Generated by NMSh Theme Bridge from ${JSON.stringify(palette.name)}. NMSh replaces this file.
colors:
  directory: ${hex(palette.ansi[4]!)}
  link: ${hex(palette.ansi[6]!)}
  executable: ${hex(palette.success)}
  special: ${hex(palette.ansi[5]!)}
  warning: ${hex(palette.warning)}
  failure: ${hex(palette.failure)}
  text: ${hex(palette.text.secondary)}
  muted: ${hex(palette.text.subtle)}
  info: ${hex(palette.info)}
  accent: ${hex(palette.accent)}
  surface: ${hex(palette.surface)}
core:
  normal_text: {}
  regular_file: {}
  reset_to_normal: {}
  directory: {foreground: directory, font-style: bold}
  symlink: {foreground: link}
  multi_hard_link: {}
  fifo: {foreground: warning}
  socket: {foreground: special}
  door: {foreground: special}
  block_device: {foreground: warning, font-style: bold}
  character_device: {foreground: warning}
  broken_symlink: {foreground: failure, font-style: bold}
  missing_symlink_target: {foreground: failure}
  setuid: {foreground: failure}
  setgid: {foreground: warning}
  file_with_capability: {}
  sticky_other_writable: {foreground: executable}
  other_writable: {foreground: directory}
  sticky: {}
  executable_file: {foreground: executable, font-style: bold}
text:
  foreground: text
markup:
  foreground: text
programming:
  foreground: accent
media:
  foreground: special
office:
  foreground: text
archives:
  foreground: failure
executable:
  foreground: executable
unimportant:
  foreground: muted
`;
}

/** vivid output accepted as an LS_COLORS value: `key=sgr` entries only. */
export function validLsColors(value: string): boolean {
  return value.length > 0 && value.length <= 64 * 1024 && /^(?:[^=:\s\u0000-\u001f]+=[0-9;]*)(?::[^=:\s\u0000-\u001f]+=[0-9;]*)*:?$/u.test(value.trim());
}

// ---- tmux -----------------------------------------------------------------------

/** Style options only: colors of tmux's own chrome. No keys, layout, behavior, plugins or commands. */
export const TMUX_STYLE_OPTIONS = ['status-style', 'status-left-style', 'status-right-style', 'window-status-style', 'window-status-current-style',
  'window-status-last-style', 'window-status-activity-style', 'window-status-bell-style', 'pane-border-style',
  'pane-active-border-style', 'message-style', 'message-command-style', 'mode-style', 'clock-mode-colour', 'display-panes-colour',
  'display-panes-active-colour', 'popup-border-style', 'popup-style', 'menu-style', 'menu-selected-style', 'menu-border-style',
  'copy-mode-match-style', 'copy-mode-current-match-style', 'copy-mode-mark-style'] as const;

export const TMUX_UNREPRESENTED = 'tmux has no roles for prompt module colors, syntax colors or text tiers beyond fg/bg; those NMSh roles are not applied.';

export function tmuxFragment(palette: SemanticPalette): string {
  const bar = palette.surface;
  const style = (fg: string, bg?: string, attrs = '') => `"fg=${fg}${bg ? `,bg=${bg}` : ''}${attrs ? `,${attrs}` : ''}"`;
  const set = (option: typeof TMUX_STYLE_OPTIONS[number], value: string) => `set -gq ${option} ${value}`;
  return [
    `# Generated by NMSh Theme Bridge from ${JSON.stringify(palette.name)}. NMSh replaces this file; edit your own tmux.conf instead.`,
    set('status-style', style(palette.text.secondary, bar)),
    set('status-left-style', style(palette.accent, bar, 'bold')),
    set('status-right-style', style(palette.text.secondary, bar)),
    set('window-status-style', style(palette.text.subtle, bar)),
    set('window-status-current-style', style(palette.selectionForeground, palette.selection, 'bold')),
    set('window-status-last-style', style(palette.text.secondary, bar)),
    set('window-status-activity-style', style(palette.warning, bar)),
    set('window-status-bell-style', style(palette.failure, bar, 'bold')),
    set('pane-border-style', style(palette.separator)),
    set('pane-active-border-style', style(palette.accent)),
    set('message-style', style(palette.text.primary, palette.selection)),
    set('message-command-style', style(palette.accent, palette.surface)),
    set('mode-style', style(palette.selectionForeground, palette.selection)),
    set('clock-mode-colour', `"${palette.accent}"`),
    set('display-panes-colour', `"${palette.separator}"`),
    set('display-panes-active-colour', `"${palette.accent}"`),
    set('popup-border-style', style(palette.accent)),
    set('menu-style', style(palette.text.primary, palette.surface)),
    set('menu-selected-style', style(palette.selectionForeground, palette.selection)),
    set('menu-border-style', style(palette.separator)),
    set('copy-mode-match-style', style(palette.selectionForeground, palette.selection)),
    set('copy-mode-current-match-style', style(palette.surface, palette.accent)),
    set('copy-mode-mark-style', style(palette.surface, palette.warning)),
    '',
  ].join('\n');
}

const TMUX_VALUE = /^"(?:#[0-9a-f]{6}|(?:fg|bg)=#[0-9a-f]{6}(?:,(?:fg|bg)=#[0-9a-f]{6})?(?:,bold)?)"$/u;

/** Validates a tmux fragment line by line: comments and allowlisted style options with color values only. */
export function validateTmuxFragment(content: string): boolean {
  return content.split('\n').every(line => line === '' || line.startsWith('# ') || (() => {
    const match = /^set -gq ([a-z-]+) (.+)$/u.exec(line);
    return Boolean(match && (TMUX_STYLE_OPTIONS as readonly string[]).includes(match[1]!) && TMUX_VALUE.test(match[2]!));
  })());
}

// ---- Neovim / Vim -----------------------------------------------------------------

export const COLORSCHEME_NAME = 'nmsh-bridge';

interface Highlight {fg?: string; bg?: string; sp?: string; bold?: true; italic?: true; underline?: true; undercurl?: true; reverse?: true}

/** Classic highlight groups both Vim and Neovim understand. */
function classicGroups(p: SemanticPalette): Record<string, Highlight> {
  const s = p.syntax;
  const bg = p.background;
  return {
    Normal: {fg: p.text.primary, ...(bg ? {bg} : {})}, Comment: {fg: s.comment, italic: true},
    Constant: {fg: s.constant}, String: {fg: s.string}, Character: {fg: s.string}, Number: {fg: s.number}, Boolean: {fg: s.number}, Float: {fg: s.number},
    Identifier: {fg: p.text.primary}, Function: {fg: s.function},
    Statement: {fg: s.keyword}, Conditional: {fg: s.keyword}, Repeat: {fg: s.keyword}, Label: {fg: s.keyword}, Operator: {fg: s.operator}, Keyword: {fg: s.keyword}, Exception: {fg: p.failure},
    PreProc: {fg: s.preproc}, Include: {fg: s.preproc}, Define: {fg: s.preproc}, Macro: {fg: s.preproc}, PreCondit: {fg: s.preproc},
    Type: {fg: s.type}, StorageClass: {fg: s.keyword}, Structure: {fg: s.type}, Typedef: {fg: s.type},
    Special: {fg: s.special}, SpecialChar: {fg: s.special}, Tag: {fg: p.accent}, Delimiter: {fg: s.operator}, SpecialComment: {fg: s.comment},
    Underlined: {fg: p.info, underline: true}, Error: {fg: p.failure, bold: true}, Todo: {fg: p.warning, bold: true},
    Visual: {bg: p.selection}, Search: {fg: p.selectionForeground, bg: p.selection, bold: true}, IncSearch: {fg: p.surface, bg: p.accent},
    CursorLine: {bg: p.surface}, CursorColumn: {bg: p.surface}, ColorColumn: {bg: p.surface},
    LineNr: {fg: p.text.subtle}, CursorLineNr: {fg: p.accent, bold: true}, SignColumn: {fg: p.text.subtle},
    Pmenu: {fg: p.text.primary, bg: p.surface}, PmenuSel: {fg: p.selectionForeground, bg: p.selection}, PmenuSbar: {bg: p.surface}, PmenuThumb: {bg: p.separator},
    StatusLine: {fg: p.text.primary, bg: p.selection}, StatusLineNC: {fg: p.text.subtle, bg: p.surface},
    VertSplit: {fg: p.separator}, TabLine: {fg: p.text.subtle, bg: p.surface}, TabLineSel: {fg: p.selectionForeground, bg: p.selection, bold: true}, TabLineFill: {bg: p.surface},
    MatchParen: {fg: p.accent, bold: true, underline: true}, Folded: {fg: p.text.subtle, bg: p.surface}, NonText: {fg: p.text.subtle},
    Title: {fg: p.accent, bold: true}, Directory: {fg: p.ansi[4]!}, ErrorMsg: {fg: p.failure}, WarningMsg: {fg: p.warning}, ModeMsg: {fg: p.text.secondary}, MoreMsg: {fg: p.success},
    Question: {fg: p.success}, WildMenu: {fg: p.selectionForeground, bg: p.selection},
    DiffAdd: {fg: p.success}, DiffChange: {fg: p.warning}, DiffDelete: {fg: p.failure}, DiffText: {fg: p.info, bold: true},
    SpellBad: {sp: p.failure, undercurl: true}, SpellCap: {sp: p.warning, undercurl: true},
  };
}

/** Neovim-only groups: floats, separators, diagnostics, and Tree-sitter captures linked onto the classic groups. */
function neovimGroups(p: SemanticPalette): Record<string, Highlight | {link: string}> {
  const diagnostics: Record<string, string> = {Error: p.failure, Warn: p.warning, Info: p.info, Hint: p.text.secondary, Ok: p.success};
  const out: Record<string, Highlight | {link: string}> = {
    NormalFloat: {fg: p.text.primary, bg: p.surface}, FloatBorder: {fg: p.separator}, WinSeparator: {fg: p.separator},
    NormalNC: {link: 'Normal'}, CursorLineSign: {link: 'SignColumn'},
  };
  for (const [name, color] of Object.entries(diagnostics)) {
    out[`Diagnostic${name}`] = {fg: color};
    out[`DiagnosticUnderline${name}`] = {sp: color, undercurl: true};
    out[`DiagnosticSign${name}`] = {fg: color};
    out[`DiagnosticVirtualText${name}`] = {fg: color};
  }
  const links: Record<string, string> = {
    '@comment': 'Comment', '@string': 'String', '@string.escape': 'SpecialChar', '@character': 'Character', '@number': 'Number', '@boolean': 'Boolean',
    '@number.float': 'Float', '@constant': 'Constant', '@constant.builtin': 'Constant', '@variable': 'Identifier', '@variable.builtin': 'Special',
    '@variable.parameter': 'Identifier', '@property': 'Identifier', '@function': 'Function', '@function.call': 'Function', '@function.builtin': 'Special',
    '@function.method': 'Function', '@constructor': 'Type', '@keyword': 'Keyword', '@keyword.function': 'Keyword', '@keyword.return': 'Keyword',
    '@keyword.import': 'Include', '@conditional': 'Conditional', '@repeat': 'Repeat', '@exception': 'Exception', '@operator': 'Operator',
    '@type': 'Type', '@type.builtin': 'Type', '@module': 'Identifier', '@label': 'Label', '@tag': 'Tag', '@tag.attribute': 'Identifier',
    '@punctuation': 'Delimiter', '@punctuation.bracket': 'Delimiter', '@punctuation.delimiter': 'Delimiter', '@markup.heading': 'Title',
    '@markup.link': 'Underlined', '@diff.plus': 'DiffAdd', '@diff.minus': 'DiffDelete', '@diff.delta': 'DiffChange',
  };
  for (const [capture, group] of Object.entries(links)) out[capture] = {link: group};
  return out;
}

const luaString = (value: string) => `'${value}'`;

export function neovimColorscheme(palette: SemanticPalette): string {
  const attributes = (highlight: Highlight | {link: string}) => {
    if ('link' in highlight) return `{link = ${luaString(highlight.link)}}`;
    const parts: string[] = [];
    for (const key of ['fg', 'bg', 'sp'] as const) if (highlight[key]) parts.push(`${key} = ${luaString(highlight[key]!)}`);
    if (highlight.fg) parts.push(`ctermfg = ${rgbTo256(parseHexColor(highlight.fg)!)}`);
    if (highlight.bg) parts.push(`ctermbg = ${rgbTo256(parseHexColor(highlight.bg)!)}`);
    for (const key of ['bold', 'italic', 'underline', 'undercurl', 'reverse'] as const) if (highlight[key]) parts.push(`${key} = true`);
    return `{${parts.join(', ')}}`;
  };
  const groups = {...classicGroups(palette), ...neovimGroups(palette)} as Record<string, Highlight | {link: string}>;
  delete groups.VertSplit;
  groups.VertSplit = {link: 'WinSeparator'};
  return [
    `-- Generated by NMSh Theme Bridge from ${JSON.stringify(palette.name)}. NMSh replaces this file; it contains highlight data only.`,
    `vim.cmd('highlight clear')`,
    `if vim.fn.exists('syntax_on') == 1 then vim.cmd('syntax reset') end`,
    `vim.o.background = ${luaString(palette.dark ? 'dark' : 'light')}`,
    `vim.g.colors_name = ${luaString(COLORSCHEME_NAME)}`,
    `local set = vim.api.nvim_set_hl`,
    ...Object.entries(groups).map(([name, highlight]) => `set(0, ${luaString(name)}, ${attributes(highlight)})`),
    '',
  ].join('\n');
}

export function vimColorscheme(palette: SemanticPalette): string {
  const line = (name: string, highlight: Highlight) => {
    const attrs = (['bold', 'italic', 'underline', 'undercurl', 'reverse'] as const).filter(key => highlight[key]);
    const cterm = attrs.filter(key => key !== 'undercurl' && key !== 'italic');
    const parts = [`hi ${name}`,
      `guifg=${highlight.fg ?? 'NONE'}`, `guibg=${highlight.bg ?? 'NONE'}`, ...(highlight.sp ? [`guisp=${highlight.sp}`] : []),
      `ctermfg=${highlight.fg ? rgbTo256(parseHexColor(highlight.fg)!) : 'NONE'}`, `ctermbg=${highlight.bg ? rgbTo256(parseHexColor(highlight.bg)!) : 'NONE'}`,
      `gui=${attrs.length ? attrs.join(',') : 'NONE'}`, `cterm=${cterm.length ? cterm.join(',') : 'NONE'}`];
    return parts.join(' ');
  };
  return [
    `" Generated by NMSh Theme Bridge from ${JSON.stringify(palette.name).replace(/"/gu, "'")}. NMSh replaces this file; it contains highlight data only.`,
    `set background=${palette.dark ? 'dark' : 'light'}`,
    'hi clear',
    "if exists('syntax_on') | syntax reset | endif",
    `let g:colors_name = '${COLORSCHEME_NAME}'`,
    ...Object.entries(classicGroups(palette)).map(([name, highlight]) => line(name, highlight)),
    '',
  ].join('\n');
}

export function validateNeovimColorscheme(content: string): boolean {
  const fixed = new Set([`vim.cmd('highlight clear')`, `if vim.fn.exists('syntax_on') == 1 then vim.cmd('syntax reset') end`, "vim.o.background = 'dark'",
    "vim.o.background = 'light'", `vim.g.colors_name = '${COLORSCHEME_NAME}'`, 'local set = vim.api.nvim_set_hl', '']);
  const value = "(?:(?:fg|bg|sp) = '#[0-9a-f]{6}'|cterm(?:fg|bg) = \\d{1,3}|(?:bold|italic|underline|undercurl|reverse) = true)";
  const set = new RegExp(`^set\\(0, '[@A-Za-z][A-Za-z0-9_.]*', \\{(?:link = '[A-Z][A-Za-z]*'|${value}(?:, ${value})*)\\}\\)$`, 'u');
  return content.split('\n').every((line, index) => (index === 0 && line.startsWith('-- Generated by NMSh Theme Bridge')) || fixed.has(line) || set.test(line));
}

export function validateVimColorscheme(content: string): boolean {
  const fixed = new Set(['set background=dark', 'set background=light', 'hi clear', "if exists('syntax_on') | syntax reset | endif", `let g:colors_name = '${COLORSCHEME_NAME}'`, '']);
  const hi = /^hi [A-Z][A-Za-z]* guifg=(?:#[0-9a-f]{6}|NONE) guibg=(?:#[0-9a-f]{6}|NONE)(?: guisp=#[0-9a-f]{6})? ctermfg=(?:\d{1,3}|NONE) ctermbg=(?:\d{1,3}|NONE) gui=(?:NONE|[a-z,]+) cterm=(?:NONE|[a-z,]+)$/u;
  return content.split('\n').every((line, index) => (index === 0 && line.startsWith('" Generated by NMSh Theme Bridge')) || fixed.has(line) || hi.test(line));
}

// ---- Helix ------------------------------------------------------------------------

export const HELIX_THEME_NAME = 'nmsh-bridge';

/**
 * A native Helix theme: a named `[palette]` derived from the NMSh semantic
 * palette (still the source of truth), then syntax, markup, diff, diagnostic
 * and editor UI scopes mapped onto those names. Declarative TOML only.
 */
export function helixTheme(p: SemanticPalette): string {
  const palette: Record<string, string> = {
    foreground: p.text.primary, secondary: p.text.secondary, muted: p.text.subtle, accent: p.accent, separator: p.separator,
    surface: p.surface, selection: p.selection, 'selection-fg': p.selectionForeground, cursor: p.cursor,
    success: p.success, warning: p.warning, failure: p.failure, info: p.info,
    string: p.syntax.string, number: p.syntax.number, keyword: p.syntax.keyword, function: p.syntax.function, type: p.syntax.type,
    constant: p.syntax.constant, operator: p.syntax.operator, special: p.syntax.special, preproc: p.syntax.preproc, comment: p.syntax.comment,
    ...(p.background ? {background: p.background} : {}),
  };
  const bg = p.background ? 'background' : undefined;
  const s: Array<[string, string]> = [];
  const fg = (scope: string, color: string, modifiers?: string[]) => s.push([scope, modifiers ? `{ fg = "${color}", modifiers = [${modifiers.map(m => `"${m}"`).join(', ')}] }` : `"${color}"`]);
  const style = (scope: string, value: string) => s.push([scope, value]);
  for (const [scope, color] of [['attribute', 'preproc'], ['type', 'type'], ['type.builtin', 'type'], ['constructor', 'type'], ['constant', 'constant'], ['constant.builtin', 'constant'],
    ['constant.character.escape', 'special'], ['constant.numeric', 'number'], ['string', 'string'], ['string.regexp', 'special'], ['string.special', 'special'],
    ['variable', 'foreground'], ['variable.builtin', 'special'], ['variable.parameter', 'foreground'], ['variable.other.member', 'secondary'], ['label', 'keyword'],
    ['punctuation', 'operator'], ['punctuation.delimiter', 'operator'], ['punctuation.bracket', 'operator'], ['keyword', 'keyword'], ['keyword.control', 'keyword'],
    ['keyword.control.conditional', 'keyword'], ['keyword.control.repeat', 'keyword'], ['keyword.control.import', 'preproc'], ['keyword.control.return', 'keyword'],
    ['keyword.control.exception', 'failure'], ['keyword.operator', 'operator'], ['keyword.directive', 'preproc'], ['keyword.function', 'keyword'], ['keyword.storage', 'keyword'],
    ['operator', 'operator'], ['function', 'function'], ['function.builtin', 'special'], ['function.method', 'function'], ['function.macro', 'preproc'], ['tag', 'accent'],
    ['namespace', 'type'], ['special', 'special'], ['markup.heading', 'accent'], ['markup.list', 'secondary'], ['markup.link.url', 'info'], ['markup.link.text', 'accent'],
    ['markup.quote', 'muted'], ['markup.raw', 'string'], ['diff.plus', 'success'], ['diff.minus', 'failure'], ['diff.delta', 'warning'], ['diff.delta.moved', 'info'],
    ['diff.delta.conflict', 'failure'], ['warning', 'warning'], ['error', 'failure'], ['info', 'info'], ['hint', 'secondary']] as const) fg(scope, color);
  fg('comment', 'comment', ['italic']);
  fg('markup.bold', 'foreground', ['bold']);
  fg('markup.italic', 'foreground', ['italic']);
  fg('markup.link', 'info', ['underlined']);
  for (const [name, color] of [['error', 'failure'], ['warning', 'warning'], ['info', 'info'], ['hint', 'secondary']] as const) {
    style(`diagnostic.${name}`, `{ underline = { color = "${color}", style = "curl" } }`);
  }
  style('diagnostic.unnecessary', '{ modifiers = ["dim"] }');
  style('diagnostic.deprecated', '{ modifiers = ["crossed_out"] }');
  const on = (f: string, b?: string) => `{ fg = "${f}"${b ? `, bg = "${b}"` : ''} }`;
  style('ui.background', bg ? `{ bg = "${bg}" }` : '{}');
  style('ui.background.separator', on('separator'));
  for (const scope of ['ui.cursor', 'ui.cursor.normal', 'ui.cursor.primary']) style(scope, on(bg ?? 'surface', 'cursor'));
  style('ui.cursor.insert', on(bg ?? 'surface', 'success'));
  style('ui.cursor.select', on(bg ?? 'surface', 'info'));
  style('ui.cursor.match', '{ fg = "accent", modifiers = ["underlined"] }');
  style('ui.gutter', bg ? `{ bg = "${bg}" }` : '{}');
  style('ui.gutter.selected', '{ bg = "surface" }');
  style('ui.linenr', on('muted'));
  style('ui.linenr.selected', on('accent'));
  style('ui.statusline', on('foreground', 'surface'));
  style('ui.statusline.inactive', on('muted', 'surface'));
  style('ui.statusline.normal', on('selection-fg', 'selection'));
  style('ui.statusline.insert', on('surface', 'success'));
  style('ui.statusline.select', on('surface', 'info'));
  style('ui.statusline.separator', on('separator', 'surface'));
  style('ui.bufferline', on('muted', 'surface'));
  style('ui.bufferline.active', on('selection-fg', 'selection'));
  style('ui.bufferline.background', '{ bg = "surface" }');
  style('ui.popup', on('foreground', 'surface'));
  style('ui.popup.info', on('foreground', 'surface'));
  style('ui.window', on('separator'));
  style('ui.help', on('foreground', 'surface'));
  style('ui.text', on('foreground'));
  style('ui.text.focus', on('selection-fg', 'selection'));
  style('ui.text.inactive', on('muted'));
  style('ui.text.info', on('secondary'));
  style('ui.text.directory', on('info'));
  style('ui.virtual.whitespace', on('separator'));
  style('ui.virtual.indent-guide', on('separator'));
  style('ui.virtual.ruler', '{ bg = "surface" }');
  for (const scope of ['ui.virtual.inlay-hint', 'ui.virtual.inlay-hint.parameter', 'ui.virtual.inlay-hint.type']) style(scope, on('muted'));
  style('ui.menu', on('foreground', 'surface'));
  style('ui.menu.selected', on('selection-fg', 'selection'));
  style('ui.menu.scroll', on('separator', 'surface'));
  style('ui.selection', '{ bg = "selection" }');
  style('ui.selection.primary', '{ bg = "selection" }');
  style('ui.highlight', '{ bg = "surface" }');
  for (const scope of ['ui.cursorline.primary', 'ui.cursorline.secondary', 'ui.cursorcolumn.primary']) style(scope, '{ bg = "surface" }');
  return [
    `# Generated by NMSh Theme Bridge from ${JSON.stringify(p.name)}. NMSh replaces this file; it is theme data only.`,
    ...s.map(([scope, value]) => `"${scope}" = ${value}`),
    '',
    '[palette]',
    ...Object.entries(palette).map(([name, hex]) => `${name} = "${hex}"`),
    '',
  ].join('\n');
}

/** Parses the generated TOML and checks every style references only palette names or hex colors. */
export function validateHelixTheme(content: string, parse: (text: string) => unknown): boolean {
  let data: Record<string, unknown>;
  try { data = parse(content) as Record<string, unknown>; } catch { return false; }
  const palette = data.palette as Record<string, unknown> | undefined;
  if (!palette || typeof palette !== 'object' || !Object.values(palette).every(value => typeof value === 'string' && HEX.test(value))) return false;
  const color = (value: unknown) => typeof value === 'string' && (value in palette || HEX.test(value));
  const MODS = new Set(['bold', 'italic', 'underlined', 'dim', 'crossed_out']);
  return Object.entries(data).every(([key, value]) => {
    if (key === 'palette') return true;
    if (!/^[a-z][a-z.-]*$/u.test(key)) return false;
    if (typeof value === 'string') return color(value);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).every(([field, item]) => field === 'fg' || field === 'bg' ? color(item)
      : field === 'modifiers' ? Array.isArray(item) && item.every(mod => MODS.has(mod))
        : field === 'underline' ? typeof item === 'object' && item !== null && color((item as {color?: unknown}).color) && (item as {style?: unknown}).style === 'curl'
          : false);
  });
}
