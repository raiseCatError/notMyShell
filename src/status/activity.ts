import stringWidth from 'string-width';
import {formatDuration, formatLocalTime} from './commandTiming.js';
import {GLYPHS, SPINNER_FRAMES} from '../ui/glyphs.js';

export const ACTIVITY_GLYPH_INTERVAL_MS = 165;

export function activityGlyph(elapsedMs: number): string {
  const frames = SPINNER_FRAMES.frames;
  return frames[Math.floor(Math.max(0, elapsedMs) / ACTIVITY_GLYPH_INTERVAL_MS) % frames.length];
}

export function liveActivityParts(command: string, elapsedMs: number): {phrase: string; duration: string} {
  let flattenedCommand = command.trim().replace(/\r?\n/g, ' ⏎ ');
  if (flattenedCommand.length > 50) {
    flattenedCommand = flattenedCommand.slice(0, 49) + '…';
  }
  return {
    phrase: `${activityGlyph(elapsedMs)} Running ${flattenedCommand}`,
    duration: ` · ${formatDuration(elapsedMs)}`,
  };
}

export function completedActivity(command: string, elapsedMs: number, completedAt: Date, exitCode: number, interrupted: boolean, facts?: string[]): {main: string; detail: string} {
  let statusText = 'Completed';
  let icon = GLYPHS.success;

  if (facts && facts.length > 0) {
    statusText = facts.join(' · ');
  }

  if (interrupted) {
    statusText = 'Interrupted';
    icon = GLYPHS.failure;
  } else if (exitCode !== 0) {
    if (facts && facts.length > 0) {
        statusText = `Command failed · ${facts.join(' · ')} · exit ${exitCode}`;
    } else {
        statusText = `Command failed · exit ${exitCode}`;
    }
    icon = GLYPHS.failure;
  }

  return {
    main: `${icon} ${statusText} · ${formatDuration(elapsedMs)}`,
    detail: ` · ${formatLocalTime(completedAt)}`,
  };
}

export function activityGlyphWidths(): number[] {
  return SPINNER_FRAMES.frames.map(glyph => stringWidth(glyph));
}
