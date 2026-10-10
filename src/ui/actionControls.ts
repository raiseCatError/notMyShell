import {displayWidth, truncateText} from '../util/text.js';
import {getCurrentGlyphMode} from './glyphs.js';
import {background, foreground, UI_COLORS} from './palette.js';

/**
 * Action controls: how a handful of semantic actions (Apply / Cancel, Yes / No, Diff / Checks) are drawn at the foot of
 * a panel. Identity and handler stay semantic: a control is `{id, label, state}` and the renderer never decides what an
 * action may do or whether it is available, it only draws what its caller says is available (and says why not, for a
 * disabled one). Appearance is separate from behavior:
 *
 *   state    default · focused · selected · disabled · destructive · destructiveFocused
 *   style    outline (default) · filled · soft · plain
 *   geometry square [ ] · rounded ( )
 *
 * Every state is told apart by its marks, not by color, so NO_COLOR, low-color and Safe/ASCII terminals lose nothing:
 *
 *   default            [ Apply ]
 *   focused            [▸Apply◂]       (Safe: [>Apply<])
 *   selected           [✓ Apply ]      (Safe: [x Apply ])
 *   disabled           [– Apply ]      (Safe: [- Apply ])   its reason is listed under the row
 *   destructive        [! Delete ]
 *   destructiveFocused [▸!Delete◂]
 *
 * Labels are untrusted text (a branch name, a title): control and format characters are removed, and every control is
 * measured in display cells. When a row does not fit, essential controls keep their words and the others fold into
 * "+N" first; below that, styles drop to plain, then to the key letters.
 */
export type ActionState = 'default' | 'focused' | 'selected' | 'disabled' | 'destructive' | 'destructiveFocused';
export type ActionStyle = 'outline' | 'filled' | 'soft' | 'plain';
export type ActionGeometry = 'square' | 'rounded';

export interface ActionControl {
  /** Semantic identity (`Action.Apply`): returned by hit-testing, never derived from the label. */
  id: string;
  label: string;
  state: ActionState;
  /** The key that invokes it, when it has one; shown as a hint and used in the tightest layout. */
  key?: string;
  /** Why a disabled control is disabled (required for the reason line; a disabled control without one is not drawn). */
  reason?: string;
  /** Kept with its words when space runs out; non-essential controls fold into "+N" first. */
  essential?: boolean;
}

export interface ActionRowOptions {
  columns: number;
  style?: ActionStyle;
  geometry?: ActionGeometry;
  /** Force Safe/ASCII marks; by default follows the current glyph mode. */
  safe?: boolean;
  /** Show each control's key after it (`[>Apply<] Enter`), so the keyboard way is always visible. */
  keys?: boolean;
  /** Draw escapes; false gives plain text (used by tests and for transcripts, which never receive chrome). */
  color?: boolean;
}

export interface ActionRegion { id: string; row: number; column: number; end: number }
export interface ActionRow { rows: string[]; regions: ActionRegion[]; plain: string[] }

const clean = (text: string) => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim();

interface Marks { left: string; right: string; focusLeft: string; focusRight: string; selected: string; disabled: string; destructive: string }

function marks(geometry: ActionGeometry, safe: boolean): Marks {
  const [left, right] = geometry === 'rounded' ? ['(', ')'] : ['[', ']'];
  return safe ? {left, right, focusLeft: '>', focusRight: '<', selected: 'x ', disabled: '- ', destructive: '! '}
    : {left, right, focusLeft: '▸', focusRight: '◂', selected: '✓ ', disabled: '– ', destructive: '! '};
}

/** One control as plain text in the given style (marks only, no color). Every state has its own marks, so none depends on color. */
export function actionText(control: ActionControl, style: ActionStyle, geometry: ActionGeometry, safe: boolean, label = clean(control.label)): string {
  const m = marks(geometry, safe);
  const focused = control.state === 'focused' || control.state === 'destructiveFocused';
  const lead = control.state === 'selected' ? m.selected : control.state === 'disabled' ? m.disabled
    : control.state === 'destructive' || control.state === 'destructiveFocused' ? m.destructive : '';
  const inner = focused ? `${m.focusLeft}${lead.trim()}${label}${m.focusRight}` : `${lead || ' '}${label} `;
  return style === 'plain' ? inner.trim() : `${m.left}${inner}${m.right}`;
}

function paint(control: ActionControl, text: string, style: ActionStyle, color: boolean): string {
  if (!color) return text;
  const reset = '\u001b[0m';
  const destructive = control.state === 'destructive' || control.state === 'destructiveFocused';
  const tone = control.state === 'disabled' ? UI_COLORS.subtle : destructive ? UI_COLORS.failure : control.state === 'selected' ? UI_COLORS.success
    : control.state === 'focused' ? UI_COLORS.accent : style === 'soft' ? UI_COLORS.subtle : UI_COLORS.secondary;
  const weight = control.state === 'focused' || control.state === 'destructiveFocused' ? '\u001b[1m' : control.state === 'disabled' ? '\u001b[2m' : '';
  // Filled draws the control as a block; the foreground then follows the chrome's primary text so it stays readable.
  return style === 'filled' ? `${background(tone)}${foreground(UI_COLORS.primary)}${weight}${text}${reset}` : `${weight}${foreground(tone)}${text}${reset}`;
}

/**
 * The controls as one or more rows that fit `columns`, with the region each control occupies (for the pointer, which
 * invokes the same semantic action as its key) and the plain text of each row. Disabled controls add a reason row.
 */
export function renderActionRow(controls: readonly ActionControl[], options: ActionRowOptions): ActionRow {
  const safe = options.safe ?? getCurrentGlyphMode() === 'safe';
  const geometry = options.geometry ?? 'square';
  const color = options.color ?? true;
  const columns = Math.max(4, options.columns);
  const shown = controls.filter(control => control.state !== 'disabled' || control.reason);
  const gap = 1;
  const attempt = (style: ActionStyle, only: readonly ActionControl[], label: (control: ActionControl) => string) => {
    const parts = only.map(control => ({control, text: actionText(control, style, geometry, safe, label(control)) + (options.keys && control.key && label === words ? ` ${clean(control.key)}` : '')}));
    return {parts, width: parts.reduce((sum, part) => sum + displayWidth(part.text), 0) + gap * Math.max(0, parts.length - 1)};
  };
  const words = (control: ActionControl) => truncateText(clean(control.label), 24) || (control.key ?? control.id);
  const keysOnly = (control: ActionControl) => control.key ?? truncateText(clean(control.label), 1);
  const essential = shown.filter(control => control.essential || control.state === 'focused' || control.state === 'destructiveFocused');
  const kept = essential.length ? essential : shown.slice(0, 1);
  const first = kept.slice(0, 1);
  // Widest first; the first form that fits is used. The last form always fits (its text is cut to the width).
  const ladder: Array<{style: ActionStyle; only: readonly ActionControl[]; label: (control: ActionControl) => string}> = [
    {style: options.style ?? 'outline', only: shown, label: words}, {style: 'plain', only: shown, label: words},
    {style: 'plain', only: kept, label: words}, {style: 'plain', only: kept, label: keysOnly}, {style: 'plain', only: first, label: keysOnly},
    {style: 'plain', only: first, label: control => truncateText(keysOnly(control), Math.max(1, columns - 2))},
  ];
  let style = ladder[0]!.style;
  let layout = attempt(style, shown, words);
  let folded = 0;
  for (const step of ladder) {
    const candidate = attempt(step.style, step.only, step.label);
    const hidden = shown.length - step.only.length;
    const extra = hidden ? displayWidth(` +${hidden}`) : 0;
    style = step.style; layout = candidate; folded = hidden;
    if (candidate.width + extra <= columns) break;
  }
  const rows: string[] = [];
  const plain: string[] = [];
  const regions: ActionRegion[] = [];
  let line = '';
  let plainLine = '';
  let column = 1;
  const flush = () => { if (plainLine) { rows.push(line); plain.push(plainLine); } line = ''; plainLine = ''; column = 1; };
  for (const part of layout.parts) {
    const width = displayWidth(part.text);
    if (plainLine && column + width > columns) flush();
    if (plainLine) { line += ' '; plainLine += ' '; column += gap; }
    regions.push({id: part.control.id, row: rows.length, column, end: column + width - 1});
    line += paint(part.control, part.text, style, color);
    plainLine += part.text;
    column += width;
  }
  // The count of folded controls is shown when there is room for it; the control itself always comes first.
  if (folded && displayWidth(plainLine) + displayWidth(` +${folded}`) <= columns) { const more = ` +${folded}`; line += more; plainLine += more; }
  flush();
  for (const control of shown) {
    if (control.state === 'disabled' && control.reason) { const reason = `${clean(control.label)}: ${truncateText(clean(control.reason), Math.max(8, columns - displayWidth(clean(control.label)) - 2))}`; rows.push(color ? `${foreground(UI_COLORS.subtle)}${reason}\u001b[0m` : reason); plain.push(reason); }
  }
  return {rows, regions, plain};
}

/** Contextual help text for the same controls: key, label and, for a disabled one, why it is unavailable. Nothing is listed that is not drawn. */
export function describeActions(controls: readonly ActionControl[]): string[] {
  return controls.filter(control => control.state !== 'disabled' || control.reason).map(control => {
    const key = control.key ? `${control.key}  ` : '';
    return control.state === 'disabled' ? `${key}${clean(control.label)} (unavailable: ${clean(control.reason!)})` : `${key}${clean(control.label)}`;
  });
}

/** The control a click at (row, column) lands on, or undefined: the pointer invokes the same semantic action as its key. */
export function hitAction(regions: readonly ActionRegion[], row: number, column: number): string | undefined {
  return regions.find(region => region.row === row && column >= region.column && column <= region.end)?.id;
}
