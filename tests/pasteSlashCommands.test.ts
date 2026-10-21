import test from 'node:test';
import assert from 'node:assert/strict';
import type {QueueOp} from '../src/session/CommandQueue.js';
import {batchAvailableChoices, batchReviewKey, createBatchReview, renderBatchReview} from '../src/input/BatchReview.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * QA F02 (v0.22 physical QA, Ghostty + zsh, 68c1cbb7): a pasted block mixing NMSh commands with shell commands.
 *   A: four `/track …` lines gave NMSh's unknown-command error: the whole block was parsed as ONE slash command.
 *   B: `cd modules/bun-app` + `/modules`: the cd ran, then zsh said "no such file or directory: /modules": the whole
 *      block went to the shell, NMSh's line with it.
 * Enter submitted the composer's text as one unit. Now a block the shell grammar splits into several statements, any of
 * them an NMSh command, is never submitted or queued as it is: it opens the reviewed list, and "one at a time" puts each
 * command in the composer, unsent, in order; each runs only on its own Enter, the next is offered only after the one
 * before succeeded, and Esc stops. Multi-line shell text (scripts, heredocs, Ctrl+J) is unchanged.
 */

const A = '/track ls\n/track df -h\n/track cat track/f.txt\n/track ls missing';
const B = 'cd modules/bun-app\n/modules';
const settled = () => new Promise(done => setImmediate(done));

function fixture() {
  const frame = executionFrameFixture(110, 34);
  // zsh's grammar, which every CI runner has: the reviewed list is offered only after the shell itself parse-checks
  // each command (fail closed), and the fixture's own shell (Fish) is not installed everywhere.
  frame.app['shellId'] = 'zsh';
  const submitted: string[] = [];
  const slashes: string[] = [];
  const queueOps: QueueOp[] = [];
  Object.defineProperty(frame.session, 'submit', {value: (text: string) => { submitted.push(text); }, configurable: true});
  Object.defineProperty(frame.session, 'queue', {value: (op: QueueOp) => { queueOps.push(op); frame.owner.request(op); }, configurable: true});
  // NMSh commands are recorded, not run: what matters is that NMSh, not the shell, gets each one, alone.
  frame.app['runSlash'] = async (command: string) => { slashes.push(command); };
  const key = (value: Parameters<typeof frame.app['handleKey']>[0]) => frame.app['handleKey'](value);
  const enter = () => key({kind: 'enter'});
  const composer = () => frame.app['editor'].text as string;
  const adds = () => queueOps.filter(op => op.op === 'add').map(op => (op as {text: string}).text);
  const reviewing = async () => {
    // The fixture's clock is frozen: bounded by rounds (the review waits for the shell's parse check).
    for (let round = 0; !frame.app['batchReview'] && round < 800; round += 1) await new Promise(done => setTimeout(done, 10));
    assert.ok(frame.app['batchReview'], 'the reviewed list opened');
  };
  /** Paste, then Enter twice: the preview inserts it, the second Enter is the one QA pressed. */
  const pasteAndEnter = async (text: string) => { key({kind: 'paste', value: text}); enter(); assert.equal(composer(), text); enter(); await settled(); };
  const screen = () => frame.capture().frame.rows.map(row => stripAnsi(row)).join('\n');
  return {...frame, submitted, slashes, adds, key, enter, composer, reviewing, pasteAndEnter, screen};
}

test('review: a list with an NMSh command offers One at a time and Queue all, never Run as block', () => {
  for (const source of [A, B]) {
    const review = createBatchReview(source, 'zsh', 100)!;
    assert.deepEqual(batchAvailableChoices(review), ['steps', 'queue', 'edit', 'cancel']);
    assert.equal(review.choice, 'steps');
    for (const shortcut of ['b', '3']) {
      batchReviewKey(review, {kind: 'text', value: shortcut}, 26);
      assert.notEqual(review.choice, 'block', `${shortcut} never selects Run as block`);
    }
    review.choice = 'steps';
    assert.deepEqual(batchReviewKey(review, {kind: 'enter'}, 26), {kind: 'steps'});
    batchReviewKey(review, {kind: 'text', value: 'q'}, 26);
    assert.deepEqual(batchReviewKey(review, {kind: 'enter'}, 26), {kind: 'queue'});
  }
  // A slash line inside a heredoc is the heredoc's text (zsh, Bash), not a statement.
  for (const shell of ['zsh', 'bash'] as const) {
    const heredoc = createBatchReview('cd /tmp\ncat <<EOF\n/track ls\nEOF', shell, 100)!;
    assert.deepEqual(heredoc.entries.map(entry => entry.text), ['cd /tmp', 'cat <<EOF\n/track ls\nEOF']);
    assert.deepEqual(batchAvailableChoices(heredoc), ['steps', 'queue', 'block', 'edit', 'cancel'], shell);
  }
  // The list says why Run as block is missing, and fits narrow windows.
  const review = createBatchReview(B, 'zsh', 100)!;
  for (const columns of [30, 50, 80, 120]) {
    const rows = renderBatchReview(review, columns, 20);
    assert.ok(rows.length <= 20);
    for (const row of rows) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
  }
  const text = stripAnsi(renderBatchReview(review, 120, 24).join('\n'));
  assert.match(text, /One at a time · 2/u);
  assert.match(text, /Queue all · 2/u);
  assert.match(text, /Run as block is off: NMSh commands never go to the shell as a block/u);
  assert.match(text, /NMSh command/u);
  assert.doesNotMatch(text, /Queue separately/u);
  // Shell-only lists offer all three.
  assert.deepEqual(batchAvailableChoices(createBatchReview('cd /tmp\nls', 'zsh', 100)!), ['steps', 'queue', 'block', 'edit', 'cancel']);
});

test('F02 B: `cd` + `/modules` pasted and entered: nothing runs; NMSh offers them one at a time, each on its own Enter', async () => {
  const f = fixture();
  try {
    await f.pasteAndEnter(B);
    await f.reviewing();
    assert.deepEqual(f.submitted, [], 'nothing reached the shell');
    assert.deepEqual(f.slashes, []);
    f.enter();
    assert.equal(f.app['batchReview'], undefined);
    assert.equal(f.composer(), 'cd modules/bun-app', 'the first command waits in the composer, unsent');
    assert.match(f.screen(), /1 of 2/u);
    assert.deepEqual(f.submitted, []);
    f.enter(); await settled();
    assert.equal(f.submitted.length, 1);
    assert.match(f.submitted[0]!, /cd modules\/bun-app/u);
    assert.doesNotMatch(f.submitted[0]!, /\/modules\b(?!\/)/u, 'the shell never gets the NMSh line');
    f.begin('cd modules/bun-app');
    f.complete(0); await settled();
    assert.equal(f.composer(), '/modules', 'after it succeeded, the next one is offered, unsent');
    assert.deepEqual(f.slashes, []);
    f.enter(); await settled();
    assert.deepEqual(f.slashes, ['/modules'], 'NMSh runs its own command');
    assert.equal(f.submitted.length, 1, 'still only the cd reached the shell');
    assert.equal(f.composer(), '');
    assert.doesNotMatch(f.screen(), /of 2/u, 'done: nothing more is offered');
  } finally { f.dispose(); }
});

test('F02 A: four `/track` lines pasted and entered: each is NMSh\'s own command, alone, on its own Enter', async () => {
  const f = fixture();
  try {
    await f.pasteAndEnter(A);
    await f.reviewing();
    assert.deepEqual(f.slashes, [], 'not parsed as one broken command');
    f.enter();
    for (const line of A.split('\n')) {
      assert.equal(f.composer(), line);
      f.enter(); await settled();
    }
    assert.deepEqual(f.slashes, A.split('\n'));
    assert.deepEqual(f.submitted, []);
  } finally { f.dispose(); }
});

test('F02: a failed step stops the rest; Esc stops them too; nothing left is run', async () => {
  const f = fixture();
  try {
    await f.pasteAndEnter(B);
    await f.reviewing();
    f.enter();
    f.enter(); await settled();
    f.begin('cd modules/bun-app');
    f.complete(1); await settled();
    assert.equal(f.composer(), '', 'the next command is not offered after a failure');
    assert.match(f.screen(), /not offered/u);
    assert.deepEqual(f.slashes, []);
    // Esc while a step waits in the composer.
    await f.pasteAndEnter(B);
    await f.reviewing();
    f.enter();
    assert.equal(f.composer(), 'cd modules/bun-app');
    f.key({kind: 'escape'});
    assert.equal(f.composer(), '');
    f.begin('true');
    f.complete(0); await settled();
    assert.equal(f.composer(), '', 'stopped: nothing more is offered');
    assert.equal(f.submitted.length, 1);
  } finally { f.dispose(); }
});

test('F02: the reviewed list\'s Cancel and Edit run nothing', async () => {
  const f = fixture();
  try {
    await f.pasteAndEnter(B);
    await f.reviewing();
    f.key({kind: 'text', value: 'c'});
    assert.equal(f.app['batchReview'], undefined);
    assert.equal(f.composer(), '');
    await f.pasteAndEnter(B);
    await f.reviewing();
    f.key({kind: 'text', value: 'e'});
    assert.equal(f.composer(), B, 'Edit puts the text back as it was');
    assert.deepEqual(f.submitted, []);
    assert.deepEqual(f.slashes, []);
  } finally { f.dispose(); }
});

test('F02: typed with Ctrl+J, or entered while a command runs, a mixed block is not submitted or queued either', async () => {
  const f = fixture();
  try {
    for (const char of 'echo a') f.key({kind: 'text', value: char});
    f.key({kind: 'newline'});
    for (const char of '/track ls') f.key({kind: 'text', value: char});
    f.enter(); await settled();
    await f.reviewing();
    assert.deepEqual(f.submitted, []);
    f.key({kind: 'text', value: 'c'});
    f.begin('sleep 5');
    f.key({kind: 'paste', value: B}); f.enter(); f.enter(); await settled();
    await f.reviewing();
    assert.deepEqual(f.adds(), [], 'not queued for the shell');
  } finally { f.dispose(); }
});

test('F02: multi-line shell text is unchanged: a script, a heredoc with a slash line inside, and a single NMSh command', async () => {
  const f = fixture();
  try {
    const script = 'for f in a b; do\n  echo $f\ndone';
    f.app['editor'].insertPaste(script);
    f.enter(); await settled();
    assert.equal(f.app['batchReview'], undefined);
    assert.equal(f.submitted.length, 1, 'a script runs as one command, as before');
    f.complete(0);
    // A quoted line is text in every shell.
    const quoted = "printf '%s\\n' 'first\n/track ls\nlast'";
    f.app['editor'].insertPaste(quoted);
    f.enter(); await settled();
    await new Promise(done => setTimeout(done, 200));
    assert.equal(f.app['batchReview'], undefined, 'a slash line inside a quote is text, not a command');
    assert.equal(f.submitted.length, 2);
    f.complete(0);
    f.app['editor'].insertPaste('/track ls');
    f.enter(); await settled();
    assert.deepEqual(f.slashes, ['/track ls']);
  } finally { f.dispose(); }
});

test('Queue all: `cd` then `/modules` runs both after one confirmation, in order; the shell never gets the NMSh line', async () => {
  const f = fixture();
  try {
    await f.pasteAndEnter(B);
    await f.reviewing();
    f.key({kind: 'text', value: 'q'});
    assert.deepEqual(f.adds(), [], 'choosing the mode runs nothing');
    f.enter(); await settled();
    assert.equal(f.app['batchReview'], undefined);
    assert.deepEqual(f.adds(), ['cd modules/bun-app'], 'the shell command is queued; /modules waits for it');
    assert.deepEqual(f.slashes, []);
    assert.match(f.screen(), /Queue all · 1 of 2/u);
    f.complete(0); // the prompt: the owner starts the queued command
    f.begin('cd modules/bun-app');
    f.complete(0); await settled();
    assert.deepEqual(f.slashes, ['/modules'], 'NMSh dispatches its own command after the shell command succeeded, with no further Enter');
    assert.deepEqual(f.adds(), ['cd modules/bun-app']);
    assert.equal(f.app['batchSequence'], undefined, 'finished');
    assert.doesNotMatch(f.screen(), /Queue all ·/u);
  } finally { f.dispose(); }
});

test('Queue all: four `/track` lines all run in NMSh without a single Enter, and none reaches the shell', async () => {
  const f = fixture();
  try {
    await f.pasteAndEnter(A);
    await f.reviewing();
    f.key({kind: 'text', value: 'q'});
    f.enter(); await settled();
    await settled();
    assert.deepEqual(f.slashes, A.split('\n'));
    assert.deepEqual(f.adds(), []);
    assert.deepEqual(f.submitted, []);
  } finally { f.dispose(); }
});

test('Queue all: a failed shell command stops the rest, and Esc stops a waiting sequence', async () => {
  const f = fixture();
  try {
    await f.pasteAndEnter(B);
    await f.reviewing();
    f.key({kind: 'text', value: 'q'});
    f.enter(); await settled();
    f.complete(0);
    f.begin('cd modules/bun-app');
    f.complete(1); await settled();
    assert.deepEqual(f.slashes, [], '/modules does not run after a failure');
    assert.equal(f.app['batchSequence'], undefined);
    assert.match(f.screen(), /Queue all stopped/u);
  } finally { f.dispose(); }
});

test('Queue all: Esc at an idle prompt stops a sequence that is waiting, and nothing more runs', async () => {
  const f = fixture();
  try {
    await f.pasteAndEnter(B);
    await f.reviewing();
    f.key({kind: 'text', value: 'q'});
    f.enter(); await settled();
    assert.ok(f.app['batchSequence']);
    f.key({kind: 'escape'});
    assert.match(f.screen(), /Queue all will stop when the command/u);
    assert.match(f.screen(), /Queue all · 1 of 2 · stopping/u);
    f.complete(0);
    f.begin('cd modules/bun-app');
    f.complete(0); await settled();
    assert.deepEqual(f.slashes, [], 'stopped: /modules never ran');
    assert.equal(f.app['batchSequence'], undefined);
  } finally { f.dispose(); }
});

test('Queue all: comment lines before an NMSh command are not sent with it, and it still reaches NMSh', async () => {
  const f = fixture();
  try {
    const source = '# go to the app\ncd modules/bun-app\n# then look at its modules\n/modules';
    await f.pasteAndEnter(source);
    await f.reviewing();
    f.key({kind: 'text', value: 'q'});
    f.enter(); await settled();
    f.complete(0);
    f.begin('cd modules/bun-app');
    f.complete(0); await settled();
    assert.deepEqual(f.slashes, ['/modules'], 'the comment is dropped from the NMSh command, never left to turn it into shell text');
  } finally { f.dispose(); }
});
