import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {LiveSandbox, strip, until, type Frontend} from './helpers/liveFrontend.js';

/**
 * Queue Mode through the real composer, PTY and session service: lines entered with Enter while `sleep` runs are
 * queued as typed and run after it, once each and in order, with no approval step. A read the shell waits on still
 * gets the answer, and a hidden one is never drawn: Queue Mode changes what Enter does for a command nobody reads,
 * never who owns typing.
 */
const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const supported = process.platform === 'darwin' || process.platform === 'linux';
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));
const SECRET = 'QSECRETQ';

type Shell = 'zsh' | 'bash' | 'fish';

async function start(shell: Shell) {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell, queue: {queueMode: true}},
    shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
  const frontend = sandbox.launch([], {cols: 120, rows: 36});
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
    try { await sandbox.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'queue mode fixture startup and cleanup failed'); }
    throw error;
  }
}

async function type(frontend: Frontend, text: string, gapMs = 25): Promise<void> {
  for (const char of text) { frontend.pty.write(char); await pause(gapMs); }
}

const records = async (sandbox: LiveSandbox) => (await sandbox.transcripts().list()).flatMap(session => session.transcript.records);
const idle = async (sandbox: LiveSandbox) => { const session = (await sandbox.sessions())[0]; return session?.running === undefined && !session?.queued; };

const READS: Record<Shell, {line: string; hidden: string}> = {
  zsh: {line: `read -r QA_REPLY; printf 'ANSWER=%s\\n' "$QA_REPLY"`, hidden: "read -s 'reply?Demo password: '; print; print len=${#reply}"},
  bash: {line: `read -r QA_REPLY; printf 'ANSWER=%s\\n' "$QA_REPLY"`, hidden: "read -rs -p 'Demo password: ' reply; echo; echo len=${#reply}"},
  fish: {line: `read QA_REPLY; printf 'ANSWER=%s\\n' "$QA_REPLY"`, hidden: "read --silent --prompt-str 'Demo password: ' reply; echo len=(string length -- $reply)"},
};

for (const shell of ['zsh', 'bash', 'fish'] as const) {
  const available = supported && (shell === 'zsh' || (shell === 'bash' ? bash : fish));
  test(`live ${shell}: Queue Mode runs lines entered during sleep after it, once each, in order, with no approval`, {skip: available ? false : `${shell} not installed`, timeout: 180_000}, async () => {
    const {sandbox, frontend} = await start(shell);
    try {
      const lines = ['echo "STEP 1 — Starting"', 'sleep 1', 'echo "STEP 2 — Halfway"', 'sleep 1', 'echo "STEP 3 — Finished."'];
      const mark = frontend.mark;
      frontend.pty.write('sleep 4\r');
      await pause(700);
      for (const line of lines) { await type(frontend, line); frontend.pty.write('\r'); await pause(150); }
      await until(async () => (await sandbox.sessions())[0]?.queued === lines.length, 10_000, 'all five lines queued while sleep runs');
      await until(() => idle(sandbox), 20_000, 'the queue drained and the prompt is back');
      const shown = strip(frontend.output.slice(mark));
      assert.doesNotMatch(shown, /Awaiting approval|typed while|Can't tell whether/u, 'no approval or held state');
      // Journal order is not run order; each record says when it started. A record is journaled after its output.
      const after = async () => {
        const ran = (await records(sandbox)).map((record, index) => ({command: record.command.trim(), at: record.startedAt ?? index}))
          .sort((a, b) => a.at - b.at).map(record => record.command);
        return ran.slice(ran.lastIndexOf('sleep 4') + 1);
      };
      await until(async () => (await after()).length >= lines.length, 15_000, 'every queued command journaled');
      assert.deepEqual(await after(), lines, 'each queued line ran once, in the order entered, after sleep');
      const printed = (await records(sandbox)).map(record => strip(record.output ?? '')).join('\n');
      for (const step of ['STEP 1 — Starting', 'STEP 2 — Halfway', 'STEP 3 — Finished.']) assert.equal(printed.split(step).length - 1, 1, `${step} printed once`);
    } finally { await sandbox.dispose(); }
  });

  test(`live ${shell}: Queue Mode still gives a waiting read its answer and never draws a hidden one`, {skip: available ? false : `${shell} not installed`, timeout: 180_000}, async () => {
    const {sandbox, frontend} = await start(shell);
    try {
      for (const reactionMs of [300, 900]) {
        const mark = frontend.mark;
        await type(frontend, READS[shell].line, 5);
        frontend.pty.write('\r');
        await pause(reactionMs);
        await type(frontend, 'hello', 60);
        frontend.pty.write('\r');
        await frontend.waitFor(/ANSWER=hello/u, mark, 10_000);
        await until(() => idle(sandbox), 15_000, `line read after ${reactionMs} ms: back at the prompt`);
        assert.equal((await records(sandbox)).some(record => record.command.trim() === 'hello'), false, `after ${reactionMs} ms: the answer never ran as a command`);
      }
      const mark = frontend.mark;
      await type(frontend, READS[shell].hidden, 5);
      frontend.pty.write('\r');
      await pause(600);
      await type(frontend, SECRET, 60);
      frontend.pty.write('\r');
      await frontend.waitFor(/len=8/u, mark, 10_000);
      await until(() => idle(sandbox), 15_000, 'hidden read: back at the prompt');
      assert.equal(strip(frontend.output.slice(mark)).includes(SECRET), false, 'the hidden answer is never drawn');
      assert.equal((await records(sandbox)).some(record => record.command.includes(SECRET)), false, 'never run as a command');
    } finally { await sandbox.dispose(); }
  });
}

test('live zsh: a line zsh cannot finish (`!"` removes its closing quote) is cancelled, explained and given back; never left waiting', {skip: supported ? false : 'unsupported platform', timeout: 180_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const bang = 'echo "STEP 3 — Finished!"';
    let mark = frontend.mark;
    await type(frontend, bang, 5);
    frontend.pty.write('\r');
    await frontend.waitFor(/was still waiting for the end of this command line/u, mark, 10_000);
    await until(() => idle(sandbox), 10_000, 'the prompt is back');
    assert.match(strip(frontend.output.slice(mark)), /history expansion/u, 'the zsh-specific cause is named');
    assert.doesNotMatch(strip(frontend.output.slice(mark)), /Can't tell whether/u, 'never left as held typing');
    // The line is back in the composer to fix; an ordinary command afterwards runs at once.
    await type(frontend, '\u0015', 5);
    await frontend.run('echo AFTER-BANG', /AFTER-BANG/u);
    // Queued: the earlier entry runs, the unfinished one is cancelled, and the queue pauses before what follows it.
    mark = frontend.mark;
    frontend.pty.write('sleep 6\r');
    await pause(600);
    for (const line of ['echo QUEUED-ONE', bang, 'echo QUEUED-AFTER']) { await type(frontend, line); frontend.pty.write('\r'); await pause(150); }
    await until(async () => (await sandbox.sessions())[0]?.queued === 3, 10_000, 'all three queued while sleep runs');
    await until(async () => (await records(sandbox)).some(record => record.command.trim() === 'echo QUEUED-ONE'), 20_000, 'the first queued entry ran');
    await until(async () => (await sandbox.sessions())[0]?.queued === 1 && (await sandbox.sessions())[0]?.running === undefined, 10_000, 'the cancelled entry left one waiting');
    await pause(1500);
    assert.equal((await records(sandbox)).some(record => record.command.trim() === 'echo QUEUED-AFTER'), false, 'the queue paused after the cancelled line');
  } finally { await sandbox.dispose(); }
});
