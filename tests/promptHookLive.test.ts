import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

/**
 * #436: after a command ends the shell runs its prompt hooks (the person's own and NMSh's) before it reports its
 * prompt. A slow hook holds the terminal, idle, exactly as a builtin `read` does, and the input watch used to report
 * it as the finished command waiting for a line: a draft typed meanwhile was then taken for a reply and discarded
 * when the prompt came (or, after Ctrl+C, lost in the shell). The shell now says the command is done as its first
 * hook, and nothing after that is read as the command's input.
 */
const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const supported = process.platform === 'darwin' || process.platform === 'linux';
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

/** A prompt hook of the person's that holds the shell, idle, for 2 s once ~/slow exists (startup stays fast). */
const SLOW_HOOK = {
  zsh: ['.zshrc', 'zmodload zsh/zselect\nnmsh_test_slow() { [[ -f ~/slow ]] && zselect -t 200; return 0 }\nprecmd_functions+=(nmsh_test_slow)\n'],
  bash: ['.bashrc', 'mkfifo ~/.slow-wait 2>/dev/null; exec 9<>~/.slow-wait\nnmsh_test_slow() { [[ -f ~/slow ]] && read -t 2 -u 9; return 0; }\nPROMPT_COMMAND=nmsh_test_slow\n'],
} as const;

for (const shell of ['zsh', 'bash'] as const) {
  const available = supported && (shell === 'zsh' || bash);
  test(`live ${shell}: a slow prompt hook is never taken for the command reading input; a draft typed during it survives`, {skip: available ? false : `${shell} not available`, timeout: 120_000}, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell}, shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
    const [file, content] = SLOW_HOOK[shell];
    writeFileSync(join(sandbox.home, file), content);
    const frontend = sandbox.launch([], {cols: 120, rows: 36});
    try {
      await frontend.waitFor(/zsh|bash/u);
      await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 30_000, 'the first prompt');
      await frontend.run('echo READY', /READY/u);
      writeFileSync(join(sandbox.home, 'slow'), '');
      const mark = frontend.mark;
      frontend.pty.write('true\r');
      // The command ends at once; the hook then holds the shell for 2 s. Give the watch time to look during it.
      await pause(900);
      for (const char of 'echo NEXT-HOOK') { frontend.pty.write(char); await pause(20); }
      await until(async () => (await sandbox.sessions())[0]?.running === undefined, 15_000, 'the prompt after the slow hook');
      await pause(400);
      const shown = strip(frontend.output.slice(mark));
      assert.doesNotMatch(shown, /[Ww]aiting for input/u, 'the shell running its own hook is not the command waiting');
      assert.doesNotMatch(shown, /reply was discarded/u, 'the draft was never taken for a reply');
      frontend.pty.write('\r');
      await frontend.waitFor(/NEXT-HOOK/u, mark, 15_000);
      await until(async () => (await sandbox.transcripts().list()).flatMap(session => session.transcript.records)
        .filter(record => record.command === 'echo NEXT-HOOK').length === 1, 15_000, 'the draft to run once');
    } finally { await sandbox.dispose(); }
  });
}

for (const shell of ['zsh', 'bash'] as const) {
  const available = supported && (shell === 'zsh' || bash);
  test(`live ${shell}: a command typed and entered during a slow prompt hook runs once at the prompt, never held or lost (#426, #436)`, {skip: available ? false : `${shell} not available`, timeout: 120_000}, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell}, shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
    const [file, content] = SLOW_HOOK[shell];
    writeFileSync(join(sandbox.home, file), content);
    const frontend = sandbox.launch([], {cols: 120, rows: 36});
    try {
      await frontend.waitFor(/zsh|bash/u);
      await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 30_000, 'the first prompt');
      await frontend.run('echo READY', /READY/u);
      writeFileSync(join(sandbox.home, 'slow'), '');
      const mark = frontend.mark;
      frontend.pty.write('true\r');
      // The shell's done marker comes at once; the hook then holds the prompt for 2 s.
      await pause(700);
      for (const char of 'echo DURING-HOOK') { frontend.pty.write(char); await pause(20); }
      frontend.pty.write('\r');
      await until(async () => (await sandbox.transcripts().list()).flatMap(session => session.transcript.records)
        .filter(record => record.command === 'echo DURING-HOOK').length === 1, 15_000, 'the line to run once at the prompt');
      const shown = strip(frontend.output.slice(mark));
      assert.doesNotMatch(shown, /never runs by itself|waits for your approval/u, 'begun after the command was done: not held');
      assert.doesNotMatch(shown, /(?<!e)cho DURING|command not found/u, 'whole, never split');
    } finally { await sandbox.dispose(); }
  });
}
