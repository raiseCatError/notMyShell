import {foreground, UI_COLORS} from './palette.js';

const RESET = '\u001B[0m';

/** A settings panel's bottom help row: keys in accent, actions muted, e.g. `↑↓ move · Enter save`. */
export function renderControls(controls: ReadonlyArray<readonly [key: string, action: string]>): string {
  // Resolved per call so NO_COLOR / NMSH_COLOR changes apply to every panel footer.
  const key = foreground(UI_COLORS.accent);
  const label = foreground(UI_COLORS.subtle);
  return controls.map(([name, action]) => `${key}${name}${label} ${action}`).join(`${label} · `) + RESET;
}
