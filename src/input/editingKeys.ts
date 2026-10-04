import type {Key} from '../terminal/keys.js';
import type {CommandEditor} from './CommandEditor.js';

/**
 * The editing keys every NMSh-owned text input shares: caret movement, word
 * and line movement, selection and deletion over a CommandEditor. The shell
 * composer, Ask and other NMSh inputs call this so they edit identically;
 * keys with surface-specific meaning (Enter, Tab, ↑↓ history, ← on an idle
 * composer) stay with the surface.
 *
 * Returns true when the key was an editing key and the editor handled it.
 */
export function applyEditingKey(editor: CommandEditor, key: Key, columns = 80, firstLinePrefix?: string): boolean {
  switch (key.kind) {
    case 'text': editor.insert(key.value.replace(/[\u0000-\u001f\u007f]/gu, '')); return true;
    case 'paste': editor.insert(key.value.replace(/\r\n?/gu, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/gu, ' ')); return true;
    case 'newline': editor.insert('\n'); return true;
    case 'left': editor.moveLeft(); return true;
    case 'right': editor.moveRight(); return true;
    case 'selectLeft': editor.selectLeft(); return true;
    case 'selectRight': editor.selectRight(); return true;
    case 'wordLeft': editor.wordLeft(); return true;
    case 'wordRight': editor.wordRight(); return true;
    case 'selectWordLeft': editor.selectWordLeft(); return true;
    case 'selectWordRight': editor.selectWordRight(); return true;
    case 'selectUp': editor.selectUp(columns, firstLinePrefix); return true;
    case 'selectDown': editor.selectDown(columns, firstLinePrefix); return true;
    case 'lineHome': editor.lineHome(); return true;
    case 'lineEnd': editor.lineEnd(); return true;
    case 'selectLineHome': editor.selectLineHome(); return true;
    case 'selectLineEnd': editor.selectLineEnd(); return true;
    case 'bufferHome': editor.moveBufferHome(); return true;
    case 'bufferEnd': editor.moveBufferEnd(); return true;
    case 'selectBufferHome': editor.selectBufferHome(); return true;
    case 'selectBufferEnd': editor.selectBufferEnd(); return true;
    case 'selectAll': editor.selectAll(); return true;
    case 'backspace': editor.backspace(); return true;
    case 'delete': editor.delete(); return true;
    case 'deleteWord': editor.deleteWord(); return true;
    case 'deleteLineBefore': editor.deleteLineBefore(); return true;
    case 'deleteLineAfter': editor.deleteLineAfter(); return true;
    default: return false;
  }
}

/** Set the caret from a click column in a single-line input (0 = first grapheme). */
export function caretFromColumn(editor: CommandEditor, column: number): void {
  editor.moveBufferHome();
  let width = 0;
  for (const grapheme of [...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(editor.text)].map(part => part.segment)) {
    if (grapheme === '\n' || width >= column) break;
    width += 1;
    editor.moveRight();
  }
}
