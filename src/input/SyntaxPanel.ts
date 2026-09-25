import {
  NATIVE_PALETTE_IDS,
  SYNTAX_COLOR_MODES,
  type NativePaletteId,
  type SyntaxAppearance,
  type SyntaxColorMode,
} from '../prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../prompt/prompt.js';
import type {CommandType} from '../shell/SemanticService.js';
import type {Key} from '../terminal/keys.js';
import {renderControls} from '../ui/controls.js';
import {GLYPHS} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';
import {graphemes} from './inputLayout.js';
import {Highlighter} from './Highlighter.js';
import {syntaxCharStyles, syntaxSgr} from './syntaxTheme.js';

export interface SyntaxPanelState {
  selectedIndex: number;
  draft: SyntaxAppearance;
  /** The syntax appearance in effect; the draft is only a preview until saved. */
  saved: SyntaxAppearance;
  message?: string;
}

type Row = 'highlighting' | 'colors' | 'theme';

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const ACCENT = foreground(UI_COLORS.accent);
const SUBTLE = foreground(UI_COLORS.subtle);
const RESET = '\u001B[0m';

/** Short rows that together exercise every token type. */
export const SYNTAX_PREVIEW_LINES = [
  'git commit -m "message" ~/Projects',
  'echo $HOME && ll | unknown-cmd --force',
  'cd ~ ; greet # comments look like this',
] as const;

/**
 * Deterministic semantics for the preview: nothing is looked up or run.
 * `ll` is an alias and `greet` a function so every command class appears.
 */
export const SYNTAX_PREVIEW_SEMANTICS: ReadonlyMap<string, CommandType> = new Map<string, CommandType>([
  ['git', 'executable'], ['echo', 'builtin'], ['cd', 'builtin'], ['ll', 'alias'], ['greet', 'function'], ['unknown-cmd', 'unknown'],
]);

const highlighter = new Highlighter();

export function colorModeLabel(mode: SyntaxColorMode): string {
  return mode === 'followPrompt' ? 'Follow prompt theme' : mode === 'theme' ? 'Choose theme' : 'Grayscale';
}

/** Colors only matter while highlighting is on; Theme only in Choose theme. */
function rows(draft: SyntaxAppearance): Row[] {
  if (!draft.highlighting) return ['highlighting'];
  return ['highlighting', 'colors', ...(draft.colors === 'theme' ? ['theme' as const] : [])];
}

function cycle<T>(values: readonly T[], current: T, delta: number): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + delta + values.length) % values.length]!;
}

export function syntaxDraftChanged(state: SyntaxPanelState): boolean {
  return JSON.stringify(state.draft) !== JSON.stringify(state.saved);
}

export function handleSyntaxPanelKey(key: Key, state: SyntaxPanelState): boolean {
  const available = rows(state.draft);
  if (key.kind === 'up') state.selectedIndex = (state.selectedIndex - 1 + available.length) % available.length;
  else if (key.kind === 'down') state.selectedIndex = (state.selectedIndex + 1) % available.length;
  else if (key.kind === 'left' || key.kind === 'right') {
    const delta = key.kind === 'left' ? -1 : 1;
    const draft = state.draft;
    switch (available[state.selectedIndex]) {
      case 'highlighting': draft.highlighting = !draft.highlighting; break;
      case 'colors': draft.colors = cycle(SYNTAX_COLOR_MODES, draft.colors, delta); break;
      case 'theme': draft.theme = cycle(NATIVE_PALETTE_IDS, draft.theme, delta); break;
      default: return false;
    }
    state.selectedIndex = Math.min(state.selectedIndex, rows(draft).length - 1);
  } else return false;
  state.message = undefined;
  return true;
}

/** One preview line through the real Highlighter and style resolver. */
export function renderSyntaxPreviewLine(text: string, syntax: SyntaxAppearance, promptPalette: NativePaletteId): string {
  const characters = graphemes(text);
  const tokens = highlighter.tokenize(characters, SYNTAX_PREVIEW_SEMANTICS as Map<string, CommandType>);
  const styles = syntaxCharStyles(tokens, characters.length, syntaxSgr(syntax, promptPalette));
  return characters.map((character, index) => `${styles[index]}${character}${RESET}`).join('');
}

export function renderSyntaxPanel(state: SyntaxPanelState, columns: number, promptPalette: NativePaletteId, rowsAvailable = Infinity): string[] {
  const {draft, saved} = state;
  const out = [`${PRIMARY}  Syntax highlighting${RESET}`, ''];
  const value = (text: string, savedText: string) => text === savedText ? `‹ ${text} ›` : `‹ ${text} ›  ${SUBTLE}saved: ${savedText}`;
  const onOff = (on: boolean) => on ? 'On' : 'Off';
  const labels: Record<Row, string> = {
    highlighting: `Highlighting   ${value(onOff(draft.highlighting), onOff(saved.highlighting))}`,
    colors: `Colors         ${value(colorModeLabel(draft.colors), colorModeLabel(saved.colors))}`,
    theme: `Theme          ${value(NATIVE_PROMPT_THEMES[draft.theme].label, NATIVE_PROMPT_THEMES[saved.theme].label)}`,
  };
  rows(draft).forEach((row, index) => {
    const selected = index === state.selectedIndex;
    out.push(`${selected ? `${ACCENT}›` : ' '} ${selected ? ACCENT : SECONDARY}${labels[row]}${RESET}`);
  });
  if (draft.highlighting && draft.colors === 'followPrompt') {
    out.push(`  ${SUBTLE}Following ${NATIVE_PROMPT_THEMES[promptPalette].label} (the Native palette, even with Starship or Powerlevel10k)${RESET}`);
  }

  const gallery: string[] = [];
  if (draft.highlighting && draft.colors === 'theme') {
    gallery.push('', `${PRIMARY}Syntax themes${RESET}  ${SUBTLE}● selected  ✓ saved${RESET}`);
    for (const id of NATIVE_PALETTE_IDS) {
      const marker = draft.theme === id ? `${ACCENT}●` : `${SUBTLE}○`;
      const savedMark = saved.highlighting && saved.colors === 'theme' && saved.theme === id ? '✓' : ' ';
      const sample = renderSyntaxPreviewLine(SYNTAX_PREVIEW_LINES[1], {...draft, theme: id}, promptPalette);
      gallery.push(`${marker} ${SECONDARY}${NATIVE_PROMPT_THEMES[id].label.padEnd(17)}${ACCENT}${savedMark}${RESET} ${sample}`);
    }
  }

  const preview = ['', `${PRIMARY}Preview${RESET}  ${syntaxDraftChanged(state) ? `${ACCENT}unsaved preview` : `${SUBTLE}matches current`}${RESET}`,
    ...SYNTAX_PREVIEW_LINES.map(line => `  ${ACCENT}${GLYPHS.prompt}${RESET} ${renderSyntaxPreviewLine(line, draft, promptPalette)}`)];
  if (state.message) preview.push(`${SECONDARY}${state.message}${RESET}`);
  const controls = ['', renderControls([['↑↓', 'move'], ['←→', 'change'], ['Enter', 'save'], ['Esc', 'cancel']])];

  const includeGallery = out.length + gallery.length + preview.length + controls.length <= rowsAvailable;
  return [...out, ...(includeGallery ? gallery : []), ...preview, ...controls].map(row => truncateAnsi(row, columns));
}
