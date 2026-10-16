import {AnsiOutputParser} from '../../src/output/AnsiOutputParser.js';
import {currentBackground, currentForeground} from '../../src/presentation/cellOverlay.js';

/** Serialize terminal cells for evidence only. Parser positions already include wide-glyph continuations. */
export function terminalFrameCells(row: string) {
  const parser = new AnsiOutputParser(); parser.write(row);
  return (parser.allLines()[0] ?? []).flatMap((cell, column) => {
    if (!cell) return [];
    return [{column, text: cell.text, width: cell.width, foreground: currentForeground(cell.style),
      background: currentBackground(cell.style)}];
  });
}
