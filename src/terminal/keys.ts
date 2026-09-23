export type Key =
  | {kind: 'text'; value: string}
  | {kind: 'deleteWord' | 'deleteLineBefore' | 'deleteLineAfter' | 'wordLeft' | 'wordRight' | 'selectWordLeft' | 'selectWordRight'} 
  | {kind: 'left' | 'right' | 'up' | 'down' | 'lineHome' | 'lineEnd' | 'backspace' | 'delete' | 'enter' | 'newline' | 'complete' | 'escape' | 'selectAll'}
  | {kind: 'selectLeft' | 'selectRight' | 'selectUp' | 'selectDown' | 'selectLineHome' | 'selectLineEnd'}
  | {kind: 'bufferHome' | 'bufferEnd' | 'selectBufferHome' | 'selectBufferEnd'}
  | {kind: 'historySearch'} | {kind: 'pageUp' | 'pageDown' | 'latest' | 'interrupt' | 'eof' | 'wheelUp' | 'wheelDown' | 'mouseMove' | 'mouseClick' | 'focusPrevious' | 'focusNext'} & {x?: number; y?: number};


const SEQUENCES: Array<[string, Key['kind']]> = [
  ['\u001B[Z', 'focusPrevious'],
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
  ['\u001B[119;5u', 'deleteWord'], // Kitty Ctrl+W
  ['\u001B[117;5u', 'deleteLineBefore'], // Kitty Ctrl+U
  ['\u001B[107;5u', 'deleteLineAfter'], // Kitty Ctrl+K
  ['\u001B[99;5u', 'interrupt'], // Kitty Ctrl+C
  ['\u001B[100;5u', 'eof'], // Kitty Ctrl+D
];

export function decodeKeys(input: string): Key[] {
  const keys: Key[] = [];
  let index = 0;
  while (index < input.length) {
    if (input.startsWith('\u001B[200~', index)) {
      const contentStart = index + 6;
      const contentEnd = input.indexOf('\u001B[201~', contentStart);
      const end = contentEnd === -1 ? input.length : contentEnd;
      keys.push({kind: 'text', value: input.slice(contentStart, end).replace(/\r\n?/gu, '\n')});
      index = contentEnd === -1 ? input.length : contentEnd + 6;
      continue;
    }
    const sgrMatch = /^\u001B\[<(\d+);(\d+);(\d+)([mM])/.exec(input.slice(index));
    if (sgrMatch) {
      const button = Number(sgrMatch[1]);
      const x = Number(sgrMatch[2]);
      const y = Number(sgrMatch[3]);
      const isPress = sgrMatch[4] === 'M';
      if (button === 64) keys.push({kind: 'wheelUp'});
      else if (button === 65) keys.push({kind: 'wheelDown'});
      else if (button === 0 && isPress) keys.push({kind: 'mouseClick', x, y});
      else if (button === 35 || button === 32) keys.push({kind: 'mouseMove', x, y});
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
    else if (value === '\u0007') keys.push({kind: 'latest'} as Key);
    else if (value === '\t') keys.push({kind: 'complete'} as Key);
    else if (value === '\u0017') keys.push({kind: 'deleteWord'} as Key); // Ctrl+W
    else if (value === '\u0015') keys.push({kind: 'deleteLineBefore'} as Key); // Ctrl+U
    else if (value === '\u000B') keys.push({kind: 'deleteLineAfter'} as Key); // Ctrl+K
    else if (value === '\u0001') keys.push({kind: 'lineHome'} as Key); // Ctrl+A
    else if (value === '\u0005') keys.push({kind: 'lineEnd'} as Key); // Ctrl+E
    else if (value === '\u001B') keys.push({kind: 'escape'} as Key);
    else if (value === '\u0012') keys.push({kind: 'historySearch'} as Key);
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
        keys.push({kind: 'text', value: pasted.replace(/\r\n?/gu, '\n')});
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
