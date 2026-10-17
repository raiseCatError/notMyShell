import {AnsiOutputParser} from '../../src/output/AnsiOutputParser.js';
import {currentBackground, currentForeground} from '../../src/presentation/cellOverlay.js';

/** Whether terminal reverse video swaps the visible foreground/background. */
function inverseVideo(style: string): boolean {
  let inverse = false;
  for (const match of style.matchAll(/\u001b\[([\d;]*)m/gu)) {
    const codes = match[1]!.split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if ((code === 38 || code === 48) && codes[i + 1] === 2) { i += 4; continue; }
      if ((code === 38 || code === 48) && codes[i + 1] === 5) { i += 2; continue; }
      if (code === 0 || code === 27) inverse = false;
      else if (code === 7) inverse = true;
    }
  }
  return inverse;
}

/** Serialize terminal cells for evidence only. Parser positions already include wide-glyph continuations. */
export function terminalFrameCells(row: string) {
  const parser = new AnsiOutputParser(); parser.write(row);
  return (parser.allLines()[0] ?? []).flatMap((cell, column) => {
    if (!cell) return [];
    const inverse = inverseVideo(cell.style);
    const fg = currentForeground(cell.style), bg = currentBackground(cell.style);
    return [{column, text: cell.text, width: cell.width, foreground: inverse ? bg : fg, background: inverse ? fg : bg, inverse}];
  });
}
