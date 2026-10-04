import {spawn} from 'node:child_process';
import {mkdtempSync, readdirSync, realpathSync, rmSync} from 'node:fs';
import {availableParallelism, tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {discoverTestFiles, parseTestOptions, selectTestGroups} from './test-selection.mjs';

/** Short private temp roots keep Unix sockets below their path length limit. */
export async function runTestFiles(files, args = [], {cwd = process.cwd(), stdio = 'inherit', report = message => console.error(message)} = {}) {
  const root = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'nt-')));
  let leftovers = [];
  try {
    // Existing presentation snapshots pin truecolor; baseline fixtures override this explicitly.
    // Tests never see the user's real NMSh settings: configuration lives under this run's private root.
    const env = {...process.env, COLORTERM: process.env.COLORTERM ?? 'truecolor', TMPDIR: root, TMP: root, TEMP: root, XDG_CONFIG_HOME: join(root, 'config'), NMSH_DISABLE_UPDATES: '1'};
    // A nested runner must not impersonate its parent's test worker.
    delete env.NODE_TEST_CONTEXT;
    // PTY workers also own shell/helper processes. Bound fan-out on larger
    // development hosts; explicit Node --test-concurrency options still win.
    const concurrency = Math.max(1, Math.min(4, availableParallelism() - 1));
    const child = spawn(process.execPath, ['--import=tsx', '--test', `--test-concurrency=${concurrency}`, ...args, ...files], {
      cwd, stdio, env,
    });
    let interrupted = false;
    const forward = () => { interrupted = true; child.kill('SIGTERM'); };
    process.once('SIGINT', forward);
    process.once('SIGTERM', forward);
    let code;
    try {
      code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (status) => resolve(status ?? 1));
      });
    } finally {
      process.off('SIGINT', forward);
      process.off('SIGTERM', forward);
    }
    // Crash fixtures own their nested TMPDIR. Ordinary lifecycle leaks at the
    // suite root are a failure, reported BEFORE cleanup rather than hidden.
    leftovers = readdirSync(root).filter(name => /^nmsh-(?:semantic|zdotdir|shell|completion|capture)-/u.test(name));
    if (leftovers.length) report(`Test lifecycle leaked ${leftovers.length} semantic/zsh temp directories: ${leftovers.join(', ')}`);
    return {code: leftovers.length || interrupted ? 1 : code, root, leftovers};
  } finally {
    // Only this run's private root. Never remove pre-existing host artifacts.
    rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {args, ...selection} = parseTestOptions(process.argv.slice(2));
    const groups = selectTestGroups(discoverTestFiles(), selection);
    process.exitCode = 0;
    for (const group of groups) {
      if (group.length) process.exitCode = Math.max(process.exitCode, (await runTestFiles(group, args)).code);
    }
  }
  catch (error) { console.error(error); process.exitCode = 1; }
}
