import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

/**
 * #443, live: Fish's own output (its builtins write it, in its own process) arrives whole while NMSh's chrome changes
 * as commands start and end. Fish 3 does not retry a terminal write that SIGWINCH interrupts and prints "write:
 * Interrupted system call" instead; NMSh used to resize the shell's terminal on each such change. On Fish 4 (which
 * retries) and on zsh or Bash this passes either way; it is the Fish 3.7 CI loop that tells the builds apart.
 */
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const supported = process.platform === 'darwin' || process.platform === 'linux';
const COMMANDS = 12;
const LINES = 400;

test('live fish: builtin output arrives whole across many command starts and ends; no interrupted write', {skip: supported && fish ? false : 'fish not installed', timeout: 240_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'fish'});
  const frontend = sandbox.launch([], {cols: 100, rows: 30});
  frontend.pty.onData(data => {
    if (data.includes('\u001b[c') || data.includes('\u001b[0c')) frontend.pty.write('\u001b[?62;22c');
    if (data.includes('\u001b[6n')) frontend.pty.write('\u001b[1;1R');
  });
  try {
    await frontend.waitFor(/fish/u);
    await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 30_000, 'the first prompt');
    await frontend.run('echo READY', /READY/u);
    for (let run = 0; run < COMMANDS; run += 1) {
      const mark = frontend.mark;
      const command = `for i in (seq ${LINES}); echo OUT-${run}-$i; end; echo END-${run}`;
      const before = await frontend.completions(command);
      frontend.pty.write(`${command}\r`);
      await until(async () => await frontend.completions(command) > before, 30_000, `command ${run} to complete`);
      const records = (await sandbox.transcripts().list()).flatMap(session => session.transcript.records).filter(record => record.command === command);
      const output = records.at(-1)?.output ?? strip(frontend.output.slice(mark));
      const seen = new Set(output.match(new RegExp(`OUT-${run}-\\d+`, 'gu')) ?? []);
      assert.equal(seen.size, LINES, `command ${run}: every line of Fish's own output arrived`);
      assert.doesNotMatch(output, /Interrupted system call/u);
    }
  } finally { await sandbox.dispose(); }
});
