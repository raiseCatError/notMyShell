import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ShellSession} from '../src/shell/ShellSession.js';
import type {ShellMarker} from '../src/shell/ShellProtocol.js';
import {ShellProtocolDecoder} from '../src/shell/ShellProtocol.js';
import {shellSubmission} from '../src/shell/submission.js';

/**
 * A command line the shell cannot finish waits at its continuation prompt (PS2), which NMSh draws as nothing: the
 * command looks like it runs forever and typing for it is held. zsh's history expansion turns `echo "Finished!"` into
 * exactly that (`!"` removes the closing quote). The shell's PS2 is a marker: once the shell asks for one more line
 * than the submission's own line breaks explain, the session cancels the line (nothing of it ran) and its next prompt
 * says so. A multi-line submission's own continuation prompts are expected and never cancel it.
 */

const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const supported = process.platform === 'darwin' || process.platform === 'linux';

test('decoder: a continue marker is its own event; other payloads are unchanged', () => {
  const decoder = new ShellProtocolDecoder('tok');
  assert.deepEqual(decoder.push('a\u001b]777;nmsh;tok;continue\u0007b'), [{kind: 'data', data: 'a'}, {kind: 'continue'}, {kind: 'data', data: 'b'}]);
});

async function withShell(shell: 'zsh' | 'bash', body: (session: ShellSession, next: () => Promise<ShellMarker>, outputs: string[]) => Promise<void>) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-incomplete-')));
  const env = {...process.env, HOME: home, ...(shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {})};
  const session = new ShellSession(home, 80, 24, home, env, shell);
  const prompts: ShellMarker[] = [];
  const waiters: Array<(marker: ShellMarker) => void> = [];
  const outputs: string[] = [];
  session.on('prompt', marker => { const waiter = waiters.shift(); if (waiter) waiter(marker); else prompts.push(marker); });
  session.on('data', data => outputs.push(data));
  const next = () => new Promise<ShellMarker>((resolve, reject) => {
    const queued = prompts.shift();
    if (queued) { resolve(queued); return; }
    const timer = setTimeout(() => reject(new Error('no prompt within 10 s')), 10_000);
    waiters.push(marker => { clearTimeout(timer); resolve(marker); });
  });
  try {
    await next();
    await body(session, next, outputs);
  } finally {
    session.kill();
    rmSync(home, {recursive: true, force: true});
  }
}

test('live zsh: `echo "Finished!"` is cancelled at the continuation prompt and reported; nothing hangs, nothing ran', {skip: supported ? false : 'unsupported platform', timeout: 60_000}, async () => {
  await withShell('zsh', async (session, next, outputs) => {
    session.submit(shellSubmission('echo "STEP 3 — Finished!"', 'zsh'));
    const marker = await next();
    assert.equal(marker.incomplete, true, 'the prompt says the line was incomplete');
    assert.equal(outputs.join('').includes('STEP 3'), false, 'nothing of it ran');
    // The shell is an ordinary prompt again: the next command runs and is not incomplete.
    session.submit(shellSubmission('echo AFTER', 'zsh'));
    const after = await next();
    assert.equal(after.incomplete, undefined);
    assert.equal(after.exitCode, 0);
    assert.match(outputs.join(''), /AFTER/u);
  });
});

test('live zsh and bash: a multi-line submission\'s own continuation prompts never cancel it; an unclosed quote does', {skip: supported ? false : 'unsupported platform', timeout: 90_000}, async () => {
  for (const shell of ['zsh', ...(bash ? ['bash' as const] : [])] as const) {
    await withShell(shell, async (session, next, outputs) => {
      session.submit(shellSubmission("printf 'ONE\\n'\nprintf 'TWO\\n'\ncat <<EOF\nTHREE\nEOF", shell));
      const block = await next();
      assert.equal(block.incomplete, undefined, `${shell}: a complete block runs`);
      assert.equal(block.exitCode, 0, `${shell}: and succeeds`);
      assert.match(outputs.join(''), /ONE[\s\S]*TWO[\s\S]*THREE/u, `${shell}: every line ran`);
      session.submit(shellSubmission('echo "never closed', shell));
      const open = await next();
      assert.equal(open.incomplete, true, `${shell}: an unclosed quote is reported`);
      assert.equal(outputs.join('').includes('never closed'), false, `${shell}: and never ran`);
    });
  }
});

/** Complete constructs whose own line breaks ask for continuation lines: each must run, never be cancelled. */
const COMPLETE: Array<{text: string; expect: RegExp}> = [
  {text: "cat <<'EOF'\nit's \"half-quoted\nEOF", expect: /it's "half-quoted/u},
  {text: 'cat <<EOF\n$(echo NESTED-SUB)\nEOF', expect: /NESTED-SUB/u},
  {text: 'echo "LINE-ONE\nLINE-TWO"', expect: /LINE-ONE\r?\nLINE-TWO/u},
  {text: 'echo ESC \\\nAPED', expect: /ESC APED/u},
  {text: 'nmsh_f() {\n  echo FUNC-BODY\n}\nnmsh_f', expect: /FUNC-BODY/u},
  {text: 'echo $(\n  echo MULTI-SUB\n)', expect: /MULTI-SUB/u},
  {text: "echo 'Single Done!'", expect: /Single Done!/u},
  {text: 'if true; then\n\n  echo BLANK-LINE-IF\nfi', expect: /BLANK-LINE-IF/u},
];
/** Lines the shell can never finish: cancelled, and nothing of them runs. */
const UNFINISHED = ['echo $(echo NEVER-SUB', 'cat <<EOF\nNEVER-HEREDOC', 'nmsh_g() {\n  echo NEVER-FUNC', 'echo "NEVER-QUOTE\nstill open', 'echo NEVER-ESCAPED \\'];

test('live zsh and bash: heredocs, nested quotes, escaped newlines, functions and substitutions run; only unfinished lines are cancelled', {skip: supported ? false : 'unsupported platform', timeout: 180_000}, async () => {
  for (const shell of ['zsh', ...(bash ? ['bash' as const] : [])] as const) {
    await withShell(shell, async (session, next, outputs) => {
      for (const {text, expect} of COMPLETE) {
        const from = outputs.length;
        session.submit(shellSubmission(text, shell));
        const marker = await next();
        assert.equal(marker.incomplete, undefined, `${shell}: ${JSON.stringify(text)} is complete and is not cancelled`);
        assert.equal(marker.exitCode, 0, `${shell}: ${JSON.stringify(text)} succeeds`);
        assert.match(outputs.slice(from).join(''), expect, `${shell}: ${JSON.stringify(text)} ran`);
      }
      for (const text of UNFINISHED) {
        const from = outputs.length;
        session.submit(shellSubmission(text, shell));
        const marker = await next();
        assert.equal(marker.incomplete, true, `${shell}: ${JSON.stringify(text)} is reported unfinished`);
        assert.doesNotMatch(outputs.slice(from).join(''), /NEVER-/u, `${shell}: nothing of ${JSON.stringify(text)} ran`);
        // The very next command is an ordinary one: no leftover continuation state swallows or cancels it.
        session.submit(shellSubmission('echo AFTER-UNFINISHED', shell));
        const after = await next();
        assert.equal(after.incomplete, undefined, `${shell}: the command after ${JSON.stringify(text)} is not cancelled`);
        assert.match(outputs.slice(from).join(''), /AFTER-UNFINISHED/u);
      }
    });
  }
});

test('queue: an entry the shell could not finish pauses what follows, whatever the failure policy; nothing else is sent', async () => {
  const {CommandQueue} = await import('../src/session/CommandQueue.js');
  const {QueueDispatcher} = await import('../src/session/QueueDispatcher.js');
  for (const policy of ['pause', 'continue'] as const) {
    const submitted: string[] = [];
    const queue = new CommandQueue(() => 1);
    const dispatcher = new QueueDispatcher({isReady: true, adapter: {id: 'zsh'}, submit: (text: string) => { submitted.push(text); }}, queue);
    dispatcher.request({op: 'failure-policy', policy} as never);
    dispatcher.onExec('sleep 2');
    for (const text of ['echo ONE', 'echo "bang!"', 'echo AFTER']) dispatcher.request({op: 'add', text});
    dispatcher.onPrompt(0);
    dispatcher.onExec('echo ONE');
    dispatcher.onPrompt(0);
    assert.deepEqual(submitted, ['echo ONE', 'echo "bang!"'], `${policy}: the unfinished entry was sent`);
    dispatcher.onPrompt(130, 5, {incomplete: true});
    assert.deepEqual(submitted, ['echo ONE', 'echo "bang!"'], `${policy}: nothing after it was sent`);
    assert.deepEqual(queue.state.paused, {reason: 'failed', at: 5, command: 'echo "bang!"', exitCode: 130}, `${policy}: the queue says why it waits`);
    assert.deepEqual(queue.state.entries.map(entry => entry.text), ['echo AFTER']);
  }
});
