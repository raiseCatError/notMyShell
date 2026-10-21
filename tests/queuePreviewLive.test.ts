import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, strip, until, type Frontend} from './helpers/liveFrontend.js';

/**
 * The queue near the composer, through the real composer, PTY and session service: the expanded list while a command
 * runs, a paused queue resumed from an empty Enter only after an inline review, an entry that asks first approved in
 * place, and the guards: nothing runs from one key, a typed "y" is never an approval, a repeated Enter never runs
 * anything twice, and a program waiting for input always keeps Enter.
 */
const supported = process.platform === 'darwin' || process.platform === 'linux';
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

async function start() {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'}, {});
  const frontend = sandbox.launch([], {cols: 120, rows: 36});
  try {
    await frontend.waitFor(/zsh/u);
    await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 20_000, 'the first prompt');
    await frontend.run('echo READY', /READY/u);
    return {sandbox, frontend};
  } catch (error) {
    try { await sandbox.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'startup and cleanup failed'); }
    throw error;
  }
}

const runs = async (sandbox: LiveSandbox, command: string) =>
  (await sandbox.transcripts().list()).flatMap(session => session.transcript.records).filter(record => record.command === command).length;
const drawn = (frontend: Frontend, from: number) => strip(frontend.output.slice(from));

/** Queue `entries` behind a short sleep; the sleep then fails, so the queue pauses with them waiting. */
async function pausedQueue(frontend: Frontend, entries: string[]) {
  const mark = frontend.mark;
  frontend.pty.write("sleep 2; false\r");
  await frontend.waitFor(/Running sleep 2|[A-Z][a-z]+…/u, mark);
  // Ctrl+Q queues to run after (#426: a plain Enter would hold each for approval).
  for (const entry of entries) frontend.pty.write(`${entry}\u0011`);
  // One plain entry stays the one-line row; more show as the list.
  await frontend.waitFor(new RegExp(`Queue · ${entries.length + 1} commands`, 'u'), mark);
  await frontend.waitFor(/Queue paused: sleep 2; false failed \(exit 1\)\./u, mark, 20_000);
  await frontend.waitFor(/Queue paused · \d+ pending[\s\S]*Enter to review/u, mark);
  return mark;
}

test('live: the running queue shows what runs next and in what order; the pause is said once', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start();
  try {
    const mark = frontend.mark;
    frontend.pty.write('sleep 3\r');
    await frontend.waitFor(/Running sleep 3|[A-Z][a-z]+…/u, mark);
    for (const entry of ['echo Q1', 'echo Q2', 'echo Q3', 'echo Q4']) frontend.pty.write(`${entry}\u0011`);
    // A redraw writes only the rows that changed: each row is checked on its own.
    for (const row of [/Queue · 5 commands/u, /› echo Q1 +Next/u, /echo Q2 +Queued/u, /\+2 more/u]) await frontend.waitFor(row, mark);
    for (const entry of ['echo Q1', 'echo Q2', 'echo Q3', 'echo Q4']) await until(async () => await runs(sandbox, entry) === 1, 15_000, `${entry} once`);
    // One interruption: one transcript notice; the row below carries the state, not the same sentence again.
    const stop = frontend.mark;
    frontend.pty.write('sleep 20\r');
    await frontend.waitFor(/Running sleep 20|[A-Z][a-z]+…/u, stop);
    frontend.pty.write('echo LATER\u0011');
    await frontend.waitFor(/Queue · 2 commands/u, stop);
    frontend.pty.write('\u0003');
    await frontend.waitFor(/Queue paused · 1 waiting|Queue paused · 1 pending/u, stop, 20_000);
    await pause(800);
    const text = drawn(frontend, stop);
    assert.equal(new Set(text.match(/Queue paused: sleep 20 was interrupted\./gu)).size, 1);
    assert.doesNotMatch(text, /Queue paused · sleep 20/u, 'the row does not repeat why');
  } finally { await sandbox.dispose(); }
});

test('live: a paused queue resumes only after an inline review; Esc keeps it paused; Enter pressed again never runs anything twice', {skip: supported ? false : 'unsupported platform', timeout: 150_000}, async () => {
  const {sandbox, frontend} = await start();
  try {
    const marker = join(sandbox.home, 'resumed');
    await pausedQueue(frontend, [`echo X >> ${marker}`]);
    // Enter arms the review; nothing runs yet. Esc leaves everything as it was.
    let mark = frontend.mark;
    frontend.pty.write('\r');
    await frontend.waitFor(/Resume the queue\? 1 pending[\s\S]*Enter resumes · Esc keeps it paused/u, mark);
    await pause(1200);
    assert.equal(existsSync(marker), false, 'one Enter never runs anything');
    frontend.pty.write('\u001b');
    await frontend.waitFor(/Queue paused · 1 pending[\s\S]*Enter to review/u, mark);
    await pause(800);
    assert.equal(existsSync(marker), false, 'Esc keeps it paused');
    // While the review is armed it owns the keys: other text does nothing.
    mark = frontend.mark;
    frontend.pty.write('\r');
    await frontend.waitFor(/Resume the queue\?/u, mark);
    frontend.pty.write('zz');
    await pause(500);
    assert.equal(existsSync(marker), false);
    // Enter confirms, and a burst of Enters after it is not a second run or an answer for anything.
    frontend.pty.write('\r\r\r');
    await until(() => existsSync(marker), 15_000, 'the queue resumes');
    await pause(2000);
    assert.equal(readFileSync(marker, 'utf8'), 'X\n', 'the entry ran exactly once');
    assert.equal((await sandbox.sessions())[0]?.queued ?? 0, 0);
    await frontend.run('echo AFTER', /AFTER/u);
  } finally { await sandbox.dispose(); }
});

test('live: an entry that asks first is approved in place after its review; a typed "y" is a command, "n" pauses so typing runs', {skip: supported ? false : 'unsupported platform', timeout: 150_000}, async () => {
  const {sandbox, frontend} = await start();
  try {
    const approved = join(sandbox.home, 'approved');
    // Queue an entry that asks first, behind a sleep long enough to set it.
    let mark = frontend.mark;
    frontend.pty.write('sleep 4\r');
    await frontend.waitFor(/Running sleep 4|[A-Z][a-z]+…/u, mark);
    frontend.pty.write(`touch ${approved}\u0011`);
    await frontend.waitFor(/Queue · 2 commands/u, mark);
    frontend.pty.write('/queue\r');
    await frontend.waitFor(/Command queue[\s\S]*touch/u, mark);
    frontend.pty.write('w');
    await frontend.waitFor(/runs even after a failure/u, mark);
    frontend.pty.write('w');
    await frontend.waitFor(/asks first/u, mark);
    frontend.pty.write('\u001b');
    await frontend.waitFor(/Awaiting approval[\s\S]*Enter to review/u, mark, 20_000);
    // "y" typed into an empty composer starts a command; it never approves.
    mark = frontend.mark;
    frontend.pty.write('y');
    await pause(600);
    assert.equal(existsSync(approved), false, 'a typed y is not an approval');
    frontend.pty.write('\u0015');
    // Enter reviews the whole command; n declines: nothing runs and the queue pauses, so commands run directly.
    frontend.pty.write('\r');
    await frontend.waitFor(/Approve and run this command\?[\s\S]*touch [\s\S]*Enter or y approves · n not now/u, mark);
    frontend.pty.write('n');
    await frontend.waitFor(/Not approved; the queue is paused, so your commands run directly/u, mark);
    await frontend.run('echo DIRECT', /DIRECT/u);
    assert.equal(existsSync(approved), false);
    // Resume (review, confirm): it asks again; this time y approves exactly that entry.
    mark = frontend.mark;
    frontend.pty.write('\r');
    await frontend.waitFor(/Resume the queue\?/u, mark);
    frontend.pty.write('\r');
    await frontend.waitFor(/Awaiting approval/u, mark, 15_000);
    await frontend.waitFor(/Enter to review/u, mark, 15_000);
    await pause(700);
    frontend.pty.write('\r');
    await frontend.waitFor(/Approve and run this command\?/u, mark);
    frontend.pty.write('y');
    await until(() => existsSync(approved), 15_000, 'the approved entry runs');
    await until(async () => await runs(sandbox, `touch ${approved}`) === 1, 15_000, 'once');
  } finally { await sandbox.dispose(); }
});

test('live: while a program waits for input, Enter answers it; a queued entry that asks first is never approved by it', {skip: supported ? false : 'unsupported platform', timeout: 150_000}, async () => {
  const {sandbox, frontend} = await start();
  try {
    const approved = join(sandbox.home, 'never');
    let mark = frontend.mark;
    frontend.pty.write("read -r 'r?Answer: '; echo got=$r\r");
    await frontend.waitFor(/[Ww]aiting for input[\s\S]*Answer:/u, mark);
    frontend.pty.write(`touch ${approved}\u0011`);
    await until(async () => ((await sandbox.sessions())[0]?.queued ?? 0) === 1, 10_000, 'Ctrl+Q queues');
    frontend.pty.write('/queue\r');
    await frontend.waitFor(/Command queue[\s\S]*touch/u, mark);
    frontend.pty.write('w');
    await frontend.waitFor(/runs even after a failure/u, mark);
    frontend.pty.write('w');
    await frontend.waitFor(/asks first/u, mark);
    frontend.pty.write('\u001b');
    await pause(500);
    // Enter (empty, then with an answer) belongs to the reader.
    mark = frontend.mark;
    frontend.pty.write('yes\r');
    await frontend.waitFor(/got=yes/u, mark);
    await frontend.waitFor(/Awaiting approval/u, mark, 15_000);
    await pause(1500);
    assert.equal(existsSync(approved), false, 'answering the reader never approved the entry');
  } finally { await sandbox.dispose(); }
});
