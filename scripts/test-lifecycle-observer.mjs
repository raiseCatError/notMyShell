/** Opt-in CI evidence for test workers that retain resources after their tests finish.
 * Never changes ref state, signals children, records command text, or forces exit.
 */
import {mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';

const root = process.env.NMSH_LIFECYCLE_DIAGNOSTICS;
if (root) {
  try { mkdirSync(root, {recursive: true, mode: 0o700}); }
  catch (error) { console.error('Lifecycle diagnostic directory unavailable:', error.message); }
  const children = [];
  // Record the native PTY's exit separately from the owning test's completion.
  const require = createRequire(import.meta.url);
  try {
    const pty = require('node-pty');
    const spawn = pty.spawn;
    pty.spawn = function (...args) {
      const child = spawn.apply(this, args);
      const record = {pid: child.pid, spawnedAt: Date.now(), exited: false, signals: []};
      const kill = child.kill;
      child.kill = function (...signals) {
        const signal = signals[0];
        if (record.signals.length < 16) record.signals.push({at: Date.now(),
          signal: signal === undefined ? 'SIGHUP' : typeof signal === 'string' && /^SIG[A-Z]+$/u.test(signal) ? signal : 'other'});
        return kill.apply(this, signals);
      };
      if (children.length < 256) children.push(record);
      child.onExit(event => { record.exited = true; record.exitedAt = Date.now(); record.exit = event; });
      return child;
    };
  } catch (error) { console.error('Lifecycle PTY observation unavailable:', error.message); }

  const record = phase => {
    try {
      const fds = {};
      const descendants = [];
      const threads = [];
      if (process.platform === 'linux') {
        for (const fd of readdirSync('/proc/self/fd')) {
          try { fds[fd] = readlinkSync(`/proc/self/fd/${fd}`); } catch {}
        }
        for (const tid of readdirSync('/proc/self/task').slice(0, 64)) {
          try { threads.push({tid: Number(tid), wchan: readFileSync(`/proc/self/task/${tid}/wchan`, 'utf8')}); } catch {}
        }
        for (const pid of readdirSync('/proc').filter(value => /^\d+$/u.test(value))) {
          try {
            const status = readFileSync(`/proc/${pid}/status`, 'utf8');
            const parent = /^PPid:\s+(\d+)$/mu.exec(status);
            if (Number(parent?.[1]) !== process.pid && !children.some(child => child.pid === Number(pid))) continue;
            descendants.push({pid: Number(pid),
              status: status.split('\n').filter(line => /^(Name|State|PPid|Threads|SigIgn|SigCgt|SigBlk|SigPnd|ShdPnd):/u.test(line)),
              wchan: readFileSync(`/proc/${pid}/wchan`, 'utf8')});
          } catch {} // A process may exit during its snapshot.
        }
      }
      const handles = process._getActiveHandles().map(handle => ({kind: handle.constructor?.name,
        pid: handle.pid, fd: handle.fd, destroyed: handle.destroyed,
        readableFlowing: handle.readableFlowing, readableEnded: handle.readableEnded,
        readableLength: handle.readableLength, writableEnded: handle.writableEnded}));
      writeFileSync(join(root, `${process.pid}.json`), JSON.stringify({pid: process.pid, ppid: process.ppid,
        file: process.argv[1], phase, at: Date.now(), resources: process.getActiveResourcesInfo(),
        handles, fds, children, descendants, threads}, null, 2));
    } catch (error) { console.error('Lifecycle diagnostic snapshot failed:', error.message); }
  };
  record('loaded');
  setInterval(() => record('active'), 2000).unref();
  process.on('beforeExit', () => record('beforeExit'));
  process.on('exit', () => record('exit'));
}
