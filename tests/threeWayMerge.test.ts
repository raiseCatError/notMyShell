import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_HUNKS, hunksOf as allHunks, merge3, mergedLines, pendingConflicts, setResolution, type Merge} from '../src/viewer/threeWayMerge.js';

const L = (text: string) => text.split(' ');
const hunksOf = (merge: Merge) => allHunks(merge);

test('non-overlapping edits merge on their own: the disk-only change is a hunk defaulting to the disk version, mine is kept', () => {
  const merge = merge3(L('a b c d e'), L('a B c d e'), L('a b c D e'));
  assert.equal(pendingConflicts(merge), 0);
  assert.deepEqual(mergedLines(merge), L('a B c D e'));
  const [hunk, ...rest] = hunksOf(merge);
  assert.equal(rest.length, 0, 'my own change needs no decision');
  assert.deepEqual([hunk!.kind, hunk!.resolution, hunk!.theirs, hunk!.mine, hunk!.base], ['theirs', 'theirs', ['D'], ['d'], ['d']]);
});

test('keeping mine for a disk-only hunk reverts just that hunk to what I had', () => {
  const merge = merge3(L('a b c d e'), L('a B c d e'), L('a b c D e'));
  setResolution(merge, hunksOf(merge)[0]!.id, 'mine');
  assert.deepEqual(mergedLines(merge), L('a B c d e'));
});

test('both sides changing the same lines differently is a conflict that has no result until it is resolved', () => {
  const merge = merge3(L('a b c'), L('a X c'), L('a Y c'));
  assert.equal(pendingConflicts(merge), 1);
  assert.equal(mergedLines(merge), undefined);
  const hunk = hunksOf(merge)[0]!;
  assert.equal(hunk.kind, 'conflict');
  assert.equal(hunk.resolution, undefined);
  for (const [choice, expected] of [['mine', 'a X c'], ['theirs', 'a Y c'], ['both', 'a X Y c'], ['base', 'a b c']] as const) {
    setResolution(merge, hunk.id, choice);
    assert.deepEqual(mergedLines(merge), L(expected), choice);
    assert.equal(pendingConflicts(merge), 0);
  }
  setResolution(merge, hunk.id, undefined);
  assert.equal(pendingConflicts(merge), 1, 'a decision can be taken back');
});

test('identical edits on both sides are not a conflict and appear once', () => {
  const merge = merge3(L('a b c'), L('a X c'), L('a X c'));
  assert.equal(hunksOf(merge).length, 0);
  assert.deepEqual(mergedLines(merge), L('a X c'));
  const both = merge3(L('a b c'), L('a b c z'), L('a b c z'));
  assert.deepEqual(mergedLines(both), L('a b c z'));
});

test('adjacent changes (no unchanged line between them) are one conflict, never merged on a guess', () => {
  const merge = merge3(L('a b c d'), L('a B c d'), L('a b C d'));
  assert.equal(pendingConflicts(merge), 1);
  const hunk = hunksOf(merge)[0]!;
  assert.deepEqual([hunk.mine, hunk.theirs, hunk.base], [L('B c'), L('b C'), L('b c')]);
});

test('insertions: at different places merge; at the same place they conflict unless identical; at the very start and end work', () => {
  assert.deepEqual(mergedLines(merge3(L('a b c'), L('x a b c'), L('a b c y'))), L('x a b c y'));
  assert.equal(pendingConflicts(merge3(L('a b'), L('a m b'), L('a t b'))), 1);
  assert.equal(pendingConflicts(merge3(L('a b'), L('a m b'), L('a m b'))), 0);
  const start = merge3(L('a b'), L('m a b'), L('t a b'));
  assert.equal(pendingConflicts(start), 1);
  const empty = merge3([''], ['x'], ['']);
  assert.deepEqual(mergedLines(empty), ['x']);
});

test('deleting a line I edited on disk (or the other way round) conflicts', () => {
  const mineDeletes = merge3(L('a b c'), L('a c'), L('a B c'));
  assert.equal(pendingConflicts(mineDeletes), 1);
  assert.deepEqual(hunksOf(mineDeletes)[0]!.mine, []);
  const theirsDeletes = merge3(L('a b c'), L('a B c'), L('a c'));
  assert.equal(pendingConflicts(theirsDeletes), 1);
  assert.deepEqual(mergedLines(merge3(L('a b c d'), L('a b c'), L('b c d'))), L('b c'), 'deletions at opposite ends are independent');
});

test('several hunks are numbered in file order', () => {
  const merge = merge3(L('1 2 3 4 5 6 7 8 9'), L('1 2 3 4 5 6 7 8 9'), L('1 B 3 4 E 6 7 H 9'));
  assert.deepEqual(hunksOf(merge).map(hunk => [hunk.id, hunk.theirs]), [[1, ['B']], [2, ['E']], [3, ['H']]]);
  assert.deepEqual(mergedLines(merge), L('1 B 3 4 E 6 7 H 9'));
});

test('repeated and reordered lines never lose or duplicate text: independent edits compose, overlapping ones are flagged', () => {
  const base = L('x y x y x y x y');
  const mine = L('x y x y x y x y Z');
  const theirs = L('Q x y x y x y x y');
  assert.deepEqual(mergedLines(merge3(base, mine, theirs)), L('Q x y x y x y x y Z'));
  // Whatever the alignment, every line either side wrote is in the text or in a hunk: nothing is dropped silently.
  const swapped = merge3(L('a b c'), L('c b a'), L('a b c d'));
  const everything = new Set(swapped.segments.flatMap(segment => segment.kind === 'text' ? segment.lines : [...segment.hunk.mine, ...segment.hunk.theirs]));
  for (const line of [...L('c b a'), ...L('a b c d')]) assert.ok(everything.has(line), line);
});

test('property: random disjoint edits on each side always merge cleanly to their composition', () => {
  let seed = 12345;
  const random = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let round = 0; round < 200; round += 1) {
    const size = 12 + random(30);
    const base = Array.from({length: size}, (_, index) => `L${index}`);
    // Even-numbered blocks of three lines belong to mine, odd ones to theirs: untouched lines always separate edits.
    const mine = [...base], theirs = [...base];
    const ops: Array<[number, 'edit' | 'delete' | 'insert']> = [];
    for (let at = 1; at + 2 < size; at += 6) ops.push([at, (['edit', 'delete', 'insert'] as const)[random(3)]!]);
    const expected = [...base];
    ops.forEach(([at, op], index) => {
      const target = index % 2 === 0 ? mine : theirs;
      if (op === 'edit') { target[at] = `${target[at]}!${index}`; expected[at] = target[at]!; }
      if (op === 'delete') { target[at] = '\u0000'; expected[at] = '\u0000'; }
      if (op === 'insert') { target[at] = `${target[at]}\n+${index}`; expected[at] = target[at]!; }
    });
    const flat = (lines: string[]) => lines.flatMap(line => line === '\u0000' ? [] : line.split('\n'));
    const merge = merge3(flat(base), flat(mine), flat(theirs));
    assert.equal(pendingConflicts(merge), 0, `round ${round}`);
    assert.deepEqual(mergedLines(merge), flat(expected), `round ${round}`);
  }
});

test('too different to align within the bound: one conflict over the differing region, never a guess', () => {
  const base = Array.from({length: 400}, (_, index) => `b${index}`);
  const mine = Array.from({length: 400}, (_, index) => `m${index}`);
  const theirs = Array.from({length: 400}, (_, index) => `t${index}`);
  const merge = merge3(base, mine, theirs, 50);
  assert.equal(merge.aligned, false);
  assert.equal(hunksOf(merge).length, 1);
  assert.equal(pendingConflicts(merge), 1);
  const same = merge3(base, mine, mine, 50);
  assert.equal(pendingConflicts(same), 0, 'identical sides need no alignment');
  assert.deepEqual(mergedLines(same), mine);
});

test('a flood of hunks is capped: past the cap the review is one coarse conflict', () => {
  const base = Array.from({length: MAX_HUNKS * 3 + 10}, (_, index) => `l${index}`);
  const theirs = base.map((line, index) => index % 3 === 1 ? `${line}!` : line);
  const merge = merge3(base, base, theirs);
  assert.equal(merge.aligned, false);
  assert.equal(hunksOf(merge).length, 1);
});

test('large files: three edits per side in 50,000 lines merge exactly, and the work is bounded by the edit distance', () => {
  const base = Array.from({length: 50_000}, (_, index) => `line ${index}`);
  const mine = [...base], theirs = [...base];
  mine[100] = 'mine 100'; mine[25_000] = 'mine 25000'; mine[49_000] = 'mine 49000';
  theirs[5_000] = 'theirs 5000'; theirs[30_000] = 'theirs 30000'; theirs[49_900] = 'theirs 49900';
  const merge = merge3(base, mine, theirs);
  assert.equal(pendingConflicts(merge), 0);
  const expected = [...base];
  for (const [index, text] of [[100, 'mine 100'], [25_000, 'mine 25000'], [49_000, 'mine 49000'], [5_000, 'theirs 5000'], [30_000, 'theirs 30000'], [49_900, 'theirs 49900']] as const) expected[index] = text;
  assert.deepEqual(mergedLines(merge), expected);
  assert.equal(merge.aligned, true);
  assert.equal(hunksOf(merge).length, 3);
});

test('reviewer finding 5: where repeated lines make the alignment ambiguous the merge asks instead of picking one', () => {
  // I deleted the first "a b"; the disk edited the first "a". Aligning my deletion to the second copy would call that a disk-only change.
  assert.equal(pendingConflicts(merge3(['a', 'b', 'a', 'b', 'c'], ['a', 'b', 'c'], ['A', 'b', 'a', 'b', 'c'])), 1);
  assert.equal(pendingConflicts(merge3(['x', 's', 'P', 'x', 's'], ['x', 's'], ['X', 's', 'P', 'x', 's'])), 1);
  // Insertions among equal neighbours slide too.
  assert.equal(pendingConflicts(merge3(['}', '}', 'z'], ['}', '}', '}', 'z'], ['}', 'Z', 'z'])), 1);
  // Unambiguous edits far from any repetition still merge.
  assert.equal(pendingConflicts(merge3(['a', 'b', 'a', 'b', 'c', 'd', 'e'], ['a', 'b', 'a', 'b', 'c', 'D', 'e'], ['A', 'b', 'a', 'b', 'c', 'd', 'e'])), 0);
});

test('reviewer finding 5: widening never loses or duplicates text when every conflict is resolved either way', () => {
  let seed = 7;
  const random = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alphabet = ['', 'a', 'b', '}'];
  const make = () => Array.from({length: random(8)}, () => alphabet[random(alphabet.length)]!);
  for (let round = 0; round < 3000; round += 1) {
    const base = make(), mine = make(), theirs = make();
    const merge = merge3(base, mine, theirs);
    for (const hunk of merge.segments.flatMap(segment => segment.kind === 'hunk' ? [segment.hunk] : [])) if (!hunk.resolution) setResolution(merge, hunk.id, 'mine');
    for (const hunk of merge.segments.flatMap(segment => segment.kind === 'hunk' ? [segment.hunk] : [])) setResolution(merge, hunk.id, 'mine');
    assert.deepEqual(mergedLines(merge), mine.length ? mine : [''], `all mine: ${JSON.stringify([base, mine, theirs])}`);
    for (const hunk of merge.segments.flatMap(segment => segment.kind === 'hunk' ? [segment.hunk] : [])) setResolution(merge, hunk.id, 'theirs');
    assert.deepEqual(mergedLines(merge), theirs.length ? theirs : [''], `all theirs: ${JSON.stringify([base, mine, theirs])}`);
  }
});

test('second review: edits that only sit next to a sliding insertion stay independent; a slide that would overlap the other side\'s lines is still a conflict', () => {
  // The inserted blank line can sit before or after the blank line that is already there; only one placement avoids the edited title, and the text is the same either way.
  const clean = merge3(['# Title', '', 'para'], ['# New title', '', 'para'], ['# Title', '', '', 'para']);
  assert.equal(pendingConflicts(clean), 0);
  assert.deepEqual(mergedLines(clean), ['# New title', '', '', 'para']);
  const second = merge3(['x', 'a'], ['y', 'a'], ['x', 'a', 'a']);
  assert.equal(pendingConflicts(second), 0);
  assert.deepEqual(mergedLines(second), ['y', 'a', 'a']);
  // Still ambiguous: my deletion could be either copy, and one placement removes the line the disk edited.
  assert.equal(pendingConflicts(merge3(['a', 'b', 'a', 'b', 'c'], ['a', 'b', 'c'], ['A', 'b', 'a', 'b', 'c'])), 1);
});
