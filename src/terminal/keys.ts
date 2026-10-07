export type Key =
  | {kind: 'focusIn' | 'focusOut'}
  | {kind: 'text'; value: string}
  | {kind: 'paste'; value: string}
  | {kind: 'deleteWord' | 'deleteLineBefore' | 'deleteLineAfter' | 'wordLeft' | 'wordRight' | 'selectWordLeft' | 'selectWordRight'} 
  | {kind: 'left' | 'right' | 'up' | 'down' | 'lineHome' | 'lineEnd' | 'backspace' | 'delete' | 'enter' | 'newline' | 'complete' | 'escape' | 'selectAll'}
  | {kind: 'selectLeft' | 'selectRight' | 'selectUp' | 'selectDown' | 'selectLineHome' | 'selectLineEnd'}
  | {kind: 'bufferHome' | 'bufferEnd' | 'selectBufferHome' | 'selectBufferEnd'}
  | {kind: 'historySearch' | 'historyDelete' | 'find'} | {kind: 'suggestNext' | 'suggestPrevious' | 'palette'} | {kind: 'pageUp' | 'pageDown' | 'latest' | 'interrupt' | 'suspend' | 'eof' | 'wheelUp' | 'wheelDown' | 'mouseMove' | 'mouseClick' | 'mouseDrag' | 'mouseRelease' | 'focusPrevious' | 'focusNext' | 'toggleDetails'} & {x?: number; y?: number};


const SEQUENCES: Array<[string, Key['kind']]> = [
  ['\u001B[I', 'focusIn'],
  ['\u001B[O', 'focusOut'],
  // Kitty keyboard protocol (CSI > 1 u, enabled by TerminalRenderer on entry;
  // Ghostty honors it) encodes Escape as its functional key code (27) rather
  // than a lone raw ESC byte. Without these, Escape falls through to the
  // generic "unknown CSI sequence" branch below and is silently swallowed.
  ['\u001B[27u', 'escape'],
  ['\u001B[27;1u', 'escape'], // explicit default-modifier form
  ['\u001B[Z', 'focusPrevious'],
  ['\u001B[9;2u', 'focusPrevious'], // Kitty Shift+Tab
  ['\u001B[9u', 'complete'], // Kitty Tab
  ['\u001B[27;2;13~', 'newline'],
  ['\u001B[13;2u', 'newline'],
  ['\u001B\r', 'newline'], // macOS Terminal Shift+Enter
  ['\u001B[97;9u', 'selectAll'],
  ['\u001Ba', 'selectAll'], // Portable Alt+A
  // Cmd+Arrow (Kitty modifier 9 = Super/Cmd bit 8 + 1)
  ['\u001B[1;9D', 'lineHome'],              // Cmd+Left  → line beginning
  ['\u001B[1;9C', 'lineEnd'],               // Cmd+Right → line end
  ['\u001B[1;10D', 'selectLineHome'],       // Cmd+Shift+Left  → select to line beginning
  ['\u001B[1;10C', 'selectLineEnd'],        // Cmd+Shift+Right → select to line end
  ['\u001B[1;9A', 'bufferHome'],        // Cmd+Up   → buffer beginning
  ['\u001B[1;9B', 'bufferEnd'],         // Cmd+Down → buffer end
  ['\u001B[1;10A', 'selectBufferHome'], // Cmd+Shift+Up   → select to buffer start
  ['\u001B[1;10B', 'selectBufferEnd'],  // Cmd+Shift+Down → select to buffer end
  ['\u001B[1;2A', 'selectUp'],    // Shift+Up
  ['\u001B[1;2B', 'selectDown'],  // Shift+Down
  ['\u001B[1;2C', 'selectRight'], // Shift+Right
  ['\u001B[1;2D', 'selectLeft'],  // Shift+Left
  ['\u001B[1;3A', 'up'],    // Alt+Up
  ['\u001B[1;3B', 'down'],  // Alt+Down
  ['\u001B[1;3C', 'wordRight'], // Alt+Right
  ['\u001B[1;3D', 'wordLeft'],  // Alt+Left
  ['\u001B[1;4A', 'selectUp'],    // Alt+Shift+Up
  ['\u001B[1;4B', 'selectDown'],  // Alt+Shift+Down
  ['\u001B[1;4C', 'selectWordRight'], // Alt+Shift+Right
  ['\u001B[1;4D', 'selectWordLeft'],  // Alt+Shift+Left
  ['\u001B[1;5A', 'up'],    // Ctrl+Up
  ['\u001B[1;5B', 'down'],  // Ctrl+Down
  ['\u001B[1;5C', 'wordRight'], // Ctrl+Right
  ['\u001B[1;5D', 'wordLeft'],  // Ctrl+Left
  ['\u001B[127;1u', 'backspace'], // Kitty mode 1 Backspace
  ['\u001B[127u', 'backspace'],   // Kitty mode 1 Backspace (no mod)
  ['\u001B[127;3u', 'deleteWord'], // Kitty Alt+Backspace (Ghostty Option+Backspace)
  ['\u001B[127;4u', 'deleteWord'], // Kitty Alt+Shift+Backspace → also delete-word
  ['\u001B[3;1~', 'delete'],      // Kitty mode 1 Delete
  ['\u001B[3;2~', 'delete'],      // Shift+Delete
  ['\u001B[1;5F', 'latest'],
  ['\u001B[5;5~', 'latest'],
  ['\u001B[1;5~', 'latest'],
  ['\u001B[5~', 'pageUp'],
  ['\u001B[6~', 'pageDown'],
  ['\u001B[3~', 'delete'],
  ['\u001B[H', 'lineHome'],
  ['\u001B[1~', 'lineHome'],
  ['\u001BOH', 'lineHome'],
  ['\u001B[F', 'lineEnd'],
  ['\u001B[4~', 'lineEnd'],
  ['\u001BOF', 'lineEnd'],
  ['\u001B[D', 'left'],
  ['\u001BOD', 'left'],
  ['\u001B[C', 'right'],
  ['\u001BOC', 'right'],
  ['\u001B[A', 'up'],
  ['\u001BOA', 'up'],
  ['\u001B[B', 'down'],
  ['\u001B\u007F', 'deleteWord'],
  ['\u001B\b', 'deleteWord'],
  ['\u001Bb', 'wordLeft'],
  ['\u001Bf', 'wordRight'],
  ['\u001BOB', 'down'],
  ['\u001B[97;5u', 'lineHome'], // Kitty Ctrl+A
  ['\u001B[101;5u', 'lineEnd'], // Kitty Ctrl+E
  ['\u001B[120;5u', 'historyDelete'], // Ctrl+X: only active in command history
  ['\u001B[119;5u', 'deleteWord'], // Kitty Ctrl+W
  ['\u001B[117;5u', 'deleteLineBefore'], // Kitty Ctrl+U
  ['\u001B[107;5u', 'deleteLineAfter'], // Kitty Ctrl+K
  ['\u001B[99;5u', 'interrupt'], // Kitty Ctrl+C
  ['\u001B[102;5u', 'find'], // Kitty Ctrl+F
  ['\u001B[100;5u', 'eof'], // Kitty Ctrl+D
  ['\u001B[122;5u', 'suspend'], // Kitty Ctrl+Z
  ['\u001B[90;5u', 'suspend'], // Kitty Ctrl+Z (uppercase Z)
  // Command palette: Ctrl+Shift+P and Cmd+Shift+P need CSI-u reporting (plain Ctrl+Shift+P is Ctrl+P); F1 is the legacy fallback.
  ['\u001B[112;6u', 'palette'], ['\u001B[80;6u', 'palette'], ['\u001B[112;10u', 'palette'], ['\u001B[80;10u', 'palette'],
  ['\u001BOP', 'palette'], ['\u001B[11~', 'palette'],
  // Kitty keyboard protocol functional-key form (`CSI 1 P`, the 1 omitted when unmodified); NMSh enables that protocol where supported.
  ['\u001B[P', 'palette'],
  ['\u001B[110;5u', 'suggestNext'], // Kitty Ctrl+N
  ['\u001B[112;5u', 'suggestPrevious'], // Kitty Ctrl+P
  ['\u001B[111;5u', 'toggleDetails'], // Kitty Ctrl+O (lowercase o)
  ['\u001B[79;5u', 'toggleDetails'], // Kitty Ctrl+O (uppercase O)
];

export function decodeKeys(input: string): Key[] {
  const keys: Key[] = [];
  let index = 0;
  while (index < input.length) {
    if (input.startsWith('\u001B[200~', index)) {
      const contentStart = index + 6;
      const contentEnd = input.indexOf('\u001B[201~', contentStart);
      const end = contentEnd === -1 ? input.length : contentEnd;
      keys.push({kind: 'paste', value: input.slice(contentStart, end)});
      index = contentEnd === -1 ? input.length : contentEnd + 6;
      continue;
    }
    const sgrMatch = /^\u001B\[<(\d+);(\d+);(\d+)([mM])/.exec(input.slice(index));
    if (sgrMatch) {
      const button = Number(sgrMatch[1]);
      const x = Number(sgrMatch[2]);
      const y = Number(sgrMatch[3]);
      const isPress = sgrMatch[4] === 'M';
      // SGR button bits: 4 Shift, 8 Alt, 16 Ctrl, 32 motion, 64 wheel.
      const shift = (button & 4) !== 0;
      const motion = (button & 32) !== 0;
      const base = button & ~(4 | 8 | 16 | 32);
      if (base === 64) keys.push({kind: 'wheelUp'});
      else if (base === 65) keys.push({kind: 'wheelDown'});
      // Shift+mouse is native text selection: never click, toggle, or hover.
      else if (shift) { /* ignored */ }
      // Motion with the primary button held is a drag (NMSh transcript selection); without a button it is hover.
      else if (motion && base === 0) keys.push({kind: 'mouseDrag', x, y});
      else if (motion && base === 3) keys.push({kind: 'mouseMove', x, y});
      else if (!motion && base === 0 && isPress) keys.push({kind: 'mouseClick', x, y});
      else if (!motion && base === 0 && !isPress) keys.push({kind: 'mouseRelease', x, y});
      index += sgrMatch[0].length;
      continue;
    }
    const sequence = SEQUENCES.find(([value]) => input.startsWith(value, index));
    if (sequence) {
      keys.push({kind: sequence[1]} as Key);
      index += sequence[0].length;
      continue;
    }
    const csiMatch = /^\u001B\[[0-?]*[ -/]*[@-~]/.exec(input.slice(index));
    if (csiMatch) {
      // Unknown CSI sequence, consume and ignore
      index += csiMatch[0].length;
      continue;
    }
    const codePoint = input.codePointAt(index);
    if (codePoint === undefined) break;
    const value = String.fromCodePoint(codePoint);
    index += value.length;
    if (value === '\r') keys.push({kind: 'enter'} as Key);
    else if (value === '\n') keys.push({kind: 'newline'} as Key);
    else if (value === '\u007F' || value === '\b') keys.push({kind: 'backspace'} as Key);
    else if (value === '\u0003') keys.push({kind: 'interrupt'} as Key);
    else if (value === '\u0004') keys.push({kind: 'eof'} as Key);
    else if (value === '\u001A') keys.push({kind: 'suspend'} as Key); // Ctrl+Z
    else if (value === '\u0007') keys.push({kind: 'latest'} as Key);
    else if (value === '\t') keys.push({kind: 'complete'} as Key);
    else if (value === '\u0017') keys.push({kind: 'deleteWord'} as Key); // Ctrl+W
    else if (value === '\u0015') keys.push({kind: 'deleteLineBefore'} as Key); // Ctrl+U
    else if (value === '\u000B') keys.push({kind: 'deleteLineAfter'} as Key); // Ctrl+K
    else if (value === '\u0001') keys.push({kind: 'lineHome'} as Key); // Ctrl+A
    else if (value === '\u0005') keys.push({kind: 'lineEnd'} as Key); // Ctrl+E
    else if (value === '\u001B') keys.push({kind: 'escape'} as Key);
    else if (value === '\u0018') keys.push({kind: 'historyDelete'} as Key);
    else if (value === '\u0012') keys.push({kind: 'historySearch'} as Key);
    else if (value === '\u0006') keys.push({kind: 'find'} as Key); // Ctrl+F: NMSh transcript find
    else if (value === '\u000F') keys.push({kind: 'toggleDetails'} as Key); // Ctrl+O
    else if (value === '\u000E') keys.push({kind: 'suggestNext'} as Key); // Ctrl+N
    else if (value === '\u0010') keys.push({kind: 'suggestPrevious'} as Key); // Ctrl+P
    else if (codePoint >= 0x20 && codePoint !== 0x7f) keys.push({kind: 'text', value} as Key);
  }
  return keys;
}

export class KeyDecoder {
  private pasteBuffer: string | undefined;
  private keyBuffer = '';

  reset(): void {
    this.pasteBuffer = undefined;
    this.keyBuffer = '';
  }

  /**
   * A lone ESC is held in case an escape sequence follows. Terminals send a
   * whole sequence in one write, so a lone ESC still held after a short pause
   * is the Escape key; the owner flushes it then. Otherwise it would be
   * delivered only with the next keystroke (ESC then → became Escape + Right).
   */
  get pendingEscape(): boolean {
    return this.pasteBuffer === undefined && this.keyBuffer === '\u001B';
  }

  /** Decodes whatever is held as complete keys (a held lone ESC becomes Escape). */
  flush(): Key[] {
    if (this.pasteBuffer !== undefined || !this.keyBuffer) return [];
    const held = this.keyBuffer;
    this.keyBuffer = '';
    return decodeKeys(held);
  }

  push(input: string): Key[] {
    const keys: Key[] = [];
    let remaining = this.keyBuffer + input;
    this.keyBuffer = '';
    while (remaining.length > 0) {
      if (this.pasteBuffer !== undefined) {
        const end = remaining.indexOf('\u001B[201~');
        if (end === -1) {
          this.pasteBuffer += remaining;
          break;
        }
        const pasted = this.pasteBuffer + remaining.slice(0, end);
        keys.push({kind: 'paste', value: pasted});
        this.pasteBuffer = undefined;
        remaining = remaining.slice(end + 6);
        continue;
      }
      const start = remaining.indexOf('\u001B[200~');
      if (start === -1) {
        const escape = remaining.lastIndexOf('\u001B');
        if (escape !== -1) {
          const suffix = remaining.slice(escape);
          const known = [...SEQUENCES.map(([sequence]) => sequence), '\u001B[200~'];
          if ((known.some(sequence => sequence.startsWith(suffix)) && !known.includes(suffix)) || /^\u001B\[[0-?]*[ -/]*$/.test(suffix) || /^\u001BO$/.test(suffix)) {
            this.keyBuffer = suffix;
            remaining = remaining.slice(0, escape);
          }
        }
        keys.push(...decodeKeys(remaining));
        break;
      }
      keys.push(...decodeKeys(remaining.slice(0, start)));
      this.pasteBuffer = '';
      remaining = remaining.slice(start + 6);
    }
    return keys;
  }
}
