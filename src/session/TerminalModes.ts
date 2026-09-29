// DECSET/DECRST 1049, 1047 and 47: the alternate-screen switches.
const ALT_SCREEN = /\u001b\[\?(?:1049|1047|47)([hl])/g;
const DEC_MODE = /\u001b\[\?([\d;]+)([hl])/g;
const KEYPAD = /\u001b([=>])/g;
// Kitty keyboard protocol: push (CSI > flags u) and pop (CSI < n u).
const KITTY_PUSH = /\u001b\[>(\d*)u/g;
const KITTY_POP = /\u001b\[<\d*u/g;
/** DECCKM, cursor visibility, mouse protocols, focus events, bracketed paste. */
const TRACKED_MODES = new Set([1, 25, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 2004]);
/**
 * Modes only a program reading keys, pastes or clicks from the terminal turns
 * on: bracketed paste, mouse reporting and focus events. Cursor visibility and
 * cursor-key mode are left out because progress bars and pagers touch them too.
 */
const INPUT_MODES = new Set([1000, 1002, 1003, 1004, 1005, 1006, 1015, 2004]);

/**
 * Follows what the PTY's foreground program has asked of the terminal: whether
 * it is on the alternate screen, the input modes it turned on, and whether
 * that makes it an interactive terminal UI.
 */
export class AlternateScreenTracker {
  active = false;
  /**
   * The program turned on a terminal input mode (bracketed paste, mouse,
   * focus events or the kitty keyboard protocol), so it reads interactive
   * input from the terminal even without the alternate screen (for example
   * an inline agent UI). Reset when the command ends.
   */
  interactive = false;
  private carry = '';

  /**
   * Observe a chunk and return the part of it that belongs to the ordinary
   * transcript: what a fullscreen or interactive app draws is repainted on
   * reattach, never replayed as transcript text.
   */
  push(data: string): string {
    const text = this.carry + data;
    let kept = '';
    let from = this.carry.length;
    for (const match of text.matchAll(ALT_SCREEN)) {
      const index = match.index;
      if (!this.active && !this.interactive && index >= from) kept += text.slice(from, index);
      from = Math.max(from, index + match[0].length);
      this.active = match[1] === 'h';
    }
    if (!this.active && !this.interactive) kept += text.slice(from);
    // Keep a tail so a sequence split across reads is still seen.
    const escape = text.lastIndexOf('\u001b');
    this.carry = escape !== -1 && text.length - escape < 8 ? text.slice(escape) : '';
    return kept;
  }

  reset(): void {
    this.active = false;
    this.interactive = false;
    this.carry = '';
    this.modes.clear();
    this.keypad = false;
    this.kittyFlags = undefined;
  }

  private readonly modes = new Map<number, boolean>();
  private keypad = false;
  private kittyFlags?: string;
  private modeCarry = '';

  /**
   * Track the input-affecting terminal modes the foreground app set (mouse
   * reporting, bracketed paste, application cursor keys and keypad, focus
   * events, cursor visibility, kitty keyboard flags). They were sent to
   * whichever terminal was showing the program then; a frontend that takes
   * over later replays them from here.
   */
  observeModes(data: string): void {
    const text = this.modeCarry + data;
    for (const match of text.matchAll(DEC_MODE)) {
      for (const param of match[1]!.split(';')) {
        const mode = Number(param);
        if (!TRACKED_MODES.has(mode)) continue;
        this.modes.set(mode, match[2] === 'h');
        if (match[2] === 'h' && INPUT_MODES.has(mode)) this.interactive = true;
      }
    }
    for (const match of text.matchAll(KEYPAD)) this.keypad = match[1] === '=';
    for (const match of text.matchAll(KITTY_PUSH)) {
      this.kittyFlags = match[1] || '1';
      this.interactive = true;
    }
    if (KITTY_POP.test(text)) this.kittyFlags = undefined;
    KITTY_POP.lastIndex = 0;
    const escape = text.lastIndexOf('\u001b');
    this.modeCarry = escape !== -1 && text.length - escape < 16 ? text.slice(escape) : '';
  }

  /** Sequences that put a fresh terminal into the app's current input modes. */
  restoreSequence(): string {
    let sequence = '';
    for (const [mode, on] of this.modes) {
      if (mode === 25) { if (!on) sequence += '\u001b[?25l'; } else if (on) sequence += `\u001b[?${mode}h`;
    }
    if (this.keypad) sequence += '\u001b=';
    if (this.kittyFlags) sequence += `\u001b[>${this.kittyFlags}u`;
    return sequence;
  }

  /** The program owns the terminal: fullscreen, or an interactive UI. */
  get ownsTerminal(): boolean {
    return this.active || this.interactive;
  }
}
