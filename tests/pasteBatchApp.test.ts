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

test('Esc, T and E keep the paste as text; nothing is queued', () => {
  for (const choice of ['t', 'e'] as const) {
    const instance = app();
    try {
      instance['handleKey']({kind: 'paste', value: 'ls\npwd'});
      instance['handleKey'](text('b'));
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
