import test from 'node:test';
import assert from 'node:assert/strict';
import {AnsiOutputParser, MAX_CONTROL_SEQUENCE} from '../src/output/AnsiOutputParser.js';

/** Feed chunks, checking after every read that retained state never exceeds the bound; return the plain text. */
function parse(chunks: Iterable<string>): string {
  const parser = new AnsiOutputParser();
  for (const chunk of chunks) {
    parser.write(chunk);
    assert.ok(parser.retainedControlBytes <= MAX_CONTROL_SEQUENCE, `retained ${parser.retainedControlBytes} bytes`);
  }
  parser.ensureLineBoundary();
  return parser.lines.map(line => line.map(cell => cell?.text ?? '').join('')).join('\n');
}

/** Split text into chunks of a fixed size, so every boundary position is exercised by some size. */
function* split(text: string, size: number): Generator<string> {
  for (let index = 0; index < text.length; index += size) yield text.slice(index, index + size);
}

const STRINGS: Array<[string, string, string[]]> = [
  ['OSC', '\u001B]0;', ['\u0007', '\u001B\\']],
  ['DCS', '\u001BP', ['\u001B\\']],
  ['SOS', '\u001BX', ['\u001B\\']],
  ['PM', '\u001B^', ['\u001B\\']],
  ['APC', '\u001B_', ['\u001B\\']],
];
const BODY = (length: number) => 'x'.repeat(length - 2);

test('every control string, at the bound, past it and far past it, in any chunking, leaves no debris and resumes after its terminator', () => {
  for (const [name, opener, terminators] of STRINGS) {
    for (const terminator of terminators) {
      // Exactly at the bound (opener + body fit), one past it, and far beyond (20x).
      for (const length of [MAX_CONTROL_SEQUENCE, MAX_CONTROL_SEQUENCE + 1, MAX_CONTROL_SEQUENCE * 20]) {
        const text = `a${opener}${BODY(length)}${terminator}b\n`;
        for (const size of [1, 2, 3, 7, 4096, MAX_CONTROL_SEQUENCE, MAX_CONTROL_SEQUENCE + 1, text.length]) {
          if (size === 1 && length > MAX_CONTROL_SEQUENCE + 1) continue; // per-byte reads of 160 KiB prove nothing more
          assert.equal(parse(split(text, size)), 'ab', `${name} ${JSON.stringify(terminator)} length ${length} in ${size}-byte reads`);
        }
      }
    }
  }
});

test('the terminator split across reads is still recognized, before and after the bound', () => {
  for (const [name, opener] of STRINGS) {
    for (const length of [10, MAX_CONTROL_SEQUENCE * 2]) {
      assert.equal(parse([`a${opener}${BODY(length)}\u001B`, '\\b\n']), 'ab', `${name} ESC | \\ at ${length}`);
    }
  }
  // DCS/APC bodies may contain BEL: only ST ends them, also once discarding.
  for (const length of [10, MAX_CONTROL_SEQUENCE * 2]) {
    assert.equal(parse([`a\u001BP${BODY(length)}`, '\u0007still-dcs', '\u001B\\b\n']), 'ab', `BEL inside DCS at ${length}`);
  }
});

test('a huge unterminated string keeps memory at the bound and never prints its content', () => {
  for (const [name, opener] of STRINGS) {
    const parser = new AnsiOutputParser();
    parser.write(`a${opener}`);
    for (let read = 0; read < 256; read += 1) {
      parser.write('y'.repeat(4096)); // 1 MiB in total
      assert.ok(parser.retainedControlBytes <= MAX_CONTROL_SEQUENCE, `${name}: bounded at read ${read}`);
    }
    assert.ok(parser.retainedControlBytes <= 1, `${name}: discarding keeps at most a split ESC`);
    parser.ensureLineBoundary();
    assert.equal(parser.lines.map(line => line.map(cell => cell?.text ?? '').join('')).join('\n'), 'a', name);
  }
});

test('repeated oversized strings and malformed prefixes each recover, and plain text between them stays', () => {
  const big = BODY(MAX_CONTROL_SEQUENCE * 3);
  const text = `1\u001B]0;${big}\u00072\u001BP${big}\u001B\\3\u001B_${big}\u001B\\4\u001B]8;;${big}\u001B\\5\n`;
  for (const size of [5, 4096, text.length]) assert.equal(parse(split(text, size)), '12345', `repeated, ${size}-byte reads`);
  const malformed: Array<[string[], string, string]> = [
    [['a\u001B[', '31', ';1', 'mb\n'], 'ab', 'CSI split in three'],
    [[`a\u001B[${'1;'.repeat(MAX_CONTROL_SEQUENCE)}mb\n`], 'ab', 'an oversized CSI is discarded through its final byte, not retained or printed'],
    [['a\u001B[38;2;\u001B[1mb\n'], 'ab', 'CSI interrupted by ESC'],
    [['a\u001B', '(', 'Bb\n'], 'ab', 'nF split per byte'],
    [[`a\u001B${'('.repeat(40)}Bb\n`], 'ab', 'an nF escape with many intermediates prints nothing of itself'],
    [['a\u001B'], 'a', 'lone trailing ESC'],
    [['a\u009b31m\u009d0;x\u009cb\n'], 'a31m0;xb', 'C1 forms are not introducers and are never kept as characters'],
  ];
  for (const [chunks, expected, label] of malformed) assert.equal(parse(chunks), expected, label);
});

test('oversized CSI and nF sequences, in any chunking, stay bounded and print nothing of themselves', () => {
  for (const length of [MAX_CONTROL_SEQUENCE - 1, MAX_CONTROL_SEQUENCE, MAX_CONTROL_SEQUENCE + 1, MAX_CONTROL_SEQUENCE * 20]) {
    for (const [name, text] of [['CSI', `a\u001B[${'1'.repeat(length)}mb\n`], ['nF', `a\u001B${'('.repeat(length)}Bb\n`]]) {
      for (const size of [3, 4096, MAX_CONTROL_SEQUENCE + 1, text!.length]) assert.equal(parse(split(text!, size)), 'ab', `${name} ${length} in ${size}-byte reads`);
    }
  }
});

test('an oversized OSC 8 never leaves a link open on the text after it', () => {
  const parser = new AnsiOutputParser();
  parser.write(`\u001B]8;;https://example.com/${'p'.repeat(MAX_CONTROL_SEQUENCE * 2)}\u001B\\after\n`);
  assert.ok(parser.lines[0]!.every(cell => !cell?.hyperlink));
});

test('the key decoder never holds an endless partial sequence', async () => {
  const {KeyDecoder} = await import('../src/terminal/keys.js');
  const decoder = new KeyDecoder();
  decoder.push('\u001B[');
  for (let read = 0; read < 100; read += 1) decoder.push('1;'.repeat(500));
  assert.equal(decoder.pendingEscape, false);
  assert.ok(decoder.push('a').some(key => key.kind === 'text' && key.value === 'a'), 'ordinary keys still decode');
});
