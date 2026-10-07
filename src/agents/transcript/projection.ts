/** Eligible display text; preserve text/newlines, remove terminal instructions and bidi. */
export function displayText(text: string): string {
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '');
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
