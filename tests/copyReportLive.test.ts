import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

test('live: report review cancels safely and copies sanitized, redacted Markdown bytes', {skip: !['darwin', 'linux'].includes(process.platform), timeout: 90_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const bin = join(sandbox.root, 'fake-bin');
  mkdirSync(bin);
  const clipboard = join(sandbox.root, 'copied.txt');
  for (const name of ['pbcopy', 'wl-copy', 'xclip']) {
    writeFileSync(join(bin, name), `#!/bin/sh\ncat > '${clipboard}'\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const frontend = sandbox.launch([], {cols: 110, rows: 34}, {PATH: `${bin}:${process.env.PATH}`, ...(process.platform === 'linux' ? {DISPLAY: ':nmsh-test'} : {})});
  try {
    await frontend.waitFor(/Vespyr|notMyShell|zsh/u);
    await frontend.run('echo READY', /READY/u);
    const output = join(sandbox.home, 'hostile-output.txt');
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    writeFileSync(output, `GITHUB_TOKEN=${secret}\n\u001b[31mred\u001b[0m\u202e\u200b\n\u0060\u200b\u0060\u200b\u0060\n# output heading\nEND-OF-HOSTILE\n`);
    await frontend.run(`cat '${output}'`, /END-OF-HOSTILE/u);
    let mark = frontend.mark;
    frontend.pty.write('/copy 1 --report\r');
    await frontend.waitFor(/Copy as report[\s\S]*Redact on/u, mark);
    assert.equal(existsSync(clipboard), false, 'opening review must not copy');
    frontend.pty.write('\u001b');
    await frontend.run('echo AFTER-CANCEL', /AFTER-CANCEL/u);
    assert.equal(existsSync(clipboard), false, 'cancelling must not copy');
    mark = frontend.mark;
    frontend.pty.write('/copy 2 --report\r');
    await frontend.waitFor(/Copy as report[\s\S]*Redact on/u, mark);
    frontend.pty.write('\r');
    await until(() => existsSync(clipboard) && readFileSync(clipboard, 'utf8').length > 0, 15_000, 'reviewed report bytes');
    const copied = readFileSync(clipboard, 'utf8');
    assert.doesNotMatch(copied, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/u);
    assert.doesNotMatch(copied, new RegExp(secret, 'u'));
    assert.match(copied, /\[REDACTED/u);
    assert.match(copied, /END-OF-HOSTILE/u);
    assert.equal(copied.split('\n').filter(line => /^`{4,}/u.test(line)).length, 2, 'sanitized output cannot close the authored fence');
    await frontend.waitFor(/Copied report/u, mark);
  } finally { await sandbox.dispose(); }
});
