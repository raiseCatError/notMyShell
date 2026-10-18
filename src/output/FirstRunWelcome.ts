import {colorEscape, type Rgb} from '../chroma/escape.js';
import {colorLevel} from '../presentation/capabilities.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {UI_COLORS} from '../ui/palette.js';
import {displayWidth} from '../util/text.js';
import type {WrappedRow} from './viewport.js';

/**
 * The first-run welcome: added to the transcript once, when a genuine first
 * run applies any starting point, right after Vespyr's welcome block. It is
 * stored with the transcript (version 1), so a restored session shows it as
 * part of its history; nothing ever adds it again.
 */
export interface FirstRunSnapshot {version: 1}

export function normalizeFirstRunSnapshot(value: unknown): FirstRunSnapshot | undefined {
  return typeof value === 'object' && value !== null && (value as {version?: unknown}).version === 1 ? {version: 1} : undefined;
}

const RESET = '\u001B[0m', BOLD = '\u001B[1m', ITALIC = '\u001B[3m';
const RIM: Rgb = {red: 0x3e, green: 0xe8, blue: 0xb5};
const GLOW: Rgb = {red: 0x45, green: 0xb8, blue: 0xf0};

export const FIRST_RUN_TIPS: ReadonlyArray<readonly [string, string]> = [['/guide', 'take the tour: everything NMSh can do'], ['/btw', 'ask NMSh anything, in plain English'],
  ['F1', 'open the command palette'], ['/startup', 'change your starting point'], ['/setup', 'change any setting']];

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    if (line && displayWidth(line) + 1 + displayWidth(word) > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** The headline's line number: the ending sweeps light across it once it arrives. */
export const FIRST_RUN_HEADLINE_LINE = 2;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => ({red: Math.round(a.red + (b.red - a.red) * t), green: Math.round(a.green + (b.green - a.green) * t), blue: Math.round(a.blue + (b.blue - a.blue) * t)});

/** The horizon, kept: a short luminous rule from the aurora's green rim through its blue glow to the theme's accent. */
function rule(width: number): WrappedRow {
  const length = Math.max(1, Math.min(44, width - 2));
  const level = colorLevel();
  if (level === 'none' || getCurrentGlyphMode() !== 'nerd') {
    const plain = `  ${'_'.repeat(length)}`;
    return {ansi: plain, plain};
  }
  const stops = [RIM, GLOW, UI_COLORS.accent];
  let ansi = '  ';
  for (let i = 0; i < length; i++) {
    const position = length === 1 ? 0 : i / (length - 1) * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.floor(position));
    ansi += `${colorEscape(38, mix(stops[index]!, stops[index + 1]!, position - index), level)}▁`;
  }
  return {ansi: `${ansi}${RESET}`, plain: `  ${'▁'.repeat(length)}`};
}

/**
 * The welcome's rows for a width; plain text stays within it. Each row carries
 * its line number (`firstRunLine`, from 1; Vespyr's block above is 0) so the
 * ending can reveal it line by line: a wrapped paragraph is one line and a
 * spacer arrives with the line after it.
 */
export function renderFirstRunWelcome(width: number): WrappedRow[] {
  const columns = Math.max(1, width);
  const textWidth = Math.max(8, Math.min(columns - 2, 76));
  const row = (plain: string, style = ''): WrappedRow => ({ansi: style ? `${style}${plain}${RESET}` : plain, plain});
  const blank = (): WrappedRow => ({ansi: '', plain: ''});
  const paragraph = (text: string, style: string) => wrap(text, textWidth).map(line => row(`  ${line}`, style));
  const primary = colorEscape(38, UI_COLORS.primary), secondary = colorEscape(38, UI_COLORS.secondary);
  const subtle = colorEscape(38, UI_COLORS.subtle), accent = colorEscape(38, UI_COLORS.accent);
  const keyWidth = Math.max(...FIRST_RUN_TIPS.map(([key]) => displayWidth(key))) + 3;
  // A tip that does not fit wraps its action under itself, never past the edge.
  const tip = ([key, action]: readonly [string, string]): WrappedRow[] => {
    const lead = 4 + keyWidth;
    const lines = wrap(action, Math.max(4, columns - lead));
    return lines.map((line, index) => index === 0
      ? {ansi: `    ${BOLD}${accent}${key}${RESET}${' '.repeat(keyWidth - displayWidth(key))}${secondary}${line}${RESET}`, plain: `    ${key.padEnd(keyWidth)}${line}`}
      : row(`${' '.repeat(lead)}${line}`, secondary));
  };
  const lines: WrappedRow[][] = [
    [blank(), rule(columns)],
    paragraph('You\'re all set. Welcome to notMyShell!', `${BOLD}${primary}`),
    paragraph('We\'re so glad you\'re here. Your shell is still yours; NMSh just makes it a nicer place to live.', secondary),
    ...FIRST_RUN_TIPS.map((item, index) => index === 0 ? [blank(), ...tip(item)] : tip(item)),
    [blank(), ...paragraph('The aurora lives on in /screensaver.', `${ITALIC}${subtle}`)],
  ];
  return lines.flatMap((items, index) => items.map(item => {
    const fitted = displayWidth(item.plain) <= columns ? item : {ansi: item.plain.slice(0, columns), plain: item.plain.slice(0, columns)};
    return {...fitted, firstRunLine: index + 1};
  }));
}
