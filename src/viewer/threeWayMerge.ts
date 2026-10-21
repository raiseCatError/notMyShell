import {diffLines, type DiffLine} from '../output/compare.js';

/**
 * A line-based three-way merge of a file being edited (#463, hunk review): `base` is the file as the editor last read or
 * saved it, `mine` the editor's buffer and `theirs` the file now on disk. Pure and bounded; nothing here reads or writes
 * a file, and the editor, not this module, decides what the final text does.
 *
 * Rules, chosen to merge only what is unambiguous:
 * - A change made by one side only is taken as it is (my own needs no decision; the disk's is a hunk to accept or keep mine).
 * - Changes made by both sides to the same lines, or touching each other (no unchanged line between them), or inserted at
 *   the same point, are a conflict unless both sides made exactly the same change.
 * - If either side differs from the base by more than `bound` edits (or there are more than MAX_HUNKS hunks) the lines
 *   cannot be aligned reliably: the whole region where mine and theirs differ is one conflict, never a guess.
 */

export const MERGE_EDIT_BOUND = 1500;
export const MAX_HUNKS = 2000;

export type Resolution = 'mine' | 'theirs' | 'both' | 'base';

export interface MergeHunk {
  /** 1-based, in file order. */
  id: number;
  /** 'theirs': only the disk changed these lines (defaults to the disk's version). 'conflict': both sides did, differently. */
  kind: 'theirs' | 'conflict';
  base: string[];
  mine: string[];
  theirs: string[];
  /** Undefined only for a conflict nobody has decided yet. */
  resolution?: Resolution;
}

export type Segment = {kind: 'text'; lines: string[]} | {kind: 'hunk'; hunk: MergeHunk};

export interface Merge {
  segments: Segment[];
  /** False when the sides were too different to align and the review is one coarse conflict. */
  aligned: boolean;
  notes: string[];
}

interface Region {start: number; end: number; lines: string[]; lo: number; hi: number}

function regionsOf(script: readonly DiffLine[]): Region[] {
  const regions: Region[] = [];
  let current: Region | undefined;
  let position = 0;
  for (const line of script) {
    if (line.kind === 'same') { current = undefined; position = line.a + 1; continue; }
    if (line.kind === 'remove') {
      if (!current) { current = {start: line.a, end: line.a, lines: [], lo: line.a, hi: line.a}; regions.push(current); }
      current.end = line.a + 1; position = line.a + 1;
    } else {
      if (!current) { current = {start: position, end: position, lines: [], lo: position, hi: position}; regions.push(current); }
      current.lines.push(line.text);
    }
  }
  return regions;
}

const SLIDE_LIMIT = 10_000;

/**
 * A pure insertion or deletion among equal neighbouring lines can be placed in several equally good ways (deleting either of
 * two identical blocks leaves the same text). Where the aligner happened to put it is arbitrary, so the span it could be
 * said to touch is the whole range it can slide over; the clustering uses that span, never the arbitrary one.
 */
function widen(base: readonly string[], region: Region): void {
  const inserted = region.lines.length, removed = region.end - region.start;
  region.lo = region.start; region.hi = region.end;
  if (inserted && removed) return;
  let left = 0, right = 0;
  if (!inserted) {
    while (left < SLIDE_LIMIT && region.start - left - 1 >= 0 && base[region.start - left - 1] === base[region.end - left - 1]) left += 1;
    while (right < SLIDE_LIMIT && region.end + right < base.length && base[region.start + right] === base[region.end + right]) right += 1;
  } else {
    const n = inserted;
    while (left < SLIDE_LIMIT && region.start - left - 1 >= 0 && base[region.start - left - 1] === region.lines[(((n - 1 - left) % n) + n) % n]) left += 1;
    while (right < SLIDE_LIMIT && region.start + right < base.length && base[region.start + right] === region.lines[right % n]) right += 1;
  }
  region.lo = region.start - left; region.hi = region.end + right;
}

function applyRegions(base: readonly string[], from: number, to: number, regions: readonly Region[]): string[] {
  const out: string[] = [];
  let at = from;
  for (const region of [...regions].sort((a, b) => a.start - b.start)) { out.push(...base.slice(at, region.start), ...region.lines); at = region.end; }
  out.push(...base.slice(at, to));
  return out;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((line, index) => line === b[index]);

function coarse(mine: readonly string[], theirs: readonly string[], note: string): Merge {
  let head = 0;
  while (head < mine.length && head < theirs.length && mine[head] === theirs[head]) head += 1;
  let tail = 0;
  while (tail < mine.length - head && tail < theirs.length - head && mine[mine.length - 1 - tail] === theirs[theirs.length - 1 - tail]) tail += 1;
  const segments: Segment[] = [];
  if (head) segments.push({kind: 'text', lines: mine.slice(0, head)});
  segments.push({kind: 'hunk', hunk: {id: 1, kind: 'conflict', base: [], mine: mine.slice(head, mine.length - tail), theirs: theirs.slice(head, theirs.length - tail)}});
  if (tail) segments.push({kind: 'text', lines: mine.slice(mine.length - tail)});
  return {segments, aligned: false, notes: [note]};
}

export function merge3(base: readonly string[], mine: readonly string[], theirs: readonly string[], bound = MERGE_EDIT_BOUND): Merge {
  if (same(mine, theirs)) return {segments: [{kind: 'text', lines: [...mine]}], aligned: true, notes: []};
  const toMine = diffLines(base, mine, bound), toTheirs = diffLines(base, theirs, bound);
  if (!toMine || !toTheirs) return coarse(mine, theirs, `Too different from the version you opened to align line by line (more than ${bound} edits); the differing region is one conflict.`);
  const regionsMine = regionsOf(toMine), regionsTheirs = regionsOf(toTheirs);
  for (const region of [...regionsMine, ...regionsTheirs]) widen(base, region);
  const items = [...regionsMine.map(region => ({region, side: 'mine' as const})), ...regionsTheirs.map(region => ({region, side: 'theirs' as const}))]
    .sort((a, b) => a.region.lo - b.region.lo || a.region.hi - b.region.hi);
  // Regions join a cluster when they touch where the aligner put them, or when the places they could slide to share lines: a slide
  // that merely ends beside the other side's change does not make them conflict (the text is the same either way).
  const clusters: Array<{start: number; end: number; wide: number; touch: number; mine: Region[]; theirs: Region[]}> = [];
  for (const item of items) {
    const last = clusters.at(-1);
    if (last && (item.region.lo < last.wide || item.region.start <= last.touch)) {
      last.end = Math.max(last.end, item.region.hi); last.wide = Math.max(last.wide, item.region.hi); last.touch = Math.max(last.touch, item.region.end);
      last[item.side].push(item.region);
    } else clusters.push({start: item.region.lo, end: item.region.hi, wide: item.region.hi, touch: item.region.end, mine: item.side === 'mine' ? [item.region] : [], theirs: item.side === 'theirs' ? [item.region] : []});
  }
  const segments: Segment[] = [];
  const text = (lines: readonly string[]) => {
    if (!lines.length) return;
    const last = segments.at(-1);
    if (last?.kind === 'text') last.lines.push(...lines); else segments.push({kind: 'text', lines: [...lines]});
  };
  let hunks = 0;
  let at = 0;
  for (const cluster of clusters) {
    text(base.slice(at, cluster.start));
    at = cluster.end;
    const mineText = applyRegions(base, cluster.start, cluster.end, cluster.mine);
    const theirsText = applyRegions(base, cluster.start, cluster.end, cluster.theirs);
    if (!cluster.theirs.length) text(mineText);
    else if (same(mineText, theirsText)) text(mineText);
    else {
      hunks += 1;
      if (hunks > MAX_HUNKS) return coarse(mine, theirs, `More than ${MAX_HUNKS} separate changes; the differing region is one conflict.`);
      const baseText = base.slice(cluster.start, cluster.end);
      const conflict = cluster.mine.length > 0;
      segments.push({kind: 'hunk', hunk: {id: hunks, kind: conflict ? 'conflict' : 'theirs', base: [...baseText], mine: mineText, theirs: theirsText, ...(conflict ? {} : {resolution: 'theirs' as const})}});
    }
  }
  text(base.slice(at));
  return {segments, aligned: true, notes: []};
}

export function hunksOf(merge: Merge): MergeHunk[] {
  return merge.segments.flatMap(segment => segment.kind === 'hunk' ? [segment.hunk] : []);
}

export function setResolution(merge: Merge, id: number, resolution: Resolution | undefined): void {
  const hunk = hunksOf(merge).find(candidate => candidate.id === id);
  if (!hunk) return;
  if (resolution === undefined) delete hunk.resolution; else hunk.resolution = resolution;
}

export const pendingConflicts = (merge: Merge) => hunksOf(merge).filter(hunk => hunk.kind === 'conflict' && !hunk.resolution).length;

export function chosenLines(hunk: MergeHunk): string[] | undefined {
  switch (hunk.resolution) {
    case 'mine': return hunk.mine;
    case 'theirs': return hunk.theirs;
    case 'both': return [...hunk.mine, ...hunk.theirs];
    case 'base': return hunk.base;
    default: return undefined;
  }
}

/** The merged text with every decision applied, or undefined while a conflict is undecided. */
export function mergedLines(merge: Merge): string[] | undefined {
  const out: string[] = [];
  for (const segment of merge.segments) {
    if (segment.kind === 'text') { out.push(...segment.lines); continue; }
    const lines = chosenLines(segment.hunk);
    if (!lines) return undefined;
    out.push(...lines);
  }
  return out.length ? out : [''];
}
