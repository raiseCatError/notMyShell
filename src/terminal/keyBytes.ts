import type {Key} from './keys.js';

/**
 * The bytes an ordinary terminal sends for a key, for a program reading the terminal directly (a hidden line or
 * single keys) while NMSh's own terminal speaks an extended keyboard protocol. Only keys with one conventional
 * encoding are sent; NMSh's own gestures (selection, history search, palette, focus) and pointer events are not,
 * so nothing the program did not ask for reaches it. Ctrl+C and Ctrl+D are the caller's (signal and end of input).
 */
const PLAIN: Partial<Record<Key['kind'], string>> = {
  enter: '\r',
  // Shift+Enter has no meaning to a program reading a line or keys: it submits, as Enter does.
  newline: '\r',
  backspace: '\u007f',
  delete: '\u001b[3~',
  complete: '\t',
  focusPrevious: '\u001b[Z',
  escape: '\u001b',
  up: '\u001b[A',
  down: '\u001b[B',
  right: '\u001b[C',
  left: '\u001b[D',
  lineHome: '\u001b[H',
  lineEnd: '\u001b[F',
  // The line discipline's own editing keys: word and line erase.
  deleteWord: '\u0017',
  deleteLineBefore: '\u0015',
  suspend: '\u001a',
};

export function directKeyBytes(key: Key): string | undefined {
  if (key.kind === 'text' || key.kind === 'paste') return key.value;
  return PLAIN[key.kind];
}
