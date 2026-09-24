import {foreground, UI_COLORS} from './palette.js';

const KEY = foreground(UI_COLORS.accent);
const LABEL = foreground(UI_COLORS.subtle);
const RESET = '\u001B[0m';

/** A settings panel's bottom help row: keys in accent, actions muted, e.g. `↑↓ move · Enter save`. */
export function renderControls(controls: ReadonlyArray<readonly [key: string, action: string]>): string {
  return controls.map(([key, action]) => `${KEY}${key}${LABEL} ${action}`).join(`${LABEL} · `) + RESET;
}
