import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {LiveSandbox, strip, until, type Frontend} from './helpers/liveFrontend.js';

/**
 * Keys typed right after a `read` must never be lost (the Fish keystroke loss): through the real composer, PTY and
 * session service, with a host that answers terminal queries as a real terminal does. Every iteration types the next
 * command the moment the previous one is shown complete, with no pause; zsh and Bash also type ahead while `read`
 * still runs. Fish is not held to type-ahead during `read`: fish 4 itself drops keys that are already queued when its
 * reader starts a terminal query, with any terminal (see docs/development/fish-typeahead.md).
 */
const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const supported = process.platform === 'darwin' || process.platform === 'linux';
const RUNS = 6;

/** Answers device attributes and cursor position the way a terminal does: after it has read the query. */
function answerQueries(frontend: Frontend): () => void {
  let seen = frontend.mark;
  const timer = setInterval(() => {
    const fresh = frontend.output.slice(seen);
    seen = frontend.output.length;
    for (const match of fresh.matchAll(/\u001b\[(0?c|6n)/gu)) frontend.pty.write(match[1] === '6n' ? '\u001b[1;1R' : '\u001b[?62;22c');
  }, 20);
  return () => clearInterval(timer);
}

const READ = {
  // The prompt is built by the shell, so "Name: " is not in the command text that NMSh itself echoes and shows while it runs.
  fish: (secret: boolean) => `read ${secret ? '-s ' : ''}-P (printf 'Na%s: ' me) x; echo got=$x`,
  zsh: (secret: boolean) => `read ${secret ? '-s ' : ''}'x?Name: '; echo got=$x`,
  bash: (secret: boolean) => `read ${secret ? '-s ' : ''}-p 'Name: ' x; echo got=$x`,
};

for (const shell of ['fish', 'zsh', 'bash'] as const) {
  const available = supported && (shell === 'zsh' || (shell === 'bash' ? bash : fish));
  test(`live ${shell}: keys typed the moment a read finishes are never lost${shell === 'fish' ? '' : ', nor keys typed ahead during it'}`, {skip: available ? false : `${shell} not installed`, timeout: 240_000}, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell}, shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
    const frontend = sandbox.launch([], {cols: 100, rows: 30});
    const stop = answerQueries(frontend);
    try {
      await frontend.waitFor(/notMyShell|fish|zsh|bash/u);
      await frontend.run('echo READY', /READY/u);
      const modes = shell === 'fish' ? ['after'] : ['after', 'ahead'];
      for (const mode of modes) {
        for (let run = 0; run < RUNS; run += 1) {
          const tag = `${mode}${run}`;
          const mark = frontend.mark;
          frontend.pty.write(`${READ[shell](run % 2 === 1)}\r`);
          // zsh and Bash print their prompt from the command text; wait for it past the echo and NMSh's own "Running" line.
          await until(() => frontend.output.slice(mark).split('Name: ').length > (shell === 'fish' ? 1 : 2), 15_000, `${shell} draws the read prompt`);
          // zsh and Bash reads are composer-owned: let NMSh see the question before answering it. While a command runs
          // with no visible question, Enter queues the next command (that is the queue); an answer is only an answer
          // once the question is open.
          if (shell !== 'fish') await frontend.waitFor(/[Ww]aiting for input/u, mark);
          frontend.pty.write(`v${tag}\r`);
          if (mode === 'after') await frontend.waitFor(new RegExp(`got=v${tag}[\\s\\S]*Completed`, 'u'), mark);
          frontend.pty.write(`echo NEXT-${tag}\r`);
          await frontend.waitFor(new RegExp(`NEXT-${tag}[\\s\\S]*Completed`, 'u'), mark, 10_000);
          assert.match(strip(frontend.output.slice(mark)), new RegExp(`got=v${tag}`, 'u'), 'the answer reached read');
        }
      }
    } finally { stop(); await sandbox.dispose(); }
  });
}
