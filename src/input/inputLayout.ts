import {GLYPHS} from '../ui/glyphs.js';
import stringWidth from 'string-width';

export const CONTINUATION_PREFIX = '  ';

export interface InputRow {
  prefix: string;
  text: string;
  /** Index (in graphemes) of the first character on this row. */
  charStart: number;
  /** Index (in graphemes) one past the last character on this row. */
  charEnd: number;
}

export interface InputLayout {
  allRows: InputRow[];
  rows: InputRow[];
  caretRow: number;
  caretColumn: number;
  firstVisibleRow: number;
}

let segmenter: Intl.Segmenter | undefined;

export function graphemes(value: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, {granularity: 'grapheme'});
  return Array.from(segmenter.segment(value), part => part.segment);
}

export function layoutInput(
  value: string,
  cursorIndex: number,
  columns: number,
  maxVisibleRows = Number.POSITIVE_INFINITY,
  firstLinePrefix?: string,
): InputLayout {
  return computeInputLayout(value, cursorIndex, columns, maxVisibleRows, firstLinePrefix);
}

export interface InputCaret {
  row: number;
  column: number;
}

/** All caret positions from the same wrapping pass, for visual-row navigation. */
export function inputCaretPositions(value: string, columns: number, firstLinePrefix?: string): InputCaret[] {
  const carets: InputCaret[] = [];
  computeInputLayout(value, 0, columns, Number.POSITIVE_INFINITY, firstLinePrefix, carets);
  return carets;
}

function computeInputLayout(
  value: string,
  cursorIndex: number,
  columns: number,
  maxVisibleRows: number,
  firstLinePrefix?: string,
  carets?: InputCaret[],
): InputLayout {
  const glyphs = graphemes(value);
  const safeCursor = Math.max(0, Math.min(glyphs.length, cursorIndex));
  const width = Math.max(1, columns);
  const INPUT_PREFIX = firstLinePrefix ?? `${GLYPHS.prompt} `;
  // An explicitly empty prefix (Prompt None) means no marker and no continuation indent.
  const bare = firstLinePrefix === '';
  const rows: InputRow[] = [{prefix: bare ? '' : width >= 2 ? INPUT_PREFIX : GLYPHS.prompt, text: '', charStart: 0, charEnd: 0}];
  let rowIndex = 0;
  let contentWidth = 0;
  let caretRow = 0;
  let prefixWidth = stringWidth(rows[0].prefix);
  let available = Math.max(1, width - prefixWidth);
  let caretColumn = prefixWidth;

  const markCaret = (index: number): void => {
    if (carets) carets.push({row: rowIndex, column: Math.min(width - 1, prefixWidth + contentWidth)});
    if (index === safeCursor) {
      caretRow = rowIndex;
      caretColumn = Math.min(width - 1, prefixWidth + contentWidth);
    }
  };

  const addRow = (nextCharStart: number): void => {
    rows[rowIndex].charEnd = nextCharStart;
    rows.push({prefix: !bare && width >= 4 ? CONTINUATION_PREFIX : '', text: '', charStart: nextCharStart, charEnd: nextCharStart});
    rowIndex += 1;
    contentWidth = 0;
    prefixWidth = stringWidth(rows[rowIndex].prefix);
    available = Math.max(1, width - prefixWidth);
  };

  for (let index = 0; index < glyphs.length; index += 1) {
    markCaret(index);
    const glyph = glyphs[index];
    if (glyph === '\n') {
      // Include the newline itself in this row's range for selection math.
      rows[rowIndex].charEnd = index + 1;
      addRow(index + 1);
      continue;
    }
    const glyphWidth = Math.max(0, stringWidth(glyph));
    if (contentWidth === 0 && prefixWidth > 0 && glyphWidth > available) {
      addRow(index);
    }
    if (contentWidth > 0 && contentWidth + glyphWidth > available) addRow(index);
    rows[rowIndex].text += glyph;
    rows[rowIndex].charEnd = index + 1;
    contentWidth += glyphWidth;
    const next = glyphs[index + 1];
    if (contentWidth >= available && next !== '\n') addRow(index + 1);
  }
  markCaret(glyphs.length);
  rows[rowIndex].charEnd = glyphs.length;

  const visibleCount = Math.max(1, Math.min(rows.length, Math.floor(maxVisibleRows)));
  const firstVisibleRow = Math.max(0, Math.min(caretRow, rows.length - visibleCount));
  return {
    allRows: rows,
    rows: rows.slice(firstVisibleRow, firstVisibleRow + visibleCount),
    caretRow: caretRow - firstVisibleRow,
    caretColumn,
    firstVisibleRow,
  };
}
