import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

for (const shellBackend of ['zsh', 'bash', 'fish']) {
  test(`live ${shellBackend}: new Copy navigation copies exact folded output and Actions palette returns without action`, {timeout: 90_000}, async () => {
    const sandbox = new LiveSandbox({provider: 'none', shellBackend, liveSessionStartup: 'never', queue: {outputDisplay: 'fold'}}, {});
    const bin = join(sandbox.root, 'fake-bin'); mkdirSync(bin);
    const clip = join(sandbox.root, 'clipboard'); writeFileSync(clip, 'KEEP');
    for (const name of ['pbcopy', 'xclip', 'wl-copy']) {
      writeFileSync(join(bin, name), `#!/bin/sh\ncat > '${clip}'\n`); chmodSync(join(bin, name), 0o755);
    }
    const frontend = sandbox.launch([], {cols: 80, rows: 26}, {PATH: `${bin}:${process.env.PATH}`, ...(process.platform === 'linux' ? {DISPLAY: ':nmsh-test'} : {})});
    const read = () => existsSync(clip) ? readFileSync(clip, 'utf8') : '';
    try {
      await frontend.waitFor(/notMyShell|Vespyr|zsh|bash|fish/u);
      await frontend.run('echo READY', /READY/u);
      await frontend.run(`printf 'a\\tb\\n日本語\\n\\n'`, /日本語/u);
      let mark = frontend.mark; frontend.pty.write('/cp\r');
      await frontend.waitFor(/Copy output/u, mark); assert.equal(read(), 'KEEP');
      frontend.pty.write('\r'); await until(() => read() === 'a\tb\n日本語\n\n', 10_000, 'selected output copy to finish writing exact bytes');
      assert.equal(read(), 'a\tb\n日本語\n\n');
      mark = frontend.mark; frontend.pty.write('sleep 1\r');
      await frontend.waitFor(/Running sleep 1/u, mark);
      frontend.pty.write('seq 1 400\r');
      await until(async () => (await sandbox.transcripts().list()).some(session => session.transcript.records.some(record => record.command === 'seq 1 400' && record.queued === true)), 15_000, 'queued output to complete');
      const queued = (await sandbox.transcripts().list()).flatMap(session => session.transcript.records).find(record => record.command === 'seq 1 400')!;
      assert.equal(queued.expanded, false, 'Slice 2C queued output remains folded before selection');
      mark = frontend.mark; frontend.pty.write('/copy\r'); await frontend.waitFor(/Copy output/u, mark);
      frontend.pty.write('\r'); const expected = Array.from({length: 400}, (_, i) => String(i + 1)).join('\n') + '\n';
      await until(() => read() === expected, 10_000, 'all 400 folded output lines');
      mark = frontend.mark; frontend.pty.write('/action\r'); await frontend.waitFor(/Actions.*[\s\S]*Enter/u, mark);
      frontend.pty.write('\u001b[A'); frontend.pty.write('\r');
      await frontend.waitFor(/Copy command/u, mark);
      assert.equal(read(), expected, 'focusing and opening a palette copy nothing');
      mark = frontend.mark; frontend.pty.write('\u001b'); await frontend.waitFor(/Actions/u, mark);
      frontend.pty.write('\u001b');
      await frontend.run('echo AFTER-NAV', /AFTER-NAV/u);
      assert.equal(read(), expected);
    } finally { await sandbox.dispose(); }
  });
}
