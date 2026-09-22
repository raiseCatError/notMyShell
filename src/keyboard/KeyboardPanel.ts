import {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi} from '../util/text.js';

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const INTERACTIVE = foreground(UI_COLORS.accent);
const WARNING = foreground(UI_COLORS.failure);
const RESET = '\u001B[0m';

export interface KeyboardState {
  selectedIndex: number;
}

export function handleKeyboardKey(key: Key, state: KeyboardState): boolean {
  if (key.kind === 'up' || key.kind === 'down') {
    state.selectedIndex = 0; // Only one option for now
    return true;
  }
  return false;
}

export function renderKeyboardPanel(state: KeyboardState, columns: number): string[] {
  const rows: string[] = [];
  rows.push(`${PRIMARY}  Keyboard Integration${RESET}`);
  rows.push('');
  rows.push(`  ${WARNING}Note: Installing these bindings affects all Ghostty tabs globally.${RESET}`);
  rows.push('');
  
  const sel = (index: number) => index === state.selectedIndex ? `${INTERACTIVE}>${RESET}` : ' ';
  const labelColor = (index: number) => index === state.selectedIndex ? PRIMARY : SECONDARY;

  rows.push(`  ${sel(0)} ${labelColor(0)}Cmd+A, Cmd+Arrows, Opt+Backspace  Install for Ghostty${RESET}`);

  rows.push('');
  rows.push(`  ${SECONDARY}Ghostty normally collapses Backspace and Option+Backspace to the${RESET}`);
  rows.push(`  ${SECONDARY}same DEL byte. Installing this allows NMSh to distinguish them.${RESET}`);
  rows.push('');
  rows.push(`  ${SECONDARY}Enter install · Esc cancel${RESET}`);
  
  return rows.map(r => truncateAnsi(r, columns));
}
