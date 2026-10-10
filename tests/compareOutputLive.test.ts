import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

/** Compare output through the real composer and PTY; a stand-in clipboard tool records the copied diff. */
const supported = process.platform === 'darwin' || process.platform === 'linux';

test('live: /compare shows what changed between two runs of a command; c copies a unified diff', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const bin = join(sandbox.root, 'fake-bin');
  mkdirSync(bin);
  const clip = join(sandbox.root, 'clipboard.txt');
  for (const name of ['pbcopy', 'xclip', 'wl-copy']) {
    writeFileSync(join(bin, name), `#!/bin/sh\ncat > ${JSON.stringify(clip)}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const frontend = sandbox.launch([], {cols: 110, rows: 32}, {PATH: `${bin}:${process.env.PATH}`, ...(process.platform === 'linux' ? {DISPLAY: ':nmsh-test'} : {})});
  try {
    await frontend.waitFor(/Vespyr|notMyShell|zsh/u);
    await frontend.run('echo READY', /READY/u);
    const props = join(sandbox.home, 'props.txt');
    writeFileSync(props, Array.from({length: 40}, (_, index) => `[ro.prop.${index}]: [${index === 7 ? 'before' : 'same'}]`).join('\n') + '\n');
    await frontend.run(`cat ${props}`, /ro\.prop\.39/u);
    writeFileSync(props, Array.from({length: 40}, (_, index) => `[ro.prop.${index}]: [${index === 7 ? 'after' : 'same'}]`).join('\n') + '\n[ro.prop.new]: [1]\n');
    await frontend.run('echo between', /between/u);
    await frontend.run(`cat ${props}`, /ro\.prop\.new/u);
    // /compare 1 3: the latest cat and the earlier one (echo between is 2).
    let mark = frontend.mark;
    frontend.pty.write('/compare 1 3\r');
    await frontend.waitFor(/Compare output[\s\S]*1 changed · 1 added · 39 unchanged[\s\S]*- \[ro\.prop\.7\]: \[before\][\s\S]*\+ \[ro\.prop\.7\]: \[after\]/u, mark);
    frontend.pty.write('c');
    await until(() => existsSync(clip) && readFileSync(clip, 'utf8').length > 0, 15_000, 'the diff on the clipboard');
    const diff = readFileSync(clip, 'utf8');
    assert.match(diff, /^--- A: cat [^\n]+· exit 0\n\+\+\+ B: cat [^\n]+· exit 0\n@@ -5,7 \+5,7 @@\n[\s\S]*-\[ro\.prop\.7\]: \[before\]\n\+\[ro\.prop\.7\]: \[after\]\n[\s\S]*\+\[ro\.prop\.new\]: \[1\]\n$/u, diff);
    await frontend.waitFor(/Copied diff · \d+ lines/u, mark);
    frontend.pty.write('\u001b');
    frontend.pty.write('\u001b');
    // Bare /compare: the latest output and its previous run, straight to the difference.
    mark = frontend.mark;
    frontend.pty.write('/compare\r');
    await frontend.waitFor(/Compare output[\s\S]*1 changed · 1 added/u, mark);
    frontend.pty.write('\u001b');
    frontend.pty.write('\u001b');
    await frontend.run('echo AFTER-COMPARE', /AFTER-COMPARE/u);
    mark = frontend.mark;
    frontend.pty.write('/compare 9\r');
    await frontend.waitFor(/No completed command output at 9\./u, mark);
  } finally { await sandbox.dispose(); }
});
