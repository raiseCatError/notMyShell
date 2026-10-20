import test from 'node:test';
import assert from 'node:assert/strict';
import {BASELINE_CAPABILITIES, resolveHostCapabilities, type TerminalCapabilities} from '../src/host/capabilities.js';
import {TerminalRenderer, type TextBlock} from '../src/terminal/TerminalRenderer.js';
import {configureTextSizing, describeTextSizing, isSizable, metadata, osc66, roleForLevel, textSizingEnabled, ROLE_STEPS} from '../src/ui/textSizing.js';
import {setSizedBackend, setTextSizing, textSizing, textSizingActive, typeset} from '../src/ui/typography.js';

const scaled: TerminalCapabilities = {...BASELINE_CAPABILITIES, textSizing: {scale: true, width: true}};
const reset = () => { setSizedBackend(undefined); setTextSizing({mode: 'auto', capability: {scale: false, width: false}, knownUnrendered: false}); };

test('osc66: the sequence follows the specification and refuses unsafe input', () => {
  assert.equal(osc66('Title', {s: 2}), '\u001b]66;s=2;Title\u001b\\');
  assert.equal(osc66('H3', {s: 2, n: 3, d: 4, v: 2}), '\u001b]66;s=2:n=3:d=4:v=2;H3\u001b\\');
  assert.equal(metadata({s: 3, n: 5, d: 4}), 's=3', 'a fraction must have n < d');
  assert.equal(metadata({s: 1, n: 1, d: 2, h: 2}), 's=1:n=1:d=2:h=2');
  assert.throws(() => osc66('x', {s: 0}), RangeError);
  assert.throws(() => osc66('x', {s: 8}), RangeError);
  assert.throws(() => osc66('bad\u001b]0;pwned\u0007', {s: 2}), RangeError, 'escape and control characters never reach the sequence');
  assert.throws(() => osc66('line\nbreak', {s: 2}), RangeError);
  assert.throws(() => osc66('', {s: 2}), RangeError);
  assert.throws(() => osc66('x'.repeat(4097), {s: 2}), RangeError, 'over the 4096-byte limit');
});

test('only text of certain width is ever sized: no wide characters, emoji, combining marks or ZWJ', () => {
  for (const ok of ['Install', 'Café résumé', 'Ελληνικά', 'Привет', 'a — b “quoted”', 'Spaces and punctuation: 1,000.5%']) assert.equal(isSizable(ok), true, ok);
  for (const bad of ['日本語', '🐈 cat', 'é', 'a‍b', 'tab\there', 'bell\u0007', '\u001b[31m', 'fi️', '']) assert.equal(isSizable(bad), false, JSON.stringify(bad));
});

test('typeset: plain everywhere until scaling is verified; then the largest step that fits, with measured cells', () => {
  reset();
  const plain = typeset({role: 'title', text: 'Hello', maxColumns: 80});
  assert.equal(plain.sized, undefined);
  assert.deepEqual([plain.columns, plain.rows, plain.plain], [5, 1, ['Hello']]);
  configureTextSizing({setting: 'auto', capabilities: scaled, env: {TERM_PROGRAM: 'kitty'}});
  assert.equal(textSizingEnabled(), true);
  const title = typeset({role: 'title', text: 'Hello', maxColumns: 80});
  assert.equal(title.sized?.sequence, '\u001b]66;s=3;Hello\u001b\\');
  assert.deepEqual([title.columns, title.rows], [15, 3], 's=3 makes each of 5 cells 3 wide and the block 3 rows high');
  assert.deepEqual(title.plain, ['Hello'], 'the plain form is always available');
  const narrow = typeset({role: 'title', text: 'Hello', maxColumns: 50});
  assert.equal(narrow.sized?.sequence, '\u001b]66;s=2;Hello\u001b\\', 'a window under 60 columns uses 2x');
  assert.equal(typeset({role: 'title', text: 'Hello', maxColumns: 30}).sized, undefined, 'a very narrow window gets ordinary text');
  assert.equal(typeset({role: 'title', text: 'A long heading that will not fit at double size', maxColumns: 70}).sized, undefined, 'too long for any step: plain');
  assert.equal(typeset({role: 'title', text: 'Hello', maxColumns: 80, maxRows: 2}).sized?.rows, 2, 'a short panel gets smaller type');
  assert.equal(typeset({role: 'title', text: 'Hello', maxColumns: 80, maxRows: 1}).sized, undefined);
  assert.equal(typeset({role: 'body', text: 'Hello', maxColumns: 80}).sized, undefined, 'body text is never sized');
  assert.equal(typeset({role: 'caption', text: 'Hello', maxColumns: 80}).sized, undefined);
  assert.equal(typeset({role: 'heading', text: '日本語', maxColumns: 80}).sized, undefined, 'wide text stays plain');
  assert.equal(typeset({role: 'celebration', text: 'Well done', maxColumns: 80}).sized?.rows, 3);
  assert.equal(typeset({role: 'counter', text: '1,240', maxColumns: 80}).sized?.sequence, '\u001b]66;s=2;1,240\u001b\\');
  reset();
});

test('document levels map H1..H6 onto a progressive scale: 3x, 2x, 1.5x, then weight and color only', () => {
  reset();
  configureTextSizing({setting: 'auto', capabilities: scaled, env: {TERM_PROGRAM: 'kitty'}});
  const forLevel = (level: number) => typeset({role: 'heading', text: 'Section', maxColumns: 100, level}).sized?.sequence;
  assert.equal(forLevel(1), '\u001b]66;s=3;Section\u001b\\');
  assert.equal(forLevel(2), '\u001b]66;s=2;Section\u001b\\');
  assert.equal(forLevel(3), '\u001b]66;s=2:n=3:d=4:v=2;Section\u001b\\');
  for (const level of [4, 5, 6]) assert.equal(forLevel(level), undefined, `H${level} is ordinary text`);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(roleForLevel), ['title', 'heading', 'subheading', 'caption', 'body', 'body']);
  assert.ok(Object.values(ROLE_STEPS).flat().every(step => step.s >= 1 && step.s <= 7));
  reset();
});

test('gating: Off, an unverified or width-only terminal, a multiplexer, TERM=dumb and the environment switch all keep text plain', () => {
  const states = [
    {setting: 'off' as const, capabilities: scaled, env: {TERM_PROGRAM: 'kitty'}},
    {setting: 'auto' as const, capabilities: BASELINE_CAPABILITIES, env: {TERM_PROGRAM: 'kitty'}},
    {setting: 'auto' as const, capabilities: {...BASELINE_CAPABILITIES, textSizing: {scale: false, width: true}}, env: {TERM_PROGRAM: 'kitty'}},
    {setting: 'enhanced' as const, capabilities: scaled, env: {TERM_PROGRAM: 'kitty', TMUX: '/tmp/x,1,0'}},
    {setting: 'auto' as const, capabilities: scaled, env: {TERM: 'screen-256color'}},
    {setting: 'auto' as const, capabilities: scaled, env: {TERM: 'dumb'}},
    {setting: 'enhanced' as const, capabilities: scaled, env: {TERM_PROGRAM: 'kitty', NMSH_TEXT_SIZING: '0'}},
  ];
  for (const state of states) {
    configureTextSizing(state);
    assert.equal(textSizingEnabled(), false, JSON.stringify([state.setting, state.env]));
    assert.equal(textSizingActive(), false);
    assert.equal(typeset({role: 'title', text: 'Hello', maxColumns: 80}).sized, undefined);
  }
  reset();
});

test('Ghostty: Auto leaves scaling off even when the probe moved the cursor; Enhanced is the explicit override', () => {
  const env = {TERM_PROGRAM: 'ghostty'};
  configureTextSizing({setting: 'auto', capabilities: scaled, env});
  assert.equal(textSizingEnabled(), false);
  assert.match(describeTextSizing({setting: 'auto', capabilities: scaled, env}), /not known to draw scaled glyphs/u);
  configureTextSizing({setting: 'enhanced', capabilities: scaled, env});
  assert.equal(textSizingEnabled(), true);
  assert.equal(textSizing().capability.scale, true, 'scale support is still reported separately from width');
  reset();
});

test('describeTextSizing explains each state honestly', () => {
  const env = {TERM_PROGRAM: 'kitty'};
  assert.match(describeTextSizing({setting: 'off', capabilities: scaled, env}), /off in Settings/u);
  assert.match(describeTextSizing({setting: 'auto', capabilities: BASELINE_CAPABILITIES, env}), /did not answer/u);
  assert.match(describeTextSizing({setting: 'auto', capabilities: {...BASELINE_CAPABILITIES, textSizing: {scale: false, width: true}}, env}), /explicit widths only/u);
  assert.match(describeTextSizing({setting: 'auto', capabilities: scaled, env}), /scaled headings and counters \(verified/u);
  assert.match(describeTextSizing({setting: 'auto', capabilities: scaled, env: {TMUX: '1'}}), /multiplexer/u);
  void resolveHostCapabilities;
});

// ---- the renderer: sized blocks are drawn after the rows, and again whenever a row they cover repaints ----------------

function renderer() {
  const writes: string[] = [];
  const instance = new TerminalRenderer(data => { writes.push(data); });
  instance.enter();
  writes.length = 0;
  const frame = (rows: string[]) => ({rows, cursorRow: 1, cursorColumn: 1, columns: 40});
  return {instance, writes, frame, last: () => writes.at(-1) ?? ''};
}
const block = (overrides: Partial<TextBlock> = {}): TextBlock => ({row: 1, column: 2, columns: 10, rows: 2, sequence: '\u001b]66;s=2;Hello\u001b\\', ...overrides});

test('renderer: a block is written after every row, once, and not again while its rows are unchanged', () => {
  const r = renderer();
  r.instance.setTextBlocks([block()]);
  r.instance.render(r.frame(['top', '', '', 'bottom']));
  const first = r.last();
  assert.ok(first.indexOf('bottom') < first.indexOf('\u001b]66;s=2;Hello'), 'rows first, block last: an erase of a row would otherwise destroy it');
  assert.match(first, /\u001b\[2;3H\u001b\]66;s=2;Hello\u001b\\/u, 'positioned at its top-left cell');
  r.writes.length = 0;
  r.instance.render(r.frame(['top', '', '', 'bottom']));
  assert.deepEqual(r.writes, [], 'nothing changed: nothing written');
  r.instance.render(r.frame(['changed', '', '', 'bottom']));
  assert.doesNotMatch(r.last(), /\]66;/u, 'a row the block does not cover changed: the block stays');
});

test('renderer: a repaint of a covered row draws the block again, a removed block forces its rows to repaint, invalidate redraws', () => {
  const r = renderer();
  r.instance.setTextBlocks([block()]);
  r.instance.render(r.frame(['top', '', '', 'bottom']));
  r.writes.length = 0;
  r.instance.render(r.frame(['top', '', 'x', 'bottom']));
  assert.match(r.last(), /\u001b\[3;1H\u001b\[2Kx[\s\S]*\u001b\[2;3H\u001b\]66;s=2;Hello/u, 'the covered row was erased, so the block is drawn again');
  r.writes.length = 0;
  r.instance.setTextBlocks([]);
  r.instance.render(r.frame(['top', '', 'x', 'bottom']));
  assert.match(r.last(), /\u001b\[2;1H\u001b\[2K/u, 'the rows it covered are rewritten, which erases the block');
  assert.doesNotMatch(r.last(), /\]66;/u);
  r.instance.setTextBlocks([block()]);
  r.instance.render(r.frame(['top', '', 'x', 'bottom']));
  r.writes.length = 0;
  r.instance.invalidate();
  r.instance.render(r.frame(['top', '', 'x', 'bottom']));
  assert.match(r.last(), /\u001b\]66;s=2;Hello/u, 'after invalidate every row and block is drawn again');
});

test('renderer: nothing is written while a program owns the screen, and a block is re-drawn after it returns', () => {
  const r = renderer();
  r.instance.setTextBlocks([block()]);
  r.instance.render(r.frame(['top', '', '', 'bottom']));
  r.instance.suspendForPassthrough();
  r.writes.length = 0;
  r.instance.render(r.frame(['top', '', '', 'bottom']));
  assert.deepEqual(r.writes, [], 'a suspended renderer writes nothing');
  r.instance.sendRaw('\u001b_Gx\u001b\\');
  assert.deepEqual(r.writes, [], 'nor raw bytes');
  r.instance.resumeAfterPassthrough();
  r.writes.length = 0;
  r.instance.render(r.frame(['top', '', '', 'bottom']));
  assert.match(r.writes.join(''), /\u001b\]66;s=2;Hello/u);
});

// ---- the app: a panel's sized title reaches the renderer at the right screen cell ------------------------------------

import {executionFrameFixture} from './support/executionTimelineFrames.js';
import {stripAnsi} from '../src/util/text.js';

test('app: with verified scaling the arcade hub title is placed as a sized block inside the panel, and plain text otherwise', async () => {
  const frame = executionFrameFixture(110, 34);
  const app = frame.app;
  const placed: TextBlock[][] = [];
  const original = app['renderer'].setTextBlocks.bind(app['renderer']);
  app['renderer'].setTextBlocks = (blocks: readonly TextBlock[]) => { placed.push([...blocks]); original(blocks); };
  try {
    app['host'].capabilities = {...app['host'].capabilities, textSizing: {scale: true, width: true}};
    app['typographyKey'] = '';
    process.env.TERM_PROGRAM = process.env.TERM_PROGRAM === 'ghostty' ? 'kitty' : process.env.TERM_PROGRAM;
    await app['runSlash']('/games', {kind: 'arcade'});
    frame.capture();
    const withBlock = placed.at(-1)!;
    const title = withBlock.find(block => block.sequence.includes('Vespyr Arcade'));
    assert.ok(title, 'the hub title is a sized block');
    assert.match(title!.sequence, /\u001b\]66;s=2;Vespyr Arcade\u001b\\/u, 'the panel has no room for 3x here, so 2x');
    const rows = frame.capture().frame.rows.map(row => stripAnsi(row));
    for (let row = title!.row; row < title!.row + title!.rows; row += 1) {
      assert.equal(rows[row]!.slice(title!.column, title!.column + title!.columns).trim(), '', 'the cells under the block are blank, so the terminal draws it on clean cells');
    }
    app['promptConfiguration'].textSizing = 'off';
    frame.capture();
    assert.deepEqual(placed.at(-1), [], 'turning Text sizing off removes the block and draws the title as ordinary text');
    assert.match(frame.capture().frame.rows.map(row => stripAnsi(row)).join('\n'), /Vespyr Arcade/u);
  } finally { frame.dispose(); reset(); }
});
