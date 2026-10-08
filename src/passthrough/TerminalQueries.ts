/**
 * Terminal queries belong to the terminal. A program often asks about the
 * terminal (DECRQM synchronized output and grapheme clustering, device
 * attributes, XTVERSION, the kitty keyboard protocol, default colours) in its
 * first bytes, before anything shows that it takes the screen. Those bytes
 * would otherwise reach only NMSh's transcript parser, the program would get
 * no answers, and after its timeout it would draw as if on a lesser terminal
 * (agy then redraws without synchronized output and the cursor visibly moves).
 *
 * So queries a running command writes while NMSh still owns the screen are
 * sent to the host terminal, which never paints for them, and the host's
 * replies are routed back to the program instead of being decoded as keys.
 * Cursor position reports (DSR 6) are excluded: the position would be NMSh's
 * composer, not anything the program drew.
 */

const QUERY = /\u001b\[\??\d+\$p|\u001b\[0?c|\u001b\[>0?c|\u001b\[>0?q|\u001b\[\?u|\u001b\[\?996n|\u001b\[1[468]t|\u001b\](?:1[0-2]|4;\d{1,3});\?(?:\u0007|\u001b\\)|\u001bP(?:\+q[0-9A-Fa-f;]{1,256}|\$q[ -~]{1,8})\u001b\\/gu;
const REPLY = /^(?:\u001b\[\??\d+;\d\$y|\u001b\[\?[\d;]{1,64}c|\u001b\[>[\d;]{1,64}c|\u001bP>\|[ -~]{0,128}\u001b\\|\u001b\[\?\d{1,10}u|\u001b\[\?997;\d n|\u001b\[[468];\d{1,6};\d{1,6}t|\u001b\](?:1[0-2]|4;\d{1,3});[ -~]{1,128}(?:\u0007|\u001b\\)|\u001bP[01][+$]r[ -~]{0,512}\u001b\\)/u;
/**
 * A reply that may still be arriving: at least three bytes of a form only a terminal answer starts with
 * (CSI ? / CSI > / CSI digit, OSC with a number, DCS > or DCS 0/1). Two-byte prefixes are never held, so
 * Alt+P (ESC P), Alt+] (ESC ]) and Alt+[ stay ordinary keys and are never delayed.
 */
const REPLY_PREFIX = /^\u001b(?:\[[?>\d][\d;$]*|\]\d[\d;]*(?:;[ -~]*)?|P(?:>\|?[ -~]*|[01][+$]?r?[ -~]*))$/u;
const MAX_CARRY = 600;

/** Query sequences in `text`, in order, joined; a sequence split across reads is completed by `carry`. */
export class QueryExtractor {
  private carry = '';

  push(data: string): string {
    const text = this.carry + data;
    this.carry = '';
    let queries = '';
    let end = 0;
    for (const match of text.matchAll(QUERY)) { queries += match[0]; end = match.index + match[0].length; }
    const escape = text.lastIndexOf('\u001b');
    if (escape >= end && text.length - escape < 64 && !/[\u0007]|\u001b\\/u.test(text.slice(escape + 1))) this.carry = text.slice(escape);
    return queries;
  }

  reset(): void { this.carry = ''; }
}

/**
 * Splits terminal input into replies owed to the program and everything else,
 * only while replies are expected (a short window after forwarding a query).
 */
export class ReplyRouter {
  private expectUntil = 0;
  private held = '';

  expect(now: number, windowMs = 2000): void { this.expectUntil = Math.max(this.expectUntil, now + windowMs); }

  get expecting(): boolean { return this.expectUntil > 0; }

  stop(): string {
    this.expectUntil = 0;
    const held = this.held;
    this.held = '';
    return held;
  }

  /** `replies` go to the program; `rest` is ordinary input, in order. */
  split(data: string, now: number): {replies: string; rest: string} {
    if (!this.expecting || now > this.expectUntil) return {replies: '', rest: this.stop() + data};
    const text = this.held + data;
    this.held = '';
    let replies = '';
    let rest = '';
    let index = 0;
    while (index < text.length) {
      const escape = text.indexOf('\u001b', index);
      if (escape === -1) { rest += text.slice(index); break; }
      rest += text.slice(index, escape);
      const tail = text.slice(escape, escape + MAX_CARRY);
      const reply = REPLY.exec(tail);
      if (reply) { replies += reply[0]; index = escape + reply[0].length; continue; }
      // Escape and Alt+key are never held; only an unmistakable reply prefix split across reads is.
      if (tail.length >= 3 && tail.length === text.length - escape && tail.length < MAX_CARRY && REPLY_PREFIX.test(tail)) { this.held = tail; break; }
      rest += '\u001b';
      index = escape + 1;
    }
    return {replies, rest};
  }
}
