import assert from 'node:assert/strict';
import {TerminalApp} from '../../src/app/TerminalApp.js';

// Submit through the real frontend before its startup notice can fire. The
// service test must not depend on disk IO leaving a visible composer window.
const run = TerminalApp.prototype.run;
TerminalApp.prototype.run = async function() {
  assert.equal(process.argv.includes('--attach'), false, 'fresh frontend fixture only');
  assert.equal(this['startupPending'], true);
  assert.equal(this['startupPanel'], undefined, 'submission precedes the startup notice');
  this['editor'].insert('echo HELD-$((1+1))');
  await this['submit']();
  process.stdout.write('TEST-EARLY-SUBMISSION\n');
  return run.call(this);
};
await import('../../src/index.js');
