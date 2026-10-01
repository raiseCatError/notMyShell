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

const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'select', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'time', 'repeat', 'coproc', '!', '{', '}']);
const COMMAND_AFTER = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', 'time', 'coproc', '!', '{']);

/** Keep common expansions together without trying to parse their shell programs. */
function expansionEnd(characters: string[], start: number): number | undefined {
  if (characters[start] === '`') {
    for (let i = start + 1; i < Math.min(characters.length, start + 4096); i++) {
      if (characters[i] === '\\') { i++; continue; }
      if (characters[i] === '`') return i + 1;
    }
    return;
  }
  const open = characters[start + 1];
  if (characters[start] !== '$' || open !== '(' && open !== '{') return;
  const close = open === '(' ? ')' : '}';
  let depth = 1;
  let quote = '';
  for (let i = start + 2; i < Math.min(characters.length, start + 4096); i++) {
    const character = characters[i];
    if (character === '\\' && quote !== "'") { i++; continue; }
    if (quote) { if (character === quote) quote = ''; continue; }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (character === open && ++depth > 16) return;
    if (character === close && --depth === 0) return i + 1;
  }
  return;
}

export class Highlighter {
  tokenize(characters: string[], semanticCache: Map<string, CommandType>): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const len = characters.length;

    let expectCommand = true;
    let redirectTarget = false;
    let condition = false;

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
      const redirect = /^(?:\d+)?(?:<<<|<<-|<<|>>|<>|>&|<&|>\||>|<)(?:[0-9-]+)?/u.exec(characters.slice(i, i + 24).join(''))?.[0];
      if ('|&;<>()'.includes(c) || redirect) {
        const start = i;
        if (redirect) {
          i += redirect.length;
          redirectTarget = !/[0-9-]$/u.test(redirect) || /<<-$/u.test(redirect);
          tokens.push({type: 'Operator', start, end: i, text: redirect});
          continue;
        }
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
        if (['|', '||', '&&', '&', ';', ';;', '(', ')'].includes(text)) {
          expectCommand = true;
          redirectTarget = false;
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
        if (char === '\\' && !inSingle) {
          i = Math.min(len, i + 2);
          continue;
        }
        if ((char === '$' || char === '`') && !inSingle) {
          const end = expansionEnd(characters, i);
          if (end !== undefined) { i = end; isVar = true; continue; }
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

      if (expectCommand && word === '[[') {
        type = 'KnownCommand'; condition = true; expectCommand = false;
      } else if (condition && word === ']]') {
        type = 'KnownCommand'; condition = false; expectCommand = false;
      } else if (redirectTarget) {
        type = hasQuotes ? 'String' : word.includes('/') ? 'Path' : 'Argument';
        redirectTarget = false;
      } else if (expectCommand && RESERVED.has(word)) {
        type = 'KnownCommand';
        expectCommand = COMMAND_AFTER.has(word);
      } else if (expectCommand && ['alias', 'function'].includes(semanticCache.get(word) ?? '')) {
        type = semanticCache.get(word) === 'alias' ? 'Alias' : 'Function';
        expectCommand = false;
      } else if (expectCommand && /^[a-zA-Z_][a-zA-Z0-9_]*=/.test(word)) {
        type = 'Argument';
      } else if (hasQuotes && (word.startsWith("'") || word.startsWith('"'))) {
        type = 'String';
        expectCommand = false;
      } else if (word.startsWith('$') || isVar) {
        type = 'Variable';
        expectCommand = false;
      } else if (word.startsWith('-')) {
        type = 'Flag';
      } else if (word.includes('/') || word.startsWith('.') || word.startsWith('~') || !hasQuotes && /(?<!\\)[*?\[]/u.test(word)) {
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
