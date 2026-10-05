import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {LiveSandbox, TSX, until} from './helpers/liveFrontend.js';
// @ts-ignore standalone Node runner, intentionally outside the product tsconfig
import {runTestFiles} from '../scripts/test.mjs';

test('normal TerminalApp teardown removes semantic and zsh temp resources without a sweep', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lifecycle-'));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = root;
  let app: TerminalApp | undefined;
  try {
    app = new TerminalApp();
    assert.ok(readdirSync(root).some(name => name.startsWith('nmsh-semantic-')));
    assert.ok(readdirSync(root).some(name => name.startsWith('nmsh-zdotdir-')));
    app['stop'](0); app['session'].kill();
    await until(() => readdirSync(root).length === 0, 5000, 'normal lifecycle cleanup');
  } finally {
    if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous;
    if (app) { app['stop'](0); app['session'].kill(); }
    rmSync(root, {recursive: true, force: true});
  }
});
test('crash fixture temp files stay inside its sandbox, with truthful SIGKILL leftovers until disposal', async () => {
  const sandbox = new LiveSandbox();
  try {
    assert.equal(sandbox.env.TMPDIR, sandbox.temp);
    const frontend = sandbox.launch();
    await frontend.waitFor(/❯/);
    assert.ok(readdirSync(sandbox.temp).some(name => name.startsWith('nmsh-semantic-')));
    frontend.pty.kill('SIGKILL');
    await frontend.waitExit();
    assert.ok(readdirSync(sandbox.temp).some(name => name.startsWith('nmsh-semantic-')), 'SIGKILL cannot run frontend cleanup');
  } finally { await sandbox.dispose(); }
  assert.ok(!existsSync(sandbox.root));
});
test('suite runner uses short roots, removes only its own root, and reports normal lifecycle leaks', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'runner-'));
  try {
    const clean = join(fixture, 'clean.test.mjs');
    writeFileSync(clean, "import assert from 'node:assert/strict'; assert.ok(process.env.TMPDIR.length < 32);\n");
    for (let run = 0; run < 2; run++) {
      const result = await runTestFiles([clean], [], {stdio: 'ignore'});
      assert.equal(result.code, 0); assert.deepEqual(result.leftovers, []);
      assert.ok(!existsSync(result.root)); assert.ok(existsSync(fixture));
    }
    const leaking = join(fixture, 'leaking.test.mjs');
    writeFileSync(leaking, "import {mkdtempSync} from 'node:fs'; mkdtempSync(process.env.TMPDIR + '/nmsh-semantic-');\n");
    const diagnostics: string[] = [];
    const result = await runTestFiles([leaking], [], {stdio: 'ignore', report: (message: string) => diagnostics.push(message)});
    assert.match(diagnostics[0]!, /Test lifecycle leaked 1/);
    assert.equal(result.code, 1); assert.equal(result.leftovers.length, 1);
    assert.ok(!existsSync(result.root)); assert.ok(existsSync(fixture));
  } finally { rmSync(fixture, {recursive: true, force: true}); }
});

test('sandbox disposal waits for an untracked late writer whose cwd still owns the sandbox', async () => {
  const sandbox = new LiveSandbox();
  const child = spawn(process.execPath, ['-e', "setTimeout(() => require('node:fs').writeFileSync('late-journal.txt', 'done'), 150)"],
    {cwd: sandbox.home, stdio: 'ignore'});
  const exited = new Promise<number | null>(resolve => child.once('close', resolve));
  try {
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await sandbox.dispose();
    assert.equal(await exited, 0, 'root stays present until the last writer finishes');
    assert.ok(!existsSync(sandbox.root));
  } finally {
    child.kill(); await exited;
    await sandbox.dispose();
  }
});

test('a transient ownership scan timeout cannot delete a sandbox before its late writer exits', async () => {
  const sandbox = new LiveSandbox();
  const child = spawn(process.execPath, ['-e', "setTimeout(() => require('node:fs').writeFileSync('late-journal.txt', 'done'), 400)"],
    {cwd: sandbox.home, stdio: 'ignore'});
  const exited = new Promise<number | null>(resolve => child.once('close', resolve));
  const realSpawnSync = childProcess.spawnSync;
  let probes = 0;
  const spy = mock.method(childProcess, 'spawnSync', (...args) => {
    if (args[0] === 'lsof' && probes++ === 0) return {pid: 0, output: [], stdout: '', stderr: '', status: null, signal: 'SIGTERM',
      error: Object.assign(new Error('ownership scan timed out'), {code: 'ETIMEDOUT'})};
    return Reflect.apply(realSpawnSync, childProcess, args);
  });
  syncBuiltinESMExports();
  try {
    await sandbox.dispose();
    assert.equal(await exited, 0, 'the real writer must finish while its sandbox still exists');
    assert.ok(probes > 1, 'a successful ownership scan is required after the timeout');
    assert.equal(existsSync(sandbox.root), false);
  } finally {
    spy.mock.restore(); syncBuiltinESMExports();
    child.kill(); await exited; await sandbox.dispose();
  }
});

test('unknown ownership still fails at the existing cleanup deadline', async () => {
  const sandbox = new LiveSandbox();
  const realNow = Date.now;
  let elapsed = 0;
  const clock = mock.method(Date, 'now', () => realNow() + elapsed);
  const realSpawnSync = childProcess.spawnSync;
  const probe = mock.method(childProcess, 'spawnSync', (...args) => {
    if (args[0] !== 'lsof') return Reflect.apply(realSpawnSync, childProcess, args);
    // Advance only the fixture clock beyond its unchanged ten-second budget.
    elapsed += 10001;
    return {pid: 0, output: [], stdout: '', stderr: '', status: null, signal: 'SIGTERM',
      error: Object.assign(new Error('ownership scan timed out'), {code: 'ETIMEDOUT'})};
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(sandbox.dispose(), /timed out waiting for sandbox frontends and helpers/u);
  } finally {
    clock.mock.restore(); probe.mock.restore(); syncBuiltinESMExports();
    await sandbox.dispose();
  }
});


test('disposal observes an idle service that starts listening after its initial socket check', async () => {
  const sandbox = new LiveSandbox();
  const serviceUrl = new URL('../src/session/SessionService.ts', import.meta.url).href;
  const gate = join(sandbox.home, 'start-service');
  // Keep the fixture alive long enough that automatic idle exit cannot hide
  // disposal's ordering race. Production and disposal deadlines are unchanged.
  const program = `import {runSessionService} from ${JSON.stringify(serviceUrl)};
    process.stdout.write('IMPORTED\\n');
    const {existsSync} = await import('node:fs');
    while (!existsSync(${JSON.stringify(gate)})) await new Promise(resolve => setTimeout(resolve, 20));
    await runSessionService({runtimeDir: ${JSON.stringify(sandbox.runtime)}, startupIdleMs: 60_000});`;
  const child = spawn(process.execPath, [`--import=${TSX}`, '--input-type=module', '-e', program],
    {cwd: sandbox.home, env: sandbox.env, stdio: ['ignore', 'pipe', 'pipe']});
  const inspect = sandbox['anyServiceListening'].bind(sandbox);
  let released = false;
  let output = '';
  child.stdout.on('data', data => { output += data.toString(); });
  const exited = new Promise<number | null>(resolve => child.once('close', resolve));
  try {
    await until(() => output.includes('IMPORTED'), 5000, 'service module imported');
    assert.deepEqual(readdirSync(sandbox.runtime), [], 'the initial socket check sees no service');
    sandbox['anyServiceListening'] = async () => {
      const listening = await inspect();
      // Release the real service only after disposal has completed its first probe.
      if (!released) { writeFileSync(gate, 'start'); released = true; }
      return listening;
    };
    await sandbox.dispose();
    assert.equal(await exited, 0, 'the late idle service exits through its normal lifecycle');
    assert.equal(existsSync(sandbox.root), false);
  } finally {
    child.kill(); await exited; await sandbox.dispose();
  }
});
