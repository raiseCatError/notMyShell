import {graphemes, layoutInput} from './inputLayout.js';

export const PASTE_ATOM_MIN_LINES = 4;
export const PASTE_ATOM_MIN_CHARACTERS = 512;

interface PasteAtom {
  kind: 'pasteAtom';
  source: string;
}

type EditorToken = string | PasteAtom;

export interface DisplayPasteAtom {
  start: number;
  end: number;
}

function tokenSource(token: EditorToken): string {
  return typeof token === 'string' ? token : token.source;
}

function atomLabel(atom: PasteAtom, number: number): string {
  const lineCount = normalizedText(atom.source).split('\n').length;
  const lines = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
  return `[Text #${number} · ${lines}]`;
}

function normalizedText(value: string): string {
  return value.replace(/\r\n?/gu, '\n');
}

export class CommandEditor {
  ghost?: string;
  private characters: EditorToken[] = [];
  private cursor = 0;
  private selectionAnchor?: number;

  get text(): string {
    return this.characters.map(tokenSource).join('');
  }

  get displayText(): string {
    let atomNumber = 0;
    return this.characters.map(token => typeof token === 'string' ? token : atomLabel(token, ++atomNumber)).join('');
  }

  get cursorIndex(): number {
    return this.cursor;
  }

  get displayCursorIndex(): number {
    return this.displayIndexForTokenIndex(this.cursor);
  }

  get hasPasteAtoms(): boolean {
    return this.characters.some(token => typeof token !== 'string');
  }

  get displayPasteAtoms(): DisplayPasteAtom[] {
    const atoms: DisplayPasteAtom[] = [];
    let displayIndex = 0;
    let atomNumber = 0;
    for (const token of this.characters) {
      const display = typeof token === 'string' ? token : atomLabel(token, ++atomNumber);
      const length = graphemes(display).length;
      if (typeof token !== 'string') atoms.push({start: displayIndex, end: displayIndex + length});
      displayIndex += length;
    }
    return atoms;
  }

  get selection(): {start: number; end: number} | undefined {
    if (this.selectionAnchor === undefined || this.selectionAnchor === this.cursor) return undefined;
    return {
      start: Math.min(this.selectionAnchor, this.cursor),
      end: Math.max(this.selectionAnchor, this.cursor),
    };
  }

  get displaySelection(): {start: number; end: number} | undefined {
    const selection = this.selection;
    if (!selection) return undefined;
    return {
      start: this.displayIndexForTokenIndex(selection.start),
      end: this.displayIndexForTokenIndex(selection.end),
    };
  }

  selectAll(): void {
    this.selectionAnchor = 0;
    this.cursor = this.characters.length;
  }

  private deleteSelectionIfAny(): boolean {
    const selection = this.selection;
    if (!selection) {
      this.selectionAnchor = undefined;
      return false;
    }
    this.characters.splice(selection.start, selection.end - selection.start);
    this.cursor = selection.start;
    this.selectionAnchor = undefined;
    return true;
  }

  private clearSelection(): void {
    this.selectionAnchor = undefined;
  }

  private startSelectionIfNeeded(): void {
    if (this.selectionAnchor === undefined) this.selectionAnchor = this.cursor;
  }

  insert(value: string): void {
    this.deleteSelectionIfAny();
    const incoming = graphemes(normalizedText(value));
    this.characters.splice(this.cursor, 0, ...incoming);
    this.cursor += incoming.length;
  }

  insertPaste(value: string): void {
    this.deleteSelectionIfAny();
    const normalized = normalizedText(value);
    const lineCount = normalized.split('\n').length;
    const characterCount = graphemes(normalized).length;
    const shouldAtomize = lineCount > 1
      && (lineCount >= PASTE_ATOM_MIN_LINES || characterCount >= PASTE_ATOM_MIN_CHARACTERS);

    if (!shouldAtomize) {
      this.insert(normalized);
      return;
    }

    const atom: PasteAtom = {kind: 'pasteAtom', source: value};
    this.characters.splice(this.cursor, 0, atom);
    this.cursor += 1;
    this.ghost = undefined;
  }

  unwrapAdjacentPasteAtom(): boolean {
    const atCursor = this.characters[this.cursor];
    const beforeCursor = this.characters[this.cursor - 1];
    const atomIndex = typeof atCursor === 'object'
      ? this.cursor
      : typeof beforeCursor === 'object' ? this.cursor - 1 : -1;
    if (atomIndex < 0) return false;

    const atom = this.characters[atomIndex] as PasteAtom;
    const expanded = graphemes(atom.source);
    this.characters.splice(atomIndex, 1, ...expanded);
    this.cursor = atomIndex === this.cursor ? atomIndex + expanded.length : this.cursor + expanded.length - 1;
    this.clearSelection();
    this.ghost = undefined;
    return true;
  }

  moveLeft(): void {
    const selection = this.selection;
    if (selection) {
      this.cursor = selection.start;
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
    if (this.cursor === this.characters.length && this.ghost && !this.hasPasteAtoms) {
      this.insert(this.ghost.substring(this.text.length));
      this.ghost = undefined;
      return;
    }
    const selection = this.selection;
    if (selection) {
      this.cursor = selection.end;
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
    this.cursor = this.findLastNewline(this.cursor - 1) + 1;
  }

  selectLineHome(): void {
    this.startSelectionIfNeeded();
    this.cursor = this.findLastNewline(this.cursor - 1) + 1;
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }

  lineEnd(): void {
    if (this.cursor === this.characters.length && this.ghost && !this.hasPasteAtoms) {
      this.insert(this.ghost.substring(this.text.length));
      this.ghost = undefined;
      return;
    }
    this.clearSelection();
    const newline = this.findNextNewline(this.cursor);
    this.cursor = newline === -1 ? this.characters.length : newline;
  }

  selectLineEnd(): void {
    this.startSelectionIfNeeded();
    const newline = this.findNextNewline(this.cursor);
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
    if (this.cursor === this.characters.length && this.ghost && !this.hasPasteAtoms) {
      this.insert(this.ghost.substring(this.text.length));
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
    if (typeof this.characters[this.cursor - 1] === 'object') {
      this.backspace();
      return;
    }
    let start = this.cursor - 1;
    while (start > 0 && this.characters[start] === ' ') start -= 1;
    while (start > 0 && this.characters[start] !== ' ' && this.characters[start - 1] !== ' ') start -= 1;
    this.characters.splice(start, this.cursor - start);
    this.cursor = start;
  }

  deleteLineBefore(): void {
    if (this.deleteSelectionIfAny()) return;
    if (this.cursor === 0) return;
    const start = this.findLastNewline(this.cursor - 1) + 1;
    this.characters.splice(start, this.cursor - start);
    this.cursor = start;
  }

  deleteLineAfter(): void {
    if (this.deleteSelectionIfAny()) return;
    const newline = this.findNextNewline(this.cursor);
    const end = newline === -1 ? this.characters.length : newline;
    this.characters.splice(this.cursor, end - this.cursor);
  }

  wordLeft(): void {
    const selection = this.selection;
    if (selection) {
      this.cursor = selection.start;
      this.clearSelection();
    }
    if (this.cursor === 0) return;
    if (typeof this.characters[this.cursor - 1] === 'object') {
      this.moveLeft();
      return;
    }
    let start = this.cursor - 1;
    while (start > 0 && this.characters[start] === ' ') start -= 1;
    while (start > 0 && this.characters[start] !== ' ' && this.characters[start - 1] !== ' ') start -= 1;
    this.cursor = start;
  }

  selectWordLeft(): void {
    this.startSelectionIfNeeded();
    if (this.cursor === 0) return;
    if (typeof this.characters[this.cursor - 1] === 'object') {
      this.selectLeft();
      return;
    }
    let start = this.cursor - 1;
    while (start > 0 && this.characters[start] === ' ') start -= 1;
    while (start > 0 && this.characters[start] !== ' ' && this.characters[start - 1] !== ' ') start -= 1;
    this.cursor = start;
    if (this.selectionAnchor === this.cursor) this.selectionAnchor = undefined;
  }

  wordRight(): void {
    const selection = this.selection;
    if (selection) {
      this.cursor = selection.end;
      this.clearSelection();
    }
    if (typeof this.characters[this.cursor] === 'object') {
      this.moveRight();
      return;
    }
    let end = this.cursor;
    while (end < this.characters.length && this.characters[end] !== ' ') end += 1;
    while (end < this.characters.length && this.characters[end] === ' ') end += 1;
    this.cursor = end;
  }

  selectWordRight(): void {
    this.startSelectionIfNeeded();
    if (typeof this.characters[this.cursor] === 'object') {
      this.selectRight();
      return;
    }
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

  private findLastNewline(start: number): number {
    for (let index = Math.min(start, this.characters.length - 1); index >= 0; index -= 1) {
      if (this.characters[index] === '\n') return index;
    }
    return -1;
  }

  private findNextNewline(start: number): number {
    for (let index = Math.max(0, start); index < this.characters.length; index += 1) {
      if (this.characters[index] === '\n') return index;
    }
    return -1;
  }

  private displayIndexForTokenIndex(tokenIndex: number): number {
    let total = 0;
    let atomNumber = 0;
    for (const token of this.characters.slice(0, tokenIndex)) {
      const display = typeof token === 'string' ? token : atomLabel(token, ++atomNumber);
      total += graphemes(display).length;
    }
    return total;
  }

  private moveVertical(columns: number, direction: -1 | 1): void {
    const current = layoutInput(this.displayText, this.displayCursorIndex, columns);
    const targetRow = current.caretRow + direction;
    if (targetRow < 0 || targetRow >= current.allRows.length) return;
    let bestIndex = this.cursor;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= this.characters.length; index += 1) {
      const candidate = layoutInput(this.displayText, this.displayIndexForTokenIndex(index), columns);
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
