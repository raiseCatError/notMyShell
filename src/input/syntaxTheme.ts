import {
  normalizePaletteId,
  type NativePaletteId,
  type PromptConfiguration,
  type SyntaxAppearance,
} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';
import {foreground, UI_COLORS, type RgbColor} from '../ui/palette.js';
import type {Token, TokenType} from './Highlighter.js';

/**
 * How one token looks. The Highlighter decides what a token means; this
 * module alone decides how it looks; the editor and history decide where.
 */
export interface SyntaxStyle {
  foreground: RgbColor;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}

export type SyntaxStyles = Readonly<Record<TokenType, SyntaxStyle>>;
/** Ready-to-emit SGR prefixes, one per token type. */
export type SyntaxSgr = Readonly<Record<TokenType, string>>;

export const TOKEN_TYPES: readonly TokenType[] = ['Command', 'KnownCommand', 'Builtin', 'Alias', 'Function', 'UnknownCommand',
  'Argument', 'String', 'Variable', 'Operator', 'Path', 'Flag', 'Comment', 'Normal'];

/** The handful of roles every syntax palette supplies; token types map onto them. */
interface SyntaxRoles {
  text: RgbColor;
  command: RgbColor;
  error: RgbColor;
  string: RgbColor;
  variable: RgbColor;
  path: RgbColor;
  quiet: RgbColor;
}

/** The pre-#68 editor colors; Lavender Native keeps them exactly. */
const STRING_AMBER: RgbColor = {red: 198, green: 156, blue: 109};
const LAVENDER_ROLES: SyntaxRoles = {
  text: UI_COLORS.primary,
  command: UI_COLORS.accent,
  error: UI_COLORS.failure,
  string: STRING_AMBER,
  variable: UI_COLORS.accent,
  path: UI_COLORS.secondary,
  quiet: UI_COLORS.subtle,
};

function mix(color: RgbColor, toward: RgbColor, amount: number): RgbColor {
  const channel = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return {red: channel(color.red, toward.red), green: channel(color.green, toward.green), blue: channel(color.blue, toward.blue)};
}

const WHITE: RgbColor = {red: 255, green: 255, blue: 255};
/** Prompt backgrounds are segment fills; lifted toward white they read as text on a dark terminal. */
const lift = (color: RgbColor, amount = 0.35) => mix(color, WHITE, amount);

/** Syntax roles derived from a Native prompt theme's own role colors; no second palette table. */
function themeRoles(palette: NativePaletteId): SyntaxRoles {
  if (palette === 'lavender') return LAVENDER_ROLES;
  const theme = NATIVE_PROMPT_THEMES[palette];
  const bg = (role: Parameters<typeof theme.colors>[0]) => theme.colors(role).background;
  return {
    text: UI_COLORS.primary,
    command: lift(bg('project')),
    error: lift(bg('failure'), 0.15),
    // Warm First's yellow sits too close to its amber commands; its olive reads apart.
    string: palette === 'warm' ? lift(bg('node'), 0.3) : lift(bg('python'), 0.2),
    variable: lift(bg('go'), 0.3),
    path: lift(bg('cwd'), 0.45),
    quiet: UI_COLORS.subtle,
  };
}

function stylesFromRoles(roles: SyntaxRoles): SyntaxStyles {
  const command = {foreground: roles.command};
  return {
    Command: {foreground: roles.text},
    KnownCommand: command,
    Builtin: command,
    Alias: command,
    Function: command,
    UnknownCommand: {foreground: roles.error},
    Argument: {foreground: roles.text},
    String: {foreground: roles.string},
    Variable: {foreground: roles.variable},
    Operator: {foreground: roles.quiet},
    Path: {foreground: roles.path},
    Flag: {foreground: roles.path},
    Comment: {foreground: roles.quiet},
    Normal: {foreground: roles.text},
  };
}

const gray = (level: number): RgbColor => ({red: level, green: level, blue: level});

/**
 * Grayscale keeps distinctions through lightness and weight, not hue:
 * resolved commands bright and bold, unknown commands underlined, structure
 * and comments dim.
 */
const GRAYSCALE_STYLES: SyntaxStyles = {
  Command: {foreground: gray(236)},
  KnownCommand: {foreground: gray(250), bold: true},
  Builtin: {foreground: gray(250), bold: true},
  Alias: {foreground: gray(250), bold: true},
  Function: {foreground: gray(250), bold: true},
  UnknownCommand: {foreground: gray(236), underline: true},
  Argument: {foreground: gray(222)},
  String: {foreground: gray(190)},
  Variable: {foreground: gray(250)},
  Operator: {foreground: gray(140)},
  Path: {foreground: gray(200)},
  Flag: {foreground: gray(170)},
  Comment: {foreground: gray(120), dim: true},
  Normal: {foreground: gray(236)},
};

/** Highlighting Off: every token is ordinary input text. */
const PLAIN_STYLES: SyntaxStyles = Object.fromEntries(TOKEN_TYPES.map(type => [type, {foreground: UI_COLORS.primary}])) as SyntaxStyles;

/**
 * Follow prompt uses the saved Native palette even while Starship or
 * Powerlevel10k draws the prompt: syntax is NMSh-owned presentation, and
 * external prompt colors are never parsed.
 */
export function syntaxPaletteFor(syntax: SyntaxAppearance, promptPalette: NativePaletteId): NativePaletteId {
  return syntax.colors === 'theme' ? normalizePaletteId(syntax.theme) : normalizePaletteId(promptPalette);
}

export function resolveSyntaxStyles(syntax: SyntaxAppearance, promptPalette: NativePaletteId): SyntaxStyles {
  if (!syntax.highlighting) return PLAIN_STYLES;
  const palette = syntaxPaletteFor(syntax, promptPalette);
  // The Grayscale theme has no hue to borrow, so it shares the Grayscale mode's styles.
  if (syntax.colors === 'grayscale' || palette === 'grayscale') return GRAYSCALE_STYLES;
  return stylesFromRoles(themeRoles(palette));
}

export function styleSgr(style: SyntaxStyle): string {
  return `${style.bold ? '\u001B[1m' : ''}${style.dim ? '\u001B[2m' : ''}${style.underline ? '\u001B[4m' : ''}${foreground(style.foreground)}`;
}

const sgrCache = new Map<string, SyntaxSgr>();

/** Cached per setting combination, so rendering never recomputes colors per keystroke. */
export function syntaxSgr(syntax: SyntaxAppearance, promptPalette: NativePaletteId): SyntaxSgr {
  const key = `${syntax.highlighting}:${syntax.colors}:${syntax.theme}:${promptPalette}`;
  let cached = sgrCache.get(key);
  if (!cached) {
    const styles = resolveSyntaxStyles(syntax, promptPalette);
    cached = Object.fromEntries(TOKEN_TYPES.map(type => [type, styleSgr(styles[type])])) as SyntaxSgr;
    sgrCache.set(key, cached);
  }
  return cached;
}

export function syntaxSgrForConfiguration(configuration: PromptConfiguration): SyntaxSgr {
  return syntaxSgr(configuration.syntax, configuration.nmsh.palette);
}

/** One SGR prefix per grapheme; every emitted run must be followed by a reset. */
export function syntaxCharStyles(tokens: readonly Token[], length: number, sgr: SyntaxSgr): string[] {
  const styles = new Array<string>(length).fill(sgr.Normal);
  for (const token of tokens) {
    for (let index = token.start; index < token.end && index < length; index++) styles[index] = sgr[token.type];
  }
  return styles;
}
