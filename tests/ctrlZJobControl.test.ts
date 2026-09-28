import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import nodePty from 'node-pty';
import {KeyDecoder, decodeKeys} from '../src/terminal/keys.js';

test('Ctrl+Z decodes to suspend in raw and Kitty forms without disturbing Ctrl+C/Ctrl+D', () => {
  assert.deepEqual(decodeKeys('\u001a'), [{kind: 'suspend'}]);
  assert.deepEqual(decodeKeys('\u001b[122;5u'), [{kind: 'suspend'}]);
  assert.deepEqual(decodeKeys('\u001b[90;5u'), [{kind: 'suspend'}]);
  assert.deepEqual(decodeKeys('\u0003\u001b[99;5u'), [{kind: 'interrupt'}, {kind: 'interrupt'}]);
  assert.deepEqual(decodeKeys('\u0004\u001b[100;5u'), [{kind: 'eof'}, {kind: 'eof'}]);
  const decoder = new KeyDecoder();
  assert.deepEqual([...decoder.push('\u001b[122'), ...decoder.push(';5u')], [{kind: 'suspend'}]);
});

const strip = (value: string) => value.replace(/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\u001b[=>()][0-9A-B]?/g, '');

/**
 * Drive the real frontend in a PTY: terminal bytes -> KeyDecoder -> TerminalApp
 * -> SessionClient -> managed zsh. A direct SessionClient write would bypass the
 * decoder, which is exactly where Ctrl+Z used to disappear.
 */
async function jobControlThroughFrontend(mode: 'service' | 'in-process', ctrlZ: string): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-cz-')));
  const home = join(root, 'h');
  const config = join(root, 'c');
  const runtime = join(root, 'r');
  mkdirSync(home);
  mkdirSync(join(config, 'nmsh'), {recursive: true});
  mkdirSync(runtime, {mode: 0o700});
  chmodSync(runtime, 0o700);
  writeFileSync(join(config, 'nmsh', 'config.json'), JSON.stringify({onboardingComplete: true, glyphChoiceComplete: true, updateChecks: false}));
  const pty = nodePty.spawn(process.execPath, ['--import=tsx', 'src/index.ts'], {
    cwd: process.cwd(), cols: 100, rows: 30,
    env: {...process.env, HOME: home, XDG_CONFIG_HOME: config, NMSH_RUNTIME_DIR: runtime, TERM: 'xterm-256color',
      NMSH_SESSION_SERVICE: mode === 'service' ? '1' : '0', NMSH_ACTIVE: ''},
  });
  let output = '';
  pty.onData(data => { output += data; });
  const exited = new Promise<number>(resolve => pty.onExit(event => resolve(event.exitCode)));
  const waitFor = async (pattern: RegExp, from: number) => {
    const deadline = Date.now() + 20000;
    while (!pattern.test(strip(output.slice(from)))) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${pattern} in ${mode}:\n${strip(output.slice(from)).slice(-1500)}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  try {
    let mark = 0;
    await waitFor(/❯/, mark);
    mark = output.length;
    pty.write('echo MODE=$NMSH_SESSION_MODE\r');
    await waitFor(new RegExp(`MODE=${mode}`), mark);

    // Idle composer: Ctrl+Z is ignored and leaves the draft intact.
    mark = output.length;
    pty.write('echo idle');
    pty.write(ctrlZ);
    pty.write('-kept\r');
    await waitFor(/idle-kept/, mark);

    mark = output.length;
    pty.write('sleep 30\r');
    await waitFor(/sleep 30/, mark);
    await new Promise(resolve => setTimeout(resolve, 500));
    mark = output.length;
    pty.write(ctrlZ);
    await waitFor(/suspended/, mark);

    mark = output.length;
    pty.write('jobs\r');
    await waitFor(/\[1\][^\n]*suspended[^\n]*sleep 30/, mark);

    mark = output.length;
    pty.write('fg\r');
    await waitFor(/continued/, mark);
    await new Promise(resolve => setTimeout(resolve, 300));
    pty.write('\u0003');
    mark = output.length;
    pty.write('echo JOBCOUNT=$(jobs | wc -l | tr -d " ")\r');
    await waitFor(/JOBCOUNT=0/, mark);

    // Ctrl+D on an empty composer still ends the session and NMSh.
    pty.write('\u0004');
    const code = await Promise.race([exited, new Promise<number>((_, reject) => setTimeout(() => reject(new Error('no exit')), 15000))]);
    assert.equal(typeof code, 'number');
  } finally {
    pty.kill();
    rmSync(root, {recursive: true, force: true});
  }
}

for (const mode of ['service', 'in-process'] as const) {
  test(`Ctrl+Z suspends the foreground job through the real frontend (${mode}, raw ^Z)`, () => jobControlThroughFrontend(mode, '\u001a'));
  test(`Ctrl+Z suspends the foreground job through the real frontend (${mode}, Kitty CSI-u)`, () => jobControlThroughFrontend(mode, '\u001b[122;5u'));
}
