import {graphemes, layoutInput} from './inputLayout.js';

export class CommandEditor {
  ghost?: string;
  private characters: string[] = [];
  private cursor = 0;
  private selectionAnchor?: number;

  get text(): string {
    return this.characters.join('');
  }

  get cursorIndex(): number {
    return this.cursor;
  }

  get selection(): {start: number; end: number} | undefined {
    if (this.selectionAnchor === undefined || this.selectionAnchor === this.cursor) return undefined;
    return {
      start: Math.min(this.selectionAnchor, this.cursor),
      end: Math.max(this.selectionAnchor, this.cursor),
    };
  }

  selectAll(): void {
    this.selectionAnchor = 0;
    this.cursor = this.characters.length;
  }

  private deleteSelectionIfAny(): boolean {
    const sel = this.selection;
    if (!sel) {
      this.selectionAnchor = undefined;
      return false;
    }
    this.characters.splice(sel.start, sel.end - sel.start);
    this.cursor = sel.start;
    this.selectionAnchor = undefined;
    return true;
  }

  private clearSelection(): void {
    this.selectionAnchor = undefined;
  }

  private startSelectionIfNeeded(): void {
    if (this.selectionAnchor === undefined) {
      this.selectionAnchor = this.cursor;
    }
  }

  insert(value: string): void {
    this.deleteSelectionIfAny();
    const incoming = graphemes(value.replace(/\r\n?/gu, '\n'));
    this.characters.splice(this.cursor, 0, ...incoming);
    this.cursor += incoming.length;
  }

  moveLeft(): void {
    const sel = this.selection;
    if (sel) {
      this.cursor = sel.start;
   
    this.clearSelection();
      return;
    }
    this.cursor = Math.max(0, this.cursor - 1);
  }

  selectLeft(): void {
    this.startSelectionIfNeeded();
    this.cursor = Math.max(0, this.cursor - 1);
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }

  moveRight(): void {
    if (this.cursor === this.characters.length && this.ghost) {
      this.insert(this.ghost.substring(this.characters.length));
      this.ghost = undefined;
      return;
    }
    const sel = this.selection;
    if (sel) {
      this.cursor = sel.end;
   
    this.clearSelection();
      return;
    }
    this.cursor = Math.min(this.characters.length, this.cursor + 1);
  }

  selectRight(): void {
    this.startSelectionIfNeeded();
    this.cursor = Math.min(this.characters.length, this.cursor + 1);
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }

  lineHome(): void {
 
    this.clearSelection();
    const newline = this.characters.lastIndexOf('\n', this.cursor - 1);
    this.cursor = newline + 1;
  }

  selectLineHome(): void {
    this.startSelectionIfNeeded();
    const newline = this.characters.lastIndexOf('\n', this.cursor - 1);
    this.cursor = newline + 1;
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }

  lineEnd(): void {
    if (this.cursor === this.characters.length && this.ghost) {
      this.insert(this.ghost.substring(this.characters.length));
      this.ghost = undefined;
      return;
    }
 
    this.clearSelection();
    const newline = this.characters.indexOf('\n', this.cursor);
    this.cursor = newline === -1 ? this.characters.length : newline;
  }

  selectLineEnd(): void {
    this.startSelectionIfNeeded();
    const newline = this.characters.indexOf('\n', this.cursor);
    this.cursor = newline === -1 ? this.characters.length : newline;
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }

  /** Cmd+Up — move to the very beginning of the input buffer. */
  moveBufferHome(): void {
 
    this.clearSelection();
    this.cursor = 0;
  }

  /** Cmd+Down — move to the very end of the input buffer. */
  moveBufferEnd(): void {
    if (this.cursor === this.characters.length && this.ghost) {
      this.insert(this.ghost.substring(this.characters.length));
      this.ghost = undefined;
      return;
    }
 
    this.clearSelection();
    this.cursor = this.characters.length;
  }

  /** Cmd+Shift+Up — extend/start selection to the beginning of the buffer. */
  selectBufferHome(): void {
    this.startSelectionIfNeeded();
    this.cursor = 0;
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }

  /** Cmd+Shift+Down — extend/start selection to the end of the buffer. */
  selectBufferEnd(): void {
    this.startSelectionIfNeeded();
    this.cursor = this.characters.length;
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }


  moveUp(columns: number): void {
    this.clearSelection();
    this.moveVertical(columns, -1);
  }

  selectUp(columns: number): void {
    this.startSelectionIfNeeded();
    this.moveVertical(columns, -1);
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }

  moveDown(columns: number): void {
 
    this.clearSelection();
    this.moveVertical(columns, 1);
  }

  selectDown(columns: number): void {
    this.startSelectionIfNeeded();
    this.moveVertical(columns, 1);
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }

  backspace(): void {
    if (this.deleteSelectionIfAny()) return;
    if (this.cursor === 0) return;
    this.characters.splice(this.cursor - 1, 1);
    this.cursor -= 1;
  }

  deleteWord(): void {
    if (this.deleteSelectionIfAny()) return;
    if (this.cursor === 0) return;
    let start = this.cursor - 1;
    while (start > 0 && this.characters[start] === ' ') start -= 1;
    while (start > 0 && this.characters[start] !== ' ' && this.characters[start - 1] !== ' ') start -= 1;
    this.characters.splice(start, this.cursor - start);
    this.cursor = start;
  }

  deleteLineBefore(): void {
    if (this.deleteSelectionIfAny()) return;
    if (this.cursor === 0) return;
    const newline = this.characters.lastIndexOf('\n', this.cursor - 1);
    const start = newline + 1;
    this.characters.splice(start, this.cursor - start);
    this.cursor = start;
  }

  deleteLineAfter(): void {
    if (this.deleteSelectionIfAny()) return;
    const newline = this.characters.indexOf('\n', this.cursor);
    const end = newline === -1 ? this.characters.length : newline;
    this.characters.splice(this.cursor, end - this.cursor);
  }

  wordLeft(): void {
    const sel = this.selection;
    if (sel) {
      this.cursor = sel.start;
   
    this.clearSelection();
    }
    if (this.cursor === 0) return;
    let start = this.cursor - 1;
    while (start > 0 && this.characters[start] === ' ') start -= 1;
    while (start > 0 && this.characters[start] !== ' ' && this.characters[start - 1] !== ' ') start -= 1;
    this.cursor = start;
  }

  selectWordLeft(): void {
    this.startSelectionIfNeeded();
    if (this.cursor === 0) return;
    let start = this.cursor - 1;
    while (start > 0 && this.characters[start] === ' ') start -= 1;
    while (start > 0 && this.characters[start] !== ' ' && this.characters[start - 1] !== ' ') start -= 1;
    this.cursor = start;
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }

  wordRight(): void {
    const sel = this.selection;
    if (sel) {
      this.cursor = sel.end;
   
    this.clearSelection();
    }
    let end = this.cursor;
    while (end < this.characters.length && this.characters[end] !== ' ') end += 1;
    while (end < this.characters.length && this.characters[end] === ' ') end += 1;
    this.cursor = end;
  }

  selectWordRight(): void {
    this.startSelectionIfNeeded();
    let end = this.cursor;
    while (end < this.characters.length && this.characters[end] !== ' ') end += 1;
    while (end < this.characters.length && this.characters[end] === ' ') end += 1;
    this.cursor = end;
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }

  delete(): void {
    if (this.deleteSelectionIfAny()) return;
    if (this.cursor < this.characters.length) this.characters.splice(this.cursor, 1);
  }

  clear(): void {
    this.characters = [];
    this.cursor = 0;
 
    this.clearSelection();
  }

  private moveVertical(columns: number, direction: -1 | 1): void {
    const current = layoutInput(this.text, this.cursor, columns);
    const targetRow = current.caretRow + direction;
    if (targetRow < 0 || targetRow >= current.allRows.length) return;
    let bestIndex = this.cursor;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= this.characters.length; index += 1) {
      const candidate = layoutInput(this.text, index, columns);
      if (candidate.caretRow !== targetRow) continue;
      const distance = Math.abs(candidate.caretColumn - current.caretColumn);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    this.cursor = bestIndex;
  }
}
