import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, processAlive, until} from './helpers/liveFrontend.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';

/**
 * Regression: /caffeinate, /awake and /zoomies are NMSh frontend actions. They
 * start an NMSh-owned background process through the controller and hand the
 * composer straight back; they never run anything in the user's shell, never
 * become the shell's foreground command and never need Ctrl+C to return.
 *
 * The real slash dispatch, controller, ownership record and presentation run;
 * only the backend is the deterministic inert one, so no test ever keeps a
 * machine awake.
 */
const ENV = {NMSH_DETERMINISTIC: '1', NMSH_KEEP_AWAKE_BACKEND: 'inert'};

test('slash Keep Awake runs in the background and the shell stays ready (no Ctrl+C needed)', {timeout: 120_000}, async () => {
  const box = new LiveSandbox({}, ENV);
  const record = join(box.config, 'nmsh', 'keep-awake.json');
  const owned = () => existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) as {pid: number; token: string; mode: string} : undefined;
  try {
    const frontend = box.launch();
    await frontend.waitFor(/❯/u);
    await frontend.run('echo READY', /READY/u);

    // Bare /zoomies only opens the panel: nothing is launched yet.
    let mark = frontend.mark;
    frontend.pty.write('/zoomies\r');
    await frontend.waitFor(/\/caffeinate · \/awake · \/zoomies/u, mark);
    assert.equal(owned(), undefined, 'the panel alone starts no backend');
    frontend.pty.write('\u001b');

    // A start from the slash command returns at once.
    await frontend.run('/zoomies display 1m', /Keep Awake on · Display for 1m/u);
    const first = owned();
    assert.ok(first && processAlive(first.pid), 'an NMSh-owned background process holds the assertion');
    assert.equal(first.mode, 'display');
    // The shell is idle at its prompt: an ordinary command runs and completes right away.
    await frontend.run("printf 'still-responsive\\n'", /still-responsive/u);
    assert.ok(processAlive(first.pid), 'Keep Awake keeps running while the shell works');
    await frontend.waitFor(/Awake · Display/u, 0);

    await frontend.run('/zoomies stop', /Keep Awake stopped \(Display\)/u);
    await until(() => !processAlive(first.pid), 5000, 'the owned process to end');
    assert.equal(owned(), undefined);

    // The panel path: Enter starts, and the composer comes back without Esc or Ctrl+C.
    mark = frontend.mark;
    frontend.pty.write('/awake\r');
    await frontend.waitFor(/\/caffeinate · \/awake · \/zoomies/u, mark);
    mark = frontend.mark;
    frontend.pty.write('\r');
    await frontend.waitFor(/Keep Awake on · Idle/u, mark);
    const second = owned();
    assert.ok(second && processAlive(second.pid));
    await frontend.run("printf 'composer-is-back\\n'", /composer-is-back/u);
    await frontend.run('/awake stop', /Keep Awake stopped \(Idle\)/u);
    await until(() => !processAlive(second.pid), 5000, 'the owned process to end');

    // None of this was a shell command: no journaled caffeinate, no foreground lifecycle.
    const commands = (await box.transcripts().list()).flatMap(session => session.transcript.records).map(item => item.command);
    assert.ok(!commands.some(command => /caffeinate|-e .*nmsh-keep-awake/u.test(command ?? '')), commands.join('\n'));
    assert.ok(commands.includes("printf 'still-responsive\\n'"));
  } finally {
    const left = owned();
    if (left && processAlive(left.pid)) process.kill(left.pid, 'SIGTERM');
    await box.dispose();
  }
});

test('a typed shell caffeinate is an ordinary shell command, never intercepted', () => {
  for (const command of ['caffeinate -i', 'caffeinate', 'caffeinate -d -t 5', 'sudo caffeinate -s']) assert.equal(parseSlashCommand(command), undefined, command);
  for (const command of ['/caffeinate', '/awake display', '/zoomies stop']) assert.equal(parseSlashCommand(command)?.kind, 'keepAwake', command);
});
