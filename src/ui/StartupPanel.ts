import {foreground, UI_COLORS} from './palette.js';
import {truncateText} from '../util/text.js';

const BOLD = '\u001B[1m';
const RESET = '\u001B[0m';

export interface StartupPanelState {tail: string; elapsedMs: number}

/** Plain, sanitized lines for the "shell is still starting" state; the caller frames them. */
export function renderStartupPanel(state: StartupPanelState, columns: number, rows: number): string[] {
  const width = Math.max(10, columns - 4);
  const muted = foreground(UI_COLORS.secondary);
  const seconds = Math.max(1, Math.round(state.elapsedMs / 1000));
  const lines = [
    `  ${BOLD}Shell startup is still running${RESET}${muted} (${seconds}s)${RESET}`,
    `${muted}  zsh has not reached its first prompt. A startup file may be waiting for input or running slowly.${RESET}`,
  ];
  const tail = state.tail.split('\n').map(line => line.trimEnd());
  while (tail.length > 0 && tail[0] === '') tail.shift();
  const budget = Math.max(1, Math.min(8, rows - 12));
  const shown = tail.slice(-budget);
  lines.push(shown.length ? `${muted}  Output so far:${RESET}` : `${muted}  No output yet.${RESET}`);
  for (const line of shown) lines.push(`    ${truncateText(line, width)}`);
  lines.push(`${muted}  Ctrl+C  abort startup and close this session · commands are held until the shell is ready${RESET}`);
  return lines;
}
