// DECSET/DECRST 1049, 1047 and 47: the alternate-screen switches.
const ALT_SCREEN = /\u001b\[\?(?:1049|1047|47)([hl])/g;
// Process modes in wire order, including independent main/alternate keyboard stacks.
const MODE_SEQUENCE = /\u001b\[\?([\d;]+)([hl])|\u001b([=>])|\u001b\[([><])(\d{0,10})u/g;
const MAX_KEYBOARD_STACK = 32;
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

  reset(screen: 'main' | 'alternate' = 'main'): void {
    this.active = false;
    this.interactive = false;
    this.carry = '';
    this.modes.clear();
    this.keypad = false;
    this.modeCarry = '';
    this.keyboardScreen = screen;
    this.keyboardStacks.main.length = 0;
    this.keyboardStacks.alternate.length = 0;
  }

  private readonly modes = new Map<number, boolean>();
  private keypad = false;
  private keyboardScreen: 'main' | 'alternate' = 'main';
  private readonly keyboardStacks = {main: [] as string[], alternate: [] as string[]};
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
    for (const match of text.matchAll(MODE_SEQUENCE)) {
      if (match[1] !== undefined) {
        for (const param of match[1].split(';')) {
          const mode = Number(param);
          if ([47, 1047, 1049].includes(mode)) this.keyboardScreen = match[2] === 'h' ? 'alternate' : 'main';
          if (!TRACKED_MODES.has(mode)) continue;
          this.modes.set(mode, match[2] === 'h');
          if (match[2] === 'h' && INPUT_MODES.has(mode)) this.interactive = true;
        }
      } else if (match[3] !== undefined) this.keypad = match[3] === '=';
      else {
        const stack = this.keyboardStacks[this.keyboardScreen];
        if (match[4] === '>') {
          if (stack.length >= MAX_KEYBOARD_STACK) stack.shift();
          stack.push(match[5] || '0');
          this.interactive = true;
        } else {
          const count = match[5] === '' ? 1 : Number(match[5]);
          stack.splice(Math.max(0, stack.length - count));
        }
      }
    }
    // Retain only an incomplete sequence. Replaying a complete push would
    // duplicate stack ownership every time the next output chunk arrived.
    const escape = text.lastIndexOf('\u001b');
    const tail = escape < 0 ? '' : text.slice(escape);
    this.modeCarry = tail.length < 16 && /^\u001b(?:\[(?:\?[\d;]*|[><]\d*)?)?$/u.test(tail) ? tail : '';

  }

  /** Sequences that put a fresh terminal into the app's current input modes. */
  restoreSequence(): string {
    let sequence = '';
    for (const [mode, on] of this.modes) {
      if (mode === 25) { if (!on) sequence += '\u001b[?25l'; } else if (on) sequence += `\u001b[?${mode}h`;
    }
    if (this.keypad) sequence += '\u001b=';
    for (const flags of this.keyboardStacks[this.keyboardScreen]) sequence += `\u001b[>${flags}u`;
    return sequence;
  }

  /** Remove only outstanding child pushes, on the screen that owns each stack.
   * Always finish on alternate, where NMSh draws. Inherited entries are never flattened.
   */
  releaseKeyboardSequence(): string {
    let sequence = '';
    if (this.keyboardStacks.main.length) sequence += `\u001b[?1049l\u001b[<${this.keyboardStacks.main.length}u`;
    sequence += '\u001b[?1049h';
    if (this.keyboardStacks.alternate.length) sequence += `\u001b[<${this.keyboardStacks.alternate.length}u`;
    return sequence;
  }

  /** The program owns the terminal: fullscreen, or an interactive UI. */
  get ownsTerminal(): boolean {
    return this.active || this.interactive;
  }
}
