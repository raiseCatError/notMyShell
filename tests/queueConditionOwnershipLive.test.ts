import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';
import {inForeground, uniqueSleep} from './helpers/processState.js';

const bash = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash']
  .find(path => existsSync(path) && /version (?:4\.[4-9]|[5-9]\.)/u.test(spawnSync(path, ['--version'], {encoding: 'utf8'}).stdout ?? ''));
const fish = ['/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'].find(existsSync);
const supported = ['darwin', 'linux'].includes(process.platform);

for (const [index, shell] of (['zsh', 'bash', 'fish'] as const).entries()) {
  const available = shell === 'zsh' || (shell === 'bash' ? Boolean(bash) : Boolean(fish));
  test(`live ${shell}: queue conditions survive failure, interrupt and reattach without transferring approval`, {
    skip: !supported ? 'unsupported platform' : !available ? `${shell} not installed` : false, timeout: 120_000,
  }, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell, liveActivity: {style: 'classic'}},
      shell === 'bash' && bash ? {PATH: `${bash.replace(/\/bash$/u, '')}:${process.env.PATH}`} : {});
    try {
      const first = sandbox.launch();
      await first.waitFor(/notMyShell|zsh|bash|fish/u);
      await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined),
        20_000, 'authenticated initial prompt');
      mkdirSync(join(sandbox.home, 'scope'));
      await first.run('cd scope', /Completed/u);
      const marker = join(sandbox.home, 'conditions-ran');
      const follow = (word: string) => `printf '%s\\n' ${word} >> "${marker}"`;
      const afterFailure = follow('after-failure');
      const afterInterrupt = follow('after-interrupt');
      const approved = follow('approved');
      const contents = () => existsSync(marker) ? readFileSync(marker, 'utf8') : '';
      const hold = (name: string, code: number) => {
        const release = join(sandbox.home, name);
        const command = `sh -c 'printf "CONDITION-%s\\n" HOLD; until test -f "$1"; do sleep 0.05; done; exit ${code}' nmsh-fixture "${release}"`;
        return {release, command};
      };

      const failed = hold('release-failure', 3);
      let mark = first.mark;
      first.pty.write(`${failed.command}\r`);
      await first.waitFor(/CONDITION-HOLD/u, mark);
      first.pty.write(`${afterFailure}\u0011`);
      await first.waitFor(/Queue · 2 commands/u, mark);
      first.pty.write('/queue\r');
      await first.waitFor(/Command queue/u, mark);
      first.pty.write('w');
      await first.waitFor(/runs even after a failure/u, mark);
      first.pty.write('\u001b[27u');
      assert.equal(contents(), '', 'setting the condition does not dispatch while the original owns the shell');
      writeFileSync(failed.release, '');
      await until(() => contents() === 'after-failure\n', 20_000, 'one follow-up after exit 3');
      await first.waitFor(/from queue/u, mark);

      const duration = uniqueSleep(91 + index);
      mark = first.mark;
      first.pty.write(`sleep ${duration}\r`);
      await until(() => inForeground(duration), 20_000, 'sleep owns input before interrupt');
      first.pty.write(`${afterInterrupt}\u0011`);
      await first.waitFor(/Queue · 2 commands/u, mark);
      first.pty.write('/queue\r');
      await first.waitFor(/Command queue/u, mark);
      first.pty.write('w');
      await first.waitFor(/runs even after a failure/u, mark);
      first.pty.write('\u001b[27u');
      await first.waitFor(/Enter holds it for approval · Ctrl\+Q runs it after/u, mark);
      first.pty.write('\u0003');
      await first.waitFor(/Queue paused:[\s\S]*was interrupted/u, mark);
      await first.run('echo AFTER-INTERRUPT', /AFTER-INTERRUPT/u);
      assert.equal(contents(), 'after-failure\n', 'always does not bypass interruption');
      await first.run('/queue clear', /Clear queued commands\?/u);
      first.pty.write('\r');
      await first.waitFor(/Queue cleared|Cleared 1 queued command/u);

      const gated = hold('release-approval', 0);
      mark = first.mark;
      first.pty.write(`${gated.command}\r`);
      await first.waitFor(/CONDITION-HOLD/u, mark);
      first.pty.write(`${approved}\u0011`);
      await first.waitFor(/Queue · 2 commands/u, mark);
      first.pty.write('/queue\r');
      await first.waitFor(/Command queue/u, mark);
      first.pty.write('w');
      await first.waitFor(/runs even after a failure/u, mark);
      first.pty.write('w');
      await first.waitFor(/asks first/u, mark);
      first.pty.write('\u001b[27u');
      writeFileSync(gated.release, '');
      await first.waitFor(/Awaiting approval/u, mark);
      await until(async () => (await sandbox.transcripts().list()).some(item =>
        item.transcript.records.some(record => record.command === gated.command && record.exitCode === 0)),
      15_000, 'the holding command completes before detaching');
      const [session] = await sandbox.sessions();
      assert.ok(session);
      first.pty.kill('SIGKILL');
      await until(async () => (await sandbox.sessions()).find(item => item.id === session.id)?.state === 'detached',
        15_000, 'approval remains pending while detached');
      assert.equal(contents(), 'after-failure\n');

      const back = sandbox.launch(['--attach', session.id], {cols: 100, rows: 30}, {NO_COLOR: '1', NMSH_ICONS: 'safe'});
      await back.waitFor(/Awaiting approval/u);
      back.pty.resize(50, 24);
      await back.run('/queue', /Command queue[\s\S]*asks first/u);
      assert.equal(contents(), 'after-failure\n', 'reattach and inspection do not approve');
      mark = back.mark;
      back.pty.write('a');
      await until(() => contents() === 'after-failure\napproved\n', 20_000, 'only the explicitly approved entry runs');
      back.pty.write('\u001b[27u');
      await back.run('echo CONDITIONS-DONE', /CONDITIONS-DONE/u);
      assert.equal(contents(), 'after-failure\napproved\n', 'no duplicate or inherited approval');
      assert.doesNotMatch(back.output.slice(mark), /\u001b\[38;[25];/u, 'NO_COLOR stays plain');

      const records = (await sandbox.transcripts().list()).flatMap(item => item.transcript.records);
      for (const command of [afterFailure, approved]) {
        const matches = records.filter(record => record.command === command);
        assert.equal(matches.length, 1, 'each reviewed command recorded once');
        assert.equal(matches[0]!.historicalContext?.cwd, join(sandbox.home, 'scope'), 'the queue keeps the real shell directory');
        assert.match(matches[0]!.lifecycleText, /from queue/u);
      }
      assert.equal(records.some(record => record.command === afterInterrupt), false, 'interrupted follow-up never became a command');
    } finally { await sandbox.dispose(); }
  });
}
