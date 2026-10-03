import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

test('Terminal.app profile runs persistent editing, paste and resize without enhanced modes', async () => {
  const sandbox = new LiveSandbox({toolsSetupComplete: true, glyphStyle: 'safe'}, {
    TERM_PROGRAM: 'Apple_Terminal', COLORTERM: '', NMSH_COLOR: '', NO_COLOR: '',
  });
  try {
    const app = sandbox.launch();
    await app.waitFor(/> /);
    assert.doesNotMatch(app.output, /\u001b\[(?:>1u|\?100[036]h|\?2026h)/u);
    assert.doesNotMatch(app.output, /\u001b\[(?:38|48);2;/u);
    const exported = app.mark;
    app.pty.write('export BASELINE_STATE=kept\r');
    await app.waitFor(/Completed/, exported);
    await app.run('echo STATE-$BASELINE_STATE', /STATE-kept/);
    const mark = app.mark;
    app.pty.write('\u001b[200~echo PASTE-ONE\necho PASTE-TWO\u001b[201~');
    await app.waitFor(/echo PASTE-TWO/, mark);
    app.pty.write('\r');
    await app.waitFor(/Completed/, mark);
    assert.match(strip(app.output.slice(mark)), /PASTE-ONE.*PASTE-TWO/su);
    app.pty.resize(60, 20);
    await until(async () => {
      const sizeMark = app.mark;
      await app.run('echo WIDTH-$(stty size)', /WIDTH-\d+ \d+/);
      await app.waitFor(/Completed/, sizeMark);
      return /WIDTH-\d+ 60/u.test(strip(app.output.slice(sizeMark)));
    }, 15000, 'resize reached the persistent shell');
  } finally { await sandbox.dispose(); }
});
