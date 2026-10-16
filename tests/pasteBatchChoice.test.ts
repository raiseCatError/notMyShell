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

test('multiline paste choices: default valid state offers block, queue, edit, cancel with queue as default', () => {
  const review = createBatchReview('echo first\necho second\necho third', 'bash', 10)!;
  assert.equal(review.choice, 'queue');
  assert.equal(review.verifiedCount, 3);
  assert.equal(review.refusal, undefined);

  const choices = batchAvailableChoices(review);
  assert.deepEqual(choices, ['block', 'queue', 'edit', 'cancel']);
});

test('choice navigation: Tab, BackTab, Left, Right and 1-4 update focus only, never executing anything', () => {
  const review = createBatchReview('echo a\necho b', 'bash', 10)!;

  // Initial choice is queue
  assert.equal(review.choice, 'queue');

  // Tab (complete) moves to edit
  assert.equal(batchReviewKey(review, {kind: 'complete'}, 20), undefined);
  assert.equal(review.choice, 'edit');

  // Tab (complete) moves to cancel
  assert.equal(batchReviewKey(review, {kind: 'complete'}, 20), undefined);
  assert.equal(review.choice, 'cancel');

  // Tab (complete) wraps to block
  assert.equal(batchReviewKey(review, {kind: 'complete'}, 20), undefined);
  assert.equal(review.choice, 'block');

  // Shift+Tab (focusPrevious) moves back to cancel
  assert.equal(batchReviewKey(review, {kind: 'focusPrevious'}, 20), undefined);
  assert.equal(review.choice, 'cancel');

  // Left moves to edit
  assert.equal(batchReviewKey(review, {kind: 'left'}, 20), undefined);
  assert.equal(review.choice, 'edit');

  // Right moves to cancel
  assert.equal(batchReviewKey(review, {kind: 'right'}, 20), undefined);
  assert.equal(review.choice, 'cancel');

  // Direct numbers 1-4
  assert.equal(batchReviewKey(review, text('1'), 20), undefined);
  assert.equal(review.choice, 'block');

  assert.equal(batchReviewKey(review, text('2'), 20), undefined);
  assert.equal(review.choice, 'queue');

  assert.equal(batchReviewKey(review, text('3'), 20), undefined);
  assert.equal(review.choice, 'edit');

  assert.equal(batchReviewKey(review, text('4'), 20), undefined);
  assert.equal(review.choice, 'cancel');

  // 'b' focuses block
  assert.equal(batchReviewKey(review, text('b'), 20), undefined);
  assert.equal(review.choice, 'block');
});

test('refusal on unsafe separation: unclosed construct or single command refuses queue and defaults to block', () => {
  const review = createBatchReviewWithRefusal('echo "unclosed\necho next', 'bash', 10, 'Unclosed quote in line 1');
  assert.equal(review.choice, 'block');
  assert.equal(review.refusal, 'Unclosed quote in line 1');

  // Queue is NOT available among choices
  const choices = batchAvailableChoices(review);
  assert.deepEqual(choices, ['block', 'edit', 'cancel']);

  // Pressing 2 does NOT select queue
  batchReviewKey(review, text('2'), 20);
  assert.equal(review.choice, 'block');

  // Enter on refused state confirms block (1 outer execution)
  const action = batchReviewKey(review, {kind: 'enter'}, 20);
  assert.deepEqual(action, {kind: 'block'});
});

test('execution choices on Enter: block, queue, edit, cancel perform exact actions', () => {
  const pasteText = 'git fetch\ngit pull --ff-only';

  // 1. Block
  const blockReview = createBatchReview(pasteText, 'bash', 10)!;
  batchReviewKey(blockReview, text('1'), 20);
  assert.deepEqual(batchReviewKey(blockReview, {kind: 'enter'}, 20), {kind: 'block'});

  // 2. Queue
  const queueReview = createBatchReview(pasteText, 'bash', 10)!;
  batchReviewKey(queueReview, text('2'), 20);
  assert.deepEqual(batchReviewKey(queueReview, {kind: 'enter'}, 20), {kind: 'queue'});

  // 3. Edit
  const editReview = createBatchReview(pasteText, 'bash', 10)!;
  batchReviewKey(editReview, text('3'), 20);
  assert.deepEqual(batchReviewKey(editReview, {kind: 'enter'}, 20), {kind: 'edit'});

  // 4. Cancel
  const cancelReview = createBatchReview(pasteText, 'bash', 10)!;
  batchReviewKey(cancelReview, text('4'), 20);
  assert.deepEqual(batchReviewKey(cancelReview, {kind: 'enter'}, 20), {kind: 'cancel'});
});

test('renderBatchReview shows verified statement count, choice pills, and dynamic Enter control', () => {
  const review = createBatchReview('make build\nmake test', 'bash', 10)!;
  const rendered = renderBatchReview(review, 80, 24).map(stripAnsi);

  // Header has verified statements count
  assert.ok(rendered[0]!.includes('2 verified statements'));

  // Contains choices
  const choicesRow = rendered.find(row => row.includes('[1 Run as block') || row.includes('[1 Block'))!;
  assert.ok(choicesRow.includes('1 Run as block'));
  assert.ok(choicesRow.includes('2 Queue separately'));
  assert.ok(choicesRow.includes('3 Edit'));
  assert.ok(choicesRow.includes('4 Cancel'));

  // Default queue has Enter queue 2
  assert.ok(rendered.some(row => row.includes('Enter') && row.includes('queue 2')));

  // Switch to block choice
  review.choice = 'block';
  const blockRendered = renderBatchReview(review, 80, 24).map(stripAnsi);
  assert.ok(blockRendered.some(row => row.includes('Enter') && row.includes('run as block')));
  assert.ok(blockRendered.some(row => row.includes('The shell runs 1 outer execution')));

  // Switch to edit choice
  review.choice = 'edit';
  const editRendered = renderBatchReview(review, 80, 24).map(stripAnsi);
  assert.ok(editRendered.some(row => row.includes('Enter') && row.includes('edit in composer')));

  // Switch to cancel choice
  review.choice = 'cancel';
  const cancelRendered = renderBatchReview(review, 80, 24).map(stripAnsi);
  assert.ok(cancelRendered.some(row => row.includes('Enter') && row.includes('cancel')));
});

test('app integration: selecting "1 Run as block" submits the whole paste as 1 outer execution without queueing', async () => {
  const instance = app();
  try {
    const paste = 'echo "step1"\necho "step2"';
    instance['handleKey']({kind: 'paste', value: paste});
    assert.equal(instance['pastePreview']?.batch, true);

    // Open review with B
    instance['handleKey'](text('b'));
    await reviewing(instance);
    assert.ok(instance['batchReview']);

    // Focus 1 (Run as block)
    instance['handleKey'](text('1'));
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

test('app integration: selecting "3 Edit" places paste in composer and clears review', async () => {
  const instance = app();
  try {
    const paste = 'echo line1\necho line2';
    instance['handleKey']({kind: 'paste', value: paste});
    instance['handleKey'](text('b'));
    await reviewing(instance);
    assert.ok(instance['batchReview']);

    // Select choice 3 (Edit)
    instance['handleKey'](text('3'));
    assert.equal(instance['batchReview'].choice, 'edit');

    // Confirm
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

    // Mock shell switch readiness and session call
    instance['startupPending'] = false;
    instance['session'].switchShell = async () => {};
    const targetShell = instance['shellId'] === 'bash' ? 'zsh' : 'bash';
    await instance['switchShell'](targetShell, `/shell ${targetShell}`);
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
