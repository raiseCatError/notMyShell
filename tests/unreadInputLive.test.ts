import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ShellSession} from '../src/shell/ShellSession.js';
import {shellAdapter} from '../src/shell/adapters/registry.js';
import {SHELL_IDS, type ShellId} from '../src/shell/adapters/ShellAdapter.js';
import {markFishCompletionsGenerated} from '../scripts/test-shell-home.mjs';
import {unreadLines} from '../src/session/QueueDispatcher.js';

/**
 * #426 hardening, real shells: bytes NMSh delivered to a program (an answer, keys in a program's own interface) that
 * the program never read are still in the terminal when its command ends. A terminal hands them to the shell, which
 * would run a complete line as a command and glue a partial one onto the next. The shell's first prompt hook now takes
 * them out of the terminal and gives them to NMSh (`unread`), which holds them for approval; the shell never reads them.
 */

const available = (id: ShellId) => Boolean(shellAdapter(id).resolveExecutable(process.env));
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

async function start(id: ShellId, rc?: [string, string]) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), `nmsh-unread-${id}-`)));
  markFishCompletionsGenerated(home);
  if (rc) writeFileSync(join(home, rc[0]), rc[1]);
  const shell = new ShellSession(home, 100, 30, home, {...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'}, id);
  const state = {shell, home, execs: [] as string[], unread: [] as string[], output: ''};
  shell.on('exec', command => state.execs.push(command));
  shell.on('unread', text => state.unread.push(text));
  shell.on('data', data => { state.output += data; });
  await once(shell, 'prompt');
  return Object.assign(state, {dispose: () => { shell.kill(); rmSync(home, {recursive: true, force: true}); }});
}

async function run(shell: ShellSession, command: string, during?: () => Promise<void>) {
  const done = once(shell, 'prompt');
  shell.submit(command);
  if (during) await during();
  await done;
}

for (const id of SHELL_IDS) {
  test(`live ${id}: typing a command never read, a whole line and a partial one, is held at its end: never run, never glued to the next command`, {skip: !available(id) && `${id} is not installed`, timeout: 60_000}, async () => {
    const s = await start(id);
    try {
      await run(s.shell, 'sleep 1', async () => {
        await pause(300);
        s.shell.write('echo QZ-RAN\r');
        s.shell.write('QZSECRET');
      });
      // As the terminal delivered them (it turns Enter into a newline): handed to NMSh whole.
      assert.deepEqual(s.unread.flatMap(unreadLines), ['echo QZ-RAN', 'QZSECRET']);
      await run(s.shell, 'echo NEXT-$((40+2))'.replace('$((40+2))', id === 'fish' ? '(math 40+2)' : '$((40+2))'));
      assert.deepEqual(s.execs.filter(command => /QZ/u.test(command)), [], 'the shell never ran it');
      assert.match(s.output, /NEXT-42/u, 'the next command runs whole');
      assert.doesNotMatch(s.output, /QZSECRETecho|command not found|Unknown command/u);
    } finally { s.dispose(); }
  });

  test(`live ${id}: an answer a program reads is its own; nothing is held`, {skip: !available(id) && `${id} is not installed`, timeout: 60_000}, async () => {
    const s = await start(id);
    try {
      await run(s.shell, 'read x; echo GOT=$x', async () => { await pause(800); s.shell.write('ans\r'); });
      assert.match(s.output, /GOT=ans/u);
      assert.deepEqual(s.unread, []);
    } finally { s.dispose(); }
  });
}

for (const id of ['zsh', 'bash'] as const) {
  const rc: [string, string] = id === 'zsh'
    ? ['.zshrc', 'autoload -Uz add-zsh-hook\nqz_slow() { sleep 1 }\nadd-zsh-hook precmd qz_slow\n']
    : ['.bashrc', 'PROMPT_COMMAND="sleep 1"\n'];
  test(`live ${id}: input that arrives once the command is done (its prompt hooks still run) is never written to the terminal; it is held`, {skip: !available(id) && `${id} is not installed`, timeout: 60_000}, async () => {
    const s = await start(id, rc);
    try {
      await run(s.shell, 'true', async () => { await pause(500); s.shell.write('echo QZ-LATE\r'); });
      assert.deepEqual(s.unread.flatMap(unreadLines), ['echo QZ-LATE']);
      await run(s.shell, 'echo NEXT');
      assert.deepEqual(s.execs.filter(command => /QZ/u.test(command)), []);
    } finally { s.dispose(); }
  });
}
