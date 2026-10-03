import {renderSurface} from './surface.js';
import {foreground, UI_COLORS} from './palette.js';
import {displayWidth, truncateAnsi} from '../util/text.js';

/**
 * One small centered surface for genuinely modal conditions (display too
 * small, confirmations, fatal configuration problems). It is a full-screen
 * frame of `rows` lines with a rounded box in the middle; NMSh is not
 * redesigned around floating windows.
 */
export function renderModal(lines: readonly string[], columns: number, rows: number): string[] {
  const width = Math.max(1, columns);
  const height = Math.max(1, rows);
  const box = renderSurface(lines.map(line => truncateAnsi(line, Math.max(1, width - 6))), width,
    {frame: 'rounded', frameColor: {kind: 'theme', role: 'separator'}, padding: {x: 2, y: 0}, width: 'content', align: 'center'});
  const top = Math.max(0, Math.floor((height - box.length) / 2));
  const out = Array<string>(height).fill('');
  box.slice(0, height).forEach((line, index) => { out[top + index] = line; });
  return out.map(line => truncateAnsi(line, width));
}

export interface MinimumSize {columns: number; rows: number}

/** Whether a view with this minimum fits the current size. */
export function fits(minimum: MinimumSize, columns: number, rows: number): boolean {
  return columns >= minimum.columns && rows >= minimum.rows;
}

/**
 * The notice shown instead of a view that cannot display its essential
 * controls. It disappears on the next frame once a resize makes the view
 * viable. Extremely small terminals get one line.
 */
export function renderTooSmall(minimum: MinimumSize, columns: number, rows: number): string[] {
  const subtle = foreground(UI_COLORS.subtle);
  const primary = foreground(UI_COLORS.primary);
  const reset = '\u001B[0m';
  const lines = [`${primary}Display too small${reset}`, '',
    `${subtle}This view needs ${minimum.columns}×${minimum.rows}.${reset}`,
    `${subtle}Current size: ${columns}×${rows}.${reset}`,
    `${subtle}Resize the terminal.${reset}`];
  const boxWidth = Math.max(...lines.map(line => displayWidth(line))) + 6;
  if (columns < boxWidth || rows < lines.length + 2) {
    const line = truncateAnsi(`${primary}Display too small${subtle} · resize terminal${reset}`, Math.max(1, columns));
    return [line, ...Array<string>(Math.max(0, rows - 1)).fill('')].slice(0, Math.max(1, rows));
  }
  return renderModal(lines, columns, rows);
}
