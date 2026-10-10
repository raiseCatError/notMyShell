import {stripTerminalControls} from '../../util/terminalControls.js';

/**
 * Eligible display text: keeps line breaks, removes terminal instructions and bidi formatting with the
 * shared display scrubber (whole sequences, including unterminated and C1 forms, never their debris).
 * Tabs become spaces so cell widths stay exact.
 */
export function displayText(text: string): string {
  return text.split('\n').map(line => stripTerminalControls(line.replace(/\t/gu, '    '), Number.MAX_SAFE_INTEGER)).join('\n');
}
export interface SemanticObject {id: string; kind: string; text: string; detail?: string; incomplete?: string}
export function projectObject(object: SemanticObject, requested: number): {depth: number; text: string; depths: number[]} {
  const depths = object.detail ? [1, 2, 4, 5] : [1, 2, 5];
  const depth = depths.filter(d => d <= requested).at(-1) ?? depths[0]!;
  const content = displayText(object.detail ?? object.text);
  let text = depth === 1 ? displayText(object.text).split('\n')[0]!.slice(0, 160) : depth === 2 ? content.slice(0, 400) : depth === 4 ? content.slice(0, 2000) : content;
  if (depth !== 5 && text.length < content.length) text += '\n[excerpt · full eligible content at depth 5]';
  if (object.incomplete) text += `\n[Incomplete: ${object.incomplete}]`;
  return {depth, text, depths};
}
