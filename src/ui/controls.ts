import {foreground, UI_COLORS} from './palette.js';
import {displayWidth} from '../util/text.js';

const RESET = '\u001B[0m';

/** A settings panel's bottom help row: keys in accent, actions muted, e.g. `↑↓ move · Enter save`. */
export function renderControls(controls: ReadonlyArray<readonly [key: string, action: string]>): string {
  // Resolved per call so NO_COLOR / NMSH_COLOR changes apply to every panel footer.
  const key = foreground(UI_COLORS.accent);
  const label = foreground(UI_COLORS.subtle);
  return controls.map(([name, action]) => `${key}${name}${label} ${action}`).join(`${label} · `) + RESET;
}

/** The same help row, wrapped onto further rows at control boundaries instead of being cut off in narrow panels. */
export function renderControlRows(controls: ReadonlyArray<readonly [key: string, action: string]>, columns: number): string[] {
  const groups: Array<Array<readonly [string, string]>> = [[]];
  let width = 0;
  for (const control of controls) {
    const current = groups.at(-1)!;
    const cells = displayWidth(`${control[0]} ${control[1]}`), separator = current.length ? 3 : 0;
    if (current.length && width + separator + cells > columns) { groups.push([control]); width = cells; continue; }
    current.push(control);
    width += separator + cells;
  }
  return groups.filter(group => group.length).map(group => renderControls(group));
}
