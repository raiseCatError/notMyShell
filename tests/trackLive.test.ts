import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, processAlive, until} from './helpers/liveFrontend.js';
import {shellAdapter} from '../src/shell/adapters/registry.js';

/** /track through the real composer and PTY: the live result updates on screen, copy and stop work, history is not spammed. */
const supported = process.platform === 'darwin' || process.platform === 'linux';

test('live: /track refreshes one result in place, /track copy copies it, /track stop leaves it once', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const bin = join(sandbox.root, 'fake-bin');
  mkdirSync(bin);
  const clip = join(sandbox.root, 'clipboard.txt');
  for (const name of ['pbcopy', 'xclip', 'wl-copy']) {
    writeFileSync(join(bin, name), `#!/bin/sh\ncat > ${JSON.stringify(clip)}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const frontend = sandbox.launch([], {cols: 100, rows: 30}, {PATH: `${bin}:${process.env.PATH}`, ...(process.platform === 'linux' ? {DISPLAY: ':nmsh-test'} : {})});
  try {
    await frontend.waitFor(/Vespyr|notMyShell|zsh/u);
    await frontend.run('echo READY', /READY/u);
    writeFileSync(join(sandbox.home, 'value.txt'), 'alpha-1\n');
    let mark = frontend.mark;
    frontend.pty.write('/track --every 2s -- cat value.txt\r');
    await frontend.waitFor(/Tracking cat value\.txt[\s\S]*live · every 2s[\s\S]*alpha-1/u, mark);
    mark = frontend.mark;
    writeFileSync(join(sandbox.home, 'value.txt'), 'alpha-2\n');
    await frontend.waitFor(/alpha-2/u, mark);
    // The shell stays usable while the tracker refreshes.
    await frontend.run('echo SHELL-STILL-HERE', /SHELL-STILL-HERE/u);
    mark = frontend.mark;
    frontend.pty.write('/track copy\r');
    await until(() => existsSync(clip) && readFileSync(clip, 'utf8') === 'alpha-2\n', 15_000, 'the latest result on the clipboard');
    mark = frontend.mark;
    frontend.pty.write('/track stop\r');
    await frontend.waitFor(/Stopped · last result[\s\S]*alpha-2/u, mark);
    await frontend.run('echo AFTER-TRACK', /AFTER-TRACK/u);
    // The saved transcript holds NMSh's lines and the final result once, never one copy per refresh.
    await until(async () => (await sandbox.transcripts().list()).some(session => JSON.stringify(session.transcript).includes('AFTER-TRACK')), 15_000, 'the journal');
    const sessions = await sandbox.transcripts().list();
    const text = sessions.flatMap(session => (session.transcript.lines as Array<Array<{text?: string} | null>>)
      .map(line => line.map(cell => cell?.text ?? ' ').join(''))).join('\n');
    assert.equal(text.split('alpha-2').length - 1, 1, 'the final result is stored once');
    assert.equal(text.includes('alpha-1'), false, 'earlier refreshes are never stored');
  } finally { await sandbox.dispose(); }
});

test('live: several trackers at once (slow, failing, missing, large), resized, then /track stop all ends them and their processes', {skip: supported ? false : 'unsupported platform', timeout: 180_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const home = sandbox.home;
  const script = (name: string, body: string) => { writeFileSync(join(home, name), `#!/bin/sh\n${body}\n`); chmodSync(join(home, name), 0o755); };
  script('slow.sh', 'echo $$ >> slow.pids\nsleep 3\necho SLOW-RESULT');
  script('fail.sh', 'echo FAIL-RESULT\nexit 3');
  writeFileSync(join(home, 'big.txt'), `${Array.from({length: 5_000}, (_, index) => `big-line-${index}`).join('\n')}\n`);
  const frontend = sandbox.launch([], {cols: 100, rows: 48});
  // Commands NMSh can't vouch for ask first: Yes starts them.
  const confirmed = async (command: string) => {
    const mark = frontend.mark;
    frontend.pty.write(`/track --every 2s -- ${command}\r`);
    await frontend.waitFor(new RegExp(`Track ${command.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}\\?`, 'u'), mark);
    frontend.pty.write('y');
    frontend.pty.write('\r');
    await frontend.waitFor(/Tracking /u, mark);
  };
  try {
    await frontend.waitFor(/Vespyr|notMyShell|zsh/u);
    await frontend.run('echo READY', /READY/u);
    let mark = frontend.mark;
    await confirmed('./slow.sh');
    await frontend.waitFor(/SLOW-RESULT/u, mark);
    // A refresh that takes a while shows as refreshing over the previous result (#420), then completes in place.
    await frontend.waitFor(/live · every 2s[^\n]*refreshing…/u, mark);
    mark = frontend.mark;
    await confirmed('./fail.sh');
    await frontend.waitFor(/live · every 2s · updated \d\d:\d\d:\d\d · exit 3/u, mark);
    mark = frontend.mark;
    await confirmed('nmsh-no-such-command-393');
    await frontend.waitFor(/exit 127/u, mark);
    mark = frontend.mark;
    frontend.pty.write('/track --every 2s -- cat big.txt\r');
    await frontend.waitFor(/big-line-0[\s\S]*… 4,?989 more lines · \/track copy copies them all/u, mark);
    // Four trackers: one summary row above the composer, not one row each.
    await frontend.waitFor(/4 trackers · 2 failing · \/track opens the manager/u, mark);
    // Narrower and back: the trackers keep drawing, the shell stays usable.
    frontend.pty.resize(56, 48);
    await frontend.run('echo NARROW-OK', /NARROW-OK/u);
    frontend.pty.resize(100, 48);
    await frontend.run('echo SHELL-STILL-HERE', /SHELL-STILL-HERE/u);
    mark = frontend.mark;
    frontend.pty.write('/track stop all\r');
    await frontend.waitFor(/Stopped every tracker/u, mark);
    await frontend.waitFor(/(?:Stopped · last result[\s\S]*){4}/u, mark);
    const pids = readFileSync(join(home, 'slow.pids'), 'utf8').trim().split('\n').map(Number);
    await until(() => pids.every(pid => !processAlive(pid)), 10_000, 'every tracked process to end');
    await frontend.run('echo AFTER-ALL', /AFTER-ALL/u);
  } finally { await sandbox.dispose(); }
});

for (const shell of ['bash', 'fish'] as const) {
  const installed = Boolean(shellAdapter(shell).resolveExecutable(process.env));
  test(`live: /track from ${shell} finds what the live shell's PATH finds, including a change made after startup`, {skip: !supported ? 'unsupported platform' : !installed && `${shell} is not installed`, timeout: 120_000}, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend: shell});
    const tools = join(sandbox.home, 'tools');
    mkdirSync(tools);
    writeFileSync(join(tools, 'nmsh-track-tool'), '#!/bin/sh\necho TOOL-FROM-SHELL-PATH\n');
    chmodSync(join(tools, 'nmsh-track-tool'), 0o755);
    const frontend = sandbox.launch([], {cols: 100, rows: 40});
    try {
      await frontend.waitFor(/Vespyr|notMyShell|bash|fish/u);
      await frontend.run('echo READY', /READY/u);
      await frontend.run(shell === 'fish' ? `set -gx PATH ${tools} $PATH; echo PATH-SET` : `export PATH="${tools}:$PATH"; echo PATH-SET`, /PATH-SET/u);
      let mark = frontend.mark;
      frontend.pty.write('/track --every 2s -- nmsh-track-tool\r');
      await frontend.waitFor(/Track nmsh-track-tool\?/u, mark);
      frontend.pty.write('y');
      frontend.pty.write('\r');
      await frontend.waitFor(/live · every 2s[\s\S]*TOOL-FROM-SHELL-PATH/u, mark);
      mark = frontend.mark;
      frontend.pty.write('/track stop\r');
      await frontend.waitFor(/Stopped · last result[\s\S]*TOOL-FROM-SHELL-PATH/u, mark);
      await frontend.run('echo AFTER-TRACK', /AFTER-TRACK/u);
    } finally { await sandbox.dispose(); }
  });
}
