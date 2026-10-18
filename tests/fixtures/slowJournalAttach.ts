import {SessionJournal} from '../../src/sessions/SessionJournal.js';

// Deterministic slow disk seam. The actual CLI, session protocol, frontend and both PTYs stay real.
const continueJournal = SessionJournal.prototype.continue;
SessionJournal.prototype.continue = async function(existing) {
  process.stdout.write('TEST-JOURNAL-WAIT\n');
  await new Promise(done => setTimeout(done, 1000));
  return continueJournal.call(this, existing);
};
const startJournal = SessionJournal.prototype.start;
SessionJournal.prototype.start = async function() {
  process.stdout.write('TEST-JOURNAL-WAIT\n');
  await new Promise(done => setTimeout(done, 1000));
  return startJournal.call(this);
};
await import('../../src/index.js');
