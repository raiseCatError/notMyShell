import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fullscreenFailure} from './helpers/fullscreenFailure.js';
import {fullscreenFixture} from './helpers/fullscreenFixture.js';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

test('fullscreen fixture repaints the latest size when WINCH arrives during an older external size sample', async () => {
  const sandbox = new LiveSandbox();
  try {
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    const bin = join(sandbox.home, 'bin');
    const sample = join(sandbox.home, 'sample');
    const release = join(sandbox.home, 'release');
    const armed = join(sandbox.home, 'armed');
    const progress = join(sandbox.home, 'loops');
    const stop = join(sandbox.home, 'stop');
    mkdirSync(bin);
    const stty = process.platform === 'darwin' ? '/bin/stty' : '/usr/bin/stty';
    // Only the fixture's explicit size query is held; bootstrap termios calls
    // still use real stty. Sampling precedes the gate, as it can under load.
    writeFileSync(join(bin, 'stty'), [
      '#!/bin/bash',
      `if [ "$#" != 1 ] || [ "$1" != size ]; then exec ${stty} "$@"; fi`,
      `size=$(${stty} size)`,
      `if [ "$size" = '32 90' ] && [ -f ${quote(armed)} ]; then`,
      `  printf '%s' "$size" > ${quote(sample)}`,
      `  while [ ! -f ${quote(release)} ]; do sleep 0.01; done`,
      `fi`,
      `printf '%s\\n' "$size"`,
    ].join('\n'), {mode: 0o700});
    const fixture = join(sandbox.home, 'fullscreen.zsh');
    writeFileSync(fixture, fullscreenFixture(stop, progress));
    const first = sandbox.launch([], undefined, {PATH: `${bin}:${process.env.PATH}`});
    await first.waitFor(/❯/);
    first.pty.write(`zsh ${fixture}\r`);
    await first.waitFor(/TRAP-READY/);
    const {id, pid} = (await sandbox.sessions())[0]!;
    first.pty.kill('SIGKILL');
    await until(async () => (await sandbox.sessions())[0]?.state === 'detached', 15000, 'fixture detach');
    const second = sandbox.launch(['--attach', id], {cols: 90, rows: 33});
    await second.waitFor(/REDRAW 33 90/);
    await until(() => existsSync(progress), 15000, 'fixture main loop');
    const loop = Number(readFileSync(progress, 'utf8'));
    await until(() => Number(readFileSync(progress, 'utf8')) > loop, 15000, 'trap completion and main-loop continuation');
    writeFileSync(armed, '');
    second.pty.resize(90, 32);
    await until(() => existsSync(sample), 15000, 'held external size sample');
    assert.equal(readFileSync(sample, 'utf8'), '32 90');
    second.pty.resize(90, 33);
    let lastObservation = '';
    await until(async () => {
      const current = await fullscreenFailure(sandbox, id, pid, second);
      lastObservation = JSON.stringify(current);
      return 'backend' in current && 'size' in current.backend && current.backend.size.output === '33 90';
    }, 15000, () => `independent managed PTY size: ${lastObservation}`);
    const observation = await fullscreenFailure(sandbox, id, pid, second);
    assert.ok('session' in observation, JSON.stringify(observation));
    assert.equal(observation.session.fullscreen, 1);
    assert.equal(observation.session.runningPresent, true);
    assert.ok('size' in observation.frontend, JSON.stringify(observation.frontend));
    assert.equal(observation.frontend.size.output, '33 90');
    // Mark after the held window: historical redraws cannot satisfy the new one.
    const mark = second.mark;
    writeFileSync(release, '');
    try {
      await second.waitFor(/REDRAW 33 90/, mark);
    } catch (error) {
      if (error instanceof Error) error.message += `; actual geometry=${JSON.stringify(await fullscreenFailure(sandbox, id, pid, second))}`;
      throw error;
    }
    writeFileSync(stop, '');
    await second.waitFor(/❯/, second.output.lastIndexOf('REDRAW'));
    await second.run('echo AFTER-SAMPLED-RESIZE', /AFTER-SAMPLED-RESIZE/);
  } finally {
    await sandbox.dispose();
  }
});
