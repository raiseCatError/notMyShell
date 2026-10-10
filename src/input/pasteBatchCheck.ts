import {spawn} from 'node:child_process';
import {shellSubmission} from '../shell/submission.js';
import type {BatchShell} from './pasteBatch.js';

/**
 * The final gate for a paste split into commands: the real shell, in parse-only mode (`bash -n`, `zsh -n`,
 * `fish --no-execute`: it reads and checks syntax and never runs anything), must accept EACH command on its own,
 * exactly as it would be submitted. A boundary the splitter drew through a quote, a group, a block or a heredoc
 * leaves a fragment the shell rejects, so the split is refused instead of shown.
 *
 * This does not decide what a command does, only that the pieces are whole. It fails closed: a shell that cannot
 * be started, or that takes too long, means "not verified".
 */
const COMMAND: Record<BatchShell, string[]> = {
  bash: ['bash', '--noprofile', '--norc', '-n'],
  zsh: ['zsh', '-f', '-n'],
  fish: ['fish', '--no-config', '--no-execute'],
};
const TIMEOUT_MS = 4000;
const CONCURRENCY = 8;

export type BatchCheck = {ok: true} | {ok: false; reason: string};

function parses(shell: BatchShell, command: string): Promise<'yes' | 'no' | 'unavailable'> {
  return new Promise(resolve => {
    const [file, ...args] = COMMAND[shell];
    let settled = false;
    const finish = (result: 'yes' | 'no' | 'unavailable') => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    let child;
    try { child = spawn(file!, args, {stdio: ['pipe', 'ignore', 'ignore']}); }
    catch { resolve('unavailable'); return; }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish('unavailable'); }, TIMEOUT_MS);
    child.once('error', () => finish('unavailable'));
    child.once('close', code => finish(code === 0 ? 'yes' : 'no'));
    child.stdin.once('error', () => { /* the shell may exit before reading it all; its status decides */ });
    child.stdin.end(`${shellSubmission(command)}\n`);
  });
}

export async function verifyCommands(commands: readonly string[], shell: BatchShell): Promise<BatchCheck> {
  let next = 0;
  let failure: BatchCheck | undefined;
  const worker = async () => {
    while (!failure) {
      const index = next++;
      if (index >= commands.length) return;
      const result = await parses(shell, commands[index]!);
      if (result === 'no') failure ??= {ok: false, reason: `Command ${index + 1} is not complete ${shell} syntax by itself, so the paste was not split.`};
      else if (result === 'unavailable') failure ??= {ok: false, reason: `${shell} could not be asked to check the commands, so the paste was not split.`};
    }
  };
  await Promise.all(Array.from({length: Math.min(CONCURRENCY, commands.length)}, worker));
  return failure ?? {ok: true};
}
