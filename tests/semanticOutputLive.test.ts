import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

/** Semantic Output through the real composer and PTY: the reading is drawn in its block and /copy --semantic copies it. */
const supported = process.platform === 'darwin' || process.platform === 'linux';

test('live: a failing test summary gets its overview and failure listing; /copy --semantic copies the reading, /copy latest the raw output', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
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
    await frontend.run("printf '✔ ok (1ms)\\n✖ broken (2ms)\\nℹ tests 2\\nℹ pass 1\\nℹ fail 1\\n\\n✖ failing tests:\\n✖ broken (2ms)\\n'; false",
      /node --test · 1 passed · 1 failed[\s\S]*1 failing test/u);
    let mark = frontend.mark;
    frontend.pty.write('/copy --semantic\r');
    await frontend.waitFor(/Copied[^\n]*semantic/u, mark);
    await until(() => existsSync(clip) && readFileSync(clip, 'utf8').includes('broken'), 15_000, 'the reading on the clipboard');
    assert.equal(readFileSync(clip, 'utf8'), 'node --test: 1 passed · 1 failed\nbroken');
    mark = frontend.mark;
    frontend.pty.write('/copy latest\r');
    await until(() => readFileSync(clip, 'utf8').startsWith('✔ ok (1ms)'), 15_000, 'the raw output on the clipboard');
    assert.doesNotMatch(readFileSync(clip, 'utf8'), /node --test:/u, '/copy without --semantic stays raw');
  } finally { await sandbox.dispose(); }
});
