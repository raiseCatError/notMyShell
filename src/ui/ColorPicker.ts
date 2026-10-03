import type {Key} from '../terminal/keys.js';
import {colorEscape, rgbTo256, type Rgb} from '../chroma/escape.js';
import {contrastRatio, hexColor} from '../chroma/color.js';
import type {ColorLevel} from '../presentation/capabilities.js';
import {parseHexInput} from '../appearance/customTheme.js';
import {getCurrentGlyphMode} from './glyphs.js';
import {renderControls} from './controls.js';
import {truncateAnsi} from '../util/text.js';

/**
 * A terminal-native color editor. Truecolor hosts get a saturation/value
 * field (half-block cells, two samples per row), a hue strip and hex entry;
 * 256-color hosts get the xterm palette grid with a nearest-color preview;
 * NO_COLOR gets plain hex/RGB editing. Everything works from the keyboard;
 * nothing depends on the mouse.
 */

export type PickerFocus = 'field' | 'hue' | 'hex' | 'grid' | 'channels';

export interface ColorPickerState {
  /** The color being proposed; the caller decides whether to keep it. */
  color: Rgb;
  /** HSV kept separately so hue survives fully desaturated or black colors. */
  hue: number;
  saturation: number;
  value: number;
  focus: PickerFocus;
  hex: string;
  channel: 0 | 1 | 2;
  gridIndex: number;
  error?: string;
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hue = ((h % 360) + 360) % 360 / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const [r, g, b] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return {red: Math.round((r + m) * 255), green: Math.round((g + m) * 255), blue: Math.round((b + m) * 255)};
}

export function rgbToHsv(color: Rgb): {h: number; s: number; v: number} {
  const r = color.red / 255, g = color.green / 255, b = color.blue / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return {h: (h + 360) % 360, s: max ? d / max : 0, v: max};
}

const CUBE = [0, 95, 135, 175, 215, 255];
/** The RGB an xterm 256-color index (16–255) displays as. */
export function xterm256(index: number): Rgb {
  if (index >= 232) { const level = 8 + (index - 232) * 10; return {red: level, green: level, blue: level}; }
  const cube = Math.max(0, index - 16);
  return {red: CUBE[Math.floor(cube / 36) % 6]!, green: CUBE[Math.floor(cube / 6) % 6]!, blue: CUBE[cube % 6]!};
}

export const GRID_COLUMNS = 24;
/** Grid cells in order: the 216-color cube, then the 24 grays. */
const GRID_SIZE = 240;

export function pickerMode(level: ColorLevel): 'truecolor' | 'grid' | 'plain' {
  return level === 'truecolor' ? 'truecolor' : level === 'none' ? 'plain' : 'grid';
}

export function createColorPicker(hex: string, level: ColorLevel): ColorPickerState {
  const color = hexToRgb(parseHexInput(hex) ?? '#a67cf3');
  const {h, s, v} = rgbToHsv(color);
  const mode = pickerMode(level);
  return {color, hue: h, saturation: s, value: v, hex: hexColor(color), channel: 0,
    gridIndex: Math.max(0, rgbTo256(color) - 16), focus: mode === 'truecolor' ? 'field' : mode === 'grid' ? 'grid' : 'channels'};
}

function hexToRgb(hex: string): Rgb {
  return {red: parseInt(hex.slice(1, 3), 16), green: parseInt(hex.slice(3, 5), 16), blue: parseInt(hex.slice(5, 7), 16)};
}

function setRgb(state: ColorPickerState, color: Rgb, keepHue = false): void {
  state.color = color;
  const {h, s, v} = rgbToHsv(color);
  if (!keepHue && s > 0) state.hue = h;
  state.saturation = s; state.value = v;
  state.hex = hexColor(color);
  state.gridIndex = Math.max(0, rgbTo256(color) - 16);
  state.error = undefined;
}

function setHsv(state: ColorPickerState): void {
  state.color = hsvToRgb(state.hue, state.saturation, state.value);
  state.hex = hexColor(state.color);
  state.error = undefined;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Keys: arrows edit the focused control, Tab moves focus, `#` types hex, Enter keeps, Esc cancels. */
export function colorPickerKey(state: ColorPickerState, key: Key, level: ColorLevel, fieldSize = {columns: 32, rows: 8}): 'confirm' | 'cancel' | 'changed' | undefined {
  const mode = pickerMode(level);
  const focuses: PickerFocus[] = mode === 'truecolor' ? ['field', 'hue', 'hex'] : mode === 'grid' ? ['grid', 'hex'] : ['channels', 'hex'];
  if (key.kind === 'escape' || key.kind === 'interrupt') {
    if (state.focus === 'hex' && state.hex !== hexColor(state.color)) { state.hex = hexColor(state.color); state.error = undefined; return 'changed'; }
    return 'cancel';
  }
  if (key.kind === 'enter') {
    if (state.focus === 'hex') {
      const parsed = parseHexInput(state.hex);
      if (!parsed) { state.error = 'Use #rrggbb or #rgb.'; return 'changed'; }
      setRgb(state, hexToRgb(parsed));
    }
    return 'confirm';
  }
  if (key.kind === 'complete' || key.kind === 'focusPrevious') {
    const index = focuses.indexOf(state.focus);
    state.focus = focuses[(index + (key.kind === 'complete' ? 1 : focuses.length - 1)) % focuses.length]!;
    return 'changed';
  }
  if (key.kind === 'text' && key.value === '#') { state.focus = 'hex'; state.hex = '#'; state.error = undefined; return 'changed'; }
  if (state.focus === 'hex') {
    if (key.kind === 'backspace') { state.hex = state.hex.slice(0, -1); return 'changed'; }
    if ((key.kind === 'text' || key.kind === 'paste') && /^#?[0-9a-fA-F]+$/u.test(key.value)) {
      state.hex = `#${(state.hex.replace(/^#/u, '') + key.value.replace(/^#/u, '')).slice(0, 6)}`.toLowerCase();
      const parsed = parseHexInput(state.hex);
      if (parsed && state.hex.length === 7) setRgb(state, hexToRgb(parsed));
      return 'changed';
    }
    return undefined;
  }
  const big = key.kind === 'selectLeft' || key.kind === 'selectRight' || key.kind === 'selectUp' || key.kind === 'selectDown';
  const dir = key.kind === 'left' || key.kind === 'selectLeft' ? [-1, 0] : key.kind === 'right' || key.kind === 'selectRight' ? [1, 0]
    : key.kind === 'up' || key.kind === 'selectUp' ? [0, -1] : key.kind === 'down' || key.kind === 'selectDown' ? [0, 1] : undefined;
  if (!dir) return undefined;
  const [dx, dy] = dir as [number, number];
  if (state.focus === 'field') {
    const stepX = (big ? 4 : 1) / Math.max(1, fieldSize.columns - 1);
    const stepY = (big ? 4 : 1) / Math.max(1, fieldSize.rows * 2 - 1);
    state.saturation = clamp(state.saturation + dx * stepX);
    state.value = clamp(state.value - dy * stepY);
    setHsv(state);
  } else if (state.focus === 'hue') {
    state.hue = (state.hue + (dx || -dy) * (big ? 30 : 6) + 360) % 360;
    setHsv(state);
  } else if (state.focus === 'grid') {
    const next = state.gridIndex + dx + dy * GRID_COLUMNS;
    state.gridIndex = Math.max(0, Math.min(GRID_SIZE - 1, next));
    setRgb(state, xterm256(state.gridIndex + 16));
  } else if (state.focus === 'channels') {
    if (dy) state.channel = ((state.channel + dy + 3) % 3) as 0 | 1 | 2;
    else {
      const channels = [state.color.red, state.color.green, state.color.blue];
      channels[state.channel] = Math.max(0, Math.min(255, channels[state.channel]! + dx * (big ? 16 : 1)));
      setRgb(state, {red: channels[0]!, green: channels[1]!, blue: channels[2]!});
    }
  }
  return 'changed';
}

const RESET = '\u001B[0m';

/** Text drawn over a color: whichever of black/white reads better. */
function markerColor(background: Rgb): Rgb {
  const white = {red: 255, green: 255, blue: 255};
  return contrastRatio(white, background) >= contrastRatio({red: 0, green: 0, blue: 0}, background) ? white : {red: 0, green: 0, blue: 0};
}

export function renderColorPicker(state: ColorPickerState, label: string, columns: number, level: ColorLevel,
  fieldSize = {columns: 32, rows: 8}): string[] {
  const mode = pickerMode(level);
  const nerd = getCurrentGlyphMode() === 'nerd';
  const out: string[] = [];
  const focused = (focus: PickerFocus, text: string) => state.focus === focus ? `${nerd ? '›' : '>'} ${text}` : `  ${text}`;
  const fg = (color: Rgb) => colorEscape(38, color, level);
  const bg = (color: Rgb) => colorEscape(48, color, level);
  const swatch = mode === 'plain' ? '' : `${bg(state.color)}      ${RESET} `;
  out.push(`  ${label}`, '');
  out.push(`  ${swatch}${state.hex.toUpperCase()}  RGB ${state.color.red}, ${state.color.green}, ${state.color.blue}`, '');
  if (mode === 'truecolor') {
    const width = Math.max(4, Math.min(fieldSize.columns, columns - 6));
    const height = Math.max(2, fieldSize.rows);
    const markX = Math.round(state.saturation * (width - 1));
    const markY = Math.round((1 - state.value) * (height * 2 - 1));
    for (let row = 0; row < height; row++) {
      let line = '';
      for (let column = 0; column < width; column++) {
        const s = width === 1 ? 0 : column / (width - 1);
        const top = hsvToRgb(state.hue, s, 1 - (row * 2) / (height * 2 - 1));
        const bottom = hsvToRgb(state.hue, s, 1 - (row * 2 + 1) / (height * 2 - 1));
        const marked = column === markX && (markY === row * 2 || markY === row * 2 + 1);
        line += marked ? `${bg(markY === row * 2 ? top : bottom)}${fg(markerColor(markY === row * 2 ? top : bottom))}${nerd ? '◆' : '+'}`
          : `${fg(top)}${bg(bottom)}▀`;
      }
      out.push(`${state.focus === 'field' && row === 0 ? (nerd ? '› ' : '> ') : '  '}${line}${RESET}`);
    }
    const hueWidth = width;
    const hueMark = Math.round((state.hue / 360) * (hueWidth - 1));
    let strip = '';
    for (let column = 0; column < hueWidth; column++) {
      const color = hsvToRgb((column / Math.max(1, hueWidth - 1)) * 360, 1, 1);
      strip += column === hueMark ? `${bg(color)}${fg(markerColor(color))}${nerd ? '│' : '|'}` : `${bg(color)} `;
    }
    out.push('', `${state.focus === 'hue' ? (nerd ? '› ' : '> ') : '  '}${strip}${RESET}  ${Math.round(state.hue)}°`);
  } else if (mode === 'grid') {
    for (let row = 0; row * GRID_COLUMNS < GRID_SIZE; row++) {
      let line = '';
      for (let column = 0; column < GRID_COLUMNS && row * GRID_COLUMNS + column < GRID_SIZE; column++) {
        const index = row * GRID_COLUMNS + column;
        const color = xterm256(index + 16);
        line += index === state.gridIndex ? `${bg(color)}${fg(markerColor(color))}${nerd ? '◆' : '+'}` : `${bg(color)} `;
      }
      out.push(`${state.focus === 'grid' && row === Math.floor(state.gridIndex / GRID_COLUMNS) ? (nerd ? '› ' : '> ') : '  '}${line}${RESET}`);
    }
    out.push('', `  Nearest 256-color: ${state.gridIndex + 16}`);
  } else {
    ['Red', 'Green', 'Blue'].forEach((name, index) => {
      const value = [state.color.red, state.color.green, state.color.blue][index]!;
      out.push(focused('channels', `${name.padEnd(6)}${String(value).padStart(3)}${state.focus === 'channels' && state.channel === index ? '  <- ->' : ''}`));
    });
  }
  out.push('', focused('hex', `Hex ${state.focus === 'hex' ? `${state.hex}_` : state.hex}`));
  if (state.error) out.push(`  ${state.error}`);
  out.push('', renderControls(mode === 'truecolor'
    ? [['←→↑↓', 'adjust'], ['Shift', 'faster'], ['Tab', 'field/hue/hex'], ['#', 'type hex'], ['Enter', 'keep'], ['Esc', 'cancel']]
    : mode === 'grid' ? [['←→↑↓', 'choose'], ['Tab', 'grid/hex'], ['#', 'type hex'], ['Enter', 'keep'], ['Esc', 'cancel']]
      : [['↑↓', 'channel'], ['←→', 'adjust'], ['Tab', 'channels/hex'], ['Enter', 'keep'], ['Esc', 'cancel']]));
  return out.map(row => truncateAnsi(row, columns));
}
