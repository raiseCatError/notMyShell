/** Controlled observation seam only. Real shell reads, terminal modes and all routing remain production code. */
import {appendFileSync, existsSync} from 'node:fs';
import {InputWatch} from '../../src/session/InputWatch.ts';
import {QueryOrder} from '../../src/shell/QueryOrder.ts';
// The service deliberately strips frontend environment; the fixture passes only its private gate in this module URL.
const root = new URL(import.meta.url).searchParams.get('gate');
if (!root) throw new Error('ownership race fixture needs its private gate');
const trace = event => appendFileSync(root + '.jsonl', JSON.stringify({pid: process.pid, ...event}) + '\n');
process.on('uncaughtExceptionMonitor', error => trace({event: 'fixture-error', message: error.message}));
trace({event: 'loaded'});
const apply = InputWatch.prototype.apply;
InputWatch.prototype.apply = function(sample, now) {
  const controlled = this.running?.command.includes('QA_RACE') && !existsSync(root + '.release');
  if (controlled) {
    trace({event: 'sample', modes: sample.modes, states: sample.foreground.map(p => p.state), readingTerminal: sample.readingTerminal});
    sample = {...sample, readingTerminal: undefined, foreground: sample.foreground.map(p => ({...p, state: 'R' + p.state.replaceAll('R', '')}))};
  }
  return apply.call(this, sample, now);
};
const input = QueryOrder.prototype.input;
QueryOrder.prototype.input = function(...args) {
  if (!this.ownershipRaceTrace) {
    this.ownershipRaceTrace = true;
    const write = this.write;
    this.write = bytes => { trace({event: 'pty-write', bytes: Buffer.byteLength(bytes)}); return write.call(this, bytes); };
  }
  return input.apply(this, args);
};
