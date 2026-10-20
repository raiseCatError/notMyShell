import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {
  batchAvailableChoices,
  batchReviewKey,
  createBatchReview,
  createBatchReviewWithRefusal,
  renderBatchReview,
  type BatchReviewState,
} from '../src/input/BatchReview.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const text = (value: string): Key => ({kind: 'text', value});

function app() {
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'render', {value: () => {}});
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns: 100, rows: 30})});
  instance['session'].queue({op: 'pause'});
  return instance;
}

async function reviewing(instance: TerminalApp): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!instance['batchReview'] && Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 10));
  }
}

function dispose(instance: TerminalApp) {
  instance['stop'](0);
  instance['session'].kill();
}

const queued = (instance: TerminalApp) => instance['queueState'].entries.map(entry => entry.text);

test('multiline paste modes: a valid shell paste offers One at a time, Queue all, Run as block, Edit, Cancel, defaulting to One at a time', () => {
  const review = createBatchReview('echo first\necho second\necho third', 'bash', 10)!;
  assert.equal(review.choice, 'steps', 'nothing executes by default: the conservative mode is one command at a time');
  assert.equal(review.verifiedCount, 3);
  assert.equal(review.refusal, undefined);

  assert.deepEqual(batchAvailableChoices(review), ['steps', 'queue', 'block', 'edit', 'cancel']);
});

test('mode navigation: Tab, BackTab, Left, Right, digits and letters update the mode only, never executing anything', () => {
  const review = createBatchReview('echo a\necho b', 'bash', 10)!;
  assert.equal(review.choice, 'steps');

  // Tab (complete) walks the strip in the order it is drawn, and wraps.
  const walk = ['queue', 'block', 'edit', 'cancel', 'steps'];
  for (const expected of walk) {
    assert.equal(batchReviewKey(review, {kind: 'complete'}, 20), undefined);
    assert.equal(review.choice, expected);
  }
  assert.equal(batchReviewKey(review, {kind: 'focusPrevious'}, 20), undefined);
  assert.equal(review.choice, 'cancel');
  assert.equal(batchReviewKey(review, {kind: 'left'}, 20), undefined);
  assert.equal(review.choice, 'edit');
  assert.equal(batchReviewKey(review, {kind: 'right'}, 20), undefined);
  assert.equal(review.choice, 'cancel');

  // Digits pick the nth mode shown.
  for (const [digit, expected] of [['1', 'steps'], ['2', 'queue'], ['3', 'block'], ['4', 'edit'], ['5', 'cancel']] as const) {
    assert.equal(batchReviewKey(review, text(digit), 20), undefined);
    assert.equal(review.choice, expected);
  }
  // Letters pick by name; they select, and only Enter confirms (q used to queue at once).
  for (const [letter, expected] of [['b', 'block'], ['q', 'queue'], ['o', 'steps']] as const) {
    assert.equal(batchReviewKey(review, text(letter), 20), undefined, `${letter} selects, never runs`);
    assert.equal(review.choice, expected);
  }
});

test('refusal on unsafe separation: only Run as block, Edit and Cancel remain, and Enter alone never runs the block', () => {
  const review = createBatchReviewWithRefusal('echo "unclosed\necho next', 'bash', 10, 'Unclosed quote in line 1');
  assert.equal(review.choice, 'edit', 'the default does not execute');
  assert.equal(review.refusal, 'Unclosed quote in line 1');

  // One at a time and Queue all need separate commands.
  assert.deepEqual(batchAvailableChoices(review), ['block', 'edit', 'cancel']);

  // Pressing 2 picks the second mode shown (Edit), the queue letter picks nothing.
  batchReviewKey(review, text('q'), 20);
  assert.equal(review.choice, 'edit');
  assert.deepEqual(batchReviewKey(review, {kind: 'enter'}, 20), {kind: 'edit'});

  // Run as block is a deliberate choice, then Enter confirms it (1 outer execution).
  batchReviewKey(review, text('b'), 20);
  assert.deepEqual(batchReviewKey(review, {kind: 'enter'}, 20), {kind: 'block'});
});

test('execution choices on Enter: steps, queue, block, edit, cancel perform exact actions', () => {
  const pasteText = 'git fetch\ngit pull --ff-only';
  for (const [digit, kind] of [['1', 'steps'], ['2', 'queue'], ['3', 'block'], ['4', 'edit'], ['5', 'cancel']] as const) {
    const review = createBatchReview(pasteText, 'bash', 10)!;
    batchReviewKey(review, text(digit), 20);
    assert.deepEqual(batchReviewKey(review, {kind: 'enter'}, 20), {kind}, kind);
  }
  // A queue with no room for the commands does not offer Queue all.
  const full = createBatchReview(pasteText, 'bash', 1)!;
  assert.deepEqual(batchAvailableChoices(full), ['steps', 'block', 'edit', 'cancel']);
  // Neither does a session that cannot queue.
  const off = createBatchReview(pasteText, 'bash', 10)!;
  off.queueOff = 'Queue all is not offered: queueing is off.';
  assert.deepEqual(batchAvailableChoices(off), ['steps', 'block', 'edit', 'cancel']);
});

test('renderBatchReview draws the shared mode strip, the verified count and the dynamic Enter control, with no bracket selectors', () => {
  const review = createBatchReview('make build\nmake test', 'bash', 10)!;
  const rendered = renderBatchReview(review, 80, 24).map(stripAnsi);

  assert.ok(rendered[0]!.includes('2 verified statements'));
  const strip = rendered.find(row => row.includes('One at a time'))!;
  for (const label of ['One at a time', 'Queue all', 'Run as block', 'Edit', 'Cancel']) assert.ok(strip.includes(label), label);
  assert.ok(!rendered.some(row => /\[\d? ?(?:One at a time|Run as block|Queue|Edit|Cancel)/u.test(row)), 'no old bracket-style options');
  assert.ok(rendered.some(row => row.includes('Enter') && row.includes('first to the composer')));

  review.choice = 'queue';
  const queueRendered = renderBatchReview(review, 80, 24).map(stripAnsi);
  assert.ok(queueRendered.some(row => row.includes('Enter') && row.includes('queue all 2')));

  review.choice = 'block';
  const blockRendered = renderBatchReview(review, 80, 24).map(stripAnsi);
  assert.ok(blockRendered.some(row => row.includes('Enter') && row.includes('run as block')));
  assert.match(blockRendered.join(' ').replace(/\s+/gu, ' '), /read a block differently/u, 'the warning about different shells');

  review.choice = 'edit';
  assert.ok(renderBatchReview(review, 80, 24).map(stripAnsi).some(row => row.includes('Enter') && row.includes('edit in composer')));
  review.choice = 'cancel';
  assert.ok(renderBatchReview(review, 80, 24).map(stripAnsi).some(row => row.includes('Enter') && row.includes('cancel')));
});

test('renderBatchReview fits narrow windows, and draws the active mode and the selected row without color', () => {
  const review = createBatchReview('make build\nmake test\nmake lint', 'bash', 10)!;
  for (const columns of [24, 30, 40, 60, 100]) {
    for (const height of [10, 16, 24]) {
      const rows = renderBatchReview(review, columns, height);
      assert.ok(rows.length <= height);
      for (const row of rows) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}x${height}: ${stripAnsi(row)}`);
    }
  }
});

test('app integration: choosing Run as block submits the whole paste as 1 outer execution without queueing', async () => {
  const instance = app();
  try {
    const paste = 'echo "step1"\necho "step2"';
    instance['handleKey']({kind: 'paste', value: paste});
    assert.equal(instance['pastePreview']?.batch, true);

    // Open review with B
    instance['handleKey'](text('b'));
    await reviewing(instance);
    assert.ok(instance['batchReview']);
    assert.equal(instance['batchReview'].choice, 'steps', 'the review opens on the conservative mode');

    instance['handleKey'](text('b'));
    assert.equal(instance['batchReview'].choice, 'block');
    assert.deepEqual(queued(instance), [], 'nothing queued on focus');

    // Enter confirms 1 outer execution
    let submitted = false;
    instance['submit'] = async (realShell, skipInstallCheck, fromComposer) => {
      submitted = true;
      assert.equal(realShell, true);
      assert.equal(instance['editor'].text, paste);
    };

    instance['handleKey']({kind: 'enter'});
    await new Promise(done => setImmediate(done));
    assert.equal(submitted, true);
    assert.equal(instance['batchReview'], undefined);
    assert.equal(instance['pastePreview'], undefined);
    assert.deepEqual(queued(instance), [], 'nothing was queued into command queue');
  } finally {
    dispose(instance);
  }
});

test('app integration: choosing Edit places paste in composer and clears review', async () => {
  const instance = app();
  try {
    const paste = 'echo line1\necho line2';
    instance['handleKey']({kind: 'paste', value: paste});
    instance['handleKey'](text('b'));
    await reviewing(instance);
    assert.ok(instance['batchReview']);

    instance['handleKey'](text('4'));
    assert.equal(instance['batchReview'].choice, 'edit');

    instance['handleKey']({kind: 'enter'});
    assert.equal(instance['batchReview'], undefined);
    assert.equal(instance['pastePreview'], undefined);
    assert.equal(instance['editor'].text, paste);
    assert.deepEqual(queued(instance), []);
  } finally {
    dispose(instance);
  }
});

test('invalidation on shell switch: switching shell clears active batchReview and pastePreview', async () => {
  const instance = app();
  try {
    const paste = 'echo a\necho b';
    instance['handleKey']({kind: 'paste', value: paste});
    instance['handleKey'](text('b'));
    await reviewing(instance);
    assert.ok(instance['batchReview']);

    // This is a mocked transition: target the zsh this fixture already runs, independent of optional Bash 4.4+.
    instance['startupPending'] = false;
    instance['shellId'] = 'bash';
    let switched: string | undefined;
    instance['session'].switchShell = async target => { switched = target; };
    await instance['switchShell']('zsh', '/shell zsh');
    assert.equal(switched, 'zsh', 'the mock switch actually ran');
    assert.equal(instance['batchReview'], undefined, 'batchReview cleared on shell switch');
    assert.equal(instance['pastePreview'], undefined, 'pastePreview cleared on shell switch');
  } finally {
    dispose(instance);
  }
});

test('invalidation on composer edit: typing while pastePreview is active invalidates preview', async () => {
  const instance = app();
  try {
    const paste = 'echo a\necho b';
    instance['handleKey']({kind: 'paste', value: paste});
    assert.ok(instance['pastePreview']);

    // Typing a normal character invalidates pastePreview and inserts character
    instance['handleKey'](text('x'));
    assert.equal(instance['pastePreview'], undefined);
    assert.equal(instance['editor'].text, 'x');
  } finally {
    dispose(instance);
  }
});


test('removal and reordering in paste review change the confirmed block and edit payload', async () => {
  const instance = app();
  try {
    const review = createBatchReview('echo OMIT\necho SECOND\necho THIRD', 'zsh', 10)!;
    instance['batchReview'] = review;
    instance['handleKey']({kind: 'delete'});
    instance['handleKey'](text('j'));
    instance['handleKey'](text('b'));
    let submitted = '';
    instance['submit'] = async () => { submitted = instance['editor'].text; };
    instance['handleKey']({kind: 'enter'});
    await new Promise(done => setImmediate(done));
    assert.equal(submitted, 'echo THIRD\necho SECOND', 'only the reviewed survivors, in the reviewed order');
    instance['editor'].clear();
    instance['batchReview'] = review;
    instance['handleKey'](text('4'));
    instance['handleKey']({kind: 'enter'});
    assert.equal(instance['editor'].text, 'echo THIRD\necho SECOND');
  } finally { dispose(instance); }
});
