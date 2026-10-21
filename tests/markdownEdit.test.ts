import test from 'node:test';
import assert from 'node:assert/strict';
import {TextBuffer, type Position} from '../src/viewer/textBuffer.js';
import {continueList, insertLink, renumberList, shiftListItems, toggleTask, wrapSelection} from '../src/viewer/markdownEdit.js';

const at = (line: number, column: number): Position => ({line, column});
function buf(lines: string[], caret: Position, anchor?: Position): TextBuffer {
  const buffer = new TextBuffer(lines, () => 0);
  buffer.caret = caret;
  if (anchor) buffer.anchor = anchor;
  return buffer;
}
const end = (lines: string[], line = lines.length - 1) => at(line, lines[line]!.length);

// ---- Enter ------------------------------------------------------------------------------------------------------

test('Enter continues a bullet with the same marker and indentation', () => {
  for (const marker of ['-', '*', '+']) {
    const lines = [`${marker} one`];
    const b = buf(lines, end(lines));
    assert.equal(continueList(b), true);
    assert.deepEqual(b.lines, [`${marker} one`, `${marker} `]);
    assert.deepEqual(b.caret, at(1, 2));
  }
  const nested = ['- a', '    - b'];
  const b = buf(nested, end(nested));
  continueList(b);
  assert.deepEqual(b.lines.slice(1), ['    - b', '    - ']);
});

test('Enter continues an ordered list with the next number and the same delimiter; later items are not renumbered', () => {
  const lines = ['3) three', '9) later'];
  const b = buf(lines, end(lines, 0));
  continueList(b);
  assert.deepEqual(b.lines, ['3) three', '4) ', '9) later']);
});

test('Enter continues a task list with an unchecked box, whatever the current state', () => {
  const lines = ['- [x] done'];
  const b = buf(lines, end(lines));
  continueList(b);
  assert.deepEqual(b.lines, ['- [x] done', '- [ ] ']);
});

test('Enter in the middle of an item moves the rest to the new item', () => {
  const b = buf(['- alpha beta'], at(0, 7));
  continueList(b);
  assert.deepEqual(b.lines, ['- alpha', '- beta']);
  assert.deepEqual(b.caret, at(1, 2));
});

test('Enter on an empty item leaves the list: top level clears the marker, a nested one outdents', () => {
  const top = buf(['- one', '- '], at(1, 2));
  assert.equal(continueList(top), true);
  assert.deepEqual(top.lines, ['- one', '']);
  assert.deepEqual(top.caret, at(1, 0));
  const nested = buf(['- one', '  - two', '  - '], at(2, 4));
  continueList(nested);
  assert.deepEqual(nested.lines, ['- one', '  - two', '- ']);
});

test('Enter keeps a block-quote prefix and an empty quoted item leaves the list but stays quoted', () => {
  const q = buf(['> - one'], at(0, 7));
  continueList(q);
  assert.deepEqual(q.lines, ['> - one', '> - ']);
  const empty = buf(['> - one', '> - '], at(1, 4));
  continueList(empty);
  assert.deepEqual(empty.lines, ['> - one', '> ']);
});

test('Enter is left alone outside lists, inside the marker, with a selection, in code fences, on rules and escaped markers', () => {
  const cases: Array<[string[], Position, Position | undefined]> = [
    [['plain text'], at(0, 10), undefined],
    [['- item'], at(0, 1), undefined],
    [['- item'], at(0, 6), at(0, 2)],
    [['```', '- not a list', '```'], at(1, 12), undefined],
    [['- - -'], at(0, 5), undefined],
    [['***'], at(0, 3), undefined],
    [['\\- escaped'], at(0, 10), undefined],
    [['-no space'], at(0, 9), undefined],
  ];
  for (const [lines, caret, anchor] of cases) {
    const b = buf(lines, caret, anchor);
    assert.equal(continueList(b), false, lines.join('|'));
    assert.deepEqual(b.lines, lines);
  }
});

test('Enter works after a closed fence, with Unicode text and very long lines', () => {
  const closed = ['```', 'code', '```', '- after'];
  const b = buf(closed, end(closed));
  assert.equal(continueList(b), true);
  const uni = buf(['- 日本語 😀 café'], at(0, '- 日本語 😀 café'.length));
  continueList(uni);
  assert.deepEqual(uni.lines, ['- 日本語 😀 café', '- ']);
  const long = `- ${'x'.repeat(200_000)}`;
  const l = buf([long], at(0, long.length));
  continueList(l);
  assert.equal(l.lines.length, 2);
});

test('Enter is one undo step and the caret returns', () => {
  const b = buf(['- one'], at(0, 5));
  continueList(b);
  assert.equal(b.undo(), true);
  assert.deepEqual(b.lines, ['- one']);
  assert.deepEqual(b.caret, at(0, 5));
  assert.equal(b.undo(), false);
});

// ---- Tab / Shift+Tab --------------------------------------------------------------------------------------------

test('Tab indents an item under the previous sibling together with its children; Shift+Tab undoes it', () => {
  const lines = ['- a', '- b', '  - b1', '- c'];
  const b = buf(lines, at(1, 3));
  assert.equal(shiftListItems(b, false), true);
  assert.deepEqual(b.lines, ['- a', '  - b', '    - b1', '- c']);
  assert.deepEqual(b.caret, at(1, 5));
  assert.equal(shiftListItems(b, true), true);
  assert.deepEqual(b.lines, lines);
  assert.deepEqual(b.caret, at(1, 3));
});

test('Tab uses the width of the previous ordered marker so the child still nests', () => {
  const b = buf(['10. ten', '11. eleven'], at(1, 4));
  shiftListItems(b, false);
  assert.deepEqual(b.lines, ['10. ten', '    11. eleven']);
});

test('Shift+Tab outdents to the parent item\'s indentation and not past the margin', () => {
  const b = buf(['- a', '    - deep'], at(1, 8));
  shiftListItems(b, true);
  assert.deepEqual(b.lines, ['- a', '- deep']);
  assert.equal(shiftListItems(b, true), true, 'still a list item: handled, nothing to do');
  assert.deepEqual(b.lines, ['- a', '- deep']);
});

test('Tab and Shift+Tab over a multi-line selection move every selected item with its children and keep the selection', () => {
  const lines = ['- a', '- b', '- c', '- d'];
  const b = buf(lines, at(2, 3), at(1, 0));
  shiftListItems(b, false);
  assert.deepEqual(b.lines, ['- a', '  - b', '  - c', '- d']);
  assert.deepEqual(b.anchor, at(1, 2));
  assert.deepEqual(b.caret, at(2, 5));
});

test('Tab is not handled outside list items (the editor inserts its tab), and tabs/CRLF-free text is untouched', () => {
  const b = buf(['just text', '- item'], at(0, 4));
  assert.equal(shiftListItems(b, false), false);
  assert.equal(shiftListItems(b, true), false);
  assert.deepEqual(b.lines, ['just text', '- item']);
  const first = buf(['- only'], at(0, 3));
  assert.equal(shiftListItems(first, false), true, 'the first item has no sibling: it indents by its own marker width');
  assert.deepEqual(first.lines, ['  - only']);
});

// ---- Tasks ------------------------------------------------------------------------------------------------------

test('toggle task: plain item becomes unchecked, unchecked becomes checked, checked becomes unchecked; text and caret stay put', () => {
  const b = buf(['- write'], at(0, 4));
  toggleTask(b);
  assert.deepEqual(b.lines, ['- [ ] write']);
  assert.deepEqual(b.caret, at(0, 8));
  toggleTask(b);
  assert.deepEqual(b.lines, ['- [x] write']);
  toggleTask(b);
  assert.deepEqual(b.lines, ['- [ ] write']);
  const upper = buf(['1. [X] done'], at(0, 11));
  toggleTask(upper);
  assert.deepEqual(upper.lines, ['1. [ ] done']);
});

test('toggle task over a selection: mixed items check the open ones; all checked uncheck; none add boxes; non-items are untouched', () => {
  const mixed = buf(['- [ ] a', '- [x] b', '- c', 'text'], at(3, 4), at(0, 0));
  toggleTask(mixed);
  assert.deepEqual(mixed.lines, ['- [x] a', '- [x] b', '- c', 'text']);
  toggleTask(mixed);
  assert.deepEqual(mixed.lines.slice(0, 2), ['- [ ] a', '- [ ] b']);
  const none = buf(['- a', '* b', '1. c'], at(2, 4), at(0, 0));
  toggleTask(none);
  assert.deepEqual(none.lines, ['- [ ] a', '* [ ] b', '1. [ ] c']);
  const text = buf(['plain'], at(0, 0));
  assert.equal(toggleTask(text).changed, false);
  assert.match(toggleTask(text).note ?? '', /list item/u);
});

test('toggle task is one undo step for the whole selection', () => {
  const b = buf(['- a', '- b'], at(1, 3), at(0, 0));
  toggleTask(b);
  assert.equal(b.undo(), true);
  assert.deepEqual(b.lines, ['- a', '- b']);
  assert.equal(b.undo(), false);
});

// ---- Renumber ---------------------------------------------------------------------------------------------------

test('renumber: sequential from the first number, keeps the delimiter, indentation and text; other lists are untouched', () => {
  const lines = ['intro', '3. c', '7. d', '3. e', '', 'para', '1. other'];
  const b = buf(lines, at(2, 2));
  const result = renumberList(b);
  assert.equal(result.changed, true);
  assert.deepEqual(b.lines, ['intro', '3. c', '4. d', '5. e', '', 'para', '1. other']);
  assert.equal(renumberList(b).changed, false, 'already in order');
});

test('renumber: loose lists, nested lists and mixed markers; the item\'s children follow a changed marker width', () => {
  const loose = buf(['1. a', '', '1. b', '   - x', '1. c'], at(0, 0));
  renumberList(loose);
  assert.deepEqual(loose.lines, ['1. a', '', '2. b', '   - x', '3. c']);
  const wide = buf(['9. nine', '9. ten', '   - child', '9. eleven'], at(0, 0));
  renumberList(wide);
  assert.deepEqual(wide.lines, ['9. nine', '10. ten', '    - child', '11. eleven']);
  const mixed = buf(['1. a', '- bullet', '5. b'], at(0, 0));
  renumberList(mixed);
  assert.deepEqual(mixed.lines, ['1. a', '- bullet', '5. b'], 'a bullet at the same level ends the ordered list');
});

test('renumber: one undo step; not an ordered item says so', () => {
  const b = buf(['1. a', '1. b', '1. c'], at(1, 0));
  renumberList(b);
  assert.equal(b.undo(), true);
  assert.deepEqual(b.lines, ['1. a', '1. b', '1. c']);
  const bullet = buf(['- a'], at(0, 0));
  assert.match(renumberList(bullet).note ?? '', /numbered/u);
});

// ---- Links and images ------------------------------------------------------------------------------------------

test('insert link: a selection becomes the text and the address is selected for typing; with no selection both are placeholders', () => {
  const b = buf(['see docs here'], at(0, 8), at(0, 4));
  insertLink(b, false);
  assert.deepEqual(b.lines, ['see [docs](url) here']);
  assert.equal(b.selectedText(), 'url');
  const none = buf(['x '], at(0, 2));
  insertLink(none, false);
  assert.deepEqual(none.lines, ['x [text](url)']);
  assert.equal(none.selectedText(), 'text');
});

test('insert link: selected web address becomes the destination and the text is selected; images use ![alt](path)', () => {
  const b = buf(['https://example.com/a?b=(1)'], at(0, 27), at(0, 0));
  insertLink(b, false);
  assert.deepEqual(b.lines, ['[text](<https://example.com/a?b=(1)>)']);
  assert.equal(b.selectedText(), 'text');
  const img = buf(['a diagram'], at(0, 9), at(0, 2));
  insertLink(img, true);
  assert.deepEqual(img.lines, ['a ![diagram](path)']);
  assert.equal(img.selectedText(), 'path');
});

test('insert link: brackets in the selection are escaped, a multi-line selection is refused, one undo step', () => {
  const b = buf(['a [x] b'], at(0, 5), at(0, 2));
  insertLink(b, false);
  assert.deepEqual(b.lines, ['a [\\[x\\]](url) b']);
  const multi = buf(['one', 'two'], at(1, 3), at(0, 0));
  assert.equal(insertLink(multi, false).changed, false);
  assert.deepEqual(multi.lines, ['one', 'two']);
  assert.equal(b.undo(), true);
  assert.deepEqual(b.lines, ['a [x] b']);
});

// ---- Wrap -------------------------------------------------------------------------------------------------------

test('wrap: the selection stays on the same text; wrapping again (or selecting the markers) unwraps', () => {
  const b = buf(['make bold now'], at(0, 9), at(0, 5));
  wrapSelection(b, 'bold');
  assert.deepEqual(b.lines, ['make **bold** now']);
  assert.equal(b.selectedText(), 'bold');
  wrapSelection(b, 'bold');
  assert.deepEqual(b.lines, ['make bold now']);
  assert.equal(b.selectedText(), 'bold');
  const marked = buf(['make **bold** now'], at(0, 13), at(0, 5));
  wrapSelection(marked, 'bold');
  assert.deepEqual(marked.lines, ['make bold now']);
});

test('wrap: italic does not unwrap bold; code picks a fence longer than any backtick run; strike', () => {
  const b = buf(['**x**'], at(0, 3), at(0, 2));
  wrapSelection(b, 'italic');
  assert.deepEqual(b.lines, ['***x***']);
  const code = buf(['use a`b now'], at(0, 7), at(0, 4));
  wrapSelection(code, 'code');
  assert.deepEqual(code.lines, ['use ``a`b`` now']);
  assert.equal(code.selectedText(), 'a`b');
  const strike = buf(['old'], at(0, 3), at(0, 0));
  wrapSelection(strike, 'strike');
  assert.deepEqual(strike.lines, ['~~old~~']);
});

test('wrap: no selection inserts a pair with the caret inside; a multi-line selection wraps each non-blank line inside its list and quote prefix', () => {
  const none = buf(['a '], at(0, 2));
  wrapSelection(none, 'italic');
  assert.deepEqual(none.lines, ['a **']);
  assert.deepEqual(none.caret, at(0, 3));
  const multi = buf(['- one', '', '> two', 'three'], at(3, 5), at(0, 2));
  wrapSelection(multi, 'bold');
  assert.deepEqual(multi.lines, ['- **one**', '', '> **two**', '**three**']);
  assert.equal(multi.selection !== undefined, true);
});

test('wrap: Unicode, escaped markers and one undo step', () => {
  const b = buf(['日本語 😀'], at(0, '日本語 😀'.length), at(0, 0));
  wrapSelection(b, 'bold');
  assert.deepEqual(b.lines, ['**日本語 😀**']);
  const esc = buf(['\\*x*'], at(0, 3), at(0, 2));
  wrapSelection(esc, 'italic');
  assert.deepEqual(esc.lines, ['\\**x**'], 'an escaped marker is text, not emphasis to remove');
  assert.equal(b.undo(), true);
  assert.deepEqual(b.lines, ['日本語 😀']);
});

test('dirty recovered buffers: helpers edit the restored text and undo steps back through the restore', () => {
  const b = new TextBuffer(['disk'], () => 0);
  b.replaceAll(['- draft']);
  b.caret = at(0, 7);
  continueList(b);
  assert.deepEqual(b.lines, ['- draft', '- ']);
  b.undo();
  assert.deepEqual(b.lines, ['- draft']);
  b.undo();
  assert.deepEqual(b.lines, ['disk']);
});
