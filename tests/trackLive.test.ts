import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

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
