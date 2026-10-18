import assert from 'node:assert/strict';
import {TerminalApp} from '../../src/app/TerminalApp.js';

// Submit through the real frontend before its startup notice can fire. The
// service test must not depend on disk IO leaving a visible composer window.
const run = TerminalApp.prototype.run;
TerminalApp.prototype.run = async function() {
  assert.equal(process.argv.includes('--attach'), false, 'fresh frontend fixture only');
  assert.equal(this['startupPending'], true);
  assert.equal(this['startupPanel'], undefined, 'submission precedes the startup notice');
  const command = process.env.NMSH_TEST_EARLY_COMMAND ?? 'echo HELD-$((1+1))';
  assert.ok(['echo HELD-$((1+1))', 'less', 'vim'].includes(command), 'known fixture command only');
  this['editor'].insert(command);
  await this['submit']();
  assert.equal(this['running']?.command, command);
  assert.equal(this['running']?.awaitingExec, true, 'command is held before first shell prompt');
  assert.equal(this['passthrough'], false, 'early fullscreen command cannot take terminal ownership');
  process.stdout.write('TEST-EARLY-SUBMISSION\n');
  return run.call(this);
};
if (process.env.NMSH_TEST_DELAY_EARLY_JOURNAL === '1') await import('./slowJournalAttach.js');
else await import('../../src/index.js');
