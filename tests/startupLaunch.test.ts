import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import nodePty from 'node-pty';
import {detectTerminalHost, spawnLauncher} from '../src/host/terminalHost.js';
import {restoreAtStartup} from '../src/session/startupRestore.js';
import type {SessionInfo} from '../src/session/SessionProtocol.js';
import {LiveSandbox, strip, until} from './helpers/liveFrontend.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url));
const info = (id: string, createdAt: number): SessionInfo => ({id, pid: 1, state: 'detached', cwd: `/w/${id}`, createdAt});

test('awaiting a launcher keeps the process alive (startup used to exit with an unsettled top-level await)', () => {
  // Nothing else holds the event loop here, as at startup with stdin paused after the picker.
  const script = `const {spawnLauncher} = await import(${JSON.stringify(join(REPO, 'src/host/terminalHost.ts'))});
console.log('LAUNCHED=' + await spawnLauncher('/bin/sh', ['-c', 'sleep 0.3; exit 0']));`;
  const result = spawnSync(process.execPath, [`--import=${TSX}`, '--input-type=module', '-e', script], {encoding: 'utf8', timeout: 20000});
  assert.doesNotMatch(result.stderr, /unsettled top-level await/);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /LAUNCHED=true/);
});

test('launcher results: clean exit, failure, missing command, and a launcher that hangs', async () => {
  assert.equal(await spawnLauncher('/bin/sh', ['-c', 'exit 0']), true);
  assert.equal(await spawnLauncher('/bin/sh', ['-c', 'exit 1']), false, 'e.g. Automation permission denied');
  assert.equal(await spawnLauncher('/nonexistent/launcher', []), false);
  const started = Date.now();
  assert.equal(await spawnLauncher('/bin/sh', ['-c', 'sleep 5'], 300), false, 'a hung launcher times out');
  assert.ok(Date.now() - started < 3000);
});

function deps(spawned: string[][], spawner = async (_c: string, args: string[]) => { spawned.push(args); return true; }) {
  return {policy: {startup: 'ask' as const, multiple: 'ask' as const}, saveStartup: () => {}, askOne: async () => 'not-now' as const,
    host: {capabilities: detectTerminalHost({}).capabilities, name: 'Terminal', newWindow: (argv: readonly string[]) => ({command: 'osascript', args: [...argv]})},
    selfCommand: ['node', '/nmsh'], spawner};
}

test('N selected sessions: one attaches here, every other one gets its own launch', async () => {
  const live = [info('s1', 4), info('s2', 3), info('s3', 2), info('s4', 1)];
  for (const [selected, others] of [[['s1', 's2'], ['s2']], [['s1', 's2', 's3'], ['s2', 's3']], [['s2', 's4'], ['s4']],
    [['s1', 's2', 's3', 's4'], ['s2', 's3', 's4']]] as const) {
    const spawned: string[][] = [];
    const result = await restoreAtStartup(live, {...deps(spawned), pick: async () => [...selected]});
    assert.equal(result.target, selected[0]);
    assert.deepEqual(spawned.map(args => args.at(-1)), others, `selected ${selected.join(',')}`);
    assert.equal(result.notice, undefined);
  }
});

test('a failed launch in the middle loses nothing: the others still launch and the failed one is named', async () => {
  const live = [info('s1', 3), info('s2', 2), info('s3', 1)];
  const spawned: string[][] = [];
  const result = await restoreAtStartup(live, {...deps(spawned, async (_c, args) => { spawned.push(args); return args.at(-1) !== 's2'; }),
    pick: async () => ['s1', 's2', 's3']});
  assert.equal(result.target, 's1');
  assert.deepEqual(spawned.map(args => args.at(-1)), ['s2', 's3'], 'the launch after the failure still happens');
  assert.match(result.notice ?? '', /1 more selected live session could not be opened[\s\S]*nmsh --attach s2/);
  assert.doesNotMatch(result.notice ?? '', /s3/);
});

const built = existsSync(join(REPO, 'dist/index.js'));

test('built nmsh: Open all from a picker attaches here and launches every other selected session',
  {skip: built ? false : 'run npm run build first'}, async () => {
    const sandbox = new LiveSandbox();
    const fakeBin = join(sandbox.root, 'fake-bin');
    mkdirSync(fakeBin);
    const log = join(sandbox.root, 'launches.txt');
    // Stands in for osascript: records the request and takes a moment, like the real one.
    writeFileSync(join(fakeBin, 'osascript'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nsleep 0.5\nexit 0\n`);
    chmodSync(join(fakeBin, 'osascript'), 0o755);
    try {
      for (let index = 0; index < 3; index += 1) {
        const frontend = sandbox.launch(['--new']);
        await frontend.waitFor(/❯/);
        frontend.pty.kill('SIGKILL');
        await until(async () => (await sandbox.sessions()).filter(session => session.state === 'detached').length === index + 1, 15000, 'detached');
      }
      const env = {...sandbox.env, TERM_PROGRAM: 'Apple_Terminal', PATH: `${fakeBin}:${process.env.PATH}`} as Record<string, string>;
      const pty = nodePty.spawn(join(REPO, 'bin/nmsh'), [], {cwd: sandbox.home, cols: 100, rows: 30, env});
      sandbox.trackFrontend(pty);
      let output = '';
      let exitCode: number | undefined;
      pty.onData(data => { output += data; });
      pty.onExit(event => { exitCode = event.exitCode; });
      try {
        await until(() => /3 detached live sessions/.test(strip(output)), 20000, 'picker');
        pty.write('a');
        pty.write('\r');
        await until(() => /Reattached live session/.test(strip(output)), 20000, () => `attach here; exit ${exitCode}:\n${strip(output).slice(-600)}`);
        await until(() => existsSync(log) && readFileSync(log, 'utf8').trim().split('\n').length === 2, 20000, 'two launches');
        assert.equal(exitCode, undefined, 'still running');
        assert.doesNotMatch(output, /unsettled top-level await/);
        const launched = readFileSync(log, 'utf8').trim().split('\n').map(line => /--attach ([\w-]+)/.exec(line)?.[1]);
        const sessions = await sandbox.sessions();
        const attached = sessions.find(session => session.state === 'attached')!.id;
        assert.equal(new Set([attached, ...launched]).size, 3, 'every selected session is either attached here or launched');
      } finally {
        pty.kill('SIGKILL');
      }
    } finally {
      await sandbox.dispose();
    }
  });

test('built nmsh starts normally as Terminal.app', {skip: built ? false : 'run npm run build first'}, async () => {
  const sandbox = new LiveSandbox();
  try {
    const env = {...sandbox.env, TERM_PROGRAM: 'Apple_Terminal'} as Record<string, string>;
    const pty = nodePty.spawn(join(REPO, 'bin/nmsh'), [], {cwd: sandbox.home, cols: 100, rows: 30, env});
    sandbox.trackFrontend(pty);
    let output = '';
    pty.onData(data => { output += data; });
    try {
      await until(() => /❯/.test(strip(output)), 20000, 'composer');
      const mark = output.length;
      pty.write('echo TERMINAL-APP-OK\r');
      await until(() => /TERMINAL-APP-OK[\s\S]*Completed/.test(strip(output.slice(mark))), 20000, 'command ran');
      assert.doesNotMatch(output, /unsettled top-level await/);
    } finally {
      pty.kill('SIGKILL');
    }
  } finally {
    await sandbox.dispose();
  }
});
