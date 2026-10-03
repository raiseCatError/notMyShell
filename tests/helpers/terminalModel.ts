/**
 * A tiny model of the physical terminal's mode state, fed the exact byte stream the terminal receives.
 * It follows xterm/Ghostty/tmux semantics where they matter here: DECSET alternate screen is not a
 * stack (entering twice is a no-op, one leave returns to the main screen), and the kitty keyboard
 * stack is kept per screen and bounded. It never sees the foreground program's intent, only bytes.
 */
export interface TerminalModeState {
  screen: 'main' | 'alternate';
  modes: Record<number, boolean>;
  keypadApplication: boolean;
  cursorVisible: boolean;
  kittyStack: {main: string[]; alternate: string[]};
}

const MODES = [1, 25, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 2004];
const KITTY_STACK_LIMIT = 8;

export class TerminalModeModel {
  private screen: 'main' | 'alternate' = 'main';
  private readonly modes = new Map<number, boolean>();
  private keypad = false;
  private readonly stacks = {main: [] as string[], alternate: [] as string[]};

  feed(bytes: string): this {
    for (const match of bytes.matchAll(/\u001b\[\?([\d;]+)([hl])|\u001b([=>])|\u001b\[([><])(\d*)u/gu)) {
      if (match[1] !== undefined) {
        const on = match[2] === 'h';
        for (const param of match[1].split(';')) {
          const mode = Number(param);
          if (mode === 1049 || mode === 1047 || mode === 47) this.screen = on ? 'alternate' : 'main';
          else if (MODES.includes(mode)) this.modes.set(mode, on);
        }
      } else if (match[3] !== undefined) this.keypad = match[3] === '=';
      else {
        const stack = this.stacks[this.screen];
        if (match[4] === '>') {
          if (stack.length >= KITTY_STACK_LIMIT) stack.shift();
          stack.push(match[5] || '0');
        } else stack.splice(Math.max(0, stack.length - (match[5] === '' ? 1 : Number(match[5]))));
      }
    }
    return this;
  }

  snapshot(): TerminalModeState {
    const modes: Record<number, boolean> = {};
    for (const mode of MODES) modes[mode] = this.modes.get(mode) ?? (mode === 25);
    return {screen: this.screen, modes, keypadApplication: this.keypad, cursorVisible: modes[25]!,
      kittyStack: {main: [...this.stacks.main], alternate: [...this.stacks.alternate]}};
  }
}
