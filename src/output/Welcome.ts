import {homedir} from 'node:os';
import type {BuildIdentity} from '../buildInfo.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, repeatToWidth, truncateText} from '../util/text.js';
import type {WrappedRow} from './viewport.js';

const RESET = '\u001B[0m';
const BODY = {red: 160, green: 145, blue: 203};
const EYE = {red: 27, green: 24, blue: 37};
const DIVIDER = {red: 105, green: 98, blue: 130};
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

const CAT = [
  '  ▄██▄   ▄██▄  ',
  ' ▟███████████▙ ',
  '▐███▪████▪███▌',
  '▐████████████▌',
  ' ▐██████████▌ ',
  ' ▐██▌ ▐██▌▗██▘',
  ' ▝██▘ ▝██▘▝▀  ',
];

function catRow(index: number): {ansi: string; plain: string} {
  const plain = CAT[index] ?? '';
  // Square eyes use the dark detail color; the body remains one lavender tone.
  const ansi = plain.split('').map(character => character === '▪'
    ? `${foreground(EYE)}▪${foreground(BODY)}`
    : `${foreground(BODY)}${character}`).join('');
  return {ansi: `${ansi}${RESET}`, plain};
}

/** Presentation-only rows, generated from a semantic snapshot on every width change. */
export function renderWelcome(snapshot: WelcomeSnapshot, width: number): WrappedRow[] {
  if (width <= 0) return [];
  const identity = snapshot.identity;
  const metadata = [
    `NMSh ${safe(identity.version)}`,
    `build ${safe(identity.commit)}${identity.branch ? ` · ${safe(identity.branch)}` : ''}${identity.dirty ? ' · dirty' : ''}`,
    shortCwd(snapshot.cwd),
    snapshot.shell,
  ];
  const colors = [UI_COLORS.primary, UI_COLORS.secondary, UI_COLORS.secondary, UI_COLORS.subtle];
  const cat = width >= 42;
  const catWidth = 15;
  const metadataWidth = cat ? Math.max(1, width - catWidth - 3) : width;
  const rows: WrappedRow[] = metadata.map((value, index) => {
    const label = truncateText(value, metadataWidth);
    const prefix = catRow(index);
    const plain = cat ? `${prefix.plain}   ${label}` : label;
    return {plain, ansi: `${cat ? `${prefix.ansi}   ` : ''}${foreground(colors[index]!)}${label}${RESET}`};
  });
  if (cat) {
    for (let index = metadata.length; index < CAT.length; index += 1) {
      const prefix = catRow(index);
      rows.push({plain: prefix.plain, ansi: prefix.ansi});
    }
  }
  const line = repeatToWidth('─', width);
  rows.push({plain: line, ansi: `${foreground(DIVIDER)}${line}${RESET}`});
  // All rows belong to ordinary scrollback; none have a PTY line index.
  return rows.filter(row => displayWidth(row.plain) <= width);
}
