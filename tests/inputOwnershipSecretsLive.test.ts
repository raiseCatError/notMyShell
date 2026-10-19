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
      frontend.pty.write('first\r');
      // The first read returned; `sleep` runs with the terminal echoing again and nothing asks.
      await pause(400);
      const typed = frontend.mark;
      for (const char of SECRET) { frontend.pty.write(char); await pause(15); }
      frontend.pty.write('\r');
      await frontend.waitFor(/1 queued/u, typed, 10_000);
      // The second read, with no prompt: NMSh reports it, and the entry may be its reply.
      await frontend.waitFor(/asked for hidden input/u, typed, 20_000);
      frontend.pty.write('second\r');
      await frontend.waitFor(/LENGTHS=5\/6/u, mark, 20_000);
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
      assert.match(strip(frontend.output.slice(typed)), /waits for your approval/u);
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
