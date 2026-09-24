import {foreground, UI_COLORS} from './palette.js';

const KEY = foreground(UI_COLORS.accent);
const LABEL = foreground(UI_COLORS.subtle);
const RESET = '\u001B[0m';

/** A settings panel's bottom help row: keys in accent, actions muted, e.g. `↑↓ move · Enter save`. */
export function renderControls(controls: ReadonlyArray<readonly [key: string, action: string]>): string {
  return controls.map(([key, action]) => `${KEY}${key}${LABEL} ${action}`).join(`${LABEL} · `) + RESET;
}

const HINT_KEY = foreground(UI_COLORS.secondary);

/**
 * A quieter, contextual help row for browser-style panels: keys in the
 * secondary tone, actions muted, spaced instead of dotted, e.g.
 * `↑↓ Navigate   ←→ Change   Esc Close`.
 */
export function renderHints(hints: ReadonlyArray<readonly [key: string, action: string]>): string {
  return '  ' + hints.map(([key, action]) => `${HINT_KEY}${key} ${LABEL}${action}`).join('   ') + RESET;
}
