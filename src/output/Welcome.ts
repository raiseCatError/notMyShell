import {homedir} from 'node:os';
import type {BuildIdentity} from '../buildInfo.js';
import {background, foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, repeatToWidth, truncateText} from '../util/text.js';
import type {WrappedRow} from './viewport.js';

const RESET = '\u001B[0m';
const BODY = {red: 172, green: 150, blue: 230};
const EYE = {red: 22, green: 18, blue: 32};
const WHISKER = {red: 150, green: 142, blue: 172};
const BRAND_ACCENT = {red: 166, green: 124, blue: 243};
const DIVIDER = {red: 105, green: 98, blue: 130};
const BOLD = '\u001B[1m';
const NORMAL_WEIGHT = '\u001B[22m';
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/gu;

export interface WelcomeSnapshot {
  identity: BuildIdentity;
  cwd: string;
  shell: 'zsh';
}

export function createWelcomeSnapshot(identity: BuildIdentity, cwd: string): WelcomeSnapshot {
  return {identity: {...identity}, cwd, shell: 'zsh'};
}

function safe(value: string): string {
  return value.replace(CONTROLS, '�');
}

function shortCwd(cwd: string): string {
  const home = homedir().replace(/\/$/u, '');
  const path = safe(cwd);
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * The mascot is an 8x14 pixel grid drawn with half blocks, so each terminal
 * row carries two pixel rows: L lavender body, E dark eye, . empty. Standing
 * side-on with its face toward the viewer: ears, square eyes, back, four legs
 * and a raised tail. Whiskers are glyphs in otherwise empty cells.
 */
const CAT_PIXELS = [
  '.L...L........',
  '.LLLLL........',
  '.LELEL.......L',
  '.LELEL......L.',
  '.LLLLLLLLLLL..',
  '..LLLLLLLLLL..',
  '..LLLLLLLLLL..',
  '..L.L....L.L..',
];
const CAT_WHISKERS: Record<number, Record<number, string>> = {1: {0: '=', 6: '='}};
const CAT_WIDTH = CAT_PIXELS[0]!.length;
const CAT_ROWS = CAT_PIXELS.length / 2;
const PIXEL_COLORS: Record<string, typeof BODY> = {L: BODY, E: EYE};

/** `blink` draws each eye as a closed lid: a dark slit on the lavender face. */
export type WelcomeCatFrame = 'open' | 'blink';

/** Calm, occasional blinks: deterministic gaps between blinks and a short closed frame. */
export const WELCOME_BLINK_GAPS_MS = [6200, 8400, 5600, 9800] as const;
export const WELCOME_BLINK_CLOSED_MS = 150;

export function welcomeBlinkDelay(blinkCount: number): number {
  const gaps = WELCOME_BLINK_GAPS_MS;
  return gaps[((Math.trunc(blinkCount) % gaps.length) + gaps.length) % gaps.length]!;
}

function catRow(row: number, frame: WelcomeCatFrame = 'open'): {ansi: string; plain: string} {
  const top = CAT_PIXELS[row * 2]!;
  const bottom = CAT_PIXELS[row * 2 + 1]!;
  let ansi = '';
  let plain = '';
  for (let column = 0; column < CAT_WIDTH; column += 1) {
    const upper = PIXEL_COLORS[top[column]!];
    const lower = PIXEL_COLORS[bottom[column]!];
    let glyph: string;
    if (frame === 'blink' && upper === EYE && lower === EYE) {
      glyph = '▂';
      ansi += `${foreground(EYE)}${background(BODY)}${glyph}${RESET}`;
    } else if (!upper && !lower) {
      glyph = CAT_WHISKERS[row]?.[column] ?? ' ';
      ansi += glyph === ' ' ? ' ' : `${foreground(WHISKER)}${glyph}${RESET}`;
    } else if (upper === lower || !lower || !upper) {
      glyph = upper === lower ? '█' : upper ? '▀' : '▄';
      ansi += `${foreground((upper ?? lower)!)}${glyph}${RESET}`;
    } else {
      glyph = '▀';
      ansi += `${foreground(upper)}${background(lower)}${glyph}${RESET}`;
    }
    plain += glyph;
  }
  return {ansi, plain};
}

interface Span {
  text: string;
  color: typeof BODY;
  /** Only the product wordmark is bold; metadata stays quiet. */
  bold?: boolean;
}

/** Truncate styled spans to a cell budget while keeping per-span color. */
function renderSpans(spans: readonly Span[], width: number): {ansi: string; plain: string} {
  const plain = truncateText(spans.map(span => span.text).join(''), width);
  let remaining = plain;
  let ansi = '';
  for (const span of spans) {
    if (!remaining) break;
    const part = remaining.startsWith(span.text) ? span.text : remaining;
    remaining = remaining.slice(part.length);
    ansi += `${span.bold ? BOLD : NORMAL_WEIGHT}${foreground(span.color)}${part}`;
  }
  return {ansi: `${ansi}${RESET}`, plain};
}

function versionLabel(version: string): string {
  return /^\d/u.test(version) ? `v${version}` : version;
}

/** Presentation-only rows, generated from a semantic snapshot on every width change. */
export function renderWelcome(snapshot: WelcomeSnapshot, width: number, frame: WelcomeCatFrame = 'open'): WrappedRow[] {
  if (width <= 0) return [];
  const identity = snapshot.identity;
  const metadata: Span[][] = [
    [
      {text: 'not', color: UI_COLORS.primary, bold: true},
      {text: 'My', color: BRAND_ACCENT, bold: true},
      {text: 'Shell', color: UI_COLORS.primary, bold: true},
      {text: ` ${safe(versionLabel(identity.version))}`, color: UI_COLORS.subtle},
    ],
    [
      {text: `build ${safe(identity.commit)}`, color: UI_COLORS.subtle},
      ...(identity.branch ? [{text: ` · ${safe(identity.branch)}`, color: UI_COLORS.secondary}] : []),
      ...(identity.dirty ? [{text: ' · dirty', color: UI_COLORS.subtle}] : []),
    ],
    [{text: shortCwd(snapshot.cwd), color: UI_COLORS.secondary}],
    [{text: snapshot.shell, color: {red: 104, green: 110, blue: 120}}],
  ];
  const gutter = 2;
  const cat = width >= 42;
  const metadataWidth = cat ? Math.max(1, width - CAT_WIDTH - gutter) : width;
  const rows: WrappedRow[] = [];
  for (let index = 0; index < Math.max(metadata.length, cat ? CAT_ROWS : 0); index += 1) {
    const text = renderSpans(metadata[index] ?? [], metadataWidth);
    if (!cat) {
      rows.push(text);
      continue;
    }
    const prefix = catRow(index, frame);
    const spacer = ' '.repeat(gutter);
    rows.push({plain: `${prefix.plain}${spacer}${text.plain}`, ansi: `${prefix.ansi}${spacer}${text.ansi}`});
  }
  const line = repeatToWidth('─', width);
  rows.push({plain: line, ansi: `${foreground(DIVIDER)}${line}${RESET}`});
  // All rows belong to ordinary scrollback; none have a PTY line index.
  return rows.filter(row => displayWidth(row.plain) <= width);
}
