import type {TerminalCapabilities} from './capabilities.js';

export const HOST_PROBE_TIMEOUT_MS = 80;
export const HOST_QUERY = '\u001b[?u\u001b[?2026$p';
/**
 * Kitty graphics support query: a 1×1 RGB direct-data query (a=q) that the
 * host answers with OK or an error, and never displays. Sent only to hosts
 * whose profile suggests graphics, so others never see an APC sequence.
 */
export const GRAPHICS_QUERY = '\u001b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\u001b\\';

/** Read only the two requested replies, never bytes inside a bracketed paste. */
export function resolveProbeReplies(input: string, hints: Readonly<TerminalCapabilities>): {capabilities: TerminalCapabilities; input: string} {
  const capabilities = {...hints};
  let pasted = false;
  const remaining = input.replace(/\u001b\[200~|\u001b\[201~|\u001b\[\?(\d+)u|\u001b\[\?2026;([0-4])\$y|\u001b_Gi=31;([^\u001b]{0,128})\u001b\\/gu,
    (match, flags: string | undefined, status: string | undefined, graphics: string | undefined) => {
      if (match === '\u001b[200~') { pasted = true; return match; }
      if (match === '\u001b[201~') { pasted = false; return match; }
      if (pasted) return match;
      if (graphics !== undefined) {
        // Protocol evidence wins over profile hints in both directions.
        if (graphics === 'OK') capabilities.graphicsProtocol = 'kitty';
        else if (capabilities.graphicsProtocol === 'kitty') capabilities.graphicsProtocol = 'none';
        return '';
      }
      if (flags !== undefined) capabilities.kittyKeyboard = capabilities.enhancedKeyboard = true;
      if (status !== undefined) capabilities.synchronizedOutput = status === '1' || status === '2';
      return '';
    });
  return {capabilities, input: remaining};
}

export interface ProbeTransport {
  write(data: string): unknown;
  listen(receive: (data: string) => void): () => void;
}

/** One bounded parallel query batch per attachment; caller owns raw mode. */
export function probeHost(hints: Readonly<TerminalCapabilities>, transport: ProbeTransport,
  timeoutMs = HOST_PROBE_TIMEOUT_MS, options: {graphics?: boolean} = {}): Promise<ReturnType<typeof resolveProbeReplies>> {
  return new Promise(resolve => {
    let input = '';
    let finished = false;
    let remove = () => {};
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      remove();
      resolve(resolveProbeReplies(input, hints));
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
      transport.write(options.graphics ? `${GRAPHICS_QUERY}${HOST_QUERY}` : HOST_QUERY);
    } catch { finish(); }
  });
}
