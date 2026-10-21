import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

/**
 * The Arcade over a real command, through the real composer, PTY and session service: the command keeps running and
 * finishes normally, every game key stays in the Arcade, and the transcript is intact afterwards.
 */
const supported = process.platform === 'darwin' || process.platform === 'linux';
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** CPU seconds the process has used so far (ps cputime is [[dd-]hh:]mm:ss.ff). */
const cpuSeconds = (pid: number) => execFileSync('ps', ['-o', 'cputime=', '-p', String(pid)], {encoding: 'utf8'}).trim().split(/[-:]/u).map(Number).reduce((total, part) => total * 60 + part, 0);
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

test('live zsh: play over a running command; it finishes unharmed, the toast appears, no game key reaches the shell', {skip: supported ? false : 'needs a POSIX PTY', timeout: 150_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const frontend = sandbox.launch([], {cols: 100, rows: 30}, {});
  try {
    await frontend.waitFor(/notMyShell|zsh/u);
    await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 20_000, 'the shell authenticated prompt');
    await frontend.run('echo READY', /READY/u);
    const before = (await sandbox.sessions())[0]!;
    const release = join(sandbox.home, 'arcade-release');
    const pidFile = join(sandbox.home, 'arcade-pid');
    // Bursty output, a file gate, then output with a clear-screen and cursor-home sequence that arrives while the Arcade is open.
    const holding = `sh -c 'echo $$ > "$2"; i=0; while [ $i -lt 400 ]; do printf "burst line %s\\n" $i; i=$((i+1)); done; printf "HELD-%s\\n" ON; until test -f "$1"; do sleep 0.05; done; printf "\\033[2J\\033[HLATE-%s\\n" OUT; printf "RAN-%s\\n" OK' nmsh-fixture "${release}" "${pidFile}"`;
    const mark = frontend.mark;
    frontend.pty.write(`${holding}\r`);
    await frontend.waitFor(/HELD-ON/u, mark);
    await until(async () => existsSync(pidFile), 5_000, 'the command pid');
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    assert.ok(alive(pid), 'the command runs');

    const arcadeMark = frontend.mark;
    frontend.pty.write('\u0014');
    await frontend.waitFor(/Vespyr Arcade/u, arcadeMark);
    await frontend.waitFor(/sh running/u, arcadeMark);
    await pause(700);
    const playMark = frontend.mark;
    assert.ok(alive(pid), 'opening the Arcade did not touch the command');
    assert.equal((await sandbox.sessions())[0]!.id, before.id, 'the same session');
    assert.equal((await sandbox.sessions())[0]!.pid, before.pid, 'the same shell service process');

    // Play, with every key that means something to a shell or a queue.
    for (const keys of ['\r', ' ', 'y', 'a', 'hunter2', '\r', '\u0011', '\u0013', ' ', '\r', 'rm -rf nothing', '\r']) { frontend.pty.write(keys); await pause(40); }
    assert.ok(alive(pid), 'game keys did not stop it');

    writeFileSync(release, 'go');
    await frontend.waitFor(/sh finished/u, playMark);
    await until(async () => !alive(pid), 10_000, 'the command to end');
    assert.doesNotMatch(strip(frontend.output.slice(playMark)), /LATE-OUT|RAN-OK/u, 'shell output, even a clear-screen, never reached the Arcade\'s screen');
    assert.match(strip(frontend.output.slice(arcadeMark)), /Vespyr Arcade|Vespyr|Arcade/u, 'the Arcade stayed open');

    // Back to the shell: Ctrl+C leaves the Arcade only.
    const backMark = frontend.mark;
    frontend.pty.write('\u0003');
    await frontend.waitFor(/RAN-OK/u, backMark);
    await frontend.run('echo AFTER-ARCADE', /AFTER-ARCADE/u);
    const everything = strip(frontend.output);
    assert.doesNotMatch(everything, /command not found|hunter2: /u, 'nothing typed in the game ran in the shell');
    assert.equal(await frontend.completions('hunter2'), 0);
    assert.equal(await frontend.completions('rm -rf nothing'), 0);
    assert.equal((await sandbox.sessions())[0]!.pid, before.pid, 'still the same shell');
  } finally { await sandbox.dispose(); }
});

test('live zsh: while the Arcade is open over a chatty command, the host never sees a shell frame', {skip: supported ? false : 'needs a POSIX PTY', timeout: 120_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const frontend = sandbox.launch([], {cols: 100, rows: 30}, {});
  try {
    await frontend.waitFor(/notMyShell|zsh/u);
    await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 20_000, 'the shell authenticated prompt');
    await frontend.run('echo READY', /READY/u);
    const mark = frontend.mark;
    frontend.pty.write(`sh -c 'i=0; while [ $i -lt 60 ]; do printf "tick %s\\\\n" $i; i=$((i+1)); sleep 0.1; done; printf "CHATTY-%s\\\\n" END'\r`);
    await frontend.waitFor(/tick 1\b/u, mark);
    const open = frontend.mark;
    frontend.pty.write('\u0014');
    await frontend.waitFor(/running/u, open);
    await pause(900);                       // the entry transition is over
    const steady = frontend.mark;
    frontend.pty.write('\r');               // start a game
    const cpuBefore = cpuSeconds(frontend.pty.pid);
    await pause(3000);                      // many output chunks, activity ticks and presentation frames
    const cpuUsed = cpuSeconds(frontend.pty.pid) - cpuBefore;
    console.log(`arcade over chatty command: ${cpuUsed.toFixed(2)} CPU s in 3 s, ${frontend.output.length - steady} host bytes`);
    assert.ok(cpuUsed < 2.0, `the frontend used ${cpuUsed}s of CPU in 3s`);
    const during = strip(frontend.output.slice(steady));
    assert.doesNotMatch(during, /Ctrl\+Q runs it after|Enter holds it for approval|current command|tick \d+/u, 'no shell frame or output reached the host while the Arcade was open');
    // Redraw volume stays small: a quiet game over three seconds is not a stream of full-screen repaints.
    assert.ok(frontend.output.length - steady < 400_000, `host bytes while open: ${frontend.output.length - steady}`);
    frontend.pty.write('\u0003');
    await frontend.waitFor(/CHATTY-END|tick \d+/u, steady);
  } finally { await sandbox.dispose(); }
});

test('live zsh: typing /games over a running command offers the Arcade; Enter opens it, Esc cancels, nothing is queued or run', {skip: supported ? false : 'needs a POSIX PTY', timeout: 120_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const frontend = sandbox.launch([], {cols: 100, rows: 30}, {});
  try {
    await frontend.waitFor(/notMyShell|zsh/u);
    await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined), 20_000, 'the shell authenticated prompt');
    await frontend.run('echo READY', /READY/u);
    const release = join(sandbox.home, 'offer-release');
    const mark = frontend.mark;
    frontend.pty.write(`sh -c 'printf "OFFER-%s\\\\n" HOLD; until test -f "$1"; do sleep 0.05; done; printf "OFFER-%s\\\\n" DONE' nmsh-fixture "${release}"\r`);
    await frontend.waitFor(/OFFER-HOLD/u, mark);
    await pause(600);
    // Esc first: nothing opens, nothing is left in the composer.
    const escMark = frontend.mark;
    frontend.pty.write('/games');
    await frontend.waitFor(/Open Arcade while the command runs\? Enter Open · Esc Cancel/u, escMark);
    frontend.pty.write('\u001b');
    await pause(400);
    assert.doesNotMatch(strip(frontend.output.slice(escMark)), /Vespyr Arcade/u, 'Esc opened nothing');
    // Enter: opens at once.
    const openMark = frontend.mark;
    frontend.pty.write('/games');
    await frontend.waitFor(/Open Arcade while the command runs\?/u, openMark);
    await pause(400);                       // read it
    frontend.pty.write('\r');
    await frontend.waitFor(/Vespyr Arcade/u, openMark);
    await frontend.waitFor(/nmsh-fixture running|sh running/u, openMark);
    writeFileSync(release, 'go');
    await frontend.waitFor(/finished/u, openMark);
    frontend.pty.write('\u0003');
    await frontend.waitFor(/OFFER-DONE/u, openMark);
    await frontend.run('echo AFTER-OFFER', /AFTER-OFFER/u);
    assert.equal(await frontend.completions('/games'), 0, '/games never reached the shell as a command');
    assert.doesNotMatch(strip(frontend.output), /command not found: \/?games|no such file or directory: \/games/iu);
    assert.equal((await sandbox.sessions()).length, 1);
  } finally { await sandbox.dispose(); }
});
