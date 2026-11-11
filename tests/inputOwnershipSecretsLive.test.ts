import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

/**
 * #426 review, through the real composer, PTY, session service and shell: a command reads a password, works with the
 * terminal echoing, then reads a second password with no prompt. The second reply, typed and entered before that
 * question exists, can only be queued (nothing asked yet; documented limit). Once the command asks for hidden input the
 * entry waits for approval: when the command succeeds it never runs, so the password reaches neither NMSh's journal nor
 * the shell's own history file, and the shell never reports it as a command.
 */
const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const supported = process.platform === 'darwin' || process.platform === 'linux';
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));
const SECRET = 'QZSECRETZQ';

/** The shell's history written as each command is entered, so the test reads exactly what the shell recorded. */
const HISTORY = {
  zsh: ['.zshrc', '.zhist', 'HISTFILE=~/.zhist\nHISTSIZE=1000\nSAVEHIST=1000\nsetopt INC_APPEND_HISTORY\n'],
  bash: ['.bashrc', '.bhist', 'HISTFILE=~/.bhist\nshopt -s histappend\nPROMPT_COMMAND="history -a${PROMPT_COMMAND:+; $PROMPT_COMMAND}"\n'],
} as const;

for (const shell of ['zsh', 'bash'] as const) {
  const available = supported && (shell === 'zsh' || bash);
  test(`live ${shell}: a reply entered before a second hidden question with no prompt never runs as a command or reaches history`, {skip: available ? false : `${shell} not available`, timeout: 120_000}, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell}, shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
    const [rc, histfile, content] = HISTORY[shell];
    writeFileSync(join(sandbox.home, rc), content);
    const frontend = sandbox.launch([], {cols: 120, rows: 36});
    try {
      await frontend.waitFor(/zsh|bash/u);
      await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 30_000, 'the first prompt');
      await frontend.run('echo READY', /READY/u);
      const mark = frontend.mark;
      const command = 'read -rs a; sleep 3; read -rs b; echo "LENGTHS=${#a}/${#b}"';
      frontend.pty.write(`${command}\r`);
      await frontend.waitFor(/[Ww]aiting for input/u, mark, 20_000);
      const firstQuestion = (await sandbox.sessions())[0]?.inputSince;
      frontend.pty.write('first\r');
      // The first read returned; `sleep` runs with the terminal echoing again and nothing asks.
      await pause(400);
      const typed = frontend.mark;
      for (const char of SECRET) { frontend.pty.write(char); await pause(15); }
      frontend.pty.write('\r');
      await frontend.waitFor(/Can.t tell whether read is reading your typing/u, typed, 10_000);
      assert.equal((await sandbox.sessions())[0]?.queued ?? 0, 0, 'an early password is not an approval entry');
      const held = frontend.mark;
      // The second read, with no prompt: NMSh reports it, and the entry may be its reply.
      await until(async () => { const current = (await sandbox.sessions())[0]; return current?.inputMode === 'hidden' && current.inputSince !== firstQuestion; }, 20_000, 'the second hidden reader');
      assert.equal(strip(frontend.output.slice(held)).includes(SECRET), false, 'late hidden input never reveals the capture');
      frontend.pty.write('\u0013');
      await frontend.waitFor(/LENGTHS=5\/10/u, mark, 20_000);
      const records = async () => (await sandbox.transcripts().list()).flatMap(session => session.transcript.records);
      await until(async () => (await records()).some(record => record.command === command), 15_000, 'the command to complete');
      // Anything that would run after it has had time to start.
      await pause(2500);
      assert.equal((await records()).some(record => record.command?.includes(SECRET)), false, 'never run: not in NMSh\'s journal');
      assert.doesNotMatch(strip(frontend.output.slice(typed)), new RegExp(`${SECRET}[^\\n]*(?:not found|No such)|(?:not found|No such)[^\\n]*${SECRET}`, 'u'),
        'the shell never saw it as a command');
      const history = readFileSync(join(sandbox.home, histfile), 'utf8');
      assert.match(history, /echo READY/u, 'the shell records history here');
      assert.equal(history.includes(SECRET), false, 'not in the shell\'s history');
      assert.equal((await sandbox.sessions())[0]?.queued ?? 0, 0);
    } finally { await sandbox.dispose(); }
  });

  test(`live ${shell}: a password typed before the program prints its prompt is never left one Enter from running`, {skip: available ? false : `${shell} not available`, timeout: 120_000}, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell}, shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
    const [rc, histfile, content] = HISTORY[shell];
    writeFileSync(join(sandbox.home, rc), content);
    const frontend = sandbox.launch([], {cols: 120, rows: 36});
    try {
      await frontend.waitFor(/zsh|bash/u);
      await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 30_000, 'the first prompt');
      await frontend.run('echo READY', /READY/u);
      const mark = frontend.mark;
      // As sudo does: a moment's work, then a prompt and a read with echo off.
      const command = `sh -c 'sleep 1; printf "QA-%s: " Password; stty -echo; IFS= read -r pw; stty echo; printf "\\nLEN=%s\\n" "\${#pw}"'`;
      frontend.pty.write(`${command}\r`);
      await pause(300);
      // Typed before the prompt exists (no Enter): NMSh can only draw it, as a terminal would echo it.
      for (const char of SECRET) { frontend.pty.write(char); await pause(15); }
      await frontend.waitFor(/QA-Password: /u, mark, 20_000);
      await frontend.waitFor(/[Ww]aiting for input/u, mark, 20_000);
      // From here on the earlier typing must never be drawn again, and it must end up held, not in the composer.
      const asked = frontend.mark;
      for (const char of 'answer') { frontend.pty.write(char); await pause(15); }
      frontend.pty.write('\r');
      await frontend.waitFor(/LEN=6/u, mark, 20_000);
      const records = async () => (await sandbox.transcripts().list()).flatMap(session => session.transcript.records);
      await until(async () => (await records()).some(record => record.command === command), 15_000, 'the command to complete');
      await frontend.waitFor(/held, not run · Tab shows it · Esc discards it/u, asked, 10_000);
      // An Enter at the prompt does not run what was typed before the question.
      frontend.pty.write('\r');
      await pause(2500);
      assert.equal((await records()).some(record => record.command?.includes(SECRET)), false, 'never run: not in NMSh\'s journal');
      assert.equal(strip(frontend.output.slice(asked)).includes(SECRET), false, 'never drawn again once the program asked');
      const history = readFileSync(join(sandbox.home, histfile), 'utf8');
      assert.match(history, /echo READY/u, 'the shell records history here');
      assert.equal(history.includes(SECRET), false, 'not in the shell\'s history');
    } finally { await sandbox.dispose(); }
  });
}

/**
 * #426, live: a reply typed and entered before a timed read with no prompt asks (here a program's read, which macOS
 * cannot report at all). The read gives up and the command succeeds. The line used to run as a command; whatever it
 * looks like (a secret, `ls`, an assignment), it now waits for approval and never runs by itself. A command queued
 * with Ctrl+Q, the explicit run-after, still runs after it.
 */
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const perl = ['/usr/bin/perl', '/opt/homebrew/bin/perl', '/usr/local/bin/perl'].find(existsSync);
for (const shell of ['zsh', 'bash', 'fish'] as const) {
  const available = supported && Boolean(perl) && (shell === 'zsh' || (shell === 'bash' ? bash : fish));
  test(`live ${shell}: a reply entered before a timed read nobody saw: the read gives up, the command succeeds; never run, whatever it looks like; Ctrl+Q still runs`, {skip: available ? false : `${shell} or perl not available`, timeout: 120_000}, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell}, shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
    if (shell !== 'fish') { const [rc, , content] = HISTORY[shell]; writeFileSync(join(sandbox.home, rc), content); }
    const frontend = sandbox.launch([], {cols: 120, rows: 36});
    // Answer the terminal queries Fish's reader waits for, as a real terminal does.
    frontend.pty.onData(data => {
      if (data.includes('\u001b[c') || data.includes('\u001b[0c')) frontend.pty.write('\u001b[?62;22c');
      if (data.includes('\u001b[6n')) frontend.pty.write('\u001b[1;1R');
    });
    try {
      await frontend.waitFor(/zsh|bash|fish/u);
      await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 30_000, 'the first prompt');
      await frontend.run('echo READY', /READY/u);
      const records = async () => (await sandbox.transcripts().list()).flatMap(session => session.transcript.records);
      const reading = `sleep 2; ${perl} -e 'alarm 1; <STDIN>'; true`;
      // The control's command reads nothing: where the platform reports the read (Linux), every entry typed during a
      // command that asked waits for approval by design, a Ctrl+Q command too.
      const quiet = 'sleep 2; true';
      // The Ctrl+Q control first: an entry left waiting for approval would hold anything queued after it. The replies
      // that follow look like a password, a command and an assignment; none may run.
      const replies = [SECRET, 'ls', 'QA_ASSIGNED=1'];
      for (const [index, [typed, runs, command]] of ([['echo QA-NEXT-RAN', true, quiet], ...replies.map(reply => [reply, false, reading])] as Array<[string, boolean, string]>).entries()) {
        const ran = async () => (await records()).filter(record => record.command === command).length;
        const mark = frontend.mark;
        const before = await ran();
        frontend.pty.write(`${command}\r`);
        await pause(500);
        for (const char of typed) { frontend.pty.write(char); await pause(15); }
        frontend.pty.write(runs ? '\u0011' : '\r');
        await frontend.waitFor(runs ? /1 (?:queued|waiting)/u : /Can.t tell whether sleep is reading your typing|Typed while sleep ran[^\n]*held, not run/u, mark, 10_000);
        await until(async () => await ran() === before + 1, 20_000, 'the command to complete');
        if (runs) {
          await until(async () => (await records()).some(record => record.command === typed), 15_000, 'the real command to run after it');
          continue;
        }
        // Anything that would run after it has had time to start.
        await pause(2500);
        assert.equal((await records()).some(record => record.command === typed), false, `${typed}: never run, not in NMSh's journal`);
        assert.match(strip(frontend.output.slice(mark)), /held, not run/u);
        assert.equal((await sandbox.sessions())[0]?.queued ?? 0, 0);
        assert.doesNotMatch(strip(frontend.output.slice(mark)), new RegExp(`${SECRET}[^\\n]*(?:not found|No such|Unknown command)|(?:not found|No such|Unknown command)[^\\n]*${SECRET}`, 'u'),
          'the shell never saw it as a command');
        frontend.pty.write('\u001b[27u'); // Explicitly discard this capture before the next independent case.
        if (shell !== 'fish') {
          const history = readFileSync(join(sandbox.home, HISTORY[shell][1]), 'utf8').split('\n');
          assert.equal(history.some(line => line.replace(/^: \d+:\d+;/u, '') === typed), false, `${typed}: not in the shell's history`);
        }
      }
    } finally { await sandbox.dispose(); }
  });
}
