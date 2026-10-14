import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

test('live: module diagnostics remain readable in a short NO_COLOR Safe terminal', {
  skip: !['darwin', 'linux'].includes(process.platform), timeout: 120_000,
}, async () => {
  const sandbox = new LiveSandbox({provider: 'nmsh', shellBackend: 'zsh'});
  const frontend = sandbox.launch([], {cols: 50, rows: 24}, {NO_COLOR: '1', NMSH_ICONS: 'safe'});
  try {
    await frontend.waitFor(/Vespyr|notMyShell|zsh/u);
    await until(async () => (await sandbox.sessions()).some(session => session.lastExit !== undefined),
      20_000, 'the shell authenticated prompt');
    await frontend.run('echo READY', /READY/u);
    await frontend.run('/modules', /Modules[\s\S]*Catalog[\s\S]*Packs/u);
    const start = frontend.mark;
    frontend.pty.write('\t/aws\r\r');
    await frontend.waitFor(/PgUp\/PgDn/u, start);
    const labels = ['Reads', 'Source', 'Cache', 'Timing', 'Why'];
    const seen = new Set<string>();
    for (let step = 0; step < 70 && seen.size < labels.length; step++) {
      const mark = frontend.mark;
      // A real resize requests a complete repaint, so assertions inspect the
      // displayed rows rather than concatenating incremental changed spans.
      frontend.pty.resize(step % 2 ? 50 : 51, 24);
      await until(() => frontend.output.length > mark, 3000, 'diagnostic repaint');
      const painted = frontend.output.slice(mark);
      assert.doesNotMatch(painted, /\u001b\[38;[25];/u, 'NO_COLOR stays plain');
      for (const label of labels) if (strip(painted).includes(label)) seen.add(label);
      frontend.pty.write('\u001b[B');
    }
    assert.deepEqual([...seen].sort(), [...labels].sort(), 'every diagnostic section is reachable');
    frontend.pty.write('\u001b[5~');
    frontend.pty.write('\u001b[27u\u001b[27u\u001b[27u');
    await frontend.run('echo AFTER-DETAIL', /AFTER-DETAIL/u);
  } finally { await sandbox.dispose(); }
});
