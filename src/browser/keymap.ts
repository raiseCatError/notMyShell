import type {Key} from '../terminal/keys.js';
import type {KeyEventInput} from './types.js';

/**
 * What a page gets for a key the person typed while the page has focus. NMSh's `Key` is already decoded from terminal bytes,
 * so only what the decoder can tell apart can be forwarded: it reports Ctrl+letter as the editing action that byte stands for
 * (Ctrl+A arrives as "line home"), which is mapped back to the letter; Ctrl+C never arrives here (it closes the browser).
 */
export const ALT = 1;
export const CTRL = 2;
export const META = 4;
export const SHIFT = 8;

const UNSHIFTED: Readonly<Record<string, string>> = {
  '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon', '\'': 'Quote',
  ',': 'Comma', '.': 'Period', '/': 'Slash', '`': 'Backquote', ' ': 'Space',
};
/** US layout: the shifted symbol and the key it sits on. */
const SHIFTED: Readonly<Record<string, string>> = {
  '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', '$': 'Digit4', '%': 'Digit5', '^': 'Digit6', '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0',
  '_': 'Minus', '+': 'Equal', '{': 'BracketLeft', '}': 'BracketRight', '|': 'Backslash', ':': 'Semicolon', '"': 'Quote',
  '<': 'Comma', '>': 'Period', '?': 'Slash', '~': 'Backquote',
};

/** The Ctrl+letter each decoded kind stands for. */
const CTRL_LETTERS: Readonly<Record<string, string>> = {
  deleteWord: 'w', deleteLineBefore: 'u', deleteLineAfter: 'k', historySearch: 'r', find: 'f', toggleDetails: 'o', queueCommand: 'q',
  sendToProgram: 's', redo: 'y', suggestNext: 'n', suggestPrevious: 'p', historyDelete: 'x', latest: 'g', eof: 'd', suspend: 'z',
};

const NAMED: Readonly<Record<string, KeyEventInput>> = {
  enter: {key: 'Enter', code: 'Enter', text: '\r'},
  newline: {key: 'Enter', code: 'Enter', text: '\r', modifiers: SHIFT},
  complete: {key: 'Tab', code: 'Tab'},
  focusPrevious: {key: 'Tab', code: 'Tab', modifiers: SHIFT},
  backspace: {key: 'Backspace', code: 'Backspace'},
  delete: {key: 'Delete', code: 'Delete'},
  escape: {key: 'Escape', code: 'Escape'},
  left: {key: 'ArrowLeft', code: 'ArrowLeft'}, right: {key: 'ArrowRight', code: 'ArrowRight'},
  up: {key: 'ArrowUp', code: 'ArrowUp'}, down: {key: 'ArrowDown', code: 'ArrowDown'},
  lineHome: {key: 'Home', code: 'Home'}, lineEnd: {key: 'End', code: 'End'},
  pageUp: {key: 'PageUp', code: 'PageUp'}, pageDown: {key: 'PageDown', code: 'PageDown'},
  selectLeft: {key: 'ArrowLeft', code: 'ArrowLeft', modifiers: SHIFT}, selectRight: {key: 'ArrowRight', code: 'ArrowRight', modifiers: SHIFT},
  selectUp: {key: 'ArrowUp', code: 'ArrowUp', modifiers: SHIFT}, selectDown: {key: 'ArrowDown', code: 'ArrowDown', modifiers: SHIFT},
  selectLineHome: {key: 'Home', code: 'Home', modifiers: SHIFT}, selectLineEnd: {key: 'End', code: 'End', modifiers: SHIFT},
  wordLeft: {key: 'ArrowLeft', code: 'ArrowLeft', modifiers: ALT}, wordRight: {key: 'ArrowRight', code: 'ArrowRight', modifiers: ALT},
  selectWordLeft: {key: 'ArrowLeft', code: 'ArrowLeft', modifiers: ALT | SHIFT}, selectWordRight: {key: 'ArrowRight', code: 'ArrowRight', modifiers: ALT | SHIFT},
  bufferHome: {key: 'Home', code: 'Home', modifiers: CTRL}, bufferEnd: {key: 'End', code: 'End', modifiers: CTRL},
  selectBufferHome: {key: 'Home', code: 'Home', modifiers: CTRL | SHIFT}, selectBufferEnd: {key: 'End', code: 'End', modifiers: CTRL | SHIFT},
  selectAll: {key: 'a', code: 'KeyA', modifiers: META},
  palette: {key: 'F1', code: 'F1'},
  previousFailure: {key: 'F8', code: 'F8'}, nextFailure: {key: 'F8', code: 'F8', modifiers: SHIFT},
};

/** The key event for a decoded key, or undefined when the key is not a keystroke (mouse, focus, paste, interrupt). */
export function keyToInput(key: Key): KeyEventInput | undefined {
  if (key.kind === 'text') return textInput(key.value);
  const letter = CTRL_LETTERS[key.kind];
  if (letter) return {key: letter, code: `Key${letter.toUpperCase()}`, modifiers: CTRL};
  const named = NAMED[key.kind];
  return named ? {...named} : undefined;
}

function textInput(value: string): KeyEventInput | undefined {
  if (!value || [...value].length !== 1) return value ? {key: value, text: value} : undefined;
  if (/^[a-z]$/u.test(value)) return {key: value, code: `Key${value.toUpperCase()}`, text: value};
  if (/^[A-Z]$/u.test(value)) return {key: value, code: `Key${value}`, text: value, modifiers: SHIFT};
  if (/^[0-9]$/u.test(value)) return {key: value, code: `Digit${value}`, text: value};
  const plain = UNSHIFTED[value];
  if (plain) return {key: value, code: plain, text: value};
  const shifted = SHIFTED[value];
  if (shifted) return {key: value, code: shifted, text: value, modifiers: SHIFT};
  return {key: value, text: value};
}

// ---- mouse ----------------------------------------------------------------------------------------------------------

export interface CellPoint {
  /** 1-based screen column and row, as the terminal reports them. */
  x: number;
  y: number;
}

export interface MouseGeometry {
  /** The page area on screen: 1-based column and row of its top-left cell, and its size in cells. */
  area: {row: number; column: number; columns: number; rows: number};
  /** Terminal pixels per cell (the graphics decision's). */
  cell: {width: number; height: number};
  /** Device pixel ratio of the frames: a frame pixel is `scale` per CSS pixel, so CSS pixels = terminal pixels / scale. */
  scale: number;
  /** The page's viewport in CSS pixels, to keep a point inside it. */
  viewport?: {width: number; height: number};
}

/** True when a cell lies inside the page area. */
export function insideArea(cell: CellPoint, area: MouseGeometry['area']): boolean {
  return cell.x >= area.column && cell.x < area.column + area.columns && cell.y >= area.row && cell.y < area.row + area.rows;
}

/**
 * The CSS-pixel point at the middle of a terminal cell, relative to the page's top-left, or undefined outside the page area
 * (a click on the browser's own rows is never forwarded). `clamp` keeps a point that left the area on its nearest edge, for a
 * button release after a drag.
 */
export function cellToViewport(cell: CellPoint, geometry: MouseGeometry, options: {clamp?: boolean} = {}): {x: number; y: number} | undefined {
  const {area} = geometry;
  let x = cell.x;
  let y = cell.y;
  if (!insideArea(cell, area)) {
    if (!options.clamp) return undefined;
    x = Math.min(area.column + area.columns - 1, Math.max(area.column, x));
    y = Math.min(area.row + area.rows - 1, Math.max(area.row, y));
  }
  const scale = geometry.scale > 0 ? geometry.scale : 1;
  let px = ((x - area.column) + 0.5) * geometry.cell.width / scale;
  let py = ((y - area.row) + 0.5) * geometry.cell.height / scale;
  if (geometry.viewport) {
    px = Math.min(Math.max(0, geometry.viewport.width - 1), px);
    py = Math.min(Math.max(0, geometry.viewport.height - 1), py);
  }
  return {x: Math.round(px * 100) / 100, y: Math.round(py * 100) / 100};
}
