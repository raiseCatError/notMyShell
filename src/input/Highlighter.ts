import {CommandType} from '../shell/SemanticService.js';

export type TokenType =
  | 'Command' | 'KnownCommand' | 'Builtin' | 'Alias' | 'Function' | 'UnknownCommand'
  | 'Argument' | 'String' | 'Variable' | 'Operator' | 'Path' | 'Flag' | 'Comment' | 'Normal';

export interface Token {
  type: TokenType;
  start: number; // string index
  end: number;   // string index (exclusive)
  text: string;
}

export class Highlighter {
  tokenize(characters: string[], semanticCache: Map<string, CommandType>): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const len = characters.length;

    let expectCommand = true;

    while (i < len) {
      const c = characters[i];

      // Whitespace
      if (/\s/.test(c)) {
        const start = i;
        while (i < len && /\s/.test(characters[i])) {
          if (characters[i] === '\n') expectCommand = true;
          i++;
        }
        tokens.push({ type: 'Normal', start, end: i, text: characters.slice(start, i).join('') });
        continue;
      }

      // Comment
      if (c === '#' && (i === 0 || /\s/.test(characters[i - 1]))) {
        const start = i;
        while (i < len && characters[i] !== '\n') i++;
        tokens.push({ type: 'Comment', start, end: i, text: characters.slice(start, i).join('') });
        continue;
      }

      // Operators
      if ('|&;<>()'.includes(c) || (c === '2' && i + 1 < len && characters[i+1] === '>')) {
        const start = i;
        let op = characters.slice(i, i + 4).join('');
        if (op.startsWith('2>&1')) i += 4;
        else {
          op = characters.slice(i, i + 3).join('');
          if (op.startsWith('2>>')) i += 3;
          else {
            op = characters.slice(i, i + 2).join('');
            if (['||', '&&', ';;', '<<', '>>', '<&', '>&', '2>'].includes(op)) i += 2;
            else i += 1;
          }
        }
        
        const text = characters.slice(start, i).join('');
        tokens.push({ type: 'Operator', start, end: i, text });
        
        // Only | && || ; ;; ( ) reset expectCommand. Redirects take an argument.
        if (['|', '||', '&&', ';', ';;', '(', ')'].includes(text)) {
          expectCommand = true;
        }
        continue;
      }

      // Word (including quotes)
      const start = i;
      let inSingle = false;
      let inDouble = false;
      let isVar = false;
      let hasQuotes = false;

      while (i < len) {
        const char = characters[i];
        if (char === '\\') {
          i += 2;
          continue;
        }
        if (char === "'" && !inDouble) {
          inSingle = !inSingle;
          hasQuotes = true;
        } else if (char === '"' && !inSingle) {
          inDouble = !inDouble;
          hasQuotes = true;
        } else if (!inSingle && !inDouble) {
          if (/\s/.test(char) || '|&;<>()'.includes(char)) {
            break; // End of word
          }
        }
        i++;
      }

      if (i === start) {
        // Prevent infinite loop if we encounter an unhandled special character
        i++;
      }

      const word = characters.slice(start, i).join('');
      let type: TokenType = 'Argument';

      if (hasQuotes && (word.startsWith("'") || word.startsWith('"'))) {
        type = 'String';
      } else if (word.startsWith('$')) {
        type = 'Variable';
      } else if (word.startsWith('-')) {
        type = 'Flag';
      } else if (word.includes('/') || word.startsWith('.') || word.startsWith('~')) {
        type = 'Path';
        if (expectCommand) expectCommand = false;
      } else if (expectCommand) {
        // Assignment?
        if (/^[a-zA-Z_][a-zA-Z0-9_]*=/.test(word)) {
          type = 'Argument'; // Assignments don't trigger command reset
        } else {
          // Command position
          type = 'Command';
          
          if (semanticCache) {
             const sem = semanticCache.get(word);
             if (sem) {
               if (sem === 'unknown') type = 'UnknownCommand';
               else if (sem === 'executable') type = 'KnownCommand';
               else if (sem === 'builtin') type = 'Builtin';
               else if (sem === 'alias') type = 'Alias';
               else if (sem === 'function') type = 'Function';
               else if (sem === 'reserved') type = 'KnownCommand';
             }
          }

          if (word !== 'sudo' && word !== 'env') {
            expectCommand = false;
          }
        }
      }

      tokens.push({ type, start, end: i, text: word });
    }

    return tokens;
  }
}
