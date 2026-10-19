import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, strip, until, type Frontend} from './helpers/liveFrontend.js';

/**
 * Who owns typing while a command runs, through the real composer, PTY and session service, typed at human speed
 * and at no delay at all. A program waiting for input gets the answer; nothing typed for it is queued, run as a
 * shell command, or drawn when hidden. Reads without a prompt (`read -r reply`, `read -k 1`) are found from the
 * shell holding its own terminal; a key typed before any evidence exists waits for an on-demand look.
 */
const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const supported = process.platform === 'darwin' || process.platform === 'linux';
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));
const SECRET = 'QSECRETQ';

type Shell = 'zsh' | 'bash' | 'fish';

async function start(shell: Shell) {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell},
    shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
  const frontend = sandbox.launch([], {cols: 120, rows: 36});
  // Answer the terminal queries Fish's reader waits for, as a real terminal does.
  frontend.pty.onData(data => {
    if (data.includes('\u001b[c') || data.includes('\u001b[0c')) frontend.pty.write('\u001b[?62;22c');
    if (data.includes('\u001b[6n')) frontend.pty.write('\u001b[1;1R');
  });
  try {
    await frontend.waitFor(/zsh|bash|fish/u);
    await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 30_000, 'the first authenticated shell prompt');
    await frontend.run('echo READY', /READY/u);
    return {sandbox, frontend};
  } catch (error) {
    try { await sandbox.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'input ownership fixture startup and cleanup failed'); }
    throw error;
  }
}

/** Type like a person: one key at a time. */
async function type(frontend: Frontend, text: string, gapMs = 60): Promise<void> {
  for (const char of text) { frontend.pty.write(char); await pause(gapMs); }
}

const records = async (sandbox: LiveSandbox) => (await sandbox.transcripts().list()).flatMap(session => session.transcript.records);
const queued = async (sandbox: LiveSandbox) => (await sandbox.sessions())[0]?.queued ?? 0;

interface Read { name: string; command: string; keys: string; enter: boolean; answered: RegExp; secret?: boolean }

const READS: Record<Shell, Read[]> = {
  zsh: [
    {name: 'line without a prompt', command: `read -r QA_REPLY; printf 'ANSWER=%s\\n' "$QA_REPLY"`, keys: 'hello', enter: true, answered: /ANSWER=hello/u},
    {name: 'hidden line', command: "read -s 'reply?Demo password: '; print; print len=${#reply}", keys: SECRET, enter: true, answered: /len=8/u, secret: true},
    {name: 'single key without a prompt', command: 'read -k 1 x; echo; echo got:$x', keys: 'y', enter: false, answered: /got:y/u},
  ],
  bash: [
    {name: 'line without a prompt', command: `read -r QA_REPLY; printf 'ANSWER=%s\\n' "$QA_REPLY"`, keys: 'hello', enter: true, answered: /ANSWER=hello/u},
    {name: 'hidden line', command: "read -rs -p 'Demo password: ' reply; echo; echo len=${#reply}", keys: SECRET, enter: true, answered: /len=8/u, secret: true},
    {name: 'single key without a prompt', command: 'read -n 1 x; echo; echo got:$x', keys: 'y', enter: false, answered: /got:y/u},
  ],
  fish: [
    {name: 'line without a prompt', command: `read QA_REPLY; printf 'ANSWER=%s\\n' "$QA_REPLY"`, keys: 'hello', enter: true, answered: /ANSWER=hello/u},
    {name: 'hidden line', command: "read --silent --prompt-str 'Demo password: ' reply; echo len=(string length -- $reply)", keys: SECRET, enter: true, answered: /len=8/u, secret: true},
  ],
};

for (const shell of ['zsh', 'bash', 'fish'] as const) {
  const available = supported && (shell === 'zsh' || (shell === 'bash' ? bash : fish));
  test(`live ${shell}: a waiting read gets the answer typed at once or after a pause; nothing is queued, run or drawn`, {skip: available ? false : `${shell} not installed`, timeout: 240_000}, async () => {
    const {sandbox, frontend} = await start(shell);
    try {
      for (const reactionMs of [0, 300]) {
        for (const read of READS[shell]) {
          const what = `${read.name} after ${reactionMs} ms`;
          const mark = frontend.mark;
          const before = (await records(sandbox)).filter(entry => entry.command === read.command).length;
          await type(frontend, read.command, 5);
          frontend.pty.write('\r');
          await pause(reactionMs);
          await type(frontend, read.keys);
          if (read.enter) frontend.pty.write('\r');
          await frontend.waitFor(read.answered, mark, 10_000);
          // The answered command completes (its record is journaled after the screen, later on a slower host; Fish's
          // reader has the terminal, so its output is not journaled) and the shell is back at its prompt. Until then
          // the program's output can be on screen while the command still runs, and an Enter then queues, as designed.
          const journaled = async () => (await records(sandbox)).filter(entry => entry.command === read.command);
          if (shell !== 'fish') await until(async () => (await journaled()).length > before, 15_000, `${what}: journaled`);
          await until(async () => (await sandbox.sessions())[0]?.running === undefined, 15_000, `${what}: the shell is back at its prompt`);
          // An ordinary command then runs. Once it has, nothing typed for the program ran as a command or is left queued.
          const tag = `BACK-${reactionMs}-${read.name.length}`;
          await frontend.run(`echo ${tag}`, new RegExp(tag, 'u'));
          const all = await records(sandbox);
          assert.equal(all.some(record => record.command.trim() === read.keys), false, `${what}: the answer never ran as a command`);
          assert.equal(await queued(sandbox), 0, `${what}: nothing was queued`);
          if (read.secret) assert.equal(strip(frontend.output.slice(mark)).includes(SECRET), false, `${what}: the hidden answer is never drawn`);
          // Exactly once, from the journal.
          const record = (await journaled()).at(-1);
          if (shell !== 'fish' && read.keys === 'hello') assert.equal(record?.output.match(/ANSWER=hello/gu)?.length, 1, `${what}: answered exactly once`);
          await pause(400);
        }
      }
    } finally { await sandbox.dispose(); }
  });
}

test('live zsh: Ctrl+Q queues while a read waits, Enter answers it; Enter during sleep or a loop holds the line for approval, never run by itself', {skip: supported ? false : 'unsupported platform', timeout: 180_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    // Ctrl+Q composes a queue entry; the reader never sees it. Enter then answers the reader.
    let mark = frontend.mark;
    frontend.pty.write('read -r reply; echo got=$reply\r');
    await pause(700);
    await type(frontend, 'echo AFTER-READ');
    frontend.pty.write('\u0011');
    await until(async () => await queued(sandbox) === 1, 5000, 'the Ctrl+Q entry to be queued');
    await type(frontend, 'hi');
    frontend.pty.write('\r');
    await frontend.waitFor(/got=hi/u, mark, 10_000);
    await until(async () => (await records(sandbox)).some(record => record.command === 'echo AFTER-READ'), 15_000, 'the queued command to run after the read');
    const all = await records(sandbox);
    assert.equal(all.filter(record => record.command === 'echo AFTER-READ').length, 1, 'the queued command ran once, after');
    assert.equal(all.some(record => record.output.includes('got=echo')), false, 'the queued text never reached the reader');

    // Nothing visibly waits for input, but NMSh cannot know that nothing will read (#426): Enter holds the line for
    // approval, whether typed at once or later. It never runs by itself; approved at the prompt, it runs once.
    for (const [command, entry] of [['sleep 3', 'echo QUEUED-SLEEP'], ['for i in 1 2 3; do sleep 1; done', 'echo QUEUED-LOOP']] as const) {
      mark = frontend.mark;
      frontend.pty.write(`${command}\r`);
      await pause(entry.endsWith('LOOP') ? 1300 : 0);
      await type(frontend, entry);
      frontend.pty.write('\r');
      await until(async () => await queued(sandbox) === 1, 5000, `${entry} to be held`);
      await until(async () => (await records(sandbox)).some(record => record.command === command), 15_000, `${command} to complete`);
      await pause(1500);
      assert.equal((await records(sandbox)).filter(record => record.command === entry).length, 0, `${entry} did not run by itself`);
      const review = frontend.mark;
      frontend.pty.write('\r');
      await frontend.waitFor(/Approve and run this command\?/u, review);
      frontend.pty.write('\r');
      await until(async () => (await records(sandbox)).filter(record => record.command === entry).length === 1, 15_000, `${entry} to run once, approved`);
    }
  } finally { await sandbox.dispose(); }
});

test('live zsh: a command typed right after a read returns, or right after Ctrl+C, reaches the shell once, in order', {skip: supported ? false : 'unsupported platform', timeout: 180_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  const marker = join(sandbox.home, 'once');
  try {
    let mark = frontend.mark;
    frontend.pty.write('read -k 1 x; echo got:$x\r');
    await pause(300);
    frontend.pty.write('y');
    // No pause: the next command follows the answer at typing speed.
    await type(frontend, `echo X >> ${marker}`, 20);
    frontend.pty.write('\r');
    await frontend.waitFor(/got:y/u, mark, 10_000);
    // Entered before the shell's prompt was back, the line was typed while the command ran, so it is held for approval
    // (#426); entered after, it runs. Either way it runs exactly once, never by itself while unverified.
    await until(async () => (await records(sandbox)).some(record => record.command === `echo X >> ${marker}`) || /typed while read ran/u.test(strip(frontend.output.slice(mark))),
      15_000, 'the typed command to run, or to be held');
    if (!(await records(sandbox)).some(record => record.command === `echo X >> ${marker}`)) {
      await until(async () => (await records(sandbox)).some(record => record.command.startsWith('read -k 1')), 15_000, 'the read to complete');
      const review = frontend.mark;
      frontend.pty.write('\r');
      await frontend.waitFor(/Approve and run this command\?/u, review);
      frontend.pty.write('\r');
      await until(async () => (await records(sandbox)).some(record => record.command === `echo X >> ${marker}`), 15_000, 'the approved command to run');
    }
    mark = frontend.mark;
    frontend.pty.write('read -r reply\r');
    await pause(600);
    frontend.pty.write('\u0003');
    await type(frontend, `echo Y >> ${marker}`, 20);
    frontend.pty.write('\r');
    await until(async () => (await records(sandbox)).some(record => record.command === `echo Y >> ${marker}`), 15_000, 'the command after Ctrl+C to run');
    await pause(1000);
    const lines = spawnSync('cat', [marker], {encoding: 'utf8'}).stdout;
    assert.equal(lines, 'X\nY\n', 'each command ran exactly once, in order');
    assert.equal(await queued(sandbox), 0);
  } finally { await sandbox.dispose(); }
});

test('live zsh: a command typed right after Ctrl+C on a waiting question is kept when the prompt returns mid-typing', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  const marker = join(sandbox.home, 'kept');
  try {
    // The question ends 1.5 s after Ctrl+C (its trap), so the prompt comes back while the next command is typed.
    const mark = frontend.mark;
    frontend.pty.write("( trap 'sleep 1.5; exit 130' INT; read -r 'r?Name: ' )\r");
    await frontend.waitFor(/[Ww]aiting for input[\s\S]*Name:/u, mark);
    frontend.pty.write('\u0003');
    await type(frontend, `echo KEPT >> ${marker}`, 70);
    frontend.pty.write('\r');
    await until(() => existsSync(marker), 15_000, 'the command typed after Ctrl+C to run');
    assert.equal(spawnSync('cat', [marker], {encoding: 'utf8'}).stdout, 'KEPT\n');
    assert.doesNotMatch(strip(frontend.output.slice(mark)), /reply was discarded/u, 'it was never taken for a reply');
  } finally { await sandbox.dispose(); }
});

test('live zsh: a program that survives Ctrl+C and asks gets the line typed right after it as its answer; it never runs as a command', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const mark = frontend.mark;
    const command = `bash -c 'trap "" INT; read -r -p "Still-$((1+1))? " a; echo "QA-GOT=$a"'`;
    frontend.pty.write(`${command}\r`);
    await frontend.waitFor(/Still-2\? /u, mark);
    await pause(1200);
    frontend.pty.write('\u0003');
    await type(frontend, 'yes', 20);
    frontend.pty.write('\r');
    await frontend.waitFor(/QA-GOT=yes/u, mark, 15_000);
    await until(async () => (await records(sandbox)).some(record => record.command === command), 15_000, 'the program to finish');
    await pause(1500);
    assert.equal((await records(sandbox)).some(record => record.command === 'yes'), false, 'never run as a command');
  } finally { await sandbox.dispose(); }
});
