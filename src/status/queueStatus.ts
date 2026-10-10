import {displayWidth, truncateText} from '../util/text.js';
import {displaySafe} from '../input/PasteReview.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import type {QueuePause, QueueState} from '../session/CommandQueue.js';

/**
 * How NMSh shows the command queue. The queue's owner (the session service, or the in-process client) is the one
 * source; this module only words and paints it. No animation: a queue waits, it does not work.
 */
const RESET = '\u001b[0m';

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
    case 'user': return 'paused';
  }
}

function commandName(command: string): string {
  return truncateText(displaySafe(command.split('\n')[0]!.trim()) || 'the command', 32);
}

/**
 * The queue's one line under the running command (or at idle while paused), widest form first:
 *   ≡ Queued (2) · next: adb devices · /queue
 *   ⏸ Queue paused · make failed (exit 2) · 2 waiting · /queue
 * Narrow widths drop the hint, then the reason or preview; the count always stays.
 */
export function queueRow(state: QueueState, columns: number): string | undefined {
  const count = state.entries.length;
  if (!count || columns <= 0) return undefined;
  const subtle = foreground(UI_COLORS.subtle);
  const secondary = foreground(UI_COLORS.secondary);
  const accent = foreground(UI_COLORS.accent);
  if (state.paused) {
    const head = `${pausedGlyph()} Queue paused`;
    const parts = [pauseReason(state.paused), `${count} waiting`, '/queue'];
    const forms = [parts, parts.slice(0, 2), [parts[1]!]];
    for (const form of forms) {
      const plain = [head, ...form].join(' · ');
      if (displayWidth(plain) <= columns) return `${accent}${head}${RESET}${secondary} · ${form.join(' · ')}${RESET}`;
    }
    return `${accent}${truncateText(`${head} · ${count}`, columns)}${RESET}`;
  }
  const next = state.entries[0]!;
  const head = `${queueGlyph()} Queued (${count})`;
  const editing = state.editing === next.id ? ' (editing)' : '';
  for (const hint of [' · /queue', '']) {
    const room = columns - displayWidth(`${head} · next: `) - displayWidth(editing) - displayWidth(hint);
    if (room >= 8) return `${secondary}${head}${RESET}${subtle} · next: ${queuePreview(next.text, room)}${editing}${hint}${RESET}`;
  }
  return `${secondary}${truncateText(head, columns)}${RESET}`;
}
