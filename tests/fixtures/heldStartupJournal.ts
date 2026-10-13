import {existsSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {TranscriptStore} from '../../src/sessions/TranscriptStore.js';

// Hold actual initial persistence, after SessionJournal has created its state.
// CLI, signal dispatch, detached helpers and session service all remain real.
const gate = process.env.NMSH_TEST_JOURNAL_GATE;
if (!gate) throw new Error('a private journal gate is required');
const save = TranscriptStore.prototype.save;
let held = false;
TranscriptStore.prototype.save = async function(...args) {
  if (!held) {
    held = true;
    process.stdout.write('TEST-STARTUP-JOURNAL-WAIT\n');
    while (!existsSync(gate)) await sleep(10);
  }
  return save.apply(this, args);
};
await import('../../src/index.js');
