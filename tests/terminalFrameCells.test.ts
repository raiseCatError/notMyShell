import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalFrameCells} from '../scripts/dev/terminal-frame-cells.js';

test('production frame evidence preserves wide/combining cells, backgrounds and reset boundaries', () => {
  const cells = terminalFrameCells('\u001b[48;2;10;20;30m界x\u001b[0me\u0301');
  assert.deepEqual(cells.map(({column, width, text}) => ({column, width, text})), [
    {column: 0, width: 2, text: '界'}, {column: 2, width: 1, text: 'x'}, {column: 3, width: 1, text: 'e\u0301'},
  ]);
  assert.deepEqual(cells[0]!.background, {red: 10, green: 20, blue: 30});
  assert.deepEqual(cells[1]!.background, cells[0]!.background);
  assert.equal(cells[2]!.background, undefined);
});
