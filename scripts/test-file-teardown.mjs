import {after} from 'node:test';
import {spawnSync} from 'node:child_process';

/**
 * Preloaded into every test file's process by scripts/test.mjs. A test that stalls past its timeout is cancelled, but
 * whatever it started keeps running: a live shell PTY or a piped child then keeps the file's process alive, the file
 * never finishes, its failure is never printed, and a CI job waits for its own time limit (#415's Ubuntu shard).
 * Once the file's tests are done, a timer that cannot itself keep the process alive gives the file's own cleanup time
 * (NMSH_TEST_TEARDOWN_MS, default 15 s); if the process is still alive then, every process the file left running is
 * ended and named, so the stall is reported instead of hanging the run.
 */
if (process.env.NODE_TEST_CONTEXT) {
  after(() => {
    const delay = Number(process.env.NMSH_TEST_TEARDOWN_MS) || 15_000;
    setTimeout(endLeftovers, delay).unref();
  });
}

export function endLeftovers() {
  const rows = processTable();
  const own = rows.find(row => row.pid === process.pid)?.group;
  const left = descendants(rows, process.pid).filter(row => !/(?:^|\/)(?:esbuild|ps)$/u.test(row.command));
  for (const row of left) {
    // A leader of its own group (a PTY shell, a detached helper) takes its whole group with it; never our own group.
    const target = row.group === row.pid && row.group !== own ? -row.group : row.pid;
    try { process.kill(target, 'SIGKILL'); } catch { /* Already gone. */ }
  }
  if (left.length) process.stderr.write(`test teardown: ended ${left.length} process${left.length === 1 ? '' : 'es'} this file left running: ${left.map(row => `${row.pid} ${row.command}`).join(', ')}\n`);
  return left;
}

function processTable() {
  const result = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,comm='], {encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024});
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout.trim().split('\n').map(line => {
    const [pid, parent, group, ...command] = line.trim().split(/\s+/u);
    return {pid: Number(pid), parent: Number(parent), group: Number(group), command: command.join(' ')};
  });
}

function descendants(rows, root) {
  const found = [];
  const queue = [root];
  while (queue.length) {
    const parent = queue.shift();
    for (const row of rows) if (row.parent === parent && row.pid !== root) { found.push(row); queue.push(row.pid); }
  }
  return found;
}
