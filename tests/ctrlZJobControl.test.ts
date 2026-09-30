import test from 'node:test';
import assert from 'node:assert/strict';
import {KeyDecoder, decodeKeys} from '../src/terminal/keys.js';
import {LiveSandbox, until} from './helpers/liveFrontend.js';
import {inForeground, sleepState, stopped, uniqueSleep} from './helpers/processState.js';

test('Ctrl+Z decodes to suspend in raw and Kitty forms without disturbing Ctrl+C/Ctrl+D', () => {
  assert.deepEqual(decodeKeys('\u001a'), [{kind: 'suspend'}]);
  assert.deepEqual(decodeKeys('\u001b[122;5u'), [{kind: 'suspend'}]);
  assert.deepEqual(decodeKeys('\u001b[90;5u'), [{kind: 'suspend'}]);
  assert.deepEqual(decodeKeys('\u0003\u001b[99;5u'), [{kind: 'interrupt'}, {kind: 'interrupt'}]);
  assert.deepEqual(decodeKeys('\u0004\u001b[100;5u'), [{kind: 'eof'}, {kind: 'eof'}]);
  const decoder = new KeyDecoder();
  assert.deepEqual([...decoder.push('\u001b[122'), ...decoder.push(';5u')], [{kind: 'suspend'}]);
});

/**
 * Drive the real frontend in a PTY: terminal bytes -> KeyDecoder -> TerminalApp
 * -> SessionClient -> managed zsh. A direct SessionClient write would bypass the
 * decoder, which is exactly where Ctrl+Z used to disappear.
 */
async function jobControlThroughFrontend(mode: 'service' | 'in-process', ctrlZ: string): Promise<void> {
  // The sandbox's dispose ends every frontend, live shell and service even when an assertion fails.
  const sandbox = new LiveSandbox({}, {NMSH_SESSION_SERVICE: mode === 'service' ? '1' : '0'});
  try {
    const app = sandbox.launch();
    await app.waitFor(/❯/);
    await app.run('echo MODE=$NMSH_SESSION_MODE', new RegExp(`MODE=${mode}`));

    // Idle composer: Ctrl+Z is ignored and leaves the draft intact.
    let mark = app.mark;
    app.pty.write('echo idle');
    app.pty.write(ctrlZ);
    app.pty.write('-kept\r');
    await app.waitFor(/idle-kept/, mark);

    // Wait until the sleep is the terminal's foreground job before Ctrl+Z, instead of guessing a delay.
    const duration = uniqueSleep(`${ctrlZ.length}${mode.length}`);
    app.pty.write(`sleep ${duration}\r`);
    await until(() => inForeground(duration), 20000, 'sleep in the foreground');
    mark = app.mark;
    app.pty.write(ctrlZ);
    await app.waitFor(/suspended/, mark);
    await until(() => stopped(duration), 20000, 'sleep stopped');

    await app.run('jobs', /\[1\][^\n]*suspended[^\n]*sleep 30/);

    mark = app.mark;
    app.pty.write('fg\r');
    await app.waitFor(/continued/, mark);
    await until(() => inForeground(duration), 20000, 'sleep resumed in the foreground');
    mark = app.mark;
    app.pty.write('\u0003');
    // Type the next command only once the job is gone and its prompt is back:
    // the tty flushes input queued around an interrupt.
    await until(() => sleepState(duration) === '', 20000, 'sleep ended');
    await app.waitFor(/Interrupted/, mark);
    await app.run('echo JOBCOUNT=$(jobs | wc -l | tr -d " ")', /JOBCOUNT=0/);

    // Ctrl+D on an empty composer still ends the session and NMSh.
    app.pty.write('\u0004');
    assert.equal(typeof await app.waitExit(), 'number');
  } finally {
    await sandbox.dispose();
  }
}

for (const mode of ['service', 'in-process'] as const) {
  test(`Ctrl+Z suspends the foreground job through the real frontend (${mode}, raw ^Z)`, () => jobControlThroughFrontend(mode, '\u001a'));
  test(`Ctrl+Z suspends the foreground job through the real frontend (${mode}, Kitty CSI-u)`, () => jobControlThroughFrontend(mode, '\u001b[122;5u'));
}
