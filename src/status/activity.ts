import stringWidth from 'string-width';
import {formatDuration, formatLocalTime} from './commandTiming.js';
import {GLYPHS, SPINNER_FRAMES} from '../ui/glyphs.js';

export const ACTIVITY_GLYPH_INTERVAL_MS = 165;

export function activityGlyph(elapsedMs: number): string {
  const frames = SPINNER_FRAMES.frames;
  return frames[Math.floor(Math.max(0, elapsedMs) / ACTIVITY_GLYPH_INTERVAL_MS) % frames.length];
}

export function liveActivityParts(command: string, elapsedMs: number): {phrase: string; duration: string} {
  return {
    phrase: `${activityGlyph(elapsedMs)} Running ${command}`,
    duration: ` · ${formatDuration(elapsedMs)}`,
  };
}

export function completedActivity(command: string, elapsedMs: number, completedAt: Date, exitCode: number, interrupted: boolean): {main: string; detail: string} {
  return {
    main: `${GLYPHS.success} Completed · ${formatDuration(elapsedMs)}`,
    detail: ` · ${formatLocalTime(completedAt)}`,
  };
}

export function activityGlyphWidths(): number[] {
  return SPINNER_FRAMES.frames.map(glyph => stringWidth(glyph));
}
