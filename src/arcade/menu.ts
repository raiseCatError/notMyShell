import {mixRgb} from '../chroma/chroma.js';
import type {Canvas} from './Canvas.js';
import type {ArcadePalette} from './palette.js';
import type {Key} from '../terminal/keys.js';
import {GLYPHS} from '../ui/glyphs.js';
import {displayWidth} from '../util/text.js';

/**
 * A small vertical choice list drawn on the canvas with the same selection treatment as every NMSh list: a pointer, a
 * band in the theme's selection color and bold text (reverse video without color, via the canvas encoder), keys ↑↓ /
 * j k to move, Enter to choose, a letter to jump. Used by the pause and game over screens and by games' own menus.
 */
export interface MenuItem { id: string; label: string; hint?: string; key?: string }

export class Menu {
  index = 0;
  constructor(readonly items: readonly MenuItem[]) {}

  /** Move or choose: returns the chosen id on Enter or a matching letter, otherwise undefined. */
  key(key: Key): string | undefined {
    if (key.kind === 'up') this.index = (this.index + this.items.length - 1) % this.items.length;
    else if (key.kind === 'down' || key.kind === 'complete') this.index = (this.index + 1) % this.items.length;
    else if (key.kind === 'enter') return this.items[this.index]?.id;
    else if (key.kind === 'text') {
      const value = key.value.toLowerCase();
      if (value === 'k') this.index = (this.index + this.items.length - 1) % this.items.length;
      else if (value === 'j') this.index = (this.index + 1) % this.items.length;
      else {
        const hit = this.items.find(item => item.key === value);
        if (hit) { this.index = this.items.indexOf(hit); return hit.id; }
      }
    }
    return undefined;
  }

  /** Draw the list with its first row at y, centered in `width` cells starting at x. Returns rows used. */
  draw(canvas: Canvas, palette: ArcadePalette, x: number, y: number, width: number): number {
    const inner = Math.max(...this.items.map(item => displayWidth(item.label) + (item.hint ? displayWidth(item.hint) + 2 : 0)), 8) + 4;
    const left = x + Math.max(0, Math.floor((width - inner) / 2));
    this.items.forEach((item, row) => {
      const selected = row === this.index;
      const style = selected ? {fg: palette.ink, bg: mixRgb(palette.selection, palette.deep, 0.15), bold: true, reverse: false} : {fg: palette.muted};
      canvas.fill(left, y + row, inner, 1, ' ', style);
      canvas.text(left + 1, y + row, selected ? GLYPHS.selection : ' ', {...style, fg: palette.accent});
      canvas.text(left + 3, y + row, item.label, style);
      if (item.hint) canvas.text(left + inner - 1 - displayWidth(item.hint), y + row, item.hint, {...style, fg: selected ? palette.muted : palette.faint, bold: false});
    });
    return this.items.length;
  }
}
