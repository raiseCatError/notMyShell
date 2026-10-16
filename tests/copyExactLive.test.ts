import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

/**
 * Physical QA 1.11 and 1.12 through the real composer, PTY, session service and clipboard tool boundary: each command
 * runs on its own, then /copy is submitted on its own, and a stand-in clipboard tool first on PATH records the exact
 * bytes NMSh hands it (the person's clipboard is never touched).
 */
const supported = process.platform === 'darwin' || process.platform === 'linux';

test('live: /copy hands the clipboard the exact bytes printed: tabs, spaces, UTF-8 and the final newline; folded output in full', {skip: supported ? false : 'unsupported platform', timeout: 150_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'}, {});
  const bin = join(sandbox.root, 'fake-bin');
  mkdirSync(bin);
  const clip = join(sandbox.root, 'clipboard.bin');
  for (const name of ['pbcopy', 'xclip', 'wl-copy']) {
    writeFileSync(join(bin, name), `#!/bin/sh\ncat > ${JSON.stringify(clip)}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const frontend = sandbox.launch([], {cols: 120, rows: 36}, {PATH: `${bin}:${process.env.PATH}`, ...(process.platform === 'linux' ? {DISPLAY: ':nmsh-test'} : {})});
  const read = () => existsSync(clip) ? readFileSync(clip) : Buffer.alloc(0);
  const copy = async (command = '/copy') => {
    writeFileSync(clip, '');
    frontend.pty.write(`${command}\r`);
    await until(() => read().length > 0, 15_000, `the clipboard after ${command}`);
    return read();
  };
  try {
    await frontend.waitFor(/zsh/u);
    await frontend.run('echo READY', /READY/u);
    // 1.11: exactly the maintainer's bytes.
    await frontend.run(`printf 'a\\tb\\n  indented\\nüñí\\n'`, /indented/u);
    assert.equal((await copy()).toString('hex'), '6109620a2020696e64656e7465640ac3bcc3b1c3ad0a');
    // 1.12: all 400 records, the final newline, no frontend text, though the block is folded on screen.
    const mark = frontend.mark;
    await frontend.run('seq 1 400', /400/u);
    assert.match(strip(frontend.output.slice(mark)), /lines hidden/u, 'the block is folded');
    const seq = (await copy()).toString('utf8');
    assert.equal(seq, `${Array.from({length: 400}, (_, index) => index + 1).join('\n')}\n`);
    assert.equal(seq.match(/\n/gu)?.length, 400, 'pbpaste | wc -l prints 400');
    // Selection ranges, output without a final newline, and wide or combined characters.
    await frontend.run(`printf 'one\\n'`, /Completed/u);
    await frontend.run(`printf 'no-newline'`, /Completed/u);
    assert.equal((await copy('/copy 1-2')).toString(), 'one\nno-newline');
    await frontend.run(`printf '%s\\n' 'wide 漢字 ✓' 'emoji 👍🏽'`, /Completed/u);
    assert.equal((await copy()).toString(), 'wide 漢字 ✓\nemoji 👍🏽\n');
  } finally { await sandbox.dispose(); }
});
