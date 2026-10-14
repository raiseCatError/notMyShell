import {appendFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {createRequire} from 'node:module';
import {ChildProcess} from 'node:child_process';
import {beforeEach, afterEach, after} from 'node:test';

// Private diagnostic only. Never used by canonical acceptance gates.
const entry = process.argv[1];
const directory = process.env.NMSH_WORKER_OBSERVATIONS;
if (directory && process.env.NODE_TEST_CONTEXT && entry?.endsWith('.test.ts')) {
  const file = join(directory, `worker-${process.pid}.jsonl`);
  const record = (event, details = {}) => {
    try { appendFileSync(file, JSON.stringify({at: new Date().toISOString(), pid: process.pid, event, ...details}) + '\n'); }
    catch { /* Observation must not replace the original outcome. */ }
  };
  const resources = () => {
    const counts = {};
    for (const type of process.getActiveResourcesInfo()) counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  };
  record('worker-entry', {file: basename(entry), parent: process.ppid, node: process.version});
  beforeEach(context => record('test-start', {name: context.name}));
  afterEach(context => record('test-end', {name: context.name}));
  after(() => record('after-tests', {resources: resources()}));
  const spawn = ChildProcess.prototype.spawn;
  ChildProcess.prototype.spawn = function (...args) {
    const result = Reflect.apply(spawn, this, args);
    record('child-spawn', {child: this.pid, executable: basename(args[0]?.file ?? '')});
    this.once('exit', (code, signal) => record('child-exit', {child: this.pid, code, signal}));
    this.once('close', (code, signal) => record('child-close', {child: this.pid, code, signal}));
    return result;
  };
  const kill = ChildProcess.prototype.kill;
  ChildProcess.prototype.kill = function (...args) {
    const result = Reflect.apply(kill, this, args);
    record('child-signal-attempt', {child: this.pid, signal: args[0] ?? 'SIGTERM', result});
    return result;
  };
  try {
    const pty = createRequire(entry)('node-pty');
    const spawnPty = pty.spawn;
    pty.spawn = function (...args) {
      const terminal = Reflect.apply(spawnPty, this, args);
      record('pty-spawn', {child: terminal.pid, executable: basename(args[0])});
      const killPty = terminal.kill;
      terminal.kill = function (...signal) {
        record('pty-signal-attempt', {child: this.pid, signal: signal[0] ?? 'SIGHUP'});
        return Reflect.apply(killPty, this, signal);
      };
      terminal.onExit(({exitCode, signal}) => record('pty-exit', {child: terminal.pid, exitCode, signal}));
      return terminal;
    };
  } catch (error) { record('pty-observer-unavailable', {code: error?.code ?? error?.name}); }
  let ticks = 0;
  const heartbeat = setInterval(() => {
    if (++ticks > 60) { clearInterval(heartbeat); return; }
    record('heartbeat', {resources: resources()});
  }, 10000);
  heartbeat.unref();
  process.on('beforeExit', code => record('before-exit', {code, resources: resources()}));
  process.on('exit', code => record('worker-exit', {code}));
}
