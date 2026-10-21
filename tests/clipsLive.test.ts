import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

test('live: an explicit clipboard read can be kept as a clip, reviewed again and queued only on approval', {skip: !['darwin', 'linux'].includes(process.platform), timeout: 120_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const bin = join(sandbox.root, 'fake-bin');
  mkdirSync(bin);
  const readMarker = join(sandbox.root, 'clipboard-read');
  const execution = join(sandbox.home, 'explicit-execution');
  const source = join(sandbox.root, 'clipboard-text');
  writeFileSync(source, `touch '${execution}'\necho CLIP-DONE`);
  for (const name of ['pbpaste', 'wl-paste', 'xclip', 'xsel']) {
    writeFileSync(join(bin, name), `#!/bin/sh\ntouch '${readMarker}'\ncat '${source}'\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const frontend = sandbox.launch([], {cols: 100, rows: 32}, {PATH: `${bin}:${process.env.PATH}`, ...(process.platform === 'linux' ? {DISPLAY: ':nmsh-test'} : {})});
  try {
    await frontend.waitFor(/Vespyr|notMyShell|zsh/u);
    await frontend.run('echo READY', /READY/u);
    assert.equal(existsSync(readMarker), false, 'startup never reads clipboard text');
    let mark = frontend.mark;
    frontend.pty.write('/ps\r');
    await frontend.waitFor(/Review paste/u, mark);
    assert.equal(existsSync(readMarker), true);
    assert.equal(existsSync(execution), false);
    frontend.pty.write('c');
    // Complete Escape sequences avoid relying on repaint of an unchanged composer row
    // or on a bare Escape's ambiguity timer before the next typed slash.
    frontend.pty.write('\u001b[27u\u001b[27u');
    await frontend.run('/clips', /Review clip 1/u);
    mark = frontend.mark;
    frontend.pty.write('\r');
    await frontend.waitFor(/Review paste/u, mark);
    assert.equal(existsSync(execution), false, 'selecting a clip only opens review');
    frontend.pty.write('b');
    await frontend.waitFor(/Review commands/u, mark);
    assert.equal(existsSync(execution), false, 'batch review never dispatches');
    frontend.pty.write('q');
    await frontend.waitFor(/queue all/u, mark);
    assert.equal(existsSync(execution), false, 'choosing Queue all dispatches nothing');
    frontend.pty.write('\r');
    await until(() => existsSync(execution), 15_000, 'explicitly approved queued command');
    await frontend.waitFor(/CLIP-DONE[\s\S]*from queue/u, mark);
  } finally { await sandbox.dispose(); }
});
