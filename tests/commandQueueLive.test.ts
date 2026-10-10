import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {LiveSandbox, strip, until, type Frontend} from './helpers/liveFrontend.js';

/**
 * The command queue through the real composer, PTY and session service, with harmless commands only (sleep, echo,
 * cd, touch inside the sandbox). Entries run in the session's own shell, in order, after the shell's own prompt.
 */
const ASKYN = resolve('tests/fixtures/askyn.py');
const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const python = spawnSync('python3', ['-c', 'import termios'], {encoding: 'utf8'}).status === 0;
const supported = process.platform === 'darwin' || process.platform === 'linux';
type Shell = 'zsh' | 'bash' | 'fish';

async function start(shell: Shell, options: {size?: {cols: number; rows: number}; env?: Record<string, string>} = {}) {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell},
    shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
  const frontend = sandbox.launch([], options.size ?? {cols: 100, rows: 30}, options.env ?? {});
  try {
    await frontend.waitFor(/notMyShell|zsh|bash|fish/u);
    await frontend.run('echo READY', /READY/u);
  } catch (error) {
    // A start that never became ready is not inside the test's try/finally: end its processes here, or they keep
    // the test file (and the suite) running.
    await sandbox.dispose().catch(() => {});
    throw error;
  }
  return {sandbox, frontend};
}

const drawn = (frontend: Frontend, from: number) => strip(frontend.output.slice(from));
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

const SET_STATE: Record<Shell, string[]> = {
  zsh: ['cd sub', 'export QUEUE_VAR=kept', 'qfn() { echo "fn-$1" }', 'setopt nullglob'],
  bash: ['cd sub', 'export QUEUE_VAR=kept', 'qfn() { echo "fn-$1"; }', 'shopt -s nullglob'],
  fish: ['cd sub', 'set -gx QUEUE_VAR kept', 'function qfn; echo "fn-$argv[1]"; end', 'set -g fish_queue_opt on'],
};
const CHECK_STATE: Record<Shell, string> = {
  zsh: 'echo "STATE $(basename $PWD) $QUEUE_VAR $(qfn x) $([[ -o nullglob ]] && echo opt)"',
  bash: 'echo "STATE $(basename $PWD) $QUEUE_VAR $(qfn x) $(shopt -q nullglob && echo opt)"',
  fish: 'echo "STATE "(basename $PWD)" $QUEUE_VAR "(qfn x)" $fish_queue_opt"',
};

for (const shell of ['zsh', 'bash', 'fish'] as const) {
  const available = supported && (shell === 'zsh' || (shell === 'bash' ? bash : fish));
  test(`live ${shell}: Enter while a command runs queues; entries run in order in the same shell, keeping its state`, {skip: available ? false : `${shell} not installed`, timeout: 120_000}, async () => {
    const {sandbox, frontend} = await start(shell);
    try {
      await frontend.run('mkdir -p sub', /❯/u);
      const mark = frontend.mark;
      frontend.pty.write('sleep 3\r');
      await frontend.waitFor(/Running sleep 3/u, mark);
      for (const line of [...SET_STATE[shell], CHECK_STATE[shell]]) {
        frontend.pty.write(`${line}\r`);
        await pause(80);
      }
      await frontend.waitFor(/≡ Queued \(5\) · next: cd sub/u, mark);
      assert.match(drawn(frontend, mark), /Enter queues the next command · Ctrl\+S sends to sleep/u, 'the empty composer says what Enter does');
      await frontend.waitFor(/STATE sub kept fn-x (?:opt|on)/u, mark, 30_000);
      const commands = ['sleep 3', ...SET_STATE[shell], CHECK_STATE[shell]];
      const records = async () => (await sandbox.transcripts().list()).flatMap(session => session.transcript.records).filter(record => commands.includes(record.command));
      await until(async () => (await records()).length >= commands.length, 20_000, 'every command recorded');
      const recorded = (await records()).reverse();
      assert.deepEqual(recorded.map(record => record.command), commands, 'in order, each once');
      assert.deepEqual(recorded.map(record => /from queue/u.test(record.lifecycleText)), [false, true, true, true, true, true],
        `queued commands say so: ${recorded.map(record => record.lifecycleText).join(' | ')}`);
      assert.doesNotMatch(drawn(frontend, mark), /command not found: (?:cd|export|qfn)/u, 'nothing reached sleep as input or ran early');
    } finally { await sandbox.dispose(); }
  });
}

test('live: a failed command pauses the queue with its reason; nothing after it runs until resumed or cleared', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const marker = join(sandbox.home, 'deployed');
    const mark = frontend.mark;
    frontend.pty.write(`sh -c 'sleep 1; exit 3'\r`);
    await frontend.waitFor(/Running sh -c/u, mark);
    frontend.pty.write(`touch ${marker}\r`);
    await frontend.waitFor(/Queue paused: sh -c 'sleep 1; exit 3' failed \(exit 3\)\. 1 waiting · \/queue to resume or clear/u, mark, 20_000);
    await frontend.waitFor(/⏸ Queue paused · sh -c 'sleep 1; exit 3' failed \(exit 3\) · 1 waiting/u, mark);
    await pause(1500);
    assert.equal(existsSync(marker), false, 'the follow-up did not run blindly');
    // A command typed at the prompt still runs at once; the paused queue keeps waiting.
    await frontend.run('echo DIRECT', /DIRECT/u);
    assert.equal(existsSync(marker), false);
    const resume = frontend.mark;
    frontend.pty.write('/queue resume\r');
    await frontend.waitFor(/Queue resumed; 1 will run in order/u, resume);
    await until(() => existsSync(marker), 15_000, 'the resumed entry runs');
    await frontend.waitFor(/from queue/u, resume);
  } finally { await sandbox.dispose(); }
});

test('live: a program waiting for a line gets Enter; Ctrl+Q queues; Ctrl+S sends to a program NMSh cannot see waiting', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    let mark = frontend.mark;
    frontend.pty.write(`read 'x?Name: '; echo got=$x\r`);
    await frontend.waitFor(/[◆◇] (?:Probably w|W)aiting for input[\s\S]*Name:/u, mark);
    await frontend.waitFor(/Enter answers zsh · Ctrl\+Q queues a command/u, mark);
    frontend.pty.write('echo QUEUED-AFTER-READ\u0011');
    await frontend.waitFor(/≡ 1 queued|≡ Queued \(1\)/u, mark);
    frontend.pty.write('alice\r');
    await frontend.waitFor(/got=alice[\s\S]*QUEUED-AFTER-READ/u, mark, 20_000);
    assert.doesNotMatch(drawn(frontend, mark), /got=echo/u, 'the queued command never reached read');

    // cat reads stdin with no prompt: NMSh cannot tell it waits, so Enter queues; Ctrl+S sends the line to cat.
    mark = frontend.mark;
    frontend.pty.write('cat\r');
    await frontend.waitFor(/Running cat/u, mark);
    frontend.pty.write('to-cat');
    await frontend.waitFor(/❯ to-cat/u, mark);
    // After Ctrl+S: the terminal's echo of the line, then cat's own copy of it (composer redraws may sit between).
    const sent = frontend.mark;
    frontend.pty.write('\u0013');
    await frontend.waitFor(/to-cat[\s\S]*to-cat/u, sent);
    frontend.pty.write('\u0004');
    await frontend.waitFor(/Completed/u, mark);
  } finally { await sandbox.dispose(); }
});

test('live: a reply typed at a fresh prompt goes to the program before any probe looks; it is never queued or run', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const mark = frontend.mark;
    // The prompt is assembled at run time, so only the program's own question matches (not the echoed command).
    frontend.pty.write(`p=Pass; sleep 0.3; read -s "x?\${p}word: "; echo; echo "len=\${#x}"\r`);
    await frontend.waitFor(/Password: /u, mark);
    // At once: no input probe has run yet, only the question on the program's line is evidence.
    frontend.pty.write('hunter2\r');
    await frontend.waitFor(/len=7[\s\S]*Completed/u, mark, 20_000);
    await pause(800);
    const painted = drawn(frontend, mark);
    assert.doesNotMatch(painted, /≡ (?:\d+ q|Queued)/u, 'the reply was never queued');
    assert.doesNotMatch(painted, /hunter2/u, 'the hidden reply was never shown or run');
    const records = (await sandbox.transcripts().list()).flatMap(session => session.transcript.records);
    assert.equal(records.some(record => record.command.includes('hunter2')), false, 'never recorded as a command');
  } finally { await sandbox.dispose(); }
});

test('live: during single-key input, Ctrl+Q composes a queue entry the program never sees; Esc returns keys to it', {skip: supported && python ? false : 'python3 with termios not available', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const mark = frontend.mark;
    frontend.pty.write(`python3 ${ASKYN} 'Fix<y>? '\r`);
    await frontend.waitFor(/◆ Waiting for input[\s\S]*Ctrl\+Q queues a command/u, mark);
    frontend.pty.write('\u0011');
    await frontend.waitFor(/Queue a command · Enter adds it · Esc returns to the program/u, mark);
    frontend.pty.write('echo AFTER-ASKYN\r');
    await frontend.waitFor(/≡ 1 queued/u, mark);
    frontend.pty.write('y');
    await frontend.waitFor(/ANSWERS=yes[\s\S]*AFTER-ASKYN/u, mark, 20_000);
    assert.doesNotMatch(drawn(frontend, mark), /ANSWERS=[^\n]*,/u, 'exactly one key reached the program');
  } finally { await sandbox.dispose(); }
});

test('live: Ctrl+C pauses what was queued behind the interrupted command', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const marker = join(sandbox.home, 'after-interrupt');
    const mark = frontend.mark;
    frontend.pty.write('sleep 30\r');
    await frontend.waitFor(/Running sleep 30/u, mark);
    frontend.pty.write(`touch ${marker}\r`);
    await frontend.waitFor(/≡ Queued \(1\)/u, mark);
    frontend.pty.write('\u0003');
    await frontend.waitFor(/Queue paused: sleep 30 was interrupted/u, mark, 20_000);
    await pause(1000);
    assert.equal(existsSync(marker), false);
    const clear = frontend.mark;
    frontend.pty.write('/queue clear\r');
    await frontend.waitFor(/Cleared 1 queued command; none of them ran\./u, clear);
  } finally { await sandbox.dispose(); }
});

test('live: after Ctrl+Z or Ctrl+C, what you type next is for the shell prompt, not a queue entry', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const mark = frontend.mark;
    frontend.pty.write('sleep 177\r');
    await frontend.waitFor(/Running sleep 177/u, mark);
    // Typed at once, before NMSh sees the prompt the stop brings back (as the GNU screen test does).
    frontend.pty.write('\u001a');
    frontend.pty.write('jobs\r');
    await frontend.waitFor(/suspended\s+sleep 177[\s\S]*suspended\s+sleep 177/u, mark, 20_000);
    await frontend.run('kill %1; echo JOB-GONE', /JOB-GONE/u);
    frontend.pty.write('sleep 178\r');
    await frontend.waitFor(/Running sleep 178/u, mark);
    frontend.pty.write('\u0003');
    frontend.pty.write('echo AFTER-STOP\r');
    await frontend.waitFor(/AFTER-STOP[\s\S]*Completed/u, mark, 20_000);
    assert.doesNotMatch(drawn(frontend, mark), /Queue paused/u, 'nothing typed after a stop was held as a queue entry');
  } finally { await sandbox.dispose(); }
});

test('live: a program that survives Ctrl+C gets ordinary routing again: later typing queues, it is never sent into the program', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const mark = frontend.mark;
    // Ignores SIGINT and keeps reading stdin: anything sent to it would be echoed back as GOT=...
    frontend.pty.write(`sh -c 'trap "" INT; sleep 5; if read -t 1 line; then echo "GOT=$line"; fi; echo SURVIVED'\r`);
    await frontend.waitFor(/Running sh -c/u, mark);
    frontend.pty.write('\u0003');
    await pause(2600);
    frontend.pty.write('echo LATER\r');
    await frontend.waitFor(/≡ Queued \(1\) · next: echo LATER/u, mark);
    await frontend.waitFor(/SURVIVED[\s\S]*LATER/u, mark, 20_000);
    assert.doesNotMatch(drawn(frontend, mark), /GOT=echo LATER/u, 'nothing typed after the window reached the program');
  } finally { await sandbox.dispose(); }
});

test('live: a multi-line paste queues as one entry and runs once, as one block', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh');
  try {
    const mark = frontend.mark;
    frontend.pty.write('sleep 5\r');
    await frontend.waitFor(/Running sleep 5/u, mark);
    frontend.pty.write('\u001b[200~for i in 1 2; do\n  echo "LINE-$i"\ndone\u001b[201~');
    // NMSh's paste review comes first; Enter inserts the paste into the composer, and only the next Enter queues it.
    await frontend.waitFor(/Enter insert · R review · Esc cancel/u, mark);
    frontend.pty.write('\r');
    await frontend.waitFor(/❯ for i in 1 2; do/u, mark);
    await pause(300);
    assert.doesNotMatch(drawn(frontend, mark), /≡ Queued/u, 'a paste never queues by itself');
    frontend.pty.write('\r');
    await frontend.waitFor(/≡ Queued \(1\) · next: for i in 1 2; do \(\+2 lines\)/u, mark);
    await frontend.waitFor(/LINE-1[\s\S]*LINE-2[\s\S]*from queue/u, mark, 20_000);
    assert.equal(drawn(frontend, mark).match(/LINE-1/gu)?.length, 1, 'it ran exactly once');
  } finally { await sandbox.dispose(); }
});

test('live: the queue belongs to the session: it survives detach and reattach and runs in its own shell', {skip: supported ? false : 'unsupported platform', timeout: 150_000}, async () => {
  const {sandbox, frontend: first} = await start('zsh');
  try {
    const marker = join(sandbox.home, 'ran-detached');
    const mark = first.mark;
    first.pty.write('sleep 4\r');
    await first.waitFor(/Running sleep 4/u, mark);
    first.pty.write(`touch ${marker}\r`);
    first.pty.write('sleep 6\r');
    await first.waitFor(/≡ Queued \(2\)/u, mark);
    const [session] = await sandbox.sessions();
    first.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions()).find(item => item.id === session!.id)?.state === 'detached', 15_000, 'detached');
    // The queue keeps running while no window is attached.
    await until(() => existsSync(marker), 20_000, 'the first entry ran while detached');
    const back = sandbox.launch(['--attach', session!.id]);
    await back.waitFor(/Running sleep 6|Completed[\s\S]*from queue/u, 0, 30_000);
    await back.waitFor(/sleep 6[\s\S]*from queue/u, 0, 30_000);
  } finally { await sandbox.dispose(); }
});

test('live: narrow, NO_COLOR and Safe glyphs keep the queue legible', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const {sandbox, frontend} = await start('zsh', {size: {cols: 40, rows: 18}, env: {NO_COLOR: '1', NMSH_ICONS: 'safe'}});
  try {
    const mark = frontend.mark;
    frontend.pty.write('sleep 3\r');
    await frontend.waitFor(/Running/u, mark);
    frontend.pty.write('echo NARROW-QUEUED\r');
    // 40 columns: the entry's text is cut to fit, never wrapped into the composer.
    await frontend.waitFor(/= Queued \(1\) · next: echo NARR/u, mark);
    assert.doesNotMatch(drawn(frontend, mark), /≡|⏸/u, 'Safe glyphs only');
    await frontend.waitFor(/NARROW-QUEUED[\s\S]*from queue/u, mark, 20_000);
  } finally { await sandbox.dispose(); }
});
