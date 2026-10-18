import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

/** /view through the real composer and PTY: keys decoded from bytes, the real screen, a stand-in clipboard. */
const supported = process.platform === 'darwin' || process.platform === 'linux';

test('live: /view reads a file and the latest output; find, go to line, copy all and Esc back to the composer', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
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
    writeFileSync(join(sandbox.home, 'notes.md'), '# Field notes\n\nThe **quick** fox.\n\n- alpha\n- beta\n');
    let mark = frontend.mark;
    frontend.pty.write('/view notes.md\r');
    await frontend.waitFor(/notes\.md[\s\S]*Markdown · 6 lines[\s\S]*Field notes[\s\S]*quick fox[\s\S]*Esc close/u, mark);
    mark = frontend.mark;
    frontend.pty.write('m');
    await frontend.waitFor(/\*\*quick\*\*/u, mark);
    // Esc closes; the composer is drawn again before anything is typed (a lone Esc followed at once by text is ambiguous).
    mark = frontend.mark;
    frontend.pty.write('\u001b');
    await frontend.waitFor(/❯/u, mark);

    await frontend.run('seq 1 400', /399[\s\S]*400/u);
    mark = frontend.mark;
    frontend.pty.write('/view\r');
    await frontend.waitFor(/\$ seq 1 400[\s\S]*output 1 · exit 0 · 400 lines[\s\S]*Lines 1–/u, mark);
    mark = frontend.mark;
    frontend.pty.write('/37\r');
    await frontend.waitFor(/match(?:es)? for “37”/u, mark);
    mark = frontend.mark;
    frontend.pty.write(':390\r');
    await frontend.waitFor(/Lines 3\d\d–400 of 400/u, mark);
    frontend.pty.write('c');
    await until(() => existsSync(clip) && readFileSync(clip, 'utf8').length > 0, 15_000, 'the document on the clipboard');
    assert.equal(readFileSync(clip, 'utf8'), Array.from({length: 400}, (_, index) => String(index + 1)).join('\n') + '\n');
    // The first Esc clears the search, the second closes.
    mark = frontend.mark;
    frontend.pty.write('\u001b');
    await frontend.waitFor(/of 400 +↑↓ scroll/u, mark);
    mark = frontend.mark;
    frontend.pty.write('\u001b');
    await frontend.waitFor(/❯/u, mark);
    // Back at the composer: a command runs as usual.
    await frontend.run('echo AFTER-VIEW', /AFTER-VIEW/u);
  } finally { await sandbox.dispose(); }
});

test('live: /edit creates a file, typed text and Ctrl+S from real terminal bytes save it, Esc returns to the composer', {skip: supported ? false : 'unsupported platform', timeout: 120_000}, async () => {
  const sandbox = new LiveSandbox({provider: 'none', shellBackend: 'zsh'});
  const frontend = sandbox.launch([], {cols: 100, rows: 30});
  try {
    await frontend.waitFor(/Vespyr|notMyShell|zsh/u);
    await frontend.run('echo READY', /READY/u);
    let mark = frontend.mark;
    frontend.pty.write('/edit notes.txt\r');
    await frontend.waitFor(/notes\.txt[\s\S]*new file[\s\S]*Ctrl\+S save/u, mark);
    frontend.pty.write('first line\rsecond\tline');
    mark = frontend.mark;
    frontend.pty.write('\u0013');
    await frontend.waitFor(/Saved/u, mark);
    assert.equal(readFileSync(join(sandbox.home, 'notes.txt'), 'utf8'), 'first line\nsecond\tline\n');
    mark = frontend.mark;
    frontend.pty.write('\u001b');
    await frontend.waitFor(/❯/u, mark);
    await frontend.run('cat notes.txt', /second\s+line/u);
  } finally { await sandbox.dispose(); }
});
