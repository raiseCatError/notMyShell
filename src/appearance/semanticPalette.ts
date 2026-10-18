import {mixRgb} from '../chroma/chroma.js';
import {contrastRatio, hexColor, parseHexColor} from '../chroma/color.js';
import type {RgbColor as Rgb} from '../ui/palette.js';
import type {CustomTheme, PromptThemeRole} from './customTheme.js';
import {themeForRef, themeRefLabel, type ThemeRef, type ThemeSource} from './themeRefs.js';

/**
 * The one resolved, immutable semantic palette every Theme Bridge adapter
 * consumes. It is static theme data: Chroma is a live presentation treatment
 * and never leaks into generated configuration. Adapters translate these
 * roles into their target's documented roles; none of them re-reads a theme.
 */
export interface SemanticPalette {
  readonly ref: ThemeRef;
  readonly name: string;
  /** Whether the theme was designed for a dark terminal background. */
  readonly dark: boolean;
  /** Present only when the theme carries a real terminal background (imported schemes). Otherwise adapters keep the terminal's own. */
  readonly background?: string;
  readonly foreground: string;
  readonly text: Readonly<{primary: string; secondary: string; subtle: string}>;
  readonly accent: string;
  readonly separator: string;
  /** Selected/active surface and the text drawn on it. */
  readonly selection: string;
  readonly selectionForeground: string;
  /** A raised surface for bars and menus (status lines, popup menus), one step from the background. */
  readonly surface: string;
  readonly cursor: string;
  readonly success: string;
  readonly warning: string;
  readonly failure: string;
  readonly info: string;
  readonly prompt: Readonly<Record<PromptThemeRole, string>>;
  /** 16 ANSI-ish colors: the imported terminal palette when present, otherwise derived from the roles. */
  readonly ansi: readonly string[];
  /** Code roles for editor/pager targets, derived once here. */
  readonly syntax: Readonly<{comment: string; string: string; number: string; keyword: string; function: string; type: string;
    constant: string; operator: string; special: string; preproc: string}>;
}

export type PaletteResolution = {ok: true; palette: SemanticPalette} | {ok: false; reason: 'invalid' | 'missing'; label: string};

const BLACK: Rgb = {red: 0, green: 0, blue: 0};
const WHITE: Rgb = {red: 255, green: 255, blue: 255};
const rgb = (hex: string): Rgb => parseHexColor(hex)!;
const mix = (a: string, b: Rgb | string, amount: number): string => hexColor(mixRgb(rgb(a), typeof b === 'string' ? rgb(b) : b, amount));

/** A role color pushed until it reads against `against` (when there is a known background). */
function legible(color: string, against: string | undefined, dark: boolean): string {
  if (!against) return color;
  let out = color;
  for (let step = 0; step < 6 && contrastRatio(rgb(out), rgb(against)) < 3; step++) out = mix(out, dark ? WHITE : BLACK, 0.2);
  return out;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/** The semantic palette for theme data (pure; exported for fixtures). */
export function paletteFromTheme(theme: CustomTheme, ref: ThemeRef): SemanticPalette {
  const terminal = theme.terminal;
  const dark = theme.dark;
  const background = terminal?.background;
  // Light themes keep NMSh's dark-terminal text tiers in its own UI; external tools need text that reads on light.
  const primary = terminal?.foreground ?? (dark ? theme.ui.primary : mix(theme.ui.accent, BLACK, 0.78));
  const secondary = dark ? theme.ui.secondary : mix(primary, WHITE, 0.25);
  const subtle = dark ? theme.ui.subtle : mix(theme.ui.separator, BLACK, 0.2);
  const surface = background ? mix(background, dark ? WHITE : BLACK, 0.08) : dark ? mix(theme.ui.selection, BLACK, 0.35) : mix(theme.ui.accent, WHITE, 0.88);
  const selection = terminal?.selectionBackground ?? (dark ? theme.ui.selection : mix(theme.ui.accent, WHITE, 0.75));
  const roles = {success: legible(theme.ui.success, background, dark), warning: legible(theme.ui.warning, background, dark),
    failure: legible(theme.ui.failure, background, dark), info: legible(theme.ui.info, background, dark), accent: legible(theme.ui.accent, background, dark)};
  const ansi = terminal?.ansi.slice() ?? (() => {
    const base = [dark ? mix(surface, BLACK, 0.3) : subtle, roles.failure, roles.success, roles.warning, legible(theme.prompt.gitBranch, background, dark),
      roles.accent, roles.info, dark ? secondary : mix(subtle, WHITE, 0.5)];
    const bright = base.map((color, index) => index === 0 ? subtle : index === 7 ? primary : mix(color, dark ? WHITE : BLACK, 0.2));
    return [...base, ...bright];
  })();
  const syntax = {comment: subtle, string: ansi[2]!, number: ansi[3]!, keyword: roles.accent, function: ansi[4]!, type: ansi[6]!,
    constant: ansi[11]!, operator: secondary, special: ansi[13]!, preproc: ansi[5]!};
  return deepFreeze({
    ref, name: theme.name, dark, ...(background ? {background} : {}), foreground: primary,
    text: {primary, secondary, subtle}, accent: roles.accent, separator: theme.ui.separator,
    selection, selectionForeground: terminal?.selectionForeground ?? primary, surface,
    cursor: terminal?.cursor ?? roles.accent, success: roles.success, warning: roles.warning, failure: roles.failure, info: roles.info,
    prompt: {...theme.prompt}, ansi, syntax,
  });
}

/**
 * Resolves any selectable theme (built-in, family variant/accent, Imported,
 * Custom) to its immutable semantic palette. A missing or invalid reference
 * is reported; it never silently resolves to another theme.
 */
export function resolveSemanticPalette(ref: ThemeRef | undefined, source: Pick<ThemeSource, 'themes'>): PaletteResolution {
  const resolution = themeForRef(ref, source);
  if (!resolution.ok) return {ok: false, reason: resolution.reason, label: themeRefLabel(ref, source)};
  return {ok: true, palette: paletteFromTheme(resolution.theme, ref!)};
}

/** `#rrggbb` → `r;g;b` for SGR sequences in generated environment values. */
export function sgrRgb(hex: string): string {
  const color = rgb(hex);
  return `${color.red};${color.green};${color.blue}`;
}
