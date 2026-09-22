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

export function graphemes(value: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
  return Array.from(segmenter.segment(value), part => part.segment);
}

export function layoutInput(
  value: string,
  cursorIndex: number,
  columns: number,
  maxVisibleRows = Number.POSITIVE_INFINITY,
): InputLayout {
  const glyphs = graphemes(value);
  const safeCursor = Math.max(0, Math.min(glyphs.length, cursorIndex));
  const width = Math.max(1, columns);
  const INPUT_PREFIX = `${GLYPHS.prompt} `;
  const rows: InputRow[] = [{prefix: width >= 2 ? INPUT_PREFIX : GLYPHS.prompt, text: '', charStart: 0, charEnd: 0}];
  let rowIndex = 0;
  let contentWidth = 0;
  let caretRow = 0;
  let caretColumn = stringWidth(rows[0].prefix);

  const markCaret = (index: number): void => {
    if (index === safeCursor) {
      caretRow = rowIndex;
      caretColumn = Math.min(width - 1, stringWidth(rows[rowIndex].prefix) + contentWidth);
    }
  };

  const addRow = (nextCharStart: number): void => {
    rows[rowIndex].charEnd = nextCharStart;
    rows.push({prefix: width >= 2 ? CONTINUATION_PREFIX : '', text: '', charStart: nextCharStart, charEnd: nextCharStart});
    rowIndex += 1;
    contentWidth = 0;
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
    const prefixWidth = stringWidth(rows[rowIndex].prefix);
    const available = Math.max(1, width - prefixWidth);
    const glyphWidth = Math.max(0, stringWidth(glyph));
    if (contentWidth > 0 && contentWidth + glyphWidth > available) addRow(index);
    rows[rowIndex].text += glyph;
    rows[rowIndex].charEnd = index + 1;
    contentWidth += glyphWidth;
    const next = glyphs[index + 1];
    if (contentWidth >= Math.max(1, width - stringWidth(rows[rowIndex].prefix)) && next !== '\n') addRow(index + 1);
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
