import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {describeScreen, LiveSandbox, strip, until, type Frontend} from './helpers/liveFrontend.js';

/**
 * Keys typed right after a `read` must never be lost (the Fish keystroke loss): through the real composer, PTY and
 * session service, with a host that answers terminal queries as a real terminal does. Every iteration types the next
 * command the moment the previous one is shown complete, with no pause; zsh and Bash also type ahead while `read`
 * still runs. Fish is not held to type-ahead during `read`: fish 4 itself drops keys that are already queued when its
 * reader starts a terminal query, with any terminal (see docs/development/fish-typeahead.md).
 *
 * Two outcomes besides running at once are correct, and only for typing ahead while the read's command still runs:
 * - (#426 review, #437) a command typed during a hidden read's answer, when a look still saw hidden input and the
 *   command then ended, may be a reply to a second question with no prompt: held at the prompt, Tab shows it, Enter runs it;
 * - (#426 hardening) a line entered while the command still runs may be a reply to a read NMSh never saw: it waits for
 *   approval (Enter reviews, Enter approves), never run by itself. On Fish the keys reach Fish's reader; those it never
 *   reads are taken back from the terminal when the command ends and wait for approval the same way.
 * Either way it must still run exactly once.
 */

async function showAndRunHeld(frontend: Frontend, mode: string, run: number, next: string, mark: number, queued: boolean): Promise<void> {
  if (queued) {
    assert.ok(mode === 'ahead', `only typing ahead while the read's command runs waits for approval (${mode}${run})`);
    const review = frontend.mark;
    frontend.pty.write('\r');
    await frontend.waitFor(/Approve and run this command\?/u, review, 10_000);
    frontend.pty.write('\r');
    return;
  }
  assert.ok(mode === 'ahead' && run % 2 === 1, `only typing ahead during a hidden read is held (${mode}${run})`);
  assert.equal(new RegExp(`(?<!echo )${next.slice('echo '.length)}`, 'u').test(strip(frontend.output.slice(mark))), false, 'held, it has not run');
  const shown = frontend.mark;
  frontend.pty.write('\t');
  await frontend.waitFor(new RegExp(next.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), shown, 10_000);
  frontend.pty.write('\r');
}
const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const supported = process.platform === 'darwin' || process.platform === 'linux';
const RUNS = 6;
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

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
  fish: (secret: boolean, tag: string) => `read ${secret ? '-s ' : ''}-P (printf 'Name-%s: ' ${tag}) x; echo got=$x`,
  zsh: (secret: boolean, tag: string) => `printf 'Name-%s: ' ${tag}; read ${secret ? '-s ' : ''}x; echo got=$x`,
  bash: (secret: boolean, tag: string) => `printf 'Name-%s: ' ${tag}; read ${secret ? '-s ' : ''}x; echo got=$x`,
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
          const reading = READ[shell](run % 2 === 1, tag);
          frontend.pty.write(`${reading}\r`);
          // zsh and Bash print their prompt from the command text; wait for it past the echo and NMSh's own "Running" line.
          // Each prompt is unique and assembled at runtime: historical redraws and the echoed command cannot satisfy it.
          await frontend.waitFor(new RegExp(`Name-${tag}: `, 'u'), mark);
          // zsh and Bash reads are composer-owned: let NMSh see the question before answering it. While a command runs
          // with no visible question, Enter queues the next command (that is the queue); an answer is only an answer
          // once the question is open.
          if (shell !== 'fish') await frontend.waitFor(new RegExp(`[Ww]aiting for input[^\\n]*[\\s\\S]*Name-${tag}:`, 'u'), mark);
          const next = `echo NEXT-${tag}`;
          const before = await frontend.completions(next);
          frontend.pty.write(`v${tag}\r`);
          if (mode === 'after') await frontend.waitFor(new RegExp(`got=v${tag}[\\s\\S]*Completed`, 'u'), mark);
          frontend.pty.write(`${next}\r`);
          // NMSh's journal records a command once the shell's prompt has returned after it: deterministic, where screen
          // text is not (a redraw repeats older rows and notes; seen in CI on #442 and #457). The read's command ends
          // first; then the next one has run, or is held (in the owner's queue, or at the prompt).
          await until(async () => await frontend.completions(next) > before || await frontend.completions(reading) > 0, 10_000,
            `completed journal for ${reading}`);
          if (await frontend.completions(next) === before) {
            await pause(500);
            // Its output on the screen means it ran; the journal only trails it, longer on a loaded machine. That is not held.
            const ran = () => new RegExp(`(?<!echo )NEXT-${tag}`, 'u').test(strip(frontend.output.slice(mark)));
            if (ran()) await until(async () => await frontend.completions(next) > before, 10_000, `completed journal for ${next}, which ran`);
            else if (await frontend.completions(next) === before) {
              const queued = ((await sandbox.sessions())[0]?.queued ?? 0) > 0;
              await showAndRunHeld(frontend, mode, run, next, mark, queued);
              await until(async () => await frontend.completions(next) > before, 10_000,
                () => `completed journal for ${next} after the person's choice (${queued ? 'queued' : 'held at the prompt'}); the screen since the read began:\n${describeScreen(strip(frontend.output.slice(mark)), ['Approve and run', 'waits for your approval', 'got='])}`);
            }
          }
          assert.equal(await frontend.completions(next), before + 1, 'the next command ran once');
          const drawn = strip(frontend.output.slice(mark));
          assert.match(drawn, new RegExp(`got=v${tag}`, 'u'), 'the answer reached read');
          assert.match(drawn, new RegExp(`(?<!echo )NEXT-${tag}`, 'u'), 'and the next command ran');
        }
      }
    } finally { stop(); await sandbox.dispose(); }
  });
}
