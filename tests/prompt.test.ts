import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPromptLine, FADE_TAIL_GLYPHS} from '../src/prompt/prompt.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

test('renders sharp, distinct Powerline segments with a right-only fade', () => {
  const rendered = buildPromptLine({cwd: '/tmp/project', project: 'project', branch: 'main'}, 60);
  const plain = stripAnsi(rendered);
  assert.equal(displayWidth(rendered), 60);
  assert.match(plain, /^ project   main ▓▒░ /u);
  assert.equal((plain.match(/[░▒▓]/gu) ?? []).join(''), FADE_TAIL_GLYPHS);
  assert.ok(plain.indexOf(FADE_TAIL_GLYPHS) > plain.indexOf('main'));
  assert.ok(!plain.startsWith('░'));
  assert.ok(!plain.includes(''));
  assert.ok(!plain.includes(''));
  assert.match(rendered, /48;2;84;82;132/u);
  assert.match(rendered, /48;2;52;105;98/u);
});

test('never wraps or duplicates metadata at narrow widths', () => {
  for (let width = 4; width <= 30; width += 1) {
    const rendered = buildPromptLine(
      {cwd: '/tmp/notMyShell', project: 'notMyShell', branch: 'very-long-branch-name'},
      width,
    );
    assert.equal(displayWidth(rendered), width, `width ${width}`);
    assert.equal(stripAnsi(rendered).split('\n').length, 1);
  }
});
