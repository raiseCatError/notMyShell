import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {LiveSandbox, strip} from '../../tests/helpers/liveFrontend.ts';
const repo = process.cwd();
const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error('Pass an absolute result JSON path on T7');
const pty = createRequire(join(repo, 'package.json'))('node-pty');
const rows = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function wait(frontend, pattern, action = () => {}) {
  return new Promise((resolve, reject) => {
    let tail = '';
    const started = performance.now();
    const finish = error => {
      clearTimeout(timer); sub.dispose(); exit.dispose();
      if (error) reject(error); else resolve(performance.now() - started);
    };
    const timer = setTimeout(() => finish(new Error('No expected composer update: '+strip(tail).slice(-500))), 30_000);
    const sub = frontend.pty.onData(data => {
      tail = (tail + data).slice(-65_536);
      if (pattern.test(strip(tail))) finish();
    });
    const exit = frontend.pty.onExit(() => finish(new Error('Frontend exited')));
    action();
  });
}
let active;
let interrupted = false;
const interrupt = () => { interrupted = true; active?.pty.kill('SIGTERM'); };
process.on('SIGTERM', interrupt); process.on('SIGINT', interrupt);
try {
  for (let iteration = 0; iteration < 8; iteration++) {
    if (interrupted) throw new Error('Benchmark interrupted');
    const box = new LiveSandbox({provider: 'native', introSeen: true, liveSessionStartup: 'never'}, {NMSH_DISABLE_UPDATES: '1'});
    try {
      const frontend = box.trackFrontend(pty.spawn(process.execPath, [join(repo, 'dist/index.js')], {cwd: box.home, cols: 100, rows: 30, env: box.env}));
      active = frontend;
      await wait(frontend, /❯/u);
      await wait(frontend, /LIVE_READY_42/u, () => frontend.pty.write("printf '\\114\\111\\126\\105\\137\\122\\105\\101\\104\\131\\137\\064\\062\\n'\r"));
      await sleep(300);
      // Ordinary key input, not a paste atom: keep the full command visible/editable.
      const seed = "printf '%s' café 界 👩🏽‍💻 # " + 'long-command '.repeat(24) + 'COMPOSER_SEED_';
      await wait(frontend, /COMPOSER_SEED_/u, () => frontend.pty.write(seed));
      const typingMs = [];
      let tail = 'COMPOSER_SEED_';
      for (const key of 'abcdefghijklmno') {
        tail += key;
        typingMs.push(await wait(frontend, new RegExp(tail.slice(-8)), () => frontend.pty.write(key)));
        await sleep(20);
      }
      const deletingMs = [];
      for (let i = 0; i < 15; i++) {
        tail = tail.slice(0, -1);
        // The deleted character must be absent on the next emitted row (rather than matching old history).
        deletingMs.push(await wait(frontend, new RegExp(tail.slice(-8)+'(?: |\\x1b|$)'), () => frontend.pty.write('\x7f')));
        await sleep(20);
      }
      frontend.pty.write('\x15');
      rows.push({iteration, typingMs, deletingMs});
      writeFileSync(output, JSON.stringify({notes: 'Built CLI, disposable Native/zsh service, 100x30; observed PTY composer updates, not physical key-to-pixel latency; initial sample excluded from warm comparisons', node: process.version, rows}, null, 2));
      console.log(iteration);
    } finally {await box.dispose(); active = undefined;}
  }
} finally {process.off('SIGTERM', interrupt); process.off('SIGINT', interrupt);}
