import test from 'node:test';
import assert from 'node:assert/strict';
import {KeyDecoder, decodeKeys} from '../src/terminal/keys.js';

test('legacy raw Escape (0x1B) still decodes on non-Kitty terminals', () => {
  assert.deepEqual(decodeKeys('\u001B'), [{kind: 'escape'}]);
});

test('Kitty keyboard protocol Escape (CSI 27 u) decodes, with and without an explicit default modifier', () => {
  assert.deepEqual(decodeKeys('\u001B[27u'), [{kind: 'escape'}]);
  assert.deepEqual(decodeKeys('\u001B[27;1u'), [{kind: 'escape'}]);
});

test('a Kitty Escape sequence split across chunks still decodes to exactly one escape', () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push('\u001B[27'), []);
  assert.deepEqual(decoder.push('u'), [{kind: 'escape'}]);
});

test('a Kitty Escape sequence with the modifier split across chunks still decodes to exactly one escape', () => {
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push('\u001B[27;'), []);
  assert.deepEqual(decoder.push('1u'), [{kind: 'escape'}]);
});

test('an unrecognized CSI-u sequence is consumed without leaking raw escape text into the editor', () => {
  const keys = decodeKeys('\u001B[999;7uhello');
  assert.ok(!keys.some(key => key.kind === 'text' && key.value.includes('\u001B')));
  assert.deepEqual(keys.filter(key => key.kind === 'text'), [
    {kind: 'text', value: 'h'}, {kind: 'text', value: 'e'}, {kind: 'text', value: 'l'},
    {kind: 'text', value: 'l'}, {kind: 'text', value: 'o'},
  ]);
});

test('existing Kitty Ctrl mappings are unaffected by the new Escape entries', () => {
  assert.deepEqual(decodeKeys('\u001B[97;5u'), [{kind: 'lineHome'}], 'Kitty Ctrl+A');
  assert.deepEqual(decodeKeys('\u001B[99;5u'), [{kind: 'interrupt'}], 'Kitty Ctrl+C');
  assert.deepEqual(decodeKeys('\u001B[127u'), [{kind: 'backspace'}], 'Kitty Backspace (no modifier)');
});
