import test from 'node:test';
import assert from 'node:assert/strict';
import type {QueueOp} from '../src/session/CommandQueue.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * QA F03 (v0.22 physical QA, A9): while a program waits for input, its question takes the activity rows and the queue's
 * list steps aside (intentional: the question needs both rows and the person's attention, and nothing may draw what is
 * typed for it). The queue must still be visibly there: the headline keeps a queue tail at every width, shortening the
 * headline before dropping it, and says when queued commands now wait for approval, so the list that returns after the
 * question holds no surprise.
 */
function waiting(columns: number, command = 'sh -c "sleep 1; read -rs p; echo done"') {
  const f = executionFrameFixture(columns, 30);
  Object.defineProperty(f.session, 'queue', {value: (op: QueueOp) => { f.owner.request(op); }, configurable: true});
  Object.defineProperty(f.session, 'write', {value: () => {}, configurable: true});
  f.begin(command);
  f.app['session'].queue({op: 'add', text: 'echo early'});
  f.app['session'].queue({op: 'add', text: 'echo later'});
  f.tick(300);
  f.session.emit('inputState', {request: {since: Date.now(), confidence: 'confirmed', mode: 'hidden'}, timing: {waitedMs: 0, waits: 0}});
  f.tick(300);
  const rows = f.capture().frame.rows.map(row => stripAnsi(row));
  return {f, rows, headline: rows.find(row => /Waiting for input/u.test(row)) ?? ''};
}

test('F03: while a program waits, the headline says the queue is there and that its entries now wait for approval', async () => {
  const {f, headline} = waiting(110);
  try {
    await new Promise(done => setImmediate(done));
    const again = f.capture().frame.rows.map(row => stripAnsi(row)).find(row => /Waiting for input/u.test(row)) ?? headline;
    assert.match(again, /≡ 2 queued · 2 for approval/u);
  } finally { f.dispose(); }
});

test('F03: at narrow widths the queue tail stays: the headline is shortened first, then the tail becomes a count', async () => {
  for (const columns of [52, 40, 30]) {
    const {f} = waiting(columns, 'a-program-with-a-rather-long-name --and arguments');
    try {
      await new Promise(done => setImmediate(done));
      const rows = f.capture().frame.rows.map(row => stripAnsi(row));
      const headline = rows.find(row => /Waiting|◆/u.test(row)) ?? '';
      assert.match(headline, /≡ 2/u, `${columns}: ${headline}`);
      for (const row of rows) assert.ok(displayWidth(row) <= columns, `${columns}: ${row}`);
    } finally { f.dispose(); }
  }
});
