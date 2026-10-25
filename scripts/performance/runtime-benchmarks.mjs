import {createRequire} from 'node:module';
import {mkdirSync, realpathSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isAbsolute, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import os from 'node:os';

// Run with --import=tsx: the existing live fixture owns all service/PTY cleanup.
const repo = process.argv[2] ?? fileURLToPath(new URL('../../', import.meta.url));
const label = process.argv[3] ?? 'current';
const output = process.env.NMSH_PERF_OUTPUT;
const lineCount = Number(process.env.NMSH_PERF_LINES ?? 1000);
const repetitions = Number(process.env.NMSH_PERF_REPETITIONS ?? 12);
if (!Number.isInteger(lineCount) || lineCount < 1 || lineCount > 10_000 || !Number.isInteger(repetitions) || repetitions < 2 || repetitions > 30) {
  throw new Error('Use 1–10000 lines and 2–30 repetitions');
}
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Use a simple alphanumeric result label');
if (!output || !isAbsolute(output) || !process.env.TMPDIR || !isAbsolute(process.env.TMPDIR)) {
  throw new Error('Set absolute NMSH_PERF_OUTPUT and a short disposable TMPDIR before benchmarking');
}
mkdirSync(output, {recursive: true});
realpathSync(process.env.TMPDIR);
const pty = createRequire(join(repo, 'package.json'))('node-pty');
const {LiveSandbox, strip, until} = await import(join(repo, 'tests/helpers/liveFrontend.ts'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = [];
const environment = {
  node: process.version, os: os.release(), platform: os.platform(), cpu: os.cpus()[0].model,
  memory: os.totalmem(), size: '100x30', lineCount, repetitions,
  commit: spawnSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).stdout.trim(),
  dirty: Boolean(spawnSync('git', ['status', '--porcelain'], {cwd: repo, encoding: 'utf8'}).stdout.trim()),
  notes: 'Built CLI, real PTY, disposable HOME/config/service, empty home shell config; no filesystem cache purge; output observation, not physical pixels',
};

/** Bounded observer work: never repeatedly scan the full accumulated screen stream. */
function waitData(frontend, pattern, action = () => {}, timeout = 20_000) {
  return new Promise((resolve, reject) => {
    let tail = '';
    const started = performance.now();
    let dataSubscription, exitSubscription;
    const finish = error => {
      clearTimeout(timer);
      dataSubscription?.dispose();
      exitSubscription?.dispose();
      if (error) reject(error); else resolve(performance.now() - started);
    };
    const timer = setTimeout(() => finish(new Error(`Timeout ${pattern}: ${strip(tail).slice(-1000)}`)), timeout);
    dataSubscription = frontend.pty.onData(data => {
      tail = (tail + data).slice(-65_536);
      if (pattern.test(strip(tail))) finish();
    });
    exitSubscription = frontend.pty.onExit(() => finish(new Error(`Frontend exited before ${pattern}`)));
    try { action(); } catch (error) { finish(error); }
  });
}

function rss(pid) {
  const result = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], {encoding: 'utf8'});
  const kib = Number(result.stdout.trim());
  if (result.status !== 0 || !Number.isFinite(kib) || kib <= 0) throw new Error(`Cannot read RSS for owned frontend ${pid}`);
  return kib * 1024;
}

let interrupted = false;
let activeFrontend;
const interrupt = () => { interrupted = true; activeFrontend?.pty.kill('SIGTERM'); };
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
try {
  for (const provider of ['native', 'none']) {
    for (let iteration = 0; iteration < repetitions; iteration++) {
      if (interrupted) throw new Error('Benchmark interrupted');
      const sandbox = new LiveSandbox({provider, introSeen: true, liveSessionStartup: 'never'}, {NMSH_DISABLE_UPDATES: '1'});
      const result = {provider, iteration, kind: iteration === 0 ? 'first-observed' : 'warm-filesystem'};
      try {
        const started = performance.now();
        const child = pty.spawn(process.execPath, [join(repo, 'dist/index.js')], {
          cwd: sandbox.home, cols: 100, rows: 30, env: sandbox.env,
        });
        const frontend = sandbox.trackFrontend(child);
        activeFrontend = frontend;
        child.onData(data => {
          if (result.firstVisibleMs === undefined && strip(data).trim()) result.firstVisibleMs = performance.now() - started;
        });
        await waitData(frontend, /❯/u);
        result.composerFrameMs = performance.now() - started;
        await waitData(frontend, /PERF_READY_42/u, () => child.write("printf '\\120\\105\\122\\106\\137\\122\\105\\101\\104\\131\\137\\064\\062\\n'\r"));
        result.executedMs = performance.now() - started;
        await sleep(300);
        result.keyEchoMs = [];
        for (const key of 'abcdefghijklmno') {
          result.keyEchoMs.push(await waitData(frontend, new RegExp(key), () => child.write(key)));
        }
        child.write('\x15');
        await sleep(150);
        result.rssAtIdle = rss(child.pid);
        // A real zsh workload: the sentinel cannot match the submitted command text.
        const command = `i=0; while (( i++ < ${lineCount} )); do printf 'line %05d café 界\\n' $i; done; printf '\\117\\125\\124\\120\\125\\124\\137\\106\\111\\116\\111\\123\\110\\105\\104\\137\\064\\062\\n'\r`;
        result[`output${lineCount}Ms`] = await waitData(frontend, /OUTPUT_FINISHED_42/u, () => child.write(command), 60_000);
        await sleep(300);
        result.rssAfterOutput = rss(child.pid);
        // Integrity checks are outside the timed interval. Never score missing output as faster.
        let saved;
        await until(async () => {
          saved = (await sandbox.transcripts().list()).flatMap(item => item.transcript.records)
            .find(record => record.command.startsWith('i=0;') && record.output.includes('OUTPUT_FINISHED_42'));
          return Boolean(saved);
        }, 15_000, 'completed output journal');
        const actual = saved.output.split('\n').filter(line => line.startsWith('line '));
        if (actual.length !== lineCount || actual.some((line, index) => line !== `line ${String(index + 1).padStart(5, '0')} café 界`)) {
          throw new Error('Output loss or reordering');
        }
        if (iteration === 0) writeFileSync(join(output, `${label}-${provider}-screen.txt`), frontend.output);
        rows.push(result);
        writeFileSync(join(output, `${label}-runtime.json`), JSON.stringify({environment, rows}, null, 2));
        console.log(JSON.stringify(result));
      } finally {
        await sandbox.dispose();
        activeFrontend = undefined;
      }
    }
  }
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
}
