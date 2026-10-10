import type {CompletedCommand} from './OutputBuffer.js';

/**
 * Compare output: two executions' stored output, line by line, computed only when asked. Faithful by default (every
 * byte of every line counts); ignoring whitespace is an explicit, labelled choice. Sides are always ordered oldest
 * first (A ran before B), whatever was picked first.
 */
export interface CompareOptions {
  /** Lines that differ only in spacing count as the same (labelled wherever the result is shown or copied). */
  ignoreWhitespace: boolean;
  /** Unchanged lines kept around each change. */
  context: number;
}

export const DEFAULT_COMPARE_OPTIONS: CompareOptions = {ignoreWhitespace: false, context: 3};

export type DiffLine =
  | {kind: 'same'; a: number; b: number; text: string}
  | {kind: 'remove'; a: number; text: string}
  | {kind: 'add'; b: number; text: string};

export interface Hunk {
  /** 0-based first line on each side, and line counts, as in a unified diff header. */
  aStart: number; aCount: number; bStart: number; bCount: number;
  lines: DiffLine[];
}

export interface Comparison {
  a: CompletedCommand;
  b: CompletedCommand;
  options: CompareOptions;
  identical: boolean;
  /** Too different to align line by line within the bound: everything is shown as removed then added. */
  unaligned: boolean;
  hunks: Hunk[];
  stats: {added: number; removed: number; changed: number; unchanged: number};
}

/** The edit-distance bound for the line diff: beyond it the outputs are reported as not alignable. */
export const MAX_EDIT_DISTANCE = 4000;

const outputLines = (output: string) => output === '' ? [] : output.replace(/\r\n?/gu, '\n').replace(/\n$/u, '').split('\n');
const key = (line: string, options: CompareOptions) => options.ignoreWhitespace ? line.trim().replace(/\s+/gu, ' ') : line;

/**
 * Myers' O((N+M)·D) shortest edit script over line keys. Returns undefined when the distance exceeds `bound`.
 * Common prefix and suffix are matched first (the usual case for re-runs of one command).
 */
export function diffLines(a: readonly string[], b: readonly string[], bound = MAX_EDIT_DISTANCE): DiffLine[] | undefined {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const n = midA.length;
  const m = midB.length;
  const middle: DiffLine[] = [];
  if (n === 0 || m === 0) {
    for (let index = 0; index < n; index += 1) middle.push({kind: 'remove', a: head + index, text: midA[index]!});
    for (let index = 0; index < m; index += 1) middle.push({kind: 'add', b: head + index, text: midB[index]!});
  } else {
    const max = Math.min(n + m, bound);
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace: Int32Array[] = [];
    let found = false;
    for (let d = 0; d <= max && !found; d += 1) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
        let y = x - k;
        while (x < n && y < m && midA[x] === midB[y]) { x += 1; y += 1; }
        v[offset + k] = x;
        if (x >= n && y >= m) { found = true; break; }
      }
    }
    if (!found) return undefined;
    // Walk the trace back from the end to recover the script.
    let x = n;
    let y = m;
    const reversed: DiffLine[] = [];
    for (let d = trace.length - 1; d >= 0; d -= 1) {
      const vd = trace[d]!;
      const k = x - y;
      const previousK = k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1;
      const previousX = d === 0 ? 0 : vd[offset + previousK]!;
      const previousY = previousX - previousK;
      while (x > previousX && y > previousY) { x -= 1; y -= 1; reversed.push({kind: 'same', a: head + x, b: head + y, text: midB[y]!}); }
      if (d > 0) {
        if (x === previousX) { y -= 1; reversed.push({kind: 'add', b: head + y, text: midB[y]!}); }
        else { x -= 1; reversed.push({kind: 'remove', a: head + x, text: midA[x]!}); }
      }
    }
    middle.push(...reversed.reverse());
  }
  const result: DiffLine[] = [];
  for (let index = 0; index < head; index += 1) result.push({kind: 'same', a: index, b: index, text: b[index]!});
  result.push(...middle);
  for (let index = tail; index > 0; index -= 1) result.push({kind: 'same', a: a.length - index, b: b.length - index, text: b[b.length - index]!});
  return result;
}

/** Compare two records' stored output. `first` and `second` may come in either order; A is always the older run. */
export function compareRecords(first: CompletedCommand, second: CompletedCommand, options: CompareOptions = DEFAULT_COMPARE_OPTIONS): Comparison {
  const [a, b] = (first.startedAt ?? first.startId) <= (second.startedAt ?? second.startId) ? [first, second] : [second, first];
  const aLines = outputLines(a.output);
  const bLines = outputLines(b.output);
  const aKeys = aLines.map(line => key(line, options));
  const bKeys = bLines.map(line => key(line, options));
  const keyed = diffLines(aKeys, bKeys);
  // Show the original text (B's for unchanged lines), whatever the keys were.
  const script: DiffLine[] = keyed
    ? keyed.map(line => line.kind === 'same' ? {...line, text: bLines[line.b]!} : line.kind === 'remove' ? {...line, text: aLines[line.a]!} : {...line, text: bLines[line.b]!})
    : [...aLines.map((text, index): DiffLine => ({kind: 'remove', a: index, text})), ...bLines.map((text, index): DiffLine => ({kind: 'add', b: index, text}))];
  const stats = {added: 0, removed: 0, changed: 0, unchanged: 0};
  for (let index = 0; index < script.length;) {
    const line = script[index]!;
    if (line.kind === 'same') { stats.unchanged += 1; index += 1; continue; }
    // A run of removals followed by additions: paired lines are changes, the rest pure removals or additions.
    let removes = 0;
    let adds = 0;
    while (script[index]?.kind === 'remove') { removes += 1; index += 1; }
    while (script[index]?.kind === 'add') { adds += 1; index += 1; }
    const pairs = Math.min(removes, adds);
    stats.changed += pairs;
    stats.removed += removes - pairs;
    stats.added += adds - pairs;
  }
  return {a, b, options, identical: stats.added + stats.removed + stats.changed === 0, unaligned: !keyed, hunks: hunks(script, options.context), stats};
}

/** Group the script into hunks with `context` unchanged lines around each change; longer unchanged runs split hunks. */
export function hunks(script: readonly DiffLine[], context: number): Hunk[] {
  const changes = script.map((line, index) => line.kind === 'same' ? -1 : index).filter(index => index >= 0);
  if (!changes.length) return [];
  const ranges: Array<[number, number]> = [];
  for (const index of changes) {
    const from = Math.max(0, index - context);
    const to = Math.min(script.length - 1, index + context);
    const last = ranges.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  return ranges.map(([from, to]) => {
    const lines = script.slice(from, to + 1);
    const aLines = lines.filter(line => line.kind !== 'add') as Array<Extract<DiffLine, {a: number}>>;
    const bLines = lines.filter(line => line.kind !== 'remove') as Array<Extract<DiffLine, {b: number}>>;
    // An empty side starts where the other side's position implies (as unified diff does).
    const aStart = aLines[0]?.a ?? positionBefore(script, from, 'a');
    const bStart = bLines[0]?.b ?? positionBefore(script, from, 'b');
    return {aStart, aCount: aLines.length, bStart, bCount: bLines.length, lines};
  });
}

function positionBefore(script: readonly DiffLine[], index: number, side: 'a' | 'b'): number {
  for (let at = index - 1; at >= 0; at -= 1) {
    const line = script[at]!;
    if (side === 'a' && line.kind !== 'add') return line.a + 1;
    if (side === 'b' && line.kind !== 'remove') return line.b + 1;
  }
  return 0;
}

const clock = (at: number | undefined) => {
  if (at === undefined) return 'time unknown';
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
};

/** One side's identity in words: what ran, when, and how it ended. */
export function sideLabel(record: CompletedCommand): string {
  const command = record.command.split('\n')[0]!.slice(0, 120);
  return `${command} · ${clock(record.startedAt)} · exit ${record.exitCode}${record.outputIncomplete ? ' · output incomplete' : ''}`;
}

/** Facts a reader needs before trusting the result (missing or incomplete output, normalization). */
export function comparisonNotes(comparison: Comparison): string[] {
  const notes: string[] = [];
  for (const [name, record] of [['A', comparison.a], ['B', comparison.b]] as const) {
    if (record.outputIncomplete) notes.push(`${name}'s output is incomplete: part of it was not kept while no window was attached.`);
    if (!record.output) notes.push(`${name} printed no output.`);
  }
  if (comparison.options.ignoreWhitespace) notes.push('Whitespace ignored: lines differing only in spacing count as the same.');
  if (comparison.unaligned) notes.push(`Too different to align line by line (more than ${MAX_EDIT_DISTANCE} edits): shown as all removed, then all added.`);
  return notes;
}

export function summary(comparison: Comparison): string {
  if (comparison.identical) return comparison.options.ignoreWhitespace ? 'Same output (whitespace ignored)' : 'Identical output';
  const {added, removed, changed, unchanged} = comparison.stats;
  return [changed && `${changed} changed`, added && `${added} added`, removed && `${removed} removed`, `${unchanged} unchanged`].filter(Boolean).join(' · ');
}

/** A unified diff of the comparison (the format git and patch read), with each side's identity in its header. */
export function unifiedDiff(comparison: Comparison): string {
  const header = [`--- A: ${sideLabel(comparison.a)}`, `+++ B: ${sideLabel(comparison.b)}`];
  const body = comparison.hunks.flatMap(hunk => [
    `@@ -${hunk.aCount ? hunk.aStart + 1 : hunk.aStart},${hunk.aCount} +${hunk.bCount ? hunk.bStart + 1 : hunk.bStart},${hunk.bCount} @@`,
    ...hunk.lines.map(line => `${line.kind === 'same' ? ' ' : line.kind === 'add' ? '+' : '-'}${line.text}`),
  ]);
  return `${[...header, ...body].join('\n')}\n`;
}

/** The comparison as a Markdown report: both sides, the summary, notes, and the diff. */
export function comparisonReport(comparison: Comparison): string {
  const diff = unifiedDiff(comparison);
  const longest = Math.max(0, ...[...diff.matchAll(/`+/gu)].map(match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const lines = ['# Output comparison', '', `- **A (older):** \`${sideLabel(comparison.a)}\``, `- **B (newer):** \`${sideLabel(comparison.b)}\``,
    `- **Result:** ${summary(comparison)}`, ...comparisonNotes(comparison).map(note => `- **Note:** ${note}`), ''];
  lines.push(comparison.identical ? '_No differences._' : `${fence}diff\n${diff.replace(/\n$/u, '')}\n${fence}`);
  return `${lines.join('\n')}\n`;
}

/**
 * The run to compare with by default: the most recent earlier execution of exactly the same command (newest-first
 * `recent`, as /copy numbers them). Undefined when there is none.
 */
export function previousRun(record: CompletedCommand, recent: readonly CompletedCommand[]): CompletedCommand | undefined {
  const same = recent.indexOf(record);
  const index = same >= 0 ? same : recent.findIndex(item => item.startId === record.startId);
  return recent.slice(index + 1).find(item => item.command.trim() === record.command.trim());
}
