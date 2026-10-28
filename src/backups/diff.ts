import type {FileChange} from '../appearance/hostFiles.js';
/** Exact line diff with a common prefix/suffix; no secret masking or truncated changed lines. */
export function changeDiff(change: FileChange): {lines: string[]; added: number; removed: number; kept: number} {
  const split = (text: string | undefined) => text === undefined || text === '' ? [] : text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const before = split(change.before.content), after = split(change.after);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length-1-end] === after[after.length-1-end]) end++;
  const removed = before.slice(start,before.length-end), added = after.slice(start,after.length-end);
  const display = (line: string) => line.replace(/\r\n$/u, ' ⟨CRLF⟩').replace(/\n$/u,'') + (line.endsWith('\n') ? '' : ' ⟨no final newline⟩');
  return {lines:[`File: ${change.before.path}`, `${change.after === undefined ? 'Remove file' : change.before.content === undefined ? 'Create file' : 'Replace changed lines'} · +${added.length} / -${removed.length}`,
    ...removed.map(line=>`- ${display(line)}`),...added.map(line=>`+ ${display(line)}`),
    `Your own unchanged lines in ${change.before.path} are kept (${start+end}).`],added:added.length,removed:removed.length,kept:start+end};
}
