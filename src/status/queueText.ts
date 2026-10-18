import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {displayWidth, truncateText} from '../util/text.js';
import {displaySafe} from '../input/PasteReview.js';
import type {QueuePause} from '../session/CommandQueue.js';

export function queueGlyph(): string { return getCurrentGlyphMode() === 'safe' ? '=' : '≡'; }
export function pausedGlyph(): string { return getCurrentGlyphMode() === 'safe' ? '||' : '⏸'; }

/** One line for a queued command: its first line, and how many more it has. */
export function queuePreview(text: string, limit = 80): string {
  const lines = text.split('\n');
  const more = lines.length > 1 ? ` (+${lines.length - 1} line${lines.length === 2 ? '' : 's'})` : '';
  const room = Math.max(1, limit - displayWidth(more));
  // Command text is drawn, never interpreted: a pasted escape sequence shows as ␛, it does not reach the terminal.
  return `${truncateText(displaySafe(lines[0]!.trim()) || '(blank first line)', room)}${more}`;
}

/** Why the queue waits, in words. */
export function pauseReason(pause: QueuePause): string {
  switch (pause.reason) {
    case 'failed': return `${commandName(pause.command)} failed (exit ${pause.exitCode})`;
    case 'interrupted': return `${commandName(pause.command)} was interrupted`;
    case 'shell-switched': return 'the shell changed';
    case 'restored': return 'restored, not resumed';
    case 'user': return 'paused manually';
  }
}

function commandName(command: string): string {
  return truncateText(displaySafe(command.split('\n')[0]!.trim()) || 'the command', 32);
}


/** One disclosure used by queue reviews, recipes and the full manager. */
export function failurePolicyNote(policy: import('../session/ExecutionTimeline.js').QueueFailurePolicy): string {
  return `Failure policy: ${policy === 'continue' ? 'continue after nonzero exit' : 'pause remaining queue'}; Ctrl+C always pauses`;
}
