import stringWidth from 'string-width';

const ANSI_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

export function displayWidth(value: string): number {
  return stringWidth(stripAnsi(value));
}

export function truncateText(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (stringWidth(value) <= maxWidth) return value;
  if (maxWidth === 1) return '…';

  let result = '';
  for (const character of value) {
    if (stringWidth(result + character) > maxWidth - 1) break;
    result += character;
  }
  return `${result}…`;
}

export function truncateAnsi(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (displayWidth(value) <= maxWidth) return value;
  const targetWidth = Math.max(0, maxWidth - 1);
  let output = '';
  let width = 0;
  let index = 0;
  while (index < value.length) {
    if (value[index] === '\u001B') {
      const match = /^\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/u.exec(value.slice(index));
      if (match) {
        output += match[0];
        index += match[0].length;
        continue;
      }
    }
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    const characterWidth = stringWidth(character);
    if (width + characterWidth > targetWidth) break;
    output += character;
    width += characterWidth;
    index += character.length;
  }
  return `${output}…\u001B[0m`;
}

export function repeatToWidth(character: string, width: number): string {
  return width > 0 ? character.repeat(width) : '';
}

/**
 * Styles each case-insensitive occurrence of `query` in plain `text` with
 * `mark`, restoring `base` afterwards. The text itself is never altered, so
 * the result strips back to the original string.
 */
export function highlightMatches(text: string, query: string, base: string, mark: string): string {
  const needle = query.trim().toLowerCase();
  const haystack = text.toLowerCase();
  if (!needle || haystack.length !== text.length) return `${base}${text}`;
  let output = base;
  let index = 0;
  for (let found = haystack.indexOf(needle); found !== -1; found = haystack.indexOf(needle, index)) {
    output += `${text.slice(index, found)}\u001B[0m${mark}${text.slice(found, found + needle.length)}\u001B[0m${base}`;
    index = found + needle.length;
  }
  return output + text.slice(index);
}
