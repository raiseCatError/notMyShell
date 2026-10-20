import test from 'node:test';
import assert from 'node:assert/strict';
import {BASELINE_CAPABILITIES, resolveHostCapabilities, type TerminalCapabilities} from '../src/host/capabilities.js';
import {resolveProbeReplies} from '../src/host/probe.js';
import {decideGraphics, describeGraphics, ESTIMATED_CELL, type GraphicsEnvironment} from '../src/graphics/capabilities.js';
import {kittyDeleteImage, kittyVirtualPlacement, placeholderRows, PLACEHOLDER_CHAR, MAX_PLACEHOLDER_SPAN, containsKittyBytes} from '../src/graphics/kittyPlaceholder.js';
import {PLACEHOLDER_DIACRITICS} from '../src/graphics/diacritics.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const KITTY_OK = '\u001b_Gi=31;OK\u001b\\';

function environment(env: NodeJS.ProcessEnv, options: {replies?: string; mode?: GraphicsEnvironment['mode']; color?: GraphicsEnvironment['color']; safe?: boolean} = {}): GraphicsEnvironment {
  const hints = resolveHostCapabilities(env);
  const capabilities: TerminalCapabilities = options.replies ? resolveProbeReplies(options.replies, hints, {extended: true}).capabilities : hints;
  return {capabilities, env, mode: options.mode ?? 'auto', color: options.color ?? 'truecolor', safeGlyphs: options.safe ?? false, columns: 100, rows: 40};
}

test('Auto: Ghostty and Kitty use Kitty graphics only when the terminal answers the query; placeholders refine it', () => {
  const ghosttyAnswered = decideGraphics(environment({TERM_PROGRAM: 'ghostty'}, {replies: KITTY_OK}));
  assert.equal(ghosttyAnswered.backend, 'kitty');
  assert.equal(ghosttyAnswered.evidence, 'query');
  assert.equal(ghosttyAnswered.inline, 'placeholder');
  const ghosttySilent = decideGraphics(environment({TERM_PROGRAM: 'ghostty'}));
  assert.equal(ghosttySilent.backend, 'unicode', 'the name alone never turns graphics on');
  assert.equal(ghosttySilent.evidence, 'none');
  const ghosttyRefused = decideGraphics(environment({TERM_PROGRAM: 'ghostty'}, {replies: '\u001b_Gi=31;ENOTSUPPORTED:no\u001b\\'}));
  assert.equal(ghosttyRefused.backend, 'unicode');
  const kitty = decideGraphics(environment({TERM_PROGRAM: 'kitty', KITTY_WINDOW_ID: '1'}));
  assert.equal(kitty.backend, 'kitty', 'Kitty itself keeps its long-standing record');
  assert.equal(kitty.inline, 'placeholder');
});

test('Auto: WezTerm that confirms Kitty graphics keeps character art in documents (no placeholder record); iTerm2 is labelled a host record', () => {
  const wez = decideGraphics(environment({TERM_PROGRAM: 'WezTerm'}, {replies: KITTY_OK}));
  assert.equal(wez.backend, 'kitty');
  assert.equal(wez.inline, 'unicode');
  const iterm = decideGraphics(environment({TERM_PROGRAM: 'iTerm.app'}));
  assert.equal(iterm.backend, 'iterm2');
  assert.equal(iterm.evidence, 'host');
  assert.equal(iterm.inline, 'unicode');
  assert.match(iterm.reason, /no query/u);
});

test('Auto: Sixel needs DA1 to say so; Zed, Terminal.app, Alacritty and unknown terminals get character art, Zed explained', () => {
  const sixel = decideGraphics(environment({TERM_PROGRAM: 'unknown'}, {replies: '\u001b[?62;4;22c'}));
  assert.equal(sixel.backend, 'sixel');
  assert.equal(sixel.evidence, 'query');
  assert.equal(sixel.inline, 'unicode');
  for (const env of [{TERM_PROGRAM: 'zed'}, {TERM_PROGRAM: 'Apple_Terminal'}, {TERM: 'alacritty'}, {}]) {
    const decision = decideGraphics(environment(env));
    assert.equal(decision.backend, 'unicode', JSON.stringify(env));
    assert.equal(decision.inline, 'unicode');
  }
  assert.match(decideGraphics(environment({TERM_PROGRAM: 'zed'})).reason, /Zed has no image protocol NMSh can verify/u);
});

test('multiplexers, TERM=dumb, NMSH_IMAGES=0 and NO_COLOR never get a native protocol, even a forced one', () => {
  for (const mode of ['auto', 'kitty', 'iterm2', 'sixel'] as const) {
    const tmux = decideGraphics(environment({TERM_PROGRAM: 'ghostty', TMUX: '/tmp/tmux-1/default,1,0'}, {replies: KITTY_OK, mode}));
    assert.equal(tmux.backend, 'unicode', `tmux ${mode}`);
    assert.equal(tmux.inline, 'unicode');
  }
  assert.equal(decideGraphics(environment({TERM: 'screen-256color'}, {mode: 'kitty'})).backend, 'unicode');
  assert.equal(decideGraphics(environment({TERM: 'dumb'})).unicode, 'ascii');
  assert.equal(decideGraphics(environment({TERM_PROGRAM: 'kitty', KITTY_WINDOW_ID: '1', NMSH_IMAGES: '0'})).backend, 'unicode');
  const noColor = decideGraphics(environment({TERM_PROGRAM: 'ghostty'}, {replies: KITTY_OK, color: 'none'}));
  assert.equal(noColor.backend, 'kitty', 'the standalone surface is pixels, color or not');
  assert.equal(noColor.inline, 'unicode', 'placeholders carry the image id in a color, so without color documents use character art');
  assert.equal(noColor.unicode, 'ascii');
});

test('explicit modes: forced protocols say they are not confirmed; Unicode and Off are always honoured', () => {
  const forced = decideGraphics(environment({TERM_PROGRAM: 'zed'}, {mode: 'kitty'}));
  assert.equal(forced.backend, 'kitty');
  assert.equal(forced.evidence, 'forced');
  assert.match(forced.reason, /did not confirm it/u);
  assert.equal(decideGraphics(environment({TERM_PROGRAM: 'ghostty'}, {replies: KITTY_OK, mode: 'kitty'})).evidence, 'query');
  assert.equal(decideGraphics(environment({}, {mode: 'sixel'})).evidence, 'forced');
  assert.equal(decideGraphics(environment({TERM_PROGRAM: 'ghostty'}, {replies: KITTY_OK, mode: 'unicode'})).backend, 'unicode');
  const off = decideGraphics(environment({TERM_PROGRAM: 'ghostty'}, {replies: KITTY_OK, mode: 'off'}));
  assert.equal(off.backend, 'off');
  assert.equal(off.inline, 'none');
});

test('character art style follows color level and Safe Glyphs; the cell size comes from the terminal, the window, or an estimate', () => {
  assert.equal(decideGraphics(environment({}, {color: 'truecolor'})).unicode, 'quadrant');
  assert.equal(decideGraphics(environment({}, {color: 'ansi256'})).unicode, 'quadrant');
  assert.equal(decideGraphics(environment({}, {color: 'ansi16'})).unicode, 'half');
  assert.equal(decideGraphics(environment({}, {color: 'none'})).unicode, 'ascii');
  assert.equal(decideGraphics(environment({}, {safe: true})).unicode, 'ascii');
  assert.deepEqual(decideGraphics(environment({}, {replies: '\u001b[6;20;10t'})).cell, {width: 10, height: 20, source: 'terminal'});
  assert.deepEqual(decideGraphics(environment({}, {replies: '\u001b[4;800;1000t'})).cell, {width: 10, height: 20, source: 'window'});
  assert.deepEqual(decideGraphics(environment({})).cell, {...ESTIMATED_CELL, source: 'estimated'});
  assert.deepEqual(decideGraphics(environment({}, {replies: '\u001b[4;5;5t'})).cell.source, 'estimated', 'an implausible size is ignored');
});

test('/doctor lines describe the choice and its evidence honestly', () => {
  const lines = describeGraphics(decideGraphics(environment({TERM_PROGRAM: 'ghostty'}, {replies: KITTY_OK})));
  assert.match(lines[0]!, /Kitty graphics \(verified\)/u);
  assert.match(lines.join('\n'), /Kitty Unicode placeholders/u);
  assert.match(describeGraphics(decideGraphics(environment({TERM_PROGRAM: 'zed'}, {mode: 'kitty'})))[0]!, /chosen, not confirmed/u);
  assert.match(describeGraphics(decideGraphics(environment({TERM_PROGRAM: 'zed'})))[0]!, /Unicode character art/u);
  void BASELINE_CAPABILITIES;
});

test('Kitty placeholders: virtual placement, exact cell grid, diacritics per row and column, deletion', () => {
  assert.equal(kittyVirtualPlacement(0x4e4d01, 12, 5), '\u001b_Ga=p,U=1,i=5131521,c=12,r=5,q=2\u001b\\');
  assert.equal(kittyDeleteImage(77), '\u001b_Ga=d,d=I,i=77,q=2\u001b\\');
  const rows = placeholderRows(0x4e4d01, 3, 2);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.ok(row.startsWith('\u001b[38;2;78;77;1m'), 'the image id is the truecolor foreground');
    assert.equal(displayWidth(row), 3, 'three cells');
    assert.equal([...stripAnsi(row)].filter(char => char === PLACEHOLDER_CHAR).length, 3);
    assert.ok(row.endsWith('\u001b[39m'));
  }
  const secondRow = [...stripAnsi(rows[1]!)].map(char => char.codePointAt(0)!);
  assert.deepEqual(secondRow.slice(0, 3), [0x10eeee, PLACEHOLDER_DIACRITICS[1], PLACEHOLDER_DIACRITICS[0]]);
  assert.deepEqual(secondRow.slice(3, 6), [0x10eeee, PLACEHOLDER_DIACRITICS[1], PLACEHOLDER_DIACRITICS[1]]);
  assert.ok(containsKittyBytes(rows[0]!));
  assert.equal(containsKittyBytes('plain text'), false);
});

test('Kitty placeholders refuse impossible spans and ids', () => {
  assert.equal(MAX_PLACEHOLDER_SPAN, 297);
  assert.throws(() => placeholderRows(0, 2, 2), RangeError);
  assert.throws(() => placeholderRows(1, 0, 2), RangeError);
  assert.throws(() => placeholderRows(1, 298, 2), RangeError);
  assert.throws(() => kittyVirtualPlacement(1, 2, 298), RangeError);
  assert.throws(() => kittyVirtualPlacement(0x1000000, 2, 2), RangeError);
  assert.throws(() => kittyDeleteImage(1.5), RangeError);
  assert.equal(new Set(PLACEHOLDER_DIACRITICS).size, 297, 'every diacritic is distinct');
});
