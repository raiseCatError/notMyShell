import stringWidth from 'string-width';
import {getCurrentGlyphMode} from '../ui/glyphs.js';

/**
 * Curated prompt glyphs. Each style offers only separators that read as that
 * style's structure; geometry styles (Powerline, Soft, Outline, Compact,
 * Ribbon) keep their shape choices and get no free-form glyph. Every choice
 * has an ASCII fallback for Safe glyph mode, and a custom glyph is one
 * validated grapheme of one or two cells, never an escape sequence.
 */

export interface GlyphChoice {
  /** Nerd / Unicode presentation. */
  glyph: string;
  /** Safe / ASCII presentation. */
  ascii: string;
  label: string;
}

export const SEPARATOR_CHOICES = {
  space: {glyph: '', ascii: '', label: 'Space'},
  dot: {glyph: '·', ascii: '.', label: 'Dot ·'},
  bullet: {glyph: '•', ascii: '*', label: 'Bullet •'},
  pipe: {glyph: '│', ascii: '|', label: 'Pipe │'},
  slash: {glyph: '/', ascii: '/', label: 'Slash /'},
  chevron: {glyph: '', ascii: '>', label: 'Chevron ›'},
  arrow: {glyph: '→', ascii: '>', label: 'Arrow →'},
  doubleChevron: {glyph: '»', ascii: '>>', label: 'Double chevron »'},
  diamond: {glyph: '◆', ascii: '*', label: 'Diamond ◆'},
  triangle: {glyph: '▸', ascii: '>', label: 'Triangle ▸'},
  dash: {glyph: '-', ascii: '-', label: 'ASCII -'},
} as const satisfies Record<string, GlyphChoice>;
export type SeparatorId = keyof typeof SEPARATOR_CHOICES;

/** Style-appropriate separators; `custom` is offered only where a text separator makes sense. */
export const MINIMAL_SEPARATORS = ['space', 'dot', 'bullet', 'pipe', 'slash', 'chevron', 'arrow', 'doubleChevron', 'diamond', 'dash', 'custom'] as const;
export const BREADCRUMB_SEPARATORS = ['chevron', 'arrow', 'slash', 'dot', 'doubleChevron', 'triangle', 'custom'] as const;
export type MinimalSeparator = typeof MINIMAL_SEPARATORS[number];
export type BreadcrumbSeparator = typeof BREADCRUMB_SEPARATORS[number];

/** Breadcrumb's slash is the Powerline thin slash in Nerd mode; everything else is shared. */
const BREADCRUMB_OVERRIDES: Partial<Record<SeparatorId, GlyphChoice>> = {slash: {glyph: '', ascii: '/', label: 'Slash /'}};

export type GlyphValidation = {ok: true; glyph: string; width: 1 | 2; warning?: string} | {ok: false; reason: string};

/** Unicode ranges whose width differs between fonts/terminals (ambiguous or emoji presentation). */
const UNCERTAIN_WIDTH = /[←-⇿⌀-⏿①-⓿─-◿☀-➿⬀-⯿️\u{1f000}-\u{1faff}]/u;

/**
 * One grapheme cluster, one or two terminal cells, no controls, no escapes,
 * no newlines. A glyph whose width depends on the font is accepted with a
 * factual warning instead of silently misaligning the prompt.
 */
export function validateGlyph(input: string): GlyphValidation {
  if (!input) return {ok: false, reason: 'Enter one character.'};
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(input)) return {ok: false, reason: 'Control characters, escapes and newlines are not allowed.'};
  const graphemes = [...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(input)];
  if (graphemes.length !== 1) return {ok: false, reason: 'Use exactly one character (one grapheme).'};
  const width = stringWidth(input);
  if (width < 1 || width > 2) return {ok: false, reason: `That glyph is ${width} cells wide; use one that is 1 or 2 cells.`};
  const warning = width === 2 ? 'Wide glyph (2 cells); some fonts draw it narrower.'
    : UNCERTAIN_WIDTH.test(input) ? 'Width can vary by font; check the preview.' : undefined;
  return {ok: true, glyph: input, width: width as 1 | 2, ...(warning ? {warning} : {})};
}

/** Stored custom glyphs are revalidated on load; anything invalid is dropped. */
export function normalizeCustomGlyph(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = validateGlyph(value);
  return result.ok ? result.glyph : undefined;
}

const isAscii = (text: string) => /^[\x20-\x7e]*$/u.test(text);

/** The separator glyph actually drawn for a style under the current glyph mode. */
export function separatorGlyph(style: 'minimal' | 'breadcrumb', id: string, custom: string | undefined, nerd = getCurrentGlyphMode() === 'nerd'): string {
  if (id === 'custom') {
    const glyph = custom ?? '';
    if (!glyph) return style === 'minimal' ? '' : (nerd ? '' : '>');
    // Safe mode keeps a custom glyph only when it is plain ASCII.
    return nerd || isAscii(glyph) ? glyph : style === 'minimal' ? '|' : '>';
  }
  const choice = (style === 'breadcrumb' ? BREADCRUMB_OVERRIDES[id as SeparatorId] : undefined) ?? SEPARATOR_CHOICES[id as SeparatorId];
  if (!choice) return '';
  if (nerd) return choice.glyph;
  return choice.ascii;
}

export function separatorLabel(id: string, custom?: string): string {
  if (id === 'custom') return custom ? `Custom ${custom}` : 'Custom';
  return SEPARATOR_CHOICES[id as SeparatorId]?.label ?? id;
}

// ---- Prompt symbol -----------------------------------------------------------

export const PROMPT_SYMBOLS = {
  chevron: {glyph: '❯', ascii: '>', label: '❯'},
  gt: {glyph: '>', ascii: '>', label: '>'},
  dollar: {glyph: '$', ascii: '$', label: '$'},
  lambda: {glyph: 'λ', ascii: '>', label: 'λ'},
  arrow: {glyph: '→', ascii: '>', label: '→'},
  heavyArrow: {glyph: '➜', ascii: '>', label: '➜'},
} as const satisfies Record<string, GlyphChoice>;
export type PromptSymbolId = keyof typeof PROMPT_SYMBOLS | 'custom';
export const PROMPT_SYMBOL_IDS: readonly PromptSymbolId[] = ['chevron', 'gt', 'dollar', 'lambda', 'arrow', 'heavyArrow', 'custom'];

export function normalizePromptSymbol(value: unknown): PromptSymbolId {
  return PROMPT_SYMBOL_IDS.includes(value as PromptSymbolId) ? value as PromptSymbolId : 'chevron';
}

/** The composer's prompt marker for a choice; Safe mode never shows a non-ASCII glyph. */
export function promptSymbolGlyph(id: PromptSymbolId, custom: string | undefined, nerd = getCurrentGlyphMode() === 'nerd'): string {
  if (id === 'custom') {
    if (!custom) return nerd ? '❯' : '>';
    return nerd || isAscii(custom) ? custom : '>';
  }
  const choice = PROMPT_SYMBOLS[id];
  return nerd ? choice.glyph : choice.ascii;
}

export function promptSymbolLabel(id: PromptSymbolId, custom?: string): string {
  return id === 'custom' ? (custom ? `Custom ${custom}` : 'Custom') : PROMPT_SYMBOLS[id].label;
}

// ---- Semantic icons -----------------------------------------------------------

/**
 * Semantic icons with fallbacks. An icon is used only where it says something
 * faster than its text, and text always stays alongside it: icons never carry
 * meaning alone. `unicode` is portable (no private-use Nerd Font code points);
 * `ascii` is strict ASCII and may be empty when the text already says it.
 */
export interface SemanticIcon {nerd: string; unicode: string; ascii: string}

export const SEMANTIC_ICONS = {
  folder: {nerd: '', unicode: '', ascii: ''},
  home: {nerd: '', unicode: '~', ascii: '~'},
  repository: {nerd: '', unicode: '', ascii: ''},
  branch: {nerd: '', unicode: '', ascii: 'git:'},
  commit: {nerd: '', unicode: '●', ascii: '@'},
  modified: {nerd: '', unicode: '~', ascii: '~'},
  node: {nerd: '', unicode: '', ascii: ''},
  python: {nerd: '', unicode: '', ascii: ''},
  go: {nerd: '', unicode: '', ascii: ''},
  rust: {nerd: '', unicode: '', ascii: ''},
  docker: {nerd: '', unicode: '', ascii: ''},
  kubernetes: {nerd: '\u{f10fe}', unicode: '', ascii: ''},
  clock: {nerd: '', unicode: '', ascii: ''},
  battery: {nerd: '', unicode: '', ascii: 'bat'},
  batteryCharging: {nerd: '', unicode: '⚡', ascii: '+'},
  cpu: {nerd: '', unicode: '', ascii: 'cpu'},
  memory: {nerd: '', unicode: '', ascii: 'ram'},
  uptime: {nerd: '', unicode: '', ascii: 'up'},
  search: {nerd: '', unicode: '?', ascii: '/'},
  settings: {nerd: '', unicode: '', ascii: ''},
  success: {nerd: '✓', unicode: '✓', ascii: '+'},
  failure: {nerd: '✕', unicode: '✕', ascii: 'x'},
  warning: {nerd: '', unicode: '!', ascii: '!'},
  info: {nerd: '', unicode: 'i', ascii: 'i'},
  update: {nerd: '', unicode: '↻', ascii: '^'},
  sparkle: {nerd: '✦', unicode: '✦', ascii: '*'},
  moon: {nerd: '', unicode: '☾', ascii: ''},
  palette: {nerd: '', unicode: '', ascii: ''},
} as const satisfies Record<string, SemanticIcon>;
export type SemanticIconId = keyof typeof SEMANTIC_ICONS;

/** The icon for the current glyph mode; Safe mode uses the ASCII form (possibly empty). */
export function semanticIcon(id: SemanticIconId, mode: 'nerd' | 'unicode' | 'ascii' = getCurrentGlyphMode() === 'nerd' ? 'nerd' : 'ascii'): string {
  return SEMANTIC_ICONS[id][mode];
}

/** Icon then text, or text alone when the mode has no icon for it. */
export function withSemanticIcon(id: SemanticIconId, text: string, mode?: 'nerd' | 'unicode' | 'ascii'): string {
  const icon = semanticIcon(id, mode);
  return icon ? `${icon} ${text}` : text;
}
