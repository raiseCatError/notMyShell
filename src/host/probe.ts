import type {TerminalCapabilities} from './capabilities.js';

export const HOST_PROBE_TIMEOUT_MS = 80;
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
/** DA1 (device attributes: `4` is Sixel), the cell size in pixels and the text area in pixels. */
export const DISPLAY_QUERY = '\u001b[c\u001b[16t\u001b[14t';

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

/** One bounded parallel query batch per attachment; caller owns raw mode. */
export function probeHost(hints: Readonly<TerminalCapabilities>, transport: ProbeTransport,
  timeoutMs = HOST_PROBE_TIMEOUT_MS, options: ProbeOptions = {}): Promise<ReturnType<typeof resolveProbeReplies>> {
  return new Promise(resolve => {
    let input = '';
    let finished = false;
    let remove = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      remove();
      resolve(resolveProbeReplies(input, hints, options));
    };
    const timer = setTimeout(finish, Math.max(0, Math.min(HOST_PROBE_TIMEOUT_MS, timeoutMs)));
    try {
      remove = transport.listen(data => {
        input += data;
        // Stop collecting promptly for large paste/input bursts.
        if (input.length >= 65536) finish();
      });
      // A transport can deliver buffered input synchronously from listen().
      if (finished) { remove(); return; }
      const base = options.graphics ? `${GRAPHICS_QUERY}${HOST_QUERY}` : HOST_QUERY;
      transport.write(options.extended ? `${TEXT_SIZING_QUERY}${base}${DISPLAY_QUERY}` : base);
    } catch { finish(); }
  });
}
