import {Key} from '../terminal/keys.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateAnsi, repeatToWidth} from '../util/text.js';
import {BlurMode, GhosttySettings} from './ghostty.js';
import {IconStylePref, getIconStyle, setIconStyle} from '../ui/glyphs.js';

const PRIMARY = foreground(UI_COLORS.primary);
const SECONDARY = foreground(UI_COLORS.secondary);
const INTERACTIVE = foreground(UI_COLORS.accent);
const RESET = '\u001B[0m';

export const BLUR_MODES: BlurMode[] = ['Off', 'Numeric', 'Glass Regular', 'Glass Clear'];
export const ICON_STYLES: IconStylePref[] = ['nerd', 'safe'];

export interface AppearanceState {
  opacity: number;
  blurModeIndex: number;
  blurStrength: number;
  selectedIndex: number;
}

export function handleAppearanceKey(key: Key, state: AppearanceState): boolean {
  const maxIndex = BLUR_MODES[state.blurModeIndex] === 'Numeric' ? 3 : 2;
  if (key.kind === 'up') {
    state.selectedIndex = Math.max(0, state.selectedIndex - 1);
    return true;
  }
  if (key.kind === 'down') {
    state.selectedIndex = Math.min(maxIndex, state.selectedIndex + 1);
    return true;
  }
  
  let delta = 0;
  if (key.kind === 'left') delta = -1;
  if (key.kind === 'right') delta = 1;

  if (delta !== 0) {
    if (state.selectedIndex === 0) {
      state.opacity = Math.max(0, Math.min(1, state.opacity + (delta * 0.05)));
      state.opacity = Math.round(state.opacity * 100) / 100;
    } else if (state.selectedIndex === 1) {
      if (Math.abs(delta) === 1) {
         state.blurModeIndex = Math.max(0, Math.min(BLUR_MODES.length - 1, state.blurModeIndex + delta));
         if (BLUR_MODES[state.blurModeIndex] !== 'Numeric' && state.selectedIndex > 2) {
           state.selectedIndex = 2;
         }
      }
    } else if (state.selectedIndex === 2 && BLUR_MODES[state.blurModeIndex] === 'Numeric') {
      state.blurStrength = Math.max(0, Math.min(50, state.blurStrength + delta));
    } else {
      // Icon Style is at index 2 (if not Numeric) or 3 (if Numeric)
      const currentIconStyleIndex = ICON_STYLES.indexOf(getIconStyle());
      const nextIndex = Math.max(0, Math.min(ICON_STYLES.length - 1, currentIconStyleIndex + delta));
      setIconStyle(ICON_STYLES[nextIndex] ?? 'auto');
    }
    return true;
  }
  return false;
}

export function renderAppearancePanel(state: AppearanceState, columns: number): string[] {
  const rows: string[] = [];
  rows.push(`${PRIMARY}  Appearance · Settings${RESET}`);
  rows.push('');
  
  const drawBar = (percent: number) => {
     const filled = Math.round(percent * 10);
     const empty = 10 - filled;
     return '█'.repeat(filled) + '░'.repeat(empty);
  };

  const sel = (index: number) => index === state.selectedIndex ? `${INTERACTIVE}>${RESET}` : ' ';
  const labelColor = (index: number) => index === state.selectedIndex ? PRIMARY : SECONDARY;

  // Opacity
  rows.push(`  ${sel(0)} ${labelColor(0)}Opacity      ${INTERACTIVE}${drawBar(state.opacity)}  ${Math.round(state.opacity * 100)}%${RESET}`);
  
  // Blur
  rows.push(`  ${sel(1)} ${labelColor(1)}Blur mode    ${PRIMARY}${BLUR_MODES[state.blurModeIndex]}${RESET}`);

  let nextIndex = 2;
  // Blur Strength
  if (BLUR_MODES[state.blurModeIndex] === 'Numeric') {
    rows.push(`  ${sel(nextIndex)} ${labelColor(nextIndex)}Blur         ${INTERACTIVE}${drawBar(state.blurStrength / 50)}  ${state.blurStrength}${RESET}`);
    nextIndex++;
  }

  // Icon Style
  const displayIconStyle = getIconStyle() === 'safe' ? 'Safe' : 'Fancy';
  rows.push(`  ${sel(nextIndex)} ${labelColor(nextIndex)}Icon style   ${PRIMARY}${displayIconStyle}${RESET}`);

  rows.push('');
  rows.push(`  ${SECONDARY}↑↓ select · ←→ adjust · Enter save · Esc cancel${RESET}`);
  
  return rows.map(r => truncateAnsi(r, columns));
}
