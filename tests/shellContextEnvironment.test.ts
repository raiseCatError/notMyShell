import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ShellSession} from '../src/shell/ShellSession.js';
import {shellAdapter} from '../src/shell/adapters/registry.js';
import {SHELL_IDS, knowledgeJobCount, type ShellId} from '../src/shell/adapters/ShellAdapter.js';
import {parseShellKnowledge} from '../src/shell/ShellKnowledge.js';
import {parseShellEnvironment} from '../src/context/shellEnvironment.js';
import type {ShellMarker} from '../src/shell/ShellProtocol.js';

const available = (id: ShellId) => Boolean(shellAdapter(id).resolveExecutable(process.env));

async function start(id: ShellId): Promise<{shell: ShellSession; home: string}> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), `nmsh-envsnap-${id}-`)));
  // The launch environment carries a secret and a frontend-only value: neither may be reported as a value.
  const shell = new ShellSession(home, 100, 30, home, {...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'),
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', AWS_SESSION_TOKEN: 'LAUNCH_TOKEN_VALUE', AWS_PROFILE: 'launch-profile'}, id);
  await once(shell, 'prompt');
  return {shell, home};
}

async function run(shell: ShellSession, command: string): Promise<ShellMarker> {
  const next = once(shell, 'prompt');
  shell.submit(command);
  return (await next as [ShellMarker])[0];
}

async function stop(shell: ShellSession, home: string): Promise<void> {
  const exited = new Promise(resolve => { shell.once('exit', resolve); setTimeout(resolve, 5000).unref(); });
  shell.kill();
  await exited;
  rmSync(home, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}

for (const id of SHELL_IDS) {
  test(`${id}: the live shell reports its own allowlisted context environment, never secrets or controls`, {skip: !available(id) && `${id} is not installed`, timeout: 60_000}, async () => {
    const {shell, home} = await start(id);
    const exportCommand = (name: string, value: string) => id === 'fish' ? `set -gx ${name} ${value}` : `export ${name}=${value}`;
    try {
      let marker = await run(shell, 'true');
      let env = parseShellEnvironment(marker.knowledge)!;
      assert.equal(env.source, 'shell');
      assert.equal(env.values.AWS_PROFILE, 'launch-profile', 'inherited values are the shell\'s values');
      assert.ok(env.present.has('AWS_SESSION_TOKEN'), 'secret presence is reported');
      assert.ok(env.values.PATH, 'PATH is reported for trusted executable identity');
      marker = await run(shell, `${exportCommand('AWS_PROFILE', 'dev-profile')}; ${exportCommand('AWS_SECRET_ACCESS_KEY', 'SUPERSECRET_VALUE')}`);
      env = parseShellEnvironment(marker.knowledge)!;
      assert.equal(env.values.AWS_PROFILE, 'dev-profile', 'a shell export is visible at the next prompt');
      assert.ok(env.present.has('AWS_SECRET_ACCESS_KEY'));
      assert.doesNotMatch(marker.knowledge!, /SUPERSECRET_VALUE|LAUNCH_TOKEN_VALUE/u, 'secret values never leave the shell');
      const hostile = id === 'fish' ? `set -gx TF_WORKSPACE (printf 'evil\\x1b[2Jx')` : `export TF_WORKSPACE=$'evil\\e[2Jx'`;
      marker = await run(shell, `${hostile}; ${exportCommand('AWS_REGION', 'x'.repeat(200))}; ${exportCommand('VIRTUAL_ENV', `${home}/.venv`)}`);
      env = parseShellEnvironment(marker.knowledge)!;
      assert.equal(env.values.TF_WORKSPACE, undefined, 'values with terminal controls are not reported');
      assert.equal(env.values.AWS_REGION, undefined, 'over-long values are not reported');
      assert.equal(env.values.VIRTUAL_ENV, `${home}/.venv`);
      assert.doesNotMatch(marker.knowledge!, /\u001b/u);
      marker = await run(shell, id === 'fish' ? 'set -e AWS_PROFILE' : 'unset AWS_PROFILE');
      env = parseShellEnvironment(marker.knowledge)!;
      assert.equal(env.values.AWS_PROFILE, undefined, 'unset variables disappear');
      const define = id === 'fish' ? 'function nmsh_env_fn; end' : 'nmsh_env_fn() { :; }';
      marker = await run(shell, define);
      assert.equal(parseShellKnowledge(marker.knowledge!).get('nmsh_env_fn'), 'function', 'names still parse after the snapshot');
      assert.equal(knowledgeJobCount(marker.knowledge), 0);
    } finally { await stop(shell, home); }
  });
}
