import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {access, chmod, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import {syncBuiltinESMExports} from 'node:module';
import {ContextEngine} from '../src/context/engine.js';
import {CORE_CAPABILITIES} from '../src/context/registry.js';
import {resetServiceCaches} from '../src/context/services.js';
import type {ShellEnvironment} from '../src/context/shellEnvironment.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {buildContextLine, buildContextRail, buildRightContext, nativePromptSnapshot} from '../src/prompt/prompt.js';
import {resolvePromptContext} from '../src/shell/ShellContext.js';
import {allModuleDefinitions} from '../src/context/modules.js';
import {stripAnsi} from '../src/util/text.js';
import {setIconStyle} from '../src/ui/glyphs.js';

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const exists = (path: string) => access(path).then(() => true, () => false);

/** Every string anywhere in a value. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(item => strings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => strings(item, out));
  return out;
}

test('cd into a hostile repository: collection and repeated rendering execute nothing, contact nothing, leak nothing, and stay inert', {timeout: 120_000}, async () => {
  resetServiceCaches();
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'nmsh-hostile-')));
  const home = await realpath(await mkdtemp(join(tmpdir(), 'nmsh-hostile-home-')));
  const marker = join(repo, 'EXECUTED');
  const bait = `#!/bin/sh\n/usr/bin/touch '${marker}'\necho v1.2.3\n`;
  const SECRETS = ['AKIASECRETKEY00000001', 'SECRET_ACCESS_KEY_MATERIAL', 'ghp_tokenvalue', 'hunter2-password'];
  const evil = '\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007\u001b[2J\u202egnp.exe\u0007';
  try {
    // Executable bait under every name a context probe could plausibly run.
    for (const directory of ['bin', 'node_modules/.bin', '.venv/bin']) {
      await mkdir(join(repo, directory), {recursive: true});
      for (const name of ['node', 'python3', 'python', 'go', 'rustc', 'cargo', 'java', 'kubectl', 'aws', 'terraform', 'tofu', 'helm', 'pulumi', 'git', 'mise',
        'asdf', 'direnv', 'gcloud', 'az', 'docker', 'bun', 'deno', 'ruby', 'vm_stat', 'pmset']) {
        await writeFile(join(repo, directory, name), bait);
        await chmod(join(repo, directory, name), 0o755);
      }
    }
    await writeFile(join(repo, '.envrc'), bait); await chmod(join(repo, '.envrc'), 0o755);
    await writeFile(join(repo, 'mise.toml'), `[env]\n_.source = "./bin/node"\nTOKEN = "${SECRETS[2]}"\n[hooks]\nenter = "./bin/node"\n[tools]\nnode = "${evil}"\npython = "3.12"\n`);
    await writeFile(join(repo, '.tool-versions'), `nodejs 22 ${evil}\n`);
    await writeFile(join(repo, 'package.json'), JSON.stringify({name: `pkg${evil}`, version: `1.0.0${evil}`, packageManager: `pnpm@9.0.0${evil}`,
      scripts: {preinstall: './bin/node'}, engines: {node: '>=22'}}));
    await writeFile(join(repo, 'pyproject.toml'), '[project\nname = "broken');
    await writeFile(join(repo, 'go.mod'), 'module example.com/x\n\ngo 1.22\n\ntoolchain go1.99.0\n');
    await writeFile(join(repo, 'rust-toolchain.toml'), '[toolchain]\nchannel = "nightly-2099-01-01"\n');
    await writeFile(join(repo, 'Chart.yaml'), `name: chart\nversion: "${evil.replace(/"/gu, '')}"\n` + 'a: &a ["x","x","x","x","x","x","x","x","x"]\n'
      + Array.from({length: 12}, (_, i) => `l${i}: &l${i} [${Array(9).fill(i ? `*l${i - 1}` : '*a').join(',')}]`).join('\n') + '\n');
    await writeFile(join(repo, 'Pulumi.yaml'), 'name: "\\u001b[31mstack"\nruntime: nodejs\n');
    await writeFile(join(repo, 'main.tf'), 'terraform {}\n');
    await mkdir(join(repo, '.terraform'));
    await writeFile(join(repo, '.terraform', 'environment'), `prod${evil}`);
    await writeFile(join(repo, 'composer.json'), JSON.stringify({name: 'huge', padding: 'x'.repeat(2 * 1024 * 1024)}));
    await symlink('/etc/passwd', join(repo, 'Cargo.toml'));
    await writeFile(join(repo, 'deno.json'), '{"name": "unreadable"}'); await chmod(join(repo, 'deno.json'), 0o000);
    await mkdir(join(repo, 'fifo-dir'));
    try { execFileSync('/usr/bin/mkfifo', [join(repo, '.nvmrc')]); } catch { /* platforms without mkfifo still exercise the rest */ }
    await writeFile(join(repo, 'kubeconfig'), `current-context: "ctx${evil.replace(/"/gu, '')}"\ncontexts:\n- name: x\n  context: {namespace: ns}\nusers:\n- name: u\n  user:\n    exec:\n      command: ${join(repo, 'bin', 'kubectl')}\n      args: ["--token", "${SECRETS[2]}"]\n`);
    // Hostile Git configuration and metadata.
    execFileSync('/usr/bin/git', ['init', '-q', '-b', 'main', repo]);
    execFileSync('/usr/bin/git', ['-C', repo, 'config', 'core.fsmonitor', join(repo, 'bin', 'git')]);
    execFileSync('/usr/bin/git', ['-C', repo, 'config', 'core.hooksPath', join(repo, 'bin')]);
    execFileSync('/usr/bin/git', ['-C', repo, 'config', 'filter.evil.clean', join(repo, 'bin', 'git')]);
    await writeFile(join(repo, '.gitattributes'), '* filter=evil\n');
    await writeFile(join(repo, '.git', 'logs-refs-stash-placeholder'), '');
    // Secrets in the home directory that context must never surface.
    await mkdir(join(home, '.aws'));
    await writeFile(join(home, '.aws', 'config'), `[default]\nregion = eu-west-1\ncredential_process = ${join(repo, 'bin', 'aws')}\n`);
    await writeFile(join(home, '.aws', 'credentials'), `[default]\naws_access_key_id = ${SECRETS[0]}\naws_secret_access_key = ${SECRETS[1]}\naws_session_token = ${SECRETS[3]}\n`);

    // The live shell, as a hostile .envrc might have left it: workspace directories first on PATH.
    const env: ShellEnvironment = {source: 'shell', present: new Set(['AWS_SECRET_ACCESS_KEY', 'DIRENV_DIFF']),
      values: {PATH: `${join(repo, 'bin')}:${join(repo, 'node_modules', '.bin')}:/usr/bin:/bin`, KUBECONFIG: join(repo, 'kubeconfig'),
        VIRTUAL_ENV: join(repo, '.venv'), TF_DATA_DIR: '.terraform', DIRENV_FILE: join(repo, '.envrc'), JAVA_HOME: repo, AWS_CONFIG_FILE: join(home, '.aws', 'config')}};

    let network = 0;
    const forbidden = () => { network += 1; throw new Error('context collection attempted network access'); };
    const spies = [mock.method(http, 'request', forbidden), mock.method(https, 'request', forbidden), mock.method(net, 'connect', forbidden),
      mock.method(net, 'createConnection', forbidden), mock.method(dns, 'lookup', forbidden), mock.method(globalThis, 'fetch', forbidden)];
    syncBuiltinESMExports();
    try {
      const engine = new ContextEngine({capabilities: CORE_CAPABILITIES});
      const legacy = await resolvePromptContext(repo, undefined, home);
      const demand = new Map(CORE_CAPABILITIES.map(capability => [capability.id, new Set(capability.fields)]));
      for (let round = 0; round < 3; round += 1) {
        engine.stage({cwd: repo, home, root: legacy.root ?? repo, session: 'hostile', env, live: {jobs: 1, startedAt: 1}});
        engine.demand(demand);
        await engine.settle(10_000);
        engine.commit();
        engine.refresh();
      }
      await engine.settle(10_000);
      const facts = engine.facts();
      for (const text of strings(facts)) assert.ok(!CONTROL.test(text), `fact text is inert: ${JSON.stringify(text)}`);
      for (const secret of SECRETS) assert.ok(!JSON.stringify(facts).includes(secret), `secret never collected: ${secret}`);
      assert.equal((facts['runtime.node']?.value as {active?: string} | undefined)?.active, undefined, 'workspace binaries are never asked for versions');

      // Every module visible, on every surface, with every trigger word typed, rendered many times.
      setIconStyle('nerd');
      const configuration = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
      configuration.modules = configuration.modules.map(module => ({...module, visible: true, condition: 'always' as const}));
      const triggers = allModuleDefinitions().flatMap(definition => definition.triggers ?? []);
      const context = {...legacy, home, facts: {...facts}, commandWords: triggers, kubeContext: 'k'};
      const rendered: string[] = [];
      for (let i = 0; i < 20; i++) {
        for (const surface of ['mainPrompt', 'rightContext', 'contextRail'] as const) {
          const routed = {...configuration, modules: configuration.modules.map(module => ({...module, surface}))};
          rendered.push(buildContextLine(context, 200, routed), buildRightContext(context, 200, routed), ...buildContextRail(context, 200, {...routed, contextRail: {...routed.contextRail, rows: 2}}));
          rendered.push(JSON.stringify(nativePromptSnapshot(context, routed)));
        }
      }
      for (const text of rendered) {
        assert.ok(!CONTROL.test(stripAnsi(text)), `rendered output is inert: ${JSON.stringify(stripAnsi(text).slice(0, 120))}`);
        assert.ok(!/\u001b\]8;/u.test(text), 'no hyperlink escapes from facts');
        for (const secret of SECRETS) assert.ok(!text.includes(secret), `secret never rendered: ${secret}`);
      }
    } finally { spies.forEach(spy => spy.mock.restore()); syncBuiltinESMExports(); }
    assert.equal(network, 0, 'no network access');
    assert.equal(await exists(marker), false, `no repository code ran (${(await readdir(repo)).join(', ')})`);
  } finally {
    await chmod(join(repo, 'deno.json'), 0o600).catch(() => {});
    await rm(repo, {recursive: true, force: true});
    await rm(home, {recursive: true, force: true});
    resetServiceCaches();
  }
});
