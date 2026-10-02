/** Characters of sanitized startup output exposed to a frontend. */
export const STARTUP_TAIL_CHARS = 2048;
/** Raw bytes retained while the shell has not yet reached its first prompt. */
export const STARTUP_RAW_LIMIT = 16 * 1024;
/** Input queued for a shell that is not ready yet (type-ahead), in UTF-16 units. */
export const PENDING_INPUT_LIMIT = 64 * 1024;

// OSC (BEL or ST terminated), CSI, DCS/PM/APC strings, and two-byte escapes.
const ESCAPES = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[PX^_][^\u001b]*\u001b\\|\u001b\[[0-?]*[ -/]*[@-~]|\u001b[ -/]*[0-~]/gu;

// A sequence cut off at the end of the buffer (including a lone ESC).
const UNTERMINATED_TAIL = /\u001b(?:\[[0-?]*[ -/]*|\](?:[^\u0007\u001b]|\u001b(?!\\))*|[PX^_](?:[^\u001b]|\u001b(?!\\))*)?$/u;

/**
 * Turn raw startup bytes into plain, size-capped text safe to draw inside NMSh's own presentation: no escape
 * sequences, no C0/C1 controls (except newline and tab), carriage returns become line breaks.
 * An escape sequence cut off at the end of the buffer is dropped.
 */
export function sanitizeStartupOutput(raw: string): string {
  const text = raw.replace(UNTERMINATED_TAIL, '').replace(ESCAPES, '')
    .replace(/\r\n?/gu, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, '');
  return text.length > STARTUP_TAIL_CHARS ? text.slice(-STARTUP_TAIL_CHARS) : text;
}
