import {foreground, UI_COLORS} from './palette.js';
import {repeatToWidth} from '../util/text.js';
import {GLYPHS} from './glyphs.js';

/** Framing belongs to the live overlay, never to OutputBuffer or an archive. */
export function framePanel(rows: string[], columns: number): string[] {
  return [`${foreground(UI_COLORS.separator)}${repeatToWidth(GLYPHS.separator, Math.max(1, columns))}\u001B[0m`, ...rows];
}
