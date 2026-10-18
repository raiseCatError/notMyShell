import {graphemes} from '../input/inputLayout.js';
import {displayWidth} from '../util/text.js';

/**
 * The text of a small file being edited (#402): lines, a caret, an optional selection anchor and bounded undo/redo.
 * Positions are (line, UTF-16 offset) and always sit on grapheme boundaries. Every change goes through one
 * replaceRange, which records its inverse; typing and deleting coalesce into one undo step per burst. Movement mirrors
 * the composer's rules (words are separated by spaces and tabs) over lines instead of one buffer.
 */

export interface Position {line: number; column: number}

interface Edit {
  from: Position;
  removed: string;
  inserted: string;
  caretBefore: Position;
  anchorBefore?: Position;
  caretAfter: Position;
  kind: 'type' | 'delete' | 'other';
  at: number;
}

const MAX_UNDO = 500;
const UNREACHABLE: unique symbol = Symbol('unreachable saved state');
const COALESCE_MS = 1000;
export const TAB_WIDTH = 4;

const same = (a: Position, b: Position) => a.line === b.line && a.column === b.column;
const before = (a: Position, b: Position) => a.line < b.line || (a.line === b.line && a.column < b.column);
const isSpace = (character: string | undefined) => character === ' ' || character === '\t';

/** The display column of `column` in `line`, with tabs to the next stop and wide characters counted. */
export function displayColumn(line: string, column: number): number {
  let cells = 0;
  let offset = 0;
  for (const character of graphemes(line)) {
    if (offset >= column) break;
    cells += character === '\t' ? TAB_WIDTH - (cells % TAB_WIDTH) : displayWidth(character);
    offset += character.length;
  }
  return cells;
}

/** The offset in `line` whose display column is nearest to `target` without passing it. */
function columnAt(line: string, target: number): number {
  let cells = 0;
  let offset = 0;
  for (const character of graphemes(line)) {
    const width = character === '\t' ? TAB_WIDTH - (cells % TAB_WIDTH) : displayWidth(character);
    if (cells + width > target) break;
    cells += width;
    offset += character.length;
  }
  return offset;
}

export class TextBuffer {
  lines: string[];
  caret: Position = {line: 0, column: 0};
  anchor?: Position;
  private preferred?: number;
  private readonly undoStack: Edit[] = [];
  private readonly redoStack: Edit[] = [];
  /**
   * The undo step the saved text ends with (undefined: the text as opened). The buffer is clean exactly when the
   * history's top is that step, so undoing back to the saved text reads as clean again. A saved state pushed out of
   * the bounded history can never be reached again and is marked unreachable.
   */
  private savedTop: Edit | undefined | typeof UNREACHABLE = undefined;

  constructor(lines: readonly string[], private readonly now: () => number = Date.now) {
    this.lines = lines.length ? [...lines] : [''];
  }

  get text(): string { return this.lines.join('\n'); }
  get dirty(): boolean { return this.undoStack.at(-1) !== this.savedTop; }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  markSaved(): void { this.savedTop = this.undoStack.at(-1); }

  get selection(): {start: Position; end: Position} | undefined {
    if (!this.anchor || same(this.anchor, this.caret)) return undefined;
    return before(this.anchor, this.caret) ? {start: this.anchor, end: this.caret} : {start: this.caret, end: this.anchor};
  }

  selectedText(): string {
    const selection = this.selection;
    return selection ? this.slice(selection.start, selection.end) : '';
  }

  private slice(from: Position, to: Position): string {
    if (from.line === to.line) return this.lines[from.line]!.slice(from.column, to.column);
    return [this.lines[from.line]!.slice(from.column), ...this.lines.slice(from.line + 1, to.line), this.lines[to.line]!.slice(0, to.column)].join('\n');
  }

  /** Replace [from, to) with text; records the inverse for undo. */
  private replaceRange(from: Position, to: Position, text: string, kind: Edit['kind'], record = true): void {
    const removed = this.slice(from, to);
    const head = this.lines[from.line]!.slice(0, from.column);
    const tail = this.lines[to.line]!.slice(to.column);
    const parts = text.split('\n');
    const caretAfter = {line: from.line + parts.length - 1, column: (parts.length === 1 ? head.length : 0) + parts.at(-1)!.length};
    parts[0] = head + parts[0]!;
    parts[parts.length - 1] = parts.at(-1)! + tail;
    const caretBefore = this.caret;
    const anchorBefore = this.anchor;
    this.lines.splice(from.line, to.line - from.line + 1, ...parts);
    this.caret = caretAfter;
    this.anchor = undefined;
    this.preferred = undefined;
    if (!record) return;
    this.redoStack.length = 0;
    const previous = this.undoStack.at(-1);
    const at = this.now();
    // A burst of typing (or of deleting) is one undo step: same kind, continuing where the last one ended, no line break.
    // The saved step is never extended: what the file holds must stay one exact step of the history.
    if (previous && previous !== this.savedTop && kind !== 'other' && previous.kind === kind && at - previous.at < COALESCE_MS && !text.includes('\n') && !removed.includes('\n')) {
      if (kind === 'type' && !removed && same(previous.caretAfter, from)) {
        previous.inserted += text; previous.caretAfter = caretAfter; previous.at = at; return;
      }
      if (kind === 'delete' && !text && same(previous.from, to) && !previous.inserted) {
        previous.from = from; previous.removed = removed + previous.removed; previous.caretAfter = caretAfter; previous.at = at; return;
      }
    }
    this.undoStack.push({from, removed, inserted: text, caretBefore, ...(anchorBefore ? {anchorBefore} : {}), caretAfter, kind, at});
    if (this.undoStack.length > MAX_UNDO) {
      const dropped = this.undoStack.shift();
      // The saved text was the state before (or at) the dropped step: undo can no longer return to it.
      if (this.savedTop === undefined || this.savedTop === dropped) this.savedTop = UNREACHABLE;
    }
  }

  private endOf(from: Position, text: string): Position {
    const parts = text.split('\n');
    return {line: from.line + parts.length - 1, column: (parts.length === 1 ? from.column : 0) + parts.at(-1)!.length};
  }

  undo(): boolean {
    const edit = this.undoStack.pop();
    if (!edit) return false;
    this.replaceRange(edit.from, this.endOf(edit.from, edit.inserted), edit.removed, 'other', false);
    this.caret = edit.caretBefore;
    this.anchor = edit.anchorBefore;
    this.redoStack.push(edit);
    return true;
  }

  redo(): boolean {
    const edit = this.redoStack.pop();
    if (!edit) return false;
    this.replaceRange(edit.from, this.endOf(edit.from, edit.removed), edit.inserted, 'other', false);
    this.caret = edit.caretAfter;
    this.undoStack.push(edit);
    return true;
  }

  // ---- Editing -----------------------------------------------------------------------------------------------------

  /** Typed or pasted text: CR LF and CR become line breaks, tabs stay, other control characters are dropped. */
  insert(value: string): void {
    const text = value.replace(/\r\n?/gu, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, '');
    if (!text && !this.selection) return;
    const selection = this.selection;
    this.replaceRange(selection?.start ?? this.caret, selection?.end ?? this.caret, text, selection ? 'other' : 'type');
  }

  private deleteSelection(): boolean {
    const selection = this.selection;
    if (!selection) { this.anchor = undefined; return false; }
    this.replaceRange(selection.start, selection.end, '', 'other');
    return true;
  }

  backspace(): void {
    if (this.deleteSelection()) return;
    const from = this.stepLeft(this.caret);
    if (!same(from, this.caret)) this.replaceRange(from, this.caret, '', 'delete');
  }

  delete(): void {
    if (this.deleteSelection()) return;
    const to = this.stepRight(this.caret);
    if (!same(to, this.caret)) this.replaceRange(this.caret, to, '', 'other');
  }

  deleteWord(): void {
    if (this.deleteSelection()) return;
    const from = this.wordStart(this.caret);
    if (!same(from, this.caret)) this.replaceRange(from, this.caret, '', 'other');
  }

  deleteLineBefore(): void {
    if (this.deleteSelection()) return;
    if (this.caret.column > 0) this.replaceRange({line: this.caret.line, column: 0}, this.caret, '', 'other');
  }

  deleteLineAfter(): void {
    if (this.deleteSelection()) return;
    const length = this.lines[this.caret.line]!.length;
    if (this.caret.column < length) this.replaceRange(this.caret, {line: this.caret.line, column: length}, '', 'other');
  }

  // ---- Movement ----------------------------------------------------------------------------------------------------

  private stepLeft(position: Position): Position {
    if (position.column === 0) return position.line === 0 ? position : {line: position.line - 1, column: this.lines[position.line - 1]!.length};
    const characters = graphemes(this.lines[position.line]!.slice(0, position.column));
    return {line: position.line, column: position.column - characters.at(-1)!.length};
  }

  private stepRight(position: Position): Position {
    const line = this.lines[position.line]!;
    if (position.column >= line.length) return position.line + 1 >= this.lines.length ? position : {line: position.line + 1, column: 0};
    return {line: position.line, column: position.column + graphemes(line.slice(position.column))[0]!.length};
  }

  private wordStart(position: Position): Position {
    if (position.column === 0) return this.stepLeft(position);
    const line = this.lines[position.line]!;
    let column = position.column;
    while (column > 0 && isSpace(line[column - 1])) column -= 1;
    while (column > 0 && !isSpace(line[column - 1])) column -= 1;
    return {line: position.line, column};
  }

  private wordEnd(position: Position): Position {
    const line = this.lines[position.line]!;
    if (position.column >= line.length) return this.stepRight(position);
    let column = position.column;
    while (column < line.length && !isSpace(line[column])) column += 1;
    while (column < line.length && isSpace(line[column])) column += 1;
    return {line: position.line, column};
  }

  private move(to: Position, select: boolean, keepPreferred = false): void {
    if (select) this.anchor ??= this.caret;
    else this.anchor = undefined;
    this.caret = to;
    if (!keepPreferred) this.preferred = undefined;
  }

  /** Without Shift, Left/Right first collapse a selection to its edge, as the composer does. */
  left(select = false): void {
    const selection = this.selection;
    if (!select && selection) { this.move(selection.start, false); return; }
    this.move(this.stepLeft(this.caret), select);
  }

  right(select = false): void {
    const selection = this.selection;
    if (!select && selection) { this.move(selection.end, false); return; }
    this.move(this.stepRight(this.caret), select);
  }

  wordLeft(select = false): void { this.move(this.wordStart(this.caret), select); }
  wordRight(select = false): void { this.move(this.wordEnd(this.caret), select); }
  home(select = false): void { this.move({line: this.caret.line, column: 0}, select); }
  end(select = false): void { this.move({line: this.caret.line, column: this.lines[this.caret.line]!.length}, select); }
  bufferHome(select = false): void { this.move({line: 0, column: 0}, select); }
  bufferEnd(select = false): void { this.move({line: this.lines.length - 1, column: this.lines.at(-1)!.length}, select); }

  selectAll(): void {
    this.anchor = {line: 0, column: 0};
    this.caret = {line: this.lines.length - 1, column: this.lines.at(-1)!.length};
  }

  /** Up/Down keep the display column the caret started from across shorter lines. */
  vertical(delta: number, select = false): void {
    const target = Math.max(0, Math.min(this.lines.length - 1, this.caret.line + delta));
    if (target === this.caret.line) { this.move(delta < 0 ? {line: target, column: 0} : {line: target, column: this.lines[target]!.length}, select); return; }
    this.preferred ??= displayColumn(this.lines[this.caret.line]!, this.caret.column);
    this.move({line: target, column: columnAt(this.lines[target]!, this.preferred)}, select, true);
  }

  setCaret(position: Position): void {
    const line = Math.max(0, Math.min(this.lines.length - 1, position.line));
    this.move({line, column: Math.max(0, Math.min(this.lines[line]!.length, position.column))}, false);
  }

  // ---- Search ------------------------------------------------------------------------------------------------------

  /** The next match after the caret (or the previous one before it), wrapping; smart case. Selects it. */
  find(query: string, direction: 1 | -1 = 1): {wrapped: boolean} | undefined {
    if (!query) return undefined;
    const insensitive = query === query.toLowerCase();
    const fold = (text: string) => insensitive ? text.toLowerCase() : text;
    const needle = fold(query);
    const start = direction === 1 ? (this.selection?.end ?? this.caret) : (this.selection?.start ?? this.caret);
    const count = this.lines.length;
    for (let step = 0; step <= count; step += 1) {
      const raw = start.line + direction * step;
      const index = ((raw % count) + count) % count;
      const line = fold(this.lines[index]!);
      let found = -1;
      if (direction === 1) found = line.indexOf(needle, step === 0 ? start.column : 0);
      else {
        const limit = step === 0 ? start.column - needle.length : line.length;
        if (limit >= 0) found = line.lastIndexOf(needle, limit);
      }
      if (found >= 0 && (step > 0 || direction === -1 || found >= start.column)) {
        this.anchor = {line: index, column: found};
        this.caret = {line: index, column: found + query.length};
        this.preferred = undefined;
        return {wrapped: direction === 1 ? raw >= count : raw < 0};
      }
    }
    return undefined;
  }
}
