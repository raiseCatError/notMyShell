import {contrastOn} from '../chroma/color.js';
import {background, foreground, UI_COLORS, type RgbColor} from './palette.js';
import {displayWidth, truncateAnsi} from '../util/text.js';

/**
 * The selected row of an NMSh list (completion menu, task bar): one full-width band in the theme's selection color,
 * so selection never relies on the text's color alone. Each part keeps its own hue, contrast-corrected against the
 * band, instead of the whole row turning one color. Without color (NO_COLOR) there is no band; the row's pointer
 * (› or >) carries the selection.
 */
export function onSelection(color: RgbColor, minimum: number): RgbColor {
  return contrastOn(color, UI_COLORS.selection, minimum);
}

/** A part's foreground: as given on an ordinary row, contrast-corrected on the selection band. */
export function selectionForeground(color: RgbColor, selected: boolean, minimum = 4.5): string {
  return foreground(selected ? onSelection(color, minimum) : color);
}

/** Lay the band under a styled row and pad it to `columns`, keeping the band through every reset inside the row. */
export function selectionBand(row: string, columns: number, color: RgbColor = UI_COLORS.selection): string {
  const RESET = '\u001b[0m';
  const fill = background(color);
  const fitted = truncateAnsi(row, columns);
  if (!fill) return fitted;
  return `${fill}${fitted.replaceAll(RESET, `${RESET}${fill}`)}${' '.repeat(Math.max(0, columns - displayWidth(fitted)))}${RESET}`;
}
