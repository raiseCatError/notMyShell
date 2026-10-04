import {formatDuration} from './commandTiming.js';
import {shimmerText} from './shimmer.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';

/**
 * One live activity line in NMSh's shared presentation: the ✦ mark, a
 * travelling luminance shimmer over the label (the same wave as running
 * commands), factual detail, and elapsed time. Reduced Motion or Decorative
 * Effects Off render it static. Used by Ask's working state, managed tasks
 * and model downloads, so there is one live-activity look, not several.
 */
export interface LiveLineOptions {
  /** Reduced Motion or Decorative Effects Off: no movement. */
  still?: boolean;
  /** Show elapsed time (omit for very short waits). */
  elapsed?: boolean;
}

export function liveLine(label: string, detail: string | undefined, startedAt: number, now: number, options: LiveLineOptions = {}): string {
  const reset = '\u001b[0m';
  const mark = getCurrentGlyphMode() === 'safe' ? '*' : '✦';
  const elapsedMs = Math.max(0, now - startedAt);
  const body = options.still ? `${foreground(UI_COLORS.secondary)}${label}` : shimmerText(label, elapsedMs, false);
  const tail = [detail, options.elapsed === false ? undefined : formatDuration(elapsedMs)].filter(Boolean).join(' · ');
  return `${foreground(UI_COLORS.accent)}${mark}${reset} ${body}${reset}${tail ? `${foreground(UI_COLORS.subtle)} · ${tail}${reset}` : ''}`;
}
