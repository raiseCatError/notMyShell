import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeCompletionSource} from '../src/shell/CompletionService.js';
import {until, processAlive} from './helpers/liveFrontend.js';

const capture = fileURLToPath(new URL('../src/shell/capture.zsh', import.meta.url));
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
    await until(() => existsSync(join(transport, 'pid')), 2000, 'capture PID');
    inner = Number(readFileSync(join(transport, 'pid'), 'utf8'));
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
    await until(() => existsSync(join(root, 'early-pid')), 3000, 'inner before initialization');
    inner = Number(readFileSync(join(root, 'early-pid'), 'utf8'));
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
  try {
    const values = await new NativeCompletionSource().query({buffer: 'ls cap', cwd: root}, new AbortController().signal);
    assert.ok(values.some(value => value.value === 'capture-file'));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

for (const configured of [false, true]) test(`${configured ? 'configured' : 'native'} capture cleans its PTY and root after abrupt frontend death`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-native-owner-'));
  writeFileSync(join(root, 'compinit'), 'sleep 20\n');
  writeFileSync(join(root, '.zshrc'), 'sleep 20\n');
  const module = new URL(configured ? '../src/shell/ConfiguredCompletion.ts' : '../src/shell/CompletionService.ts', import.meta.url).href;
  const type = configured ? 'ConfiguredCompletionSource' : 'NativeCompletionSource';
  const prefix = configured ? 'nmsh-completion-' : 'nmsh-capture-';
  const program = `import {${type}} from ${JSON.stringify(module)}; await new ${type}().query({buffer:'g',cwd:${JSON.stringify(root)}},new AbortController().signal);`;
  const owner = spawn(process.execPath, ['--import=tsx', '--input-type=module', '-e', program], {
    env: {...process.env, HOME: root, FPATH: root, TMPDIR: root}, stdio: 'ignore', detached: true,
  });
  let inner = 0;
  try {
    let transport = '';
    await until(() => {
      const name = readdirSync(root).find(name => name.startsWith(prefix));
      if (!name || !existsSync(join(root, name, 'pid'))) return false;
      transport = join(root, name);
      return true;
    }, 3000, 'owned inner shell');
    inner = Number(readFileSync(join(transport, 'pid'), 'utf8'));
    owner.kill('SIGKILL');
    await until(() => !existsSync(transport) && !processAlive(inner), 3000, 'helper cleanup without frontend timers');
    await until(() => groupEnded(inner), 2000, 'completion descendants after frontend death');
  } finally {
    if (owner.pid) { try { process.kill(-owner.pid, 'SIGKILL'); } catch {} }
    if (inner) { try { process.kill(-inner, 'SIGKILL'); } catch {} }
    rmSync(root, {recursive: true, force: true});
  }
});
