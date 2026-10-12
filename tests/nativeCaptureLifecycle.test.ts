import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareNativeCompletionHome} from './helpers/nativeCompletion.js';
import {NativeCompletionSource} from '../src/shell/CompletionService.js';
import {until, processAlive} from './helpers/liveFrontend.js';

const capture = fileURLToPath(new URL('../src/shell/capture.zsh', import.meta.url));
function publishedPid(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  const pid = Number(readFileSync(path, 'utf8'));
  return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined;
}

const groupEnded = (pid: number): boolean => spawnSync('pgrep', ['-g', String(pid)], {timeout: 2000}).status === 1;

test('native capture bounds its own startup and cleans the separate PTY process group', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-native-fixture-'));
  const transport = join(root, 'transport');
  mkdirSync(transport);
  writeFileSync(join(root, 'compinit'), 'sleep 20\n');
  const child = spawn('/bin/zsh', ['-f', capture, 'g'], {cwd: root, detached: true,
    env: {...process.env, HOME: root, FPATH: root, NMSH_CAPTURE_ROOT: transport}, stdio: 'ignore'});
  let inner = 0;
  try {
    await until(() => { inner = publishedPid(join(transport, 'pid')) ?? 0; return inner > 1; }, 2000, 'capture PID');
    assert.ok(inner > 1);
    await until(() => child.exitCode !== null || child.signalCode !== null, 2500, 'capture self deadline');
    await until(() => !processAlive(inner), 2000, 'inner PTY cleanup');
    await until(() => groupEnded(inner), 2000, 'completion descendant cleanup');
    assert.equal(existsSync(transport), false);
  } finally {
    if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    if (inner) { try { process.kill(-inner, 'SIGKILL'); } catch {} }
    rmSync(root, {recursive: true, force: true});
  }
});

test('native completion cancellation removes its private transport root', async () => {
  const source = new NativeCompletionSource();
  const controller = new AbortController();
  const request = source.query({buffer: 'g', cwd: process.cwd()}, controller.signal);
  controller.abort();
  assert.deepEqual(await request, []);
});

test('native cancellation reaps a PTY before it can process the initialization command', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-early-capture-'));
  const bin = join(root, 'bin'); mkdirSync(bin);
  // The inner shell never reads the queued command that formerly recorded its PID.
  const module = new URL('../src/shell/CompletionService.ts', import.meta.url).href;
  const program = `import {NativeCompletionSource} from ${JSON.stringify(module)};
    import {existsSync} from 'node:fs';
    const controller = new AbortController();
    const request = new NativeCompletionSource().query({buffer:'g',cwd:${JSON.stringify(root)}},controller.signal);
    while (!existsSync(${JSON.stringify(join(root, 'early-pid'))})) await new Promise(r=>setTimeout(r,5));
    controller.abort(); await request;`;
  // The outer provider also resolves zsh via PATH. Forward script execution to
  // real zsh, and delay only its interactive inner shell.
  writeFileSync(join(bin, 'zsh'), '#!/bin/zsh -f\nif [[ $2 != -i ]]; then exec /bin/zsh "$@"; fi\nunsetopt monitor\nprint -r -- $$ > "$HOME/early-pid"\nsleep 20\n');
  chmodSync(join(bin, 'zsh'), 0o700);
  const owner = spawn(process.execPath, ['--import=tsx', '--input-type=module', '-e', program], {
    env: {...process.env, HOME: root, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root}, stdio: 'ignore', detached: true,
  });
  let inner = 0;
  try {
    await until(() => { inner = publishedPid(join(root, 'early-pid')) ?? 0; return inner > 1; }, 3000, 'inner before initialization');
    await until(() => owner.exitCode !== null || owner.signalCode !== null, 2000, 'cancelled owner');
    assert.equal(owner.exitCode, 0);
    await until(() => !processAlive(inner) && groupEnded(inner), 2000, 'early PTY cleanup');
    assert.equal(readdirSync(root).some(name => name.startsWith('nmsh-capture-')), false);
  } finally {
    if (owner.pid) { try { process.kill(-owner.pid, 'SIGKILL'); } catch {} }
    if (inner) { try { process.kill(-inner, 'SIGKILL'); } catch {} }
    rmSync(root, {recursive: true, force: true});
  }
});

test('bounded nonblocking capture preserves native filesystem candidates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-native-files-'));
  writeFileSync(join(root, 'capture-file'), '');
  const previousHome = process.env.HOME;
  process.env.HOME = root;
  try {
    await prepareNativeCompletionHome(root);
    const values = await new NativeCompletionSource().query({buffer: 'ls cap', cwd: root}, new AbortController().signal);
    assert.ok(values.some(value => value.value === 'capture-file'));
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    rmSync(root, {recursive: true, force: true});
  }
});

test('native startup expiry returns no candidates and does not poison the next capture', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-capture-retry-'));
  const previousHome = process.env.HOME, previousFpath = process.env.FPATH;
  process.env.HOME = root;
  try {
    writeFileSync(join(root, 'capture-file'), '');
    await prepareNativeCompletionHome(root);
    const slow = join(root, 'slow'); mkdirSync(slow);
    writeFileSync(join(slow, 'compinit'), 'sleep 20\n');
    process.env.FPATH = slow;
    const source = new NativeCompletionSource();
    const context = {buffer: 'ls cap', cwd: root};
    assert.deepEqual(await source.query(context, new AbortController().signal), [], 'expired capture has no usable candidates');
    if (previousFpath === undefined) delete process.env.FPATH; else process.env.FPATH = previousFpath;
    const recovered = await source.query(context, new AbortController().signal);
    assert.ok(recovered.some(value => value.value === 'capture-file'), 'same context is captured again after expiry');
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousFpath === undefined) delete process.env.FPATH; else process.env.FPATH = previousFpath;
    rmSync(root, {recursive: true, force: true});
  }
});

/** Read one published capture identity before the fixture signals or observes its process. */
async function publishedCapture(root: string, prefix: string): Promise<{transport: string; pid: number}> {
  let identity: {transport: string; pid: number} | undefined;
  await until(() => {
    const name = readdirSync(root).find(name => name.startsWith(prefix));
    if (!name || !existsSync(join(root, name, 'pid'))) return false;
    const transport = join(root, name);
    const pid = publishedPid(join(transport, 'pid'));
    if (pid === undefined) return false;
    identity = {transport, pid};
    return true;
  }, 3000, 'owned inner shell');
  return identity!;
}

/** The helpers' own startup deadline (capture.zsh, configured-completion.zsh default). */
const HELPER_DEADLINE_MS = 1500;

for (const configured of [false, true]) test(`${configured ? 'configured' : 'native'} capture cleans its PTY and root after abrupt frontend death`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-native-owner-'));
  writeFileSync(join(root, 'compinit'), 'sleep 20\n');
  writeFileSync(join(root, '.zshrc'), 'sleep 20\n');
  const module = new URL(configured ? '../src/shell/ConfiguredCompletion.ts' : '../src/shell/CompletionService.ts', import.meta.url).href;
  const type = configured ? 'ConfiguredCompletionSource' : 'NativeCompletionSource';
  const prefix = configured ? 'nmsh-completion-' : 'nmsh-capture-';
  const program = `import {${type}} from ${JSON.stringify(module)};
    process.stdout.write('OWNER_LOADED\\n');
    await new ${type}().query({buffer:'g',cwd:${JSON.stringify(root)}},new AbortController().signal);`;
  const startedAt = Date.now();
  const owner = spawn(process.execPath, ['--import=tsx', '--input-type=module', '-e', program], {
    env: {...process.env, HOME: root, FPATH: root, TMPDIR: root}, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let loadedAt: number | undefined;
  let ownerOutput = '', ownerError = '';
  owner.stdout!.on('data', data => {
    ownerOutput = (ownerOutput + String(data)).slice(-4096);
    if (loadedAt === undefined && ownerOutput.includes('OWNER_LOADED')) loadedAt = Date.now();
  });
  owner.stderr!.on('data', data => { ownerError = (ownerError + String(data)).slice(-4096); });
  let inner = 0;
  try {
    const identity = await publishedCapture(root, prefix);
    const transport = identity.transport;
    inner = identity.pid;
    owner.kill('SIGKILL');
    // With the frontend gone, the helper cleans up on its own startup deadline (1.5 s in capture.zsh and the configured
    // helper); the window is that deadline plus scheduling margin for a loaded machine running the suite in parallel.
    const killedAt = Date.now();
    try {
      await until(() => !existsSync(transport) && !processAlive(inner), HELPER_DEADLINE_MS + 6500, 'helper cleanup without frontend timers');
    } catch (error) {
      // Failure-only diagnostics distinguish an unreaped zombie from a live
      // helper or a leftover transport, without weakening the cleanup deadline.
      const state = {innerPid: inner, elapsedMs: Date.now() - killedAt, transportExists: existsSync(transport), innerAlive: processAlive(inner)};
      const processState = spawnSync('ps', ['-o', 'pid=,ppid=,pgid=,state=,comm=', '-p', String(inner)], {encoding: 'utf8', timeout: 2000});
      if (error instanceof Error) error.message += `; ${JSON.stringify(state)}; inner process: ${processState.stdout?.trim() || 'unavailable'}`;
      throw error;
    }
    await until(() => groupEnded(inner), 4000, 'completion descendants after frontend death');
  } catch (error) {
    const state = spawnSync('ps', ['-o', 'pid=,ppid=,pgid=,state=,comm=', '-p', [owner.pid, inner].filter(pid => pid && pid > 0).join(',')],
      {encoding: 'utf8', timeout: 2000});
    const transports = readdirSync(root).filter(name => name.startsWith(prefix)).map(name => ({name,
      pidFile: existsSync(join(root, name, 'pid')), readyFile: existsSync(join(root, name, 'ready'))}));
    if (error instanceof Error) error.message += `; owner=${JSON.stringify({pid: owner.pid, elapsedMs: Date.now() - startedAt,
      loadedAfterMs: loadedAt === undefined ? null : loadedAt - startedAt, alive: owner.pid ? processAlive(owner.pid) : false,
      exitCode: owner.exitCode, signalCode: owner.signalCode, stdout: ownerOutput, stderr: ownerError, transports,
      processState: state.stdout?.trim(), processStateStatus: state.status, processStateError: state.error?.message})}`;
    throw error;
  } finally {
    if (owner.pid) { try { process.kill(-owner.pid, 'SIGKILL'); } catch {} }
    if (inner) { try { process.kill(-inner, 'SIGKILL'); } catch {} }
    rmSync(root, {recursive: true, force: true});
  }
});


test('abrupt capture cleanup waits through a PID-file rewrite rather than observing process group zero', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-capture-pid-'));
  const bin = join(root, 'bin'); mkdirSync(bin);
  const release = join(root, 'release');
  const marker = join(root, 'rewriting');
  writeFileSync(join(root, 'compinit'), 'sleep 20\n');
  writeFileSync(join(bin, 'zsh'), `#!/bin/zsh -f
if [[ $2 != -i ]]; then exec /bin/zsh "$@"; fi
while [[ ! -s $NMSH_CAPTURE_ROOT/pid ]]; do sleep 0.005; done
print -r -- $$ > "$HOME/inner-pid"
: > "$NMSH_CAPTURE_ROOT/pid"
print ready > "$HOME/rewriting"
while [[ ! -f $HOME/release ]]; do sleep 0.005; done
exec /bin/zsh "$@"
`);
  chmodSync(join(bin, 'zsh'), 0o700);
  const module = new URL('../src/shell/CompletionService.ts', import.meta.url).href;
  const program = `import {NativeCompletionSource} from ${JSON.stringify(module)};
await new NativeCompletionSource().query({buffer:'g',cwd:${JSON.stringify(root)}},new AbortController().signal);`;
  const owner = spawn(process.execPath, ['--import=tsx', '--input-type=module', '-e', program], {
    env: {...process.env, HOME: root, FPATH: root, TMPDIR: root, PATH: `${bin}:${process.env.PATH}`}, stdio: 'ignore', detached: true,
  });
  let inner = 0;
  try {
    await until(() => existsSync(marker), 3000, 'controlled PID rewrite');
    inner = Number(readFileSync(join(root, 'inner-pid'), 'utf8'));
    assert.ok(Number.isSafeInteger(inner) && inner > 1);
    let observed = false;
    const pending = publishedCapture(root, 'nmsh-capture-').then(identity => { observed = true; return identity; });
    await new Promise(resolve => setTimeout(resolve, 50));
    writeFileSync(release, '');
    const identity = await pending;
    assert.equal(observed, true);
    assert.ok(identity.pid > 1, 'only a valid process identity authorizes cleanup');
    assert.equal(identity.pid, inner);
    owner.kill('SIGKILL');
    await until(() => !existsSync(identity.transport) && !processAlive(inner), 8000, 'controlled capture cleanup');
    await until(() => groupEnded(inner), 4000, 'controlled capture descendants');
  } finally {
    if (owner.pid) { try { process.kill(-owner.pid, 'SIGKILL'); } catch {} }
    if (inner > 1) { try { process.kill(-inner, 'SIGKILL'); } catch {} }
    rmSync(root, {recursive: true, force: true});
  }
});
