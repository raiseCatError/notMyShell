import stringWidth from 'string-width';
import type {WorkspaceColumns} from '../workspace/layout.js';
import {displayWidth, truncateAnsi} from '../util/text.js';

/**
 * Final composition of a frame with workspace regions (#330). Everything the
 * frontend draws in the middle (transcript, composer, panels, Status Strip
 * aside) is rendered at the center's width by the ordinary render path; this
 * module only places those rows, the sidebar and the detail panel side by side
 * (docked) or lays a drawer over the center, at the very end, after cursor
 * effects and transitions. It never changes what the center rows contain.
 */

const RESET = '\u001B[0m';
const OSC8_CLOSE = '\u001B]8;;\u001B\\';
const ESCAPE = /^\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\))/u;
/** Erase-in-line would wipe a neighbouring region on the same terminal row. */
const ERASE_IN_LINE = /\u001B\[[0-2]?K/gu;

/**
 * A row as exactly `width` cells: erase-in-line removed, cut (with …) when too wide, otherwise padded with spaces in
 * the row's own last style (as erase-in-line would have filled), then reset so nothing bleeds into the next region.
 */
/** Whether the row's last hyperlink sequence opens a link (a non-empty URI) that the row does not close. */
function linkOpen(row: string): boolean {
  const links = [...row.matchAll(/\u001B\]8;[^;\u0007\u001B]*;([^\u0007\u001B]*)(?:\u0007|\u001B\\)/gu)];
  return Boolean(links.at(-1)?.[1]);
}

export function fitRow(row: string, width: number): string {
  if (width <= 0) return '';
  const clean = row.replace(ERASE_IN_LINE, '');
  const used = displayWidth(clean);
  if (used > width) return truncateAnsi(clean, width);
  return `${clean}${linkOpen(clean) ? OSC8_CLOSE : ''}${' '.repeat(width - used)}${RESET}`;
}

/**
 * Columns [start, start + width) of a row, keeping the SGR style in effect where the slice begins. Other escape
 * sequences (hyperlinks, erase) are dropped: the slice is what stays visible beside a drawer. A wide character cut by
 * an edge becomes a space so columns stay aligned.
 */
export function sliceColumns(row: string, start: number, width: number): string {
  if (width <= 0) return '';
  let out = '';
  let sgr = '';
  let column = 0;
  let started = false;
  const end = start + width;
  for (let index = 0; index < row.length && column < end;) {
    if (row[index] === '\u001B') {
      const match = ESCAPE.exec(row.slice(index));
      if (match) {
        const sequence = match[0];
        if (/^\u001B\[[0-9;:]*m$/u.test(sequence)) {
          if (/^\u001B\[0?m$/u.test(sequence)) sgr = ''; else sgr += sequence;
          if (started) out += sequence;
        }
        index += sequence.length;
        continue;
      }
    }
    const codePoint = row.codePointAt(index)!;
    const character = String.fromCodePoint(codePoint);
    index += character.length;
    const cells = stringWidth(character);
    if (cells === 0) { if (started) out += character; continue; }
    if (column + cells <= start) { column += cells; continue; }
    if (!started) { out += sgr; started = true; }
    if (column < start || column + cells > end) out += ' '.repeat(Math.min(end, column + cells) - Math.max(start, column));
    else out += character;
    column += cells;
  }
  const used = Math.max(0, Math.min(column, end) - start);
  return `${out}${' '.repeat(Math.max(0, width - used))}${RESET}`;
}

export interface WorkspaceFrameInput {
  /** The frame's rows as rendered for the center (center-width). */
  rows: readonly string[];
  plan: WorkspaceColumns;
  /** Sidebar rows for the rows it spans (index 0 = first spanned row), when the sidebar is drawn. */
  sidebar?: readonly string[];
  panel?: readonly string[];
  /** Frame rows drawn at the terminal's full width instead (the Status Strip). */
  fullWidth?: ReadonlyMap<number, string>;
  /** The divider cell, styled. */
  divider: string;
}

/** The composed rows, one per frame row, each exactly the terminal's width. Rows outside the regions' span are left full width. */
export function composeWorkspaceRows(input: WorkspaceFrameInput): string[] {
  const {plan, rows} = input;
  const sidebar = plan.sidebar.mode !== 'hidden' ? plan.sidebar.region : undefined;
  const panel = plan.panel.mode !== 'hidden' ? plan.panel.region : undefined;
  let span = 0;
  return rows.map((row, index) => {
    const full = input.fullWidth?.get(index);
    if (full !== undefined) return fitRow(full, plan.columns);
    const at = span++;
    const sideRow = input.sidebar?.[at] ?? '';
    const panelRow = input.panel?.[at] ?? '';
    // Docked: own columns either side of the center, one divider cell each.
    let center = fitRow(row, plan.center.width);
    if (plan.sidebar.mode === 'drawer' && sidebar) {
      const width = Math.min(sidebar.width, plan.center.width);
      center = `${fitRow(sideRow, width)}${width + 1 < plan.center.width ? `${input.divider}${sliceColumns(row, width + 1, plan.center.width - width - 1)}`
        : ' '.repeat(plan.center.width - width)}`;
    }
    if (plan.panel.mode === 'drawer' && panel) {
      // The drawer keeps its right edge on the terminal's; it never reaches left of the center.
      const left = Math.max(0, Math.min(plan.center.width, panel.x - plan.center.x));
      center = `${left > 0 ? `${sliceColumns(row, 0, left - 1)}${input.divider}` : ''}${fitRow(panelRow, plan.center.width - left)}`;
    }
    const leftDocked = plan.sidebar.mode === 'docked' || plan.sidebar.mode === 'compact';
    return `${leftDocked && sidebar ? `${fitRow(sideRow, sidebar.width)}${input.divider}` : ''}${center}${plan.panel.mode === 'docked' && panel ? `${input.divider}${fitRow(panelRow, panel.width)}` : ''}`;
  });
}
