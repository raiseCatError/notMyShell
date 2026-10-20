import {PLACEHOLDER_DIACRITICS} from './diacritics.js';

/**
 * Kitty graphics with Unicode placeholders: the image is transmitted once, a *virtual* placement says how many cells it
 * covers, and the document then holds ordinary text cells (U+10EEEE plus a row and a column diacritic, colored with the
 * image's id). The terminal paints the right slice of the image under each cell, so the image scrolls, clips, wraps and
 * repaints exactly like the rows around it, and NMSh's diffing renderer needs no knowledge of it. Deleting the image
 * (`a=d,d=I`) removes it everywhere.
 * See https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders
 */
export const PLACEHOLDER_CHAR = String.fromCodePoint(0x10eeee);
/** The most rows or columns one image can span: the diacritic table's length. */
export const MAX_PLACEHOLDER_SPAN = PLACEHOLDER_DIACRITICS.length;

const ESC = '\u001b';
const ST = `${ESC}\\`;

/** Ids are 24-bit so one truecolor foreground carries them; NMSh's range is kept apart from programs' own. */
export const PLACEHOLDER_ID_BASE = 0x4e4d00;
export const PLACEHOLDER_ID_LIMIT = 0xffffff;

/** The virtual placement: how many cells image `id` covers when a placeholder cell names it. */
export function kittyVirtualPlacement(id: number, columns: number, rows: number): string {
  checkId(id);
  if (columns < 1 || rows < 1 || columns > MAX_PLACEHOLDER_SPAN || rows > MAX_PLACEHOLDER_SPAN) throw new RangeError('placeholder placement out of range');
  return `${ESC}_Ga=p,U=1,i=${id},c=${Math.floor(columns)},r=${Math.floor(rows)},q=2${ST}`;
}

/** Placeholder rows for an image `columns` x `rows` cells: text, one string per row, each exactly `columns` cells wide. */
export function placeholderRows(id: number, columns: number, rows: number): string[] {
  checkId(id);
  if (columns < 1 || rows < 1 || columns > MAX_PLACEHOLDER_SPAN || rows > MAX_PLACEHOLDER_SPAN) throw new RangeError('placeholder span out of range');
  const color = `${ESC}[38;2;${(id >> 16) & 255};${(id >> 8) & 255};${id & 255}m`;
  const out: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    let line = color;
    // The row diacritic is written on the first cell; later cells of the row inherit it (the protocol allows omitting
    // repeated values), but spelling every cell out keeps a partly repainted row correct, so each cell carries both.
    for (let column = 0; column < columns; column += 1) {
      line += `${PLACEHOLDER_CHAR}${String.fromCodePoint(PLACEHOLDER_DIACRITICS[row]!)}${String.fromCodePoint(PLACEHOLDER_DIACRITICS[column]!)}`;
    }
    out.push(`${line}${ESC}[39m`);
  }
  return out;
}

/** Remove an image and every placement of it, freeing its data. */
export function kittyDeleteImage(id: number): string {
  checkId(id);
  return `${ESC}_Ga=d,d=I,i=${id},q=2${ST}`;
}

function checkId(id: number): void {
  if (!Number.isInteger(id) || id < 1 || id > PLACEHOLDER_ID_LIMIT) throw new RangeError('placeholder image id out of range');
}

/** True when text holds any Kitty graphics bytes (for tests proving a fallback emitted none). */
export function containsKittyBytes(text: string): boolean {
  return text.includes(`${ESC}_G`) || text.includes(PLACEHOLDER_CHAR);
}
