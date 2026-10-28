import type {TerminalCapabilities} from './capabilities.js';

export const HOST_PROBE_TIMEOUT_MS = 80;
/**
 * The extended batch ends with DA1, which every VT-style terminal answers, and answers in order: its reply means every
 * earlier reply has arrived, so the probe ends at once. This is only the wait for a terminal that is slow to answer (SSH,
 * a busy machine); replies later than this are still recognized (see `takeLateProbeReplies`) and never become typing.
 */
export const HOST_PROBE_REPLY_TIMEOUT_MS = 750;
/** How long after startup a reply to the startup probe is still recognized as one. */
export const LATE_PROBE_WINDOW_MS = 10_000;
const DA1_REPLY = /\u001b\[\?[\d;]{1,64}c/u;
export const HOST_QUERY = '\u001b[?u\u001b[?2026$p';
/**
 * Kitty graphics support query: a 1×1 RGB direct-data query (a=q) that the
 * host answers with OK or an error, and never displays. Sent only to hosts
 * whose profile suggests graphics, so others never see an APC sequence.
 */
export const GRAPHICS_QUERY = '\u001b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\u001b\\';

/**
 * Text sizing (OSC 66) detection, as the specification gives it: from the first column of a scratch screen, report the
 * cursor, draw a space two cells wide (`w=2`), report, draw a space at double scale (`s=2`), report. Equal positions:
 * unsupported. A step of two for the first draw: explicit widths work; two more for the second: scaling works. It runs on the
 * alternate screen and leaves it, so nothing the person sees is touched, and it is sent only when asked for.
 */
export const TEXT_SIZING_QUERY = '\u001b[?1049h\u001b[2J\u001b[H\u001b[6n\u001b]66;w=2; \u001b\\\u001b[6n\u001b]66;s=2; \u001b\\\u001b[6n\u001b[?1049l';
/** The cell size in pixels, the text area in pixels and DA1 (device attributes: `4` is Sixel), last as the end marker. */
export const DISPLAY_QUERY = '\u001b[16t\u001b[14t\u001b[c';

export interface ProbeOptions {
  graphics?: boolean;
  /** Also ask for text sizing, Sixel, cell size and window size. */
  extended?: boolean;
}

/** Read only the two requested replies, never bytes inside a bracketed paste. */
export function resolveProbeReplies(input: string, hints: Readonly<TerminalCapabilities>, options: ProbeOptions = {}): {capabilities: TerminalCapabilities; input: string} {
  const capabilities = {...hints};
  let pasted = false;
  // Only as many cursor reports as were asked for (three) are ours; later ones are the person's keys.
  const positions: Array<{row: number; column: number}> = [];
  let displayReplies = 0;
  const remaining = input.replace(/\u001b\[200~|\u001b\[201~|\u001b\[\?(\d+)u|\u001b\[\?2026;([0-4])\$y|\u001b_Gi=31;([^\u001b]{0,128})\u001b\\|\u001b\[(\d{1,4});(\d{1,4})R|\u001b\[\?([\d;]{1,64})c|\u001b\[([46]);(\d{1,5});(\d{1,5})t/gu,
    (match, flags: string | undefined, status: string | undefined, graphics: string | undefined, row: string | undefined, column: string | undefined,
      attributes: string | undefined, kind: string | undefined, height: string | undefined, width: string | undefined) => {
      if (match === '\u001b[200~') { pasted = true; return match; }
      if (match === '\u001b[201~') { pasted = false; return match; }
      if (pasted) return match;
      if (row !== undefined) {
        if (!options.extended || positions.length >= 3) return match;
        positions.push({row: Number(row), column: Number(column)});
        return '';
      }
      if (attributes !== undefined) {
        if (!options.extended || displayReplies >= 3) return match;
        displayReplies += 1;
        if (attributes.split(';').includes('4')) capabilities.sixel = true;
        return '';
      }
      if (kind !== undefined) {
        if (!options.extended || displayReplies >= 3) return match;
        displayReplies += 1;
        const size = {width: Number(width), height: Number(height)};
        if (size.width > 0 && size.height > 0 && size.width <= 1000 && size.height <= 1000 && kind === '6') capabilities.cellPixels = size;
        else if (size.width > 0 && size.height > 0 && kind === '4') capabilities.windowPixels = size;
        return '';
      }
      if (graphics !== undefined) {
        // Protocol evidence wins over profile hints in both directions.
        if (graphics === 'OK') capabilities.graphicsProtocol = 'kitty';
        else if (capabilities.graphicsProtocol === 'kitty') capabilities.graphicsProtocol = 'none';
        return '';
      }
      if (flags !== undefined) capabilities.kittyKeyboard = capabilities.enhancedKeyboard = true;
      if (status !== undefined) capabilities.synchronizedOutput = !hints.hostSynchronizes && (status === '1' || status === '2');
      return '';
    });
  if (options.extended && positions.length === 3) {
    const [start, afterWidth, afterScale] = positions as [typeof positions[0], typeof positions[0], typeof positions[0]];
    const sameRow = start.row === afterWidth.row && afterWidth.row === afterScale.row;
    capabilities.textSizing = {
      width: sameRow && afterWidth.column - start.column === 2,
      scale: sameRow && afterScale.column - afterWidth.column === 2,
    };
  }
  // The window size is the fallback for a terminal that did not answer the cell size.
  return {capabilities, input: remaining};
}

export interface ProbeTransport {
  write(data: string): unknown;
  listen(receive: (data: string) => void): () => void;
}

/** Whether the DA1 end marker is in `input` (outside a bracketed paste). */
function sawEndMarker(input: string): boolean {
  return DA1_REPLY.test(input.replace(/\u001b\[200~[\s\S]*?(?:\u001b\[201~|$)/gu, ''));
}

/**
 * One bounded parallel query batch per attachment; caller owns raw mode. The extended batch ends as soon as the DA1 end
 * marker arrives; `pending` says it did not arrive in time, so later replies may still come (see `takeLateProbeReplies`).
 */
export function probeHost(hints: Readonly<TerminalCapabilities>, transport: ProbeTransport,
  timeoutMs?: number, options: ProbeOptions = {}): Promise<ReturnType<typeof resolveProbeReplies> & {pending: boolean}> {
  const limit = options.extended ? HOST_PROBE_REPLY_TIMEOUT_MS : HOST_PROBE_TIMEOUT_MS;
  return new Promise(resolve => {
    let input = '';
    let finished = false;
    let remove = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      remove();
      resolve({...resolveProbeReplies(input, hints, options), pending: Boolean(options.extended) && !sawEndMarker(input)});
    };
    // A timer that fires late (a blocked event loop) runs before that turn's reads: let input already waiting arrive first.
    const timer = setTimeout(() => setImmediate(finish), Math.max(0, Math.min(limit, timeoutMs ?? limit)));
    try {
      remove = transport.listen(data => {
        input += data;
        // Stop collecting promptly for large paste/input bursts, and as soon as the end marker answers.
        if (input.length >= 65536 || (options.extended && sawEndMarker(input))) finish();
      });
      // A transport can deliver buffered input synchronously from listen().
      if (finished) { remove(); return; }
      const base = options.graphics ? `${GRAPHICS_QUERY}${HOST_QUERY}` : HOST_QUERY;
      transport.write(options.extended ? `${TEXT_SIZING_QUERY}${base}${DISPLAY_QUERY}` : base);
    } catch { finish(); }
  });
}

/** The Kitty graphics reply to the startup query (image id 31), whole. */
const LATE_GRAPHICS_REPLY = /\u001b_Gi=31;([^\u001b]{0,128})\u001b\\/gu;

/**
 * Replies to the startup probe that arrive after it gave up: removed from `input` so they never become typing, with the
 * evidence they carry. `done` means the DA1 end marker arrived (nothing more is outstanding).
 */
export function takeLateProbeReplies(input: string, capabilities: Readonly<TerminalCapabilities>): {input: string; capabilities?: TerminalCapabilities; done: boolean} {
  let next: TerminalCapabilities | undefined;
  const done = sawEndMarker(input);
  const rest = input.replace(LATE_GRAPHICS_REPLY, (_match, message: string) => {
    if (message === 'OK' && capabilities.graphicsProtocol !== 'kitty') next = {...(next ?? capabilities), graphicsProtocol: 'kitty'};
    return '';
  });
  return {input: rest, ...(next ? {capabilities: next} : {}), done};
}
