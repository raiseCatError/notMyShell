import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {CapabilityDefinition} from '../src/context/capability.js';
import {projectPackage} from '../src/context/capabilities/project.js';
import {projectBuild} from '../src/context/capabilities/build.js';
import {bunRuntime, dartRuntime, denoRuntime, dotnetRuntime, elixirRuntime, flutterRuntime, goRuntime, javaRuntime, nodeRuntime, phpRuntime, pythonRuntime, rubyRuntime, rustRuntime, swiftRuntime, versionMismatch, zigRuntime} from '../src/context/capabilities/runtimes.js';
import {direnv, nixShell, toolVersions} from '../src/context/capabilities/environment.js';
import {docker, helmChart, kubernetes, pulumi, terraform} from '../src/context/capabilities/infrastructure.js';
import {aws, azure, gcp} from '../src/context/capabilities/cloud.js';
import {clock, container, operatingSystem, sessionDuration, sessionJobs, sessionUser} from '../src/context/capabilities/system.js';
import {gitExtras, jujutsu, mercurial} from '../src/context/capabilities/vcs.js';
import {resetServiceCaches, versionFromInstallPath} from '../src/context/services.js';
import {CORE_CAPABILITIES} from '../src/context/registry.js';

interface Scope {cwd: string; home?: string; root?: string; env?: Record<string, string>; present?: string[]; fields?: string[]; live?: {jobs?: number; startedAt?: number}}

async function resolve<V>(capability: CapabilityDefinition<V>, scope: Scope): Promise<V | undefined> {
  const values = scope.env ?? {};
  const result = await capability.resolve({cwd: scope.cwd, home: scope.home ?? scope.cwd, ...(scope.root ? {root: scope.root} : {}), session: 'test',
    env: {values, present: new Set([...Object.keys(values), ...(scope.present ?? [])]), source: 'shell'},
    fields: new Set(scope.fields ?? capability.fields), signal: new AbortController().signal, now: Date.now(), ...(scope.live ? {live: scope.live} : {})});
  return result?.value;
}

async function workspace(): Promise<string> { return realpath(await mkdtemp(join(tmpdir(), 'nmsh-cap-'))); }
const exists = (path: string) => access(path).then(() => true, () => false);
/** An executable that records it ran: anything NMSh must never execute uses this. */
async function sentinelExecutable(path: string, marker: string, output = ''): Promise<void> {
  await writeFile(path, `#!/bin/sh\n/usr/bin/touch '${marker}'\n${output ? `printf '%s\\n' '${output}'\n` : ''}`);
  await chmod(path, 0o755);
}

test('every core capability declares bounded, disclosed, policy-bearing behavior', () => {
  const ids = new Set<string>();
  for (const capability of CORE_CAPABILITIES) {
    assert.ok(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){1,3}$/u.test(capability.id), capability.id);
    assert.ok(!ids.has(capability.id), `${capability.id} unique`); ids.add(capability.id);
    assert.ok(capability.reads.length > 0, `${capability.id} discloses what it reads`);
    assert.ok(capability.timeoutMs > 0 && capability.timeoutMs <= 3000, `${capability.id} has a bounded timeout`);
    assert.ok(capability.ttlMs > 0, `${capability.id} has a freshness window`);
    assert.ok(capability.fields.length > 0);
    for (const name of capability.env) assert.ok(/^[A-Z_][A-Z0-9_]*$/u.test(name));
    assert.ok(capability.preview !== undefined, `${capability.id} has a deterministic preview`);
  }
});

test('project.package: nearest declarative manifest within the repository, precedence and package manager evidence', async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({name: 'root-app', version: '1.2.3', private: true, packageManager: 'pnpm@9.12.0+sha512.abc'}));
    await mkdir(join(root, 'packages', 'lib', 'src'), {recursive: true});
    await writeFile(join(root, 'packages', 'lib', 'package.json'), JSON.stringify({name: '@scope/lib', version: '0.4.0'}));
    assert.deepEqual(await resolve(projectPackage, {cwd: join(root, 'packages', 'lib', 'src'), root}),
      {ecosystem: 'npm', manifest: 'package.json', name: '@scope/lib', version: '0.4.0'}, 'nearest manifest wins (monorepo)');
    const top = await resolve(projectPackage, {cwd: root, root});
    assert.deepEqual(top, {ecosystem: 'npm', manifest: 'package.json', name: 'root-app', version: '1.2.3', private: true, manager: 'pnpm', managerVersion: '9.12.0'});
    assert.equal(await resolve(projectPackage, {cwd: join(root, 'packages', 'lib', 'src')}), undefined, 'outside a repository only the working directory counts');
    const field = await resolve(projectPackage, {cwd: root, root, fields: ['version']});
    assert.equal(field?.manager, undefined, 'undemanded fields are not collected');
    await rm(join(root, 'package.json'));
    await writeFile(join(root, 'Cargo.toml'), '[package]\nname = "crab"\nversion = "0.9.1"\n');
    await writeFile(join(root, 'Cargo.lock'), '');
    assert.deepEqual(await resolve(projectPackage, {cwd: root, root, fields: ['name', 'version']}), {ecosystem: 'cargo', manifest: 'Cargo.toml', name: 'crab', version: '0.9.1'});
    await rm(join(root, 'Cargo.toml'));
    await writeFile(join(root, 'pyproject.toml'), '[tool.poetry]\nname = "snake"\nversion = "2.0.0b1"\n');
    await writeFile(join(root, 'poetry.lock'), '');
    assert.deepEqual(await resolve(projectPackage, {cwd: root, root}), {ecosystem: 'python', manifest: 'pyproject.toml', name: 'snake', version: '2.0.0b1', manager: 'poetry'});
    await rm(join(root, 'pyproject.toml'));
    await writeFile(join(root, 'go.mod'), 'module github.com/example/tool/v2\n\ngo 1.22\n');
    assert.deepEqual(await resolve(projectPackage, {cwd: root, root, fields: ['name']}), {ecosystem: 'go', manifest: 'go.mod', name: 'tool'});
    await rm(join(root, 'go.mod'));
    await writeFile(join(root, 'pom.xml'), '<project><artifactId>svc</artifactId><version>${revision}</version></project>');
    assert.deepEqual(await resolve(projectPackage, {cwd: root, root, fields: ['name', 'version']}), {ecosystem: 'maven', manifest: 'pom.xml', name: 'svc'}, 'property placeholders are not versions');
    await writeFile(join(root, 'pom.xml'), '<!DOCTYPE p [<!ENTITY x "boom">]><project><artifactId>&x;</artifactId></project>');
    assert.equal(await resolve(projectPackage, {cwd: root, root}), undefined, 'XML entity declarations are refused');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('project.package refuses malformed, oversized and symlinked manifests', async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, 'package.json'), '{"name": "broken"');
    assert.equal(await resolve(projectPackage, {cwd: root, root}), undefined);
    await writeFile(join(root, 'package.json'), JSON.stringify({name: 'huge', version: '1.0.0', padding: 'x'.repeat(300 * 1024)}));
    assert.equal(await resolve(projectPackage, {cwd: root, root}), undefined, 'over the metadata bound');
    await rm(join(root, 'package.json'));
    const outside = join(await workspace(), 'package.json');
    await writeFile(outside, JSON.stringify({name: 'outside', version: '9.9.9'}));
    await symlink(outside, join(root, 'package.json'));
    assert.equal(await resolve(projectPackage, {cwd: root, root}), undefined, 'a symlinked manifest is not read');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('runtime.node: requested pins, install-layout versions, shims and workspace refusal; nothing is ever executed', async () => {
  resetServiceCaches();
  const root = await workspace();
  const tools = await workspace();
  try {
    await writeFile(join(root, '.nvmrc'), 'v22\n');
    const cellar = join(tools, 'Cellar', 'node', '22.11.0', 'bin');
    await mkdir(cellar, {recursive: true});
    await sentinelExecutable(join(cellar, 'node'), join(tools, 'CELLAR_RAN'));
    let fact = await resolve(nodeRuntime, {cwd: root, root, env: {PATH: cellar}});
    assert.deepEqual(fact, {requested: '22', requestedFrom: '.nvmrc', active: '22.11.0', manager: 'Homebrew'});
    assert.equal(await exists(join(tools, 'CELLAR_RAN')), false, 'versions from install layout need no process');
    // A workspace-controlled node first on PATH is never inspected or run.
    const bin = join(root, 'node_modules', '.bin');
    await mkdir(bin, {recursive: true});
    await sentinelExecutable(join(bin, 'node'), join(root, 'WORKSPACE_RAN'), 'v1.0.0');
    resetServiceCaches();
    fact = await resolve(nodeRuntime, {cwd: root, root, home: tools, env: {PATH: `${bin}:${cellar}`}});
    assert.equal(fact?.active, undefined);
    assert.match(fact?.note ?? '', /inside this workspace/u);
    // The home directory is not a workspace: tools under it (~/.local/bin, ~/.cargo/bin) are the user's own.
    resetServiceCaches();
    assert.notEqual((await resolve(nodeRuntime, {cwd: root, root, home: root, env: {PATH: `${bin}:${cellar}`}}))?.note?.includes('inside this workspace'), true);
    assert.equal(await exists(join(root, 'WORKSPACE_RAN')), false);
    // A version-manager shim selects versions itself: reported, never executed.
    const shims = join(tools, '.asdf', 'shims');
    await mkdir(shims, {recursive: true});
    await sentinelExecutable(join(shims, 'node'), join(tools, 'SHIM_RAN'), 'v5.0.0');
    resetServiceCaches();
    fact = await resolve(nodeRuntime, {cwd: root, root, env: {PATH: shims}});
    assert.equal(fact?.manager, 'asdf');
    assert.equal(fact?.active, undefined);
    assert.equal(await exists(join(tools, 'SHIM_RAN')), false);
    // A binary outside every known layout is still never run: its own installed header says the version, or it stays unknown.
    const prefix = join(tools, 'plain');
    await mkdir(join(prefix, 'bin'), {recursive: true});
    await sentinelExecutable(join(prefix, 'bin', 'node'), join(tools, 'PLAIN_RAN'), 'v23.1.0');
    resetServiceCaches();
    fact = await resolve(nodeRuntime, {cwd: root, root, env: {PATH: join(prefix, 'bin')}});
    assert.equal(fact?.active, undefined, 'no metadata, no guess');
    await mkdir(join(prefix, 'include', 'node'), {recursive: true});
    await writeFile(join(prefix, 'include', 'node', 'node_version.h'), '#define NODE_MAJOR_VERSION 23\n#define NODE_MINOR_VERSION 1\n#define NODE_PATCH_VERSION 0\n');
    resetServiceCaches();
    fact = await resolve(nodeRuntime, {cwd: root, root, env: {PATH: join(prefix, 'bin')}});
    assert.equal(fact?.active, '23.1.0');
    assert.equal(fact?.mismatch, true, '.nvmrc 22 is not satisfied by 23.1.0');
    assert.equal(await exists(join(tools, 'PLAIN_RAN')), false, 'context collection never executes a discovered binary');
    fact = await resolve(nodeRuntime, {cwd: root, root, env: {PATH: join(prefix, 'bin')}, fields: ['requested']});
    assert.equal(fact?.active, undefined, 'the active field is only collected when demanded');
    // Python: a versioned interpreter name is metadata too.
    const pythonPrefix = join(tools, 'py');
    await mkdir(join(pythonPrefix, 'bin'), {recursive: true});
    await sentinelExecutable(join(pythonPrefix, 'bin', 'python3.12'), join(tools, 'PY_RAN'), 'Python 3.12.7');
    await symlink(join(pythonPrefix, 'bin', 'python3.12'), join(pythonPrefix, 'bin', 'python3'));
    resetServiceCaches();
    assert.equal((await resolve(pythonRuntime, {cwd: root, root, env: {PATH: join(pythonPrefix, 'bin')}}))?.active, '3.12');
    assert.equal(await exists(join(tools, 'PY_RAN')), false);
  } finally { await rm(root, {recursive: true, force: true}); await rm(tools, {recursive: true, force: true}); resetServiceCaches(); }
});

test('runtime facts: Python environments, Go GOROOT metadata, rustup selection and JDK release files without running them', async () => {
  resetServiceCaches();
  const root = await workspace();
  const tools = await workspace();
  try {
    const venv = join(root, '.venv');
    await mkdir(venv);
    await writeFile(join(venv, 'pyvenv.cfg'), 'home = /usr/bin\nimplementation = CPython\nuv = 0.4.18\nversion_info = 3.12.7.final.0\n');
    await writeFile(join(root, '.python-version'), '3.11\n');
    const python = await resolve(pythonRuntime, {cwd: root, root, env: {VIRTUAL_ENV: venv, VIRTUAL_ENV_PROMPT: '(proj) '}});
    assert.deepEqual(python, {requested: '3.11', requestedFrom: '.python-version', environment: 'proj', environmentKind: 'uv', active: '3.12.7', mismatch: true});

    const goroot = join(tools, 'go');
    await mkdir(join(goroot, 'bin'), {recursive: true});
    await writeFile(join(goroot, 'VERSION'), 'go1.23.2\ntime 2024-10-01T00:00:00Z\n');
    await sentinelExecutable(join(goroot, 'bin', 'go'), join(tools, 'GO_RAN'), 'go version go9.9.9');
    await writeFile(join(root, 'go.mod'), 'module example.com/m\n\ngo 1.22\n\ntoolchain go1.23.2\n');
    const go = await resolve(goRuntime, {cwd: root, root, env: {PATH: join(goroot, 'bin')}});
    assert.deepEqual(go, {requested: '1.23.2', requestedFrom: 'go.mod', active: '1.23.2'});
    assert.equal(await exists(join(tools, 'GO_RAN')), false, 'GOROOT/VERSION, not `go version` (which may download toolchains)');

    const cargoBin = join(tools, '.cargo', 'bin');
    await mkdir(cargoBin, {recursive: true});
    await sentinelExecutable(join(cargoBin, 'rustc'), join(tools, 'RUSTC_RAN'));
    const rustupHome = join(tools, '.rustup');
    await mkdir(rustupHome);
    await writeFile(join(rustupHome, 'settings.toml'), `default_toolchain = "stable-aarch64-apple-darwin"\n[overrides]\n"${root}" = "nightly-2024-09-01-aarch64-apple-darwin"\n`);
    await writeFile(join(root, 'Cargo.toml'), '[package]\nname = "x"\nversion = "0.1.0"\nedition = "2021"\n');
    const rust = await resolve(rustRuntime, {cwd: root, root, env: {PATH: cargoBin, RUSTUP_HOME: rustupHome}});
    assert.equal(rust?.active, 'nightly-2024-09-01-aarch64-apple-darwin', 'directory override wins over the default');
    assert.equal(rust?.manager, 'rustup');
    assert.equal(rust?.environment, '2021');
    await writeFile(join(root, 'rust-toolchain.toml'), '[toolchain]\nchannel = "1.79.0"\n');
    assert.equal((await resolve(rustRuntime, {cwd: root, root, env: {PATH: cargoBin, RUSTUP_HOME: rustupHome}}))?.active, '1.79.0', 'the toolchain file wins');
    assert.equal(await exists(join(tools, 'RUSTC_RAN')), false, 'rustup proxies are never run (they can install toolchains)');

    const jdk = join(tools, 'jdk');
    await mkdir(join(jdk, 'bin'), {recursive: true});
    await writeFile(join(jdk, 'release'), 'IMPLEMENTOR="Eclipse Adoptium"\nJAVA_VERSION="21.0.5"\n');
    await writeFile(join(root, 'build.gradle.kts'), 'plugins { id("java") }\n');
    const java = await resolve(javaRuntime, {cwd: root, root, env: {JAVA_HOME: jdk}});
    assert.deepEqual(java, {active: '21.0.5', manager: 'JAVA_HOME', buildTool: 'gradle'});
  } finally { await rm(root, {recursive: true, force: true}); await rm(tools, {recursive: true, force: true}); resetServiceCaches(); }
});

test('version helpers: install layouts and mismatch only for concrete pins', () => {
  assert.deepEqual(versionFromInstallPath('/opt/homebrew/Cellar/node@20/20.18.0_1/bin/node'), {version: '20.18.0', manager: 'Homebrew'});
  assert.deepEqual(versionFromInstallPath('/Users/a/.nvm/versions/node/v22.4.0/bin/node'), {version: '22.4.0', manager: 'nvm'});
  assert.deepEqual(versionFromInstallPath('/Users/a/.local/share/mise/installs/python/3.12.7/bin/python3'), {version: '3.12.7', manager: 'mise'});
  assert.deepEqual(versionFromInstallPath('/Users/a/.local/share/uv/python/cpython-3.13.0-macos-aarch64-none/bin/python3'), {version: '3.13.0', manager: 'uv'});
  assert.equal(versionFromInstallPath('/usr/bin/node'), undefined);
  assert.equal(versionMismatch('22', '22.11.0'), false);
  assert.equal(versionMismatch('v20', '22.11.0'), true);
  assert.equal(versionMismatch('>=18', '22.11.0'), false, 'ranges are not judged');
  assert.equal(versionMismatch('lts/*', '22.11.0'), false);
});

test('environment managers: mise tool requests only, direnv state without reading .envrc', async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, 'mise.toml'), '[env]\n_.source = "./evil.sh"\nSECRET = "hunter2"\n[tools]\nnode = "22"\npython = ["3.12", "3.11"]\nterraform = {version = "1.9.0"}\n[tasks.x]\nrun = "rm -rf /"\n');
    const tools = await resolve(toolVersions, {cwd: root, root, present: ['MISE_SHELL']});
    assert.deepEqual(tools, {manager: 'mise', config: 'mise.toml', tools: [{name: 'node', version: '22'}, {name: 'python', version: '3.12'}, {name: 'terraform', version: '1.9.0'}],
      active: true, summary: 'node 22 · python 3.12 · terraform 1.9.0'});
    assert.ok(!JSON.stringify(tools).includes('hunter2') && !JSON.stringify(tools).includes('evil'), '[env], hooks and tasks are never interpreted');
    await writeFile(join(root, '.envrc'), 'touch SHOULD_NOT_RUN\nexport SECRET=1\n');
    await chmod(join(root, '.envrc'), 0o000);
    assert.deepEqual(await resolve(direnv, {cwd: root, root}), {state: 'pending', directory: root.split('/').at(-1)});
    assert.deepEqual(await resolve(direnv, {cwd: root, root, env: {DIRENV_FILE: join(root, '.envrc'), DIRENV_DIR: `-${root}`}}), {state: 'loaded', directory: root.split('/').at(-1)});
    assert.equal(await exists(join(root, 'SHOULD_NOT_RUN')), false);
  } finally { await chmod(join(root, '.envrc'), 0o600).catch(() => {}); await rm(root, {recursive: true, force: true}); }
});

test('Kubernetes and Docker contexts: merged KUBECONFIG, namespaces, exec plugins never run, alias bombs bounded', async () => {
  const home = await workspace();
  try {
    await mkdir(join(home, '.kube'));
    const sentinel = join(home, 'EXEC_RAN');
    await sentinelExecutable(join(home, 'auth-plugin'), sentinel);
    const first = join(home, 'a.yaml'), second = join(home, 'b.yaml');
    await writeFile(first, `apiVersion: v1\nkind: Config\ncontexts:\n- name: dev\n  context: {cluster: dev-cluster, namespace: web, user: dev}\nusers:\n- name: dev\n  user:\n    exec:\n      command: ${join(home, 'auth-plugin')}\n`);
    await writeFile(second, 'current-context: dev\ncontexts:\n- name: dev\n  context: {cluster: other, namespace: shadowed}\n');
    assert.deepEqual(await resolve(kubernetes, {cwd: home, home, env: {KUBECONFIG: `${first}:${second}`}}), {context: 'dev', namespace: 'web', cluster: 'dev-cluster'});
    assert.equal(await exists(sentinel), false, 'users[].exec is never run');
    const bomb = 'a: &a ["x","x","x","x","x","x","x","x"]\n' + Array.from({length: 20}, (_, i) => `l${i}: &l${i} [${Array(8).fill(i ? `*l${i - 1}` : '*a').join(',')}]`).join('\n') + '\ncurrent-context: bomb\n';
    await writeFile(join(home, '.kube', 'config'), bomb);
    const started = Date.now();
    const result = await resolve(kubernetes, {cwd: home, home});
    assert.ok(Date.now() - started < 2000, 'alias expansion is bounded');
    assert.equal(result?.context, 'bomb', 'falls back to the plain current-context line');
    assert.deepEqual(await resolve(docker, {cwd: home, home, env: {DOCKER_CONTEXT: 'remote'}}), {context: 'remote'});
    assert.deepEqual(await resolve(docker, {cwd: home, home}), {context: 'default'});
  } finally { await rm(home, {recursive: true, force: true}); }
});

test('Terraform, Helm and Pulumi read local files only', async () => {
  const root = await workspace();
  const home = await workspace();
  try {
    assert.equal(await resolve(terraform, {cwd: root, root}), undefined, 'no configuration, no module');
    await writeFile(join(root, 'main.tf'), 'terraform {}\n');
    assert.deepEqual(await resolve(terraform, {cwd: root, root}), {workspace: 'default', tool: 'terraform'});
    await mkdir(join(root, '.terraform'));
    await writeFile(join(root, '.terraform', 'environment'), 'staging');
    await writeFile(join(root, '.terraform.lock.hcl'), 'provider "registry.opentofu.org/hashicorp/aws" {}\n');
    assert.deepEqual(await resolve(terraform, {cwd: root, root}), {workspace: 'staging', tool: 'opentofu'});
    assert.deepEqual(await resolve(terraform, {cwd: root, root, env: {TF_WORKSPACE: 'prod'}}), {workspace: 'prod', tool: 'opentofu'});
    await writeFile(join(root, 'Chart.yaml'), 'apiVersion: v2\nname: web\nversion: 1.4.2\nappVersion: 1.10\n');
    assert.deepEqual(await resolve(helmChart, {cwd: root, root}), {name: 'web', version: '1.4.2', appVersion: '1.10'}, 'YAML scalars stay literal strings');
    await writeFile(join(root, 'Pulumi.yaml'), 'name: platform\nruntime: nodejs\n');
    const digest = createHash('sha1').update(join(root, 'Pulumi.yaml')).digest('hex');
    await mkdir(join(home, '.pulumi', 'workspaces'), {recursive: true});
    await writeFile(join(home, '.pulumi', 'workspaces', `platform-${digest}-workspace.json`), JSON.stringify({stack: 'dev'}));
    assert.deepEqual(await resolve(pulumi, {cwd: root, root, home}), {project: 'platform', stack: 'dev'});
    assert.deepEqual(await resolve(pulumi, {cwd: root, root, home, fields: ['project']}), {project: 'platform'}, 'the stack lookup is field demand');
  } finally { await rm(root, {recursive: true, force: true}); await rm(home, {recursive: true, force: true}); }
});

test('AWS: profile, region and SSO metadata; credentials file read only for expiry, secret values never surface', async () => {
  const home = await workspace();
  try {
    await mkdir(join(home, '.aws'));
    await writeFile(join(home, '.aws', 'config'), '[default]\nregion = us-east-1\n[profile dev]\nregion = eu-west-1\nsso_session = corp\nsso_account_id = 123456789012\n[profile ops]\nrole_arn = arn:aws:iam::210987654321:role/ops\ncredential_process = /usr/bin/false\n');
    await writeFile(join(home, '.aws', 'credentials'), '[default]\naws_access_key_id = AKIASECRETVALUE0001\naws_secret_access_key = SUPERSECRETKEYMATERIAL\n[dev]\naws_secret_access_key = DEVSECRETKEYMATERIAL\nx_security_token_expires = 2030-01-01T00:00:00Z\n');
    const plain = await resolve(aws, {cwd: home, home, fields: ['profile', 'region']});
    assert.deepEqual(plain, {profile: 'default', region: 'us-east-1', credentials: 'profile'});
    const dev = await resolve(aws, {cwd: home, home, env: {AWS_PROFILE: 'dev'}});
    assert.deepEqual(dev, {profile: 'dev', region: 'eu-west-1', account: '123456789012', sso: true, expiresAt: Date.parse('2030-01-01T00:00:00Z'), credentials: 'sso'});
    const ops = await resolve(aws, {cwd: home, home, env: {AWS_PROFILE: 'ops', AWS_REGION: 'ap-south-1'}, fields: ['profile', 'region', 'account', 'credentials']});
    assert.deepEqual(ops, {profile: 'ops', region: 'ap-south-1', account: '210987654321', credentials: 'process'}, 'credential_process is described, never run');
    const environment = await resolve(aws, {cwd: home, home, present: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']});
    assert.equal(environment?.credentials, 'environment');
    for (const value of [plain, dev, ops, environment]) assert.doesNotMatch(JSON.stringify(value), /SECRET|AKIA/u);
    assert.equal(aws.fieldPolicy?.account?.persistence, 'display-only');
    assert.equal(await resolve(aws, {cwd: home, home: await workspace()}), undefined, 'no configuration, no AWS fact');
  } finally { await rm(home, {recursive: true, force: true}); }
});

test('Google Cloud and Azure: active configuration and default subscription; identities are private fields', async () => {
  const home = await workspace();
  try {
    const gcloud = join(home, '.config', 'gcloud');
    await mkdir(join(gcloud, 'configurations'), {recursive: true});
    await writeFile(join(gcloud, 'active_config'), 'work\n');
    await writeFile(join(gcloud, 'configurations', 'config_work'), '[core]\nproject = my-project\naccount = me@example.com\n[compute]\nregion = europe-west1\n');
    assert.deepEqual(await resolve(gcp, {cwd: home, home}), {configuration: 'work', project: 'my-project', account: 'me@example.com', region: 'europe-west1'});
    assert.equal(gcp.fieldPolicy?.account?.sensitivity, 'private');
    assert.equal((await resolve(gcp, {cwd: home, home, env: {CLOUDSDK_ACTIVE_CONFIG_NAME: '../../etc'}})), undefined, 'configuration names are validated');
    await mkdir(join(home, '.azure'));
    await writeFile(join(home, '.azure', 'azureProfile.json'), '﻿' + JSON.stringify({subscriptions: [{name: 'Other', id: '1', isDefault: false},
      {name: 'Engineering', id: '00000000-0000-0000-0000-000000000001', tenantId: 't-1', environmentName: 'AzureCloud', isDefault: true, user: {name: 'me@example.com'}}]}));
    const subscription = await resolve(azure, {cwd: home, home});
    assert.deepEqual(subscription, {subscription: 'Engineering', subscriptionId: '00000000-0000-0000-0000-000000000001', tenantId: 't-1', cloud: 'AzureCloud'});
    assert.doesNotMatch(JSON.stringify(subscription), /me@example/u, 'signed-in user names are not read');
  } finally { await rm(home, {recursive: true, force: true}); }
});

test('system and session facts', async () => {
  const os = await resolve(operatingSystem, {cwd: '/'});
  assert.ok(os?.name && os.arch && os.platform === process.platform);
  const user = await resolve(sessionUser, {cwd: '/', present: ['SSH_CONNECTION']});
  assert.equal(user?.ssh, true);
  assert.equal((await resolve(sessionUser, {cwd: '/'}))?.ssh, false);
  assert.deepEqual(await resolve(sessionJobs, {cwd: '/', live: {jobs: 2}}), {count: 2});
  assert.equal(await resolve(sessionJobs, {cwd: '/', live: {jobs: 0}}), undefined, 'no jobs, no segment');
  assert.deepEqual(await resolve(sessionDuration, {cwd: '/', live: {startedAt: 1000}}), {startedAt: 1000});
  assert.ok(typeof (await resolve(clock, {cwd: '/'}))?.now === 'number');
});

test('vcs.git reads stash depth and upstream from Git files, including linked worktrees', async () => {
  const root = await workspace();
  try {
    const gitDir = join(root, '.git');
    await mkdir(join(gitDir, 'logs', 'refs'), {recursive: true});
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(gitDir, 'logs', 'refs', 'stash'), 'a b c\nd e f\n');
    await writeFile(join(gitDir, 'config'), '[core]\n\tfsmonitor = ./evil\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n');
    assert.deepEqual(await resolve(gitExtras, {cwd: root, root}), {stash: 2, upstream: 'origin/main'});
    const worktree = await workspace();
    await mkdir(join(gitDir, 'worktrees', 'wt'), {recursive: true});
    await writeFile(join(gitDir, 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(gitDir, 'worktrees', 'wt', 'commondir'), '../..\n');
    await writeFile(join(worktree, '.git'), `gitdir: ${join(gitDir, 'worktrees', 'wt')}\n`);
    assert.deepEqual(await resolve(gitExtras, {cwd: worktree, root: worktree}), {stash: 2, upstream: 'origin/main'});
    await rm(worktree, {recursive: true, force: true});
    assert.equal(await resolve(gitExtras, {cwd: root}), undefined, 'outside a repository there is nothing to read');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('runtime facts: Ruby and PHP from the project\'s own files and the install location, never by running them', async () => {
  resetServiceCaches();
  const root = await workspace();
  const tools = await workspace();
  try {
    const rbenv = join(tools, '.rbenv', 'versions', '3.3.5', 'bin');
    await mkdir(rbenv, {recursive: true});
    await sentinelExecutable(join(rbenv, 'ruby'), join(tools, 'RUBY_RAN'), 'ruby 9.9.9');
    await writeFile(join(root, '.ruby-version'), 'ruby-3.2.4\n');
    await writeFile(join(root, 'Gemfile'), 'source "https://rubygems.org"\nruby "3.1.0"\n');
    const ruby = await resolve(rubyRuntime, {cwd: root, root, env: {PATH: rbenv}});
    assert.deepEqual(ruby, {requested: '3.2.4', requestedFrom: '.ruby-version', active: '3.3.5', manager: 'rbenv', buildTool: 'bundler', mismatch: true});
    await rm(join(root, '.ruby-version'));
    assert.deepEqual((await resolve(rubyRuntime, {cwd: root, root, env: {PATH: rbenv}, fields: ['requested', 'requestedFrom']})), {requested: '3.1.0', requestedFrom: 'Gemfile', buildTool: 'bundler'});
    assert.equal(await exists(join(tools, 'RUBY_RAN')), false);

    const cellar = join(tools, 'opt', 'Cellar', 'php', '8.3.12', 'bin');
    await mkdir(cellar, {recursive: true});
    await sentinelExecutable(join(cellar, 'php'), join(tools, 'PHP_RAN'), 'PHP 9.9.9');
    await writeFile(join(root, 'composer.json'), JSON.stringify({require: {php: '^8.2'}}));
    const php = await resolve(phpRuntime, {cwd: root, root, env: {PATH: cellar}});
    assert.deepEqual(php, {requested: '^8.2', requestedFrom: 'composer.json', active: '8.3.12', manager: 'Homebrew', buildTool: 'composer'});
    assert.equal(await exists(join(tools, 'PHP_RAN')), false);
    // A ruby inside the workspace is never inspected.
    const planted = join(root, 'bin');
    await mkdir(planted);
    await sentinelExecutable(join(planted, 'ruby'), join(root, 'PLANTED_RAN'), 'ruby 1.0.0');
    // An rbenv-shaped layout inside the workspace would report 6.6.6 if the boundary did not hold; home is outside it, as for a real project.
    const layout = join(root, '.rbenv', 'versions', '6.6.6', 'bin');
    await mkdir(layout, {recursive: true});
    await sentinelExecutable(join(layout, 'ruby'), join(root, 'PLANTED_RAN'), 'ruby 6.6.6');
    resetServiceCaches();
    const refused = await resolve(rubyRuntime, {cwd: root, root, home: tools, env: {PATH: layout}});
    assert.equal(refused?.active, undefined);
    assert.match(refused?.note ?? '', /inside this workspace/u);
    assert.equal((await resolve(rubyRuntime, {cwd: root, root, home: tools, env: {PATH: planted}}))?.active, undefined);
    assert.equal(await exists(join(root, 'PLANTED_RAN')), false);
  } finally { await rm(root, {recursive: true, force: true}); await rm(tools, {recursive: true, force: true}); resetServiceCaches(); }
});

test('runtime facts: .NET, Swift, Zig and Deno from the project\'s own files and the install location, never by running them', async () => {
  resetServiceCaches();
  const root = await workspace();
  const tools = await workspace();
  try {
    const cellar = (name: string, version: string) => join(tools, 'opt', 'Cellar', name, version, 'bin');
    const install = async (name: string, version: string, binary = name) => {
      const bin = cellar(name, version);
      await mkdir(bin, {recursive: true});
      await sentinelExecutable(join(bin, binary), join(tools, `${name.toUpperCase()}_RAN`), `${name} 9.9.9`);
      return bin;
    };
    await writeFile(join(root, 'global.json'), JSON.stringify({sdk: {version: '8.0.100'}}));
    assert.deepEqual(await resolve(dotnetRuntime, {cwd: root, root, env: {PATH: await install('dotnet', '8.0.404')}}), {requested: '≥8.0.100', requestedFrom: 'global.json', active: '8.0.404', manager: 'Homebrew'});

    await writeFile(join(root, 'Package.swift'), '// swift-tools-version: 5.9\nimport PackageDescription\n');
    resetServiceCaches();
    assert.deepEqual(await resolve(swiftRuntime, {cwd: root, root, env: {PATH: await install('swift', '5.10.1')}}), {requested: '≥5.9', requestedFrom: 'Package.swift', active: '5.10.1', manager: 'Homebrew', buildTool: 'swiftpm'});

    await writeFile(join(root, 'build.zig.zon'), '.{ .name = "x", .version = "0.1.0", .minimum_zig_version = "0.13.0" }\n');
    resetServiceCaches();
    assert.deepEqual(await resolve(zigRuntime, {cwd: root, root, env: {PATH: await install('zig', '0.13.0')}}), {requested: '≥0.13.0', requestedFrom: 'build.zig.zon', active: '0.13.0', manager: 'Homebrew'});

    await writeFile(join(root, '.dvmrc'), '2.0.0\n');
    resetServiceCaches();
    assert.deepEqual(await resolve(denoRuntime, {cwd: root, root, env: {PATH: await install('deno', '2.1.4')}}), {requested: '2.0.0', requestedFrom: '.dvmrc', active: '2.1.4', manager: 'Homebrew', mismatch: true});

    for (const name of ['DOTNET', 'SWIFT', 'ZIG', 'DENO']) assert.equal(await exists(join(tools, `${name}_RAN`)), false, `${name} was never run`);
    // Nothing is claimed when the project asks for nothing and the demand is only for the project's own request.
    const empty = await workspace();
    try { assert.equal(await resolve(zigRuntime, {cwd: empty, root: empty, env: {PATH: ''}, fields: ['requested']}), undefined); } finally { await rm(empty, {recursive: true, force: true}); }
    // A binary planted in the workspace is never inspected.
    const planted = join(root, 'planted');
    await mkdir(planted);
    await sentinelExecutable(join(planted, 'deno'), join(root, 'PLANTED_RAN'), 'deno 1.0.0');
    const layout = join(root, 'opt', 'Cellar', 'deno', '6.6.6', 'bin');
    await mkdir(layout, {recursive: true});
    await sentinelExecutable(join(layout, 'deno'), join(root, 'PLANTED_RAN'), 'deno 6.6.6');
    resetServiceCaches();
    const refused = await resolve(denoRuntime, {cwd: root, root, home: tools, env: {PATH: layout}});
    assert.equal(refused?.active, undefined, 'a Homebrew-shaped layout inside the workspace is not inspected');
    assert.match(refused?.note ?? '', /inside this workspace/u);
    assert.equal(await exists(join(root, 'PLANTED_RAN')), false);
  } finally { await rm(root, {recursive: true, force: true}); await rm(tools, {recursive: true, force: true}); resetServiceCaches(); }
});

test('runtime manifests with huge whitespace runs are read in linear time', async () => {
  resetServiceCaches();
  const root = await workspace();
  try {
    const timed = async <V>(capability: CapabilityDefinition<V>) => {
      const started = performance.now();
      const value = await resolve(capability, {cwd: root, root, env: {PATH: ''}, fields: ['requested', 'requestedFrom']});
      return {value, ms: performance.now() - started};
    };
    // A pattern whose leading whitespace may span lines restarts at every line and rescans the rest: ~0.7 s for this Gemfile.
    const hostile = '\n \t'.repeat(21_000);
    await writeFile(join(root, 'Gemfile'), `${hostile}gem "rails"\n`);
    const missing = await timed(rubyRuntime);
    assert.equal(missing.value?.requested, undefined);
    assert.ok(missing.ms < 250, `no declaration: ${Math.round(missing.ms)} ms`);
    await writeFile(join(root, 'Gemfile'), `${hostile}ruby "3.3.0"\n`);
    const found = await timed(rubyRuntime);
    assert.deepEqual(found.value, {requested: '3.3.0', requestedFrom: 'Gemfile', buildTool: 'bundler'});
    assert.ok(found.ms < 250, `declaration after the run: ${Math.round(found.ms)} ms`);

    await writeFile(join(root, 'Package.swift'), `// swift-tools-version${' \n//'.repeat(20_000)}\n`);
    const swift = await timed(swiftRuntime);
    assert.equal(swift.value?.requested, undefined);
    assert.ok(swift.ms < 250, `${Math.round(swift.ms)} ms`);
    await writeFile(join(root, 'go.mod'), `module x\n${'go \n'.repeat(15_000)}`);
    const go = await timed(goRuntime);
    assert.equal(go.value, undefined);
    assert.ok(go.ms < 250, `${Math.round(go.ms)} ms`);
  } finally { await rm(root, {recursive: true, force: true}); resetServiceCaches(); }
});

test('Ruby manifest whitespace stays bounded and declarations never span lines', async () => {
  resetServiceCaches();
  const root = await workspace();
  try {
    await writeFile(join(root, 'Gemfile'), `${'\n \t'.repeat(20_000)}ruby\n"3.3.0"\n`);
    const started = Date.now();
    const result = await resolve(rubyRuntime, {cwd: root, root, env: {PATH: ''}, fields: ['requested', 'requestedFrom']});
    assert.equal(result?.requested, undefined, 'a different line is not a literal Ruby version declaration');
    assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms`);
    await writeFile(join(root, 'Gemfile'), ' \truby "3.3.0"\n');
    assert.equal((await resolve(rubyRuntime, {cwd: root, root, env: {PATH: ''}, fields: ['requested']}))?.requested, '3.3.0');
  } finally { await rm(root, {recursive: true, force: true}); resetServiceCaches(); }
});

test('runtime manifests: declarations are read only where their tools read them', async () => {
  resetServiceCaches();
  const root = await workspace();
  try {
    const requested = async <V>(capability: CapabilityDefinition<V>) => resolve(capability, {cwd: root, root, env: {PATH: ''}, fields: ['requested', 'requestedFrom']});
    // SwiftPM reads swift-tools-version from the first line only, and real manifests are often larger than a few KiB.
    await writeFile(join(root, 'Package.swift'), `// swift-tools-version:5.10\nimport PackageDescription\n${'// padding\n'.repeat(1000)}`);
    assert.equal((await requested(swiftRuntime))?.requested, '≥5.10');
    await writeFile(join(root, 'Package.swift'), 'import PackageDescription\n// swift-tools-version:5.10\n');
    assert.equal((await requested(swiftRuntime))?.requested, undefined, 'a later line is not the declaration');
    await writeFile(join(root, 'Package.swift'), '//\n swift-tools-version:5.10\n');
    assert.equal((await requested(swiftRuntime))?.requested, undefined, 'the declaration does not span lines');
    // go.mod directives are single lines; a trailing comment is allowed, a line break is not.
    await writeFile(join(root, 'go.mod'), 'module x\r\n\r\ngo 1.22 // minimum\r\n');
    assert.equal((await requested(goRuntime))?.requested, '1.22');
    await writeFile(join(root, 'go.mod'), 'module x\n\ngo\n1.22\n');
    assert.equal(await requested(goRuntime), undefined);
    // asdf's .NET plugin is dotnet-core.
    await writeFile(join(root, '.tool-versions'), 'dotnet-core 8.0.404\n');
    assert.deepEqual(await requested(dotnetRuntime), {requested: '8.0.404', requestedFrom: '.tool-versions'});
  } finally { await rm(root, {recursive: true, force: true}); resetServiceCaches(); }
});

test('Ruby install layouts: RVM and chruby/ruby-install rubies', () => {
  assert.deepEqual(versionFromInstallPath('/Users/me/.rvm/rubies/ruby-3.2.2/bin/ruby'), {version: '3.2.2', manager: 'RVM'});
  assert.deepEqual(versionFromInstallPath('/Users/me/.rubies/ruby-3.3.5/bin/ruby'), {version: '3.3.5', manager: 'chruby'});
  assert.equal(versionFromInstallPath('/Users/me/.rubies/truffleruby-24.1.0/bin/ruby'), undefined, 'other implementations stay unknown');
});

test('runtime facts: Elixir, Dart and Flutter from the project\'s own files and the SDK\'s metadata, never by running them', async () => {
  resetServiceCaches();
  const root = await workspace();
  const tools = await workspace();
  try {
    // Elixir: mix.exs requirement; a distribution layout (/usr/lib/elixir) is identified by its elixir.app, not by running bin/elixir.
    const elixirHome = join(tools, 'usr', 'lib', 'elixir');
    await mkdir(join(elixirHome, 'bin'), {recursive: true});
    await mkdir(join(elixirHome, 'lib', 'elixir', 'ebin'), {recursive: true});
    await sentinelExecutable(join(elixirHome, 'bin', 'elixir'), join(tools, 'ELIXIR_RAN'), 'Elixir 9.9.9');
    await writeFile(join(elixirHome, 'lib', 'elixir', 'ebin', 'elixir.app'), '{application,elixir,\n [{description,"elixir"},\n  {vsn,"1.17.3"},\n  {modules,[]}]}.\n');
    await writeFile(join(root, 'mix.exs'), 'defmodule App.MixProject do\n  use Mix.Project\n  def project do\n    [app: :app, version: "0.1.0", elixir: "~> 1.17", deps: deps()]\n  end\nend\n');
    // The requirement is on a keyword line inside project/0: `elixir:` at the start of a line or after `[`.
    await writeFile(join(root, 'mix.exs'), 'defmodule App.MixProject do\n  def project do\n    [\n      app: :app,\n      elixir: "~> 1.17",\n    ]\n  end\nend\n');
    assert.deepEqual(await resolve(elixirRuntime, {cwd: root, root, env: {PATH: join(elixirHome, 'bin')}}),
      {requested: '~> 1.17', requestedFrom: 'mix.exs', active: '1.17.3', buildTool: 'mix'});
    await writeFile(join(root, '.tool-versions'), 'elixir 1.16.3-otp-26\nerlang 26.2\n');
    resetServiceCaches();
    const asdf = join(tools, '.asdf', 'installs', 'elixir', '1.17.3-otp-27', 'bin');
    await mkdir(asdf, {recursive: true});
    await sentinelExecutable(join(asdf, 'elixir'), join(tools, 'ELIXIR_RAN'), 'Elixir 9.9.9');
    await writeFile(join(root, 'mix.exs'), 'defmodule App.MixProject do\nend\n');
    assert.deepEqual(await resolve(elixirRuntime, {cwd: root, root, env: {PATH: asdf}}),
      {requested: '1.16.3-otp-26', requestedFrom: '.tool-versions', active: '1.17.3-otp-27', manager: 'asdf', buildTool: 'mix'}, 'mix.exs without a requirement falls back to .tool-versions; an OTP-qualified pin is not judged');
    await rm(join(root, '.tool-versions'));

    // Dart: pubspec constraint; the SDK's own version file. Flutter's bin/dart wrapper reads the bundled SDK, not Flutter's version.
    const dartSdk = join(tools, 'dart-sdk');
    await mkdir(join(dartSdk, 'bin'), {recursive: true});
    await sentinelExecutable(join(dartSdk, 'bin', 'dart'), join(tools, 'DART_RAN'), 'Dart SDK version: 9.9.9');
    await writeFile(join(dartSdk, 'version'), '3.5.4\n');
    await writeFile(join(root, 'pubspec.yaml'), 'name: app\nenvironment:\n  sdk: ^3.5.0\n  flutter: ">=3.24.0"\ndependencies:\n  flutter:\n    sdk: flutter\n');
    resetServiceCaches();
    assert.deepEqual(await resolve(dartRuntime, {cwd: root, root, env: {PATH: join(dartSdk, 'bin')}}),
      {requested: '^3.5.0', requestedFrom: 'pubspec.yaml', active: '3.5.4', buildTool: 'pub'});
    const flutterRoot = join(tools, 'fvm', 'versions', '3.24.3');
    await mkdir(join(flutterRoot, 'bin', 'cache', 'dart-sdk'), {recursive: true});
    await sentinelExecutable(join(flutterRoot, 'bin', 'flutter'), join(tools, 'FLUTTER_RAN'), 'Flutter 9.9.9');
    await sentinelExecutable(join(flutterRoot, 'bin', 'dart'), join(tools, 'DART_RAN'), 'Dart 9.9.9');
    await writeFile(join(flutterRoot, 'version'), '3.24.3\n');
    await writeFile(join(flutterRoot, 'bin', 'cache', 'dart-sdk', 'version'), '3.5.3\n');
    await writeFile(join(flutterRoot, 'bin', 'cache', 'flutter.version.json'), JSON.stringify({frameworkVersion: '3.24.3', channel: 'stable', dartSdkVersion: '3.5.3'}));
    resetServiceCaches();
    assert.equal((await resolve(dartRuntime, {cwd: root, root, env: {PATH: join(flutterRoot, 'bin')}}))?.active, '3.5.3', 'the bundled Dart SDK, not Flutter\'s version');

    // Flutter: .fvmrc wins over pubspec; the install's flutter.version.json; FVM layout names the manager.
    await writeFile(join(root, '.fvmrc'), JSON.stringify({flutter: '3.22.0'}));
    resetServiceCaches();
    assert.deepEqual(await resolve(flutterRuntime, {cwd: root, root, env: {PATH: join(flutterRoot, 'bin')}}),
      {requested: '3.22.0', requestedFrom: '.fvmrc', active: '3.24.3', manager: 'FVM', mismatch: true});
    await rm(join(root, '.fvmrc'));
    await mkdir(join(root, '.fvm'));
    await writeFile(join(root, '.fvm', 'fvm_config.json'), JSON.stringify({flutterSdkVersion: '3.24.3'}));
    assert.deepEqual(await resolve(flutterRuntime, {cwd: root, root, env: {PATH: ''}, fields: ['requested', 'requestedFrom']}), {requested: '3.24.3', requestedFrom: 'fvm_config.json'});
    await rm(join(root, '.fvm'), {recursive: true});
    assert.deepEqual(await resolve(flutterRuntime, {cwd: root, root, env: {PATH: ''}, fields: ['requested', 'requestedFrom']}), {requested: '>=3.24.0', requestedFrom: 'pubspec.yaml'});
    // A pure Dart package is not a Flutter project.
    await writeFile(join(root, 'pubspec.yaml'), 'name: cli\nenvironment:\n  sdk: ^3.5.0\n');
    assert.equal(await resolve(flutterRuntime, {cwd: root, root, env: {PATH: ''}, fields: ['requested', 'requestedFrom']}), undefined);

    // An FVM SDK linked inside the project is workspace-controlled: never inspected.
    await writeFile(join(root, '.fvmrc'), JSON.stringify({flutter: '3.24.3'}));
    const local = join(root, '.fvm', 'flutter_sdk', 'bin');
    await mkdir(local, {recursive: true});
    await sentinelExecutable(join(local, 'flutter'), join(root, 'PLANTED_RAN'), 'Flutter 1.0.0');
    await mkdir(join(local, 'cache'));
    await writeFile(join(local, 'cache', 'flutter.version.json'), JSON.stringify({frameworkVersion: '6.6.6'}));
    resetServiceCaches();
    // home is outside the workspace, as it is for a real project, so the workspace boundary applies.
    const planted = await resolve(flutterRuntime, {cwd: root, root, home: tools, env: {PATH: local}});
    assert.equal(planted?.active, undefined);
    assert.match(planted?.note ?? '', /inside this workspace/u);
    for (const name of ['ELIXIR', 'DART', 'FLUTTER']) assert.equal(await exists(join(tools, `${name}_RAN`)), false, `${name} was never run`);
    assert.equal(await exists(join(root, 'PLANTED_RAN')), false);
  } finally { await rm(root, {recursive: true, force: true}); await rm(tools, {recursive: true, force: true}); resetServiceCaches(); }
});

test('pubspec.yaml and mix.exs are data: aliases, tags and huge or hostile values are not expanded or trusted', async () => {
  resetServiceCaches();
  const root = await workspace();
  try {
    const bomb = 'a: &a ["x","x","x","x","x","x","x","x","x"]\n' + Array.from({length: 12}, (_, i) => `l${i}: &l${i} [${Array(9).fill(i ? `*l${i - 1}` : '*a').join(',')}]`).join('\n');
    await writeFile(join(root, 'pubspec.yaml'), `${bomb}\nenvironment:\n  sdk: !!js/function "function(){}"\n  flutter: *l11\n`);
    const started = performance.now();
    const dart = await resolve(dartRuntime, {cwd: root, root, env: {PATH: ''}, fields: ['requested', 'requestedFrom']});
    assert.ok(performance.now() - started < 500);
    assert.equal(dart?.requested, undefined, 'a tagged or aliased value is not a version');
    await writeFile(join(root, 'mix.exs'), `${'\n \t'.repeat(20_000)}x\n`);
    const elixirStarted = performance.now();
    assert.equal((await resolve(elixirRuntime, {cwd: root, root, env: {PATH: ''}, fields: ['requested', 'requestedFrom']}))?.requested, undefined);
    assert.ok(performance.now() - elixirStarted < 250);
  } finally { await rm(root, {recursive: true, force: true}); resetServiceCaches(); }
});

test('install layouts: FVM and Homebrew casks', () => {
  assert.deepEqual(versionFromInstallPath('/Users/me/fvm/versions/3.24.3/bin/flutter'), {version: '3.24.3', manager: 'FVM'});
  assert.deepEqual(versionFromInstallPath('/opt/homebrew/Caskroom/flutter/3.24.3/flutter/bin/flutter'), {version: '3.24.3', manager: 'Homebrew'});
  assert.deepEqual(versionFromInstallPath('/opt/homebrew/Caskroom/dotnet-sdk/8.0.404,abc123/dotnet'), {version: '8.0.404', manager: 'Homebrew'});
});

test('project.build: the build system and the version the project pins for it, without running a wrapper or build file', async () => {
  const root = await workspace();
  try {
    const at = (cwd = root) => resolve(projectBuild, {cwd, root});
    assert.equal(await at(), undefined, 'no build files, no fact');
    await writeFile(join(root, 'Makefile'), 'all:\n\ttouch MAKE_RAN\n');
    assert.deepEqual(await at(), {tool: 'make', file: 'Makefile'});

    // Gradle: the wrapper's distributionUrl names the version; gradlew is a sentinel that must never run.
    await writeFile(join(root, 'settings.gradle.kts'), 'rootProject.name = "app"\n');
    await sentinelExecutable(join(root, 'gradlew'), join(root, 'GRADLEW_RAN'), 'Gradle 9.9.9');
    await mkdir(join(root, 'gradle', 'wrapper'), {recursive: true});
    await writeFile(join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      'distributionBase=GRADLE_USER_HOME\r\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-bin.zip\r\nzipStorePath=wrapper/dists\r\n');
    assert.deepEqual(await at(), {tool: 'gradle', file: 'settings.gradle.kts', version: '8.10.2', versionFrom: 'gradle-wrapper.properties'});
    // A subproject finds the wrapper at the root.
    await mkdir(join(root, 'app', 'src'), {recursive: true});
    await writeFile(join(root, 'app', 'build.gradle.kts'), 'plugins { id("java") }\n');
    assert.deepEqual(await at(join(root, 'app', 'src')), {tool: 'gradle', file: 'build.gradle.kts', version: '8.10.2', versionFrom: 'gradle-wrapper.properties'});
    assert.equal(await exists(join(root, 'GRADLEW_RAN')), false);
    await rm(join(root, 'app'), {recursive: true});
    for (const name of ['settings.gradle.kts', 'gradlew']) await rm(join(root, name));
    await rm(join(root, 'gradle'), {recursive: true});

    // Maven wrapper.
    await writeFile(join(root, 'pom.xml'), '<project><artifactId>app</artifactId></project>');
    await mkdir(join(root, '.mvn', 'wrapper'), {recursive: true});
    await writeFile(join(root, '.mvn', 'wrapper', 'maven-wrapper.properties'), 'wrapperVersion=3.3.2\ndistributionUrl=https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.9/apache-maven-3.9.9-bin.zip\n');
    assert.deepEqual(await at(), {tool: 'maven', file: 'pom.xml', version: '3.9.9', versionFrom: 'maven-wrapper.properties'});
    await rm(join(root, 'pom.xml')); await rm(join(root, '.mvn'), {recursive: true});

    // CMake: a subdirectory without a declaration uses the nearest one that has it; the command is case-insensitive.
    await writeFile(join(root, 'CMakeLists.txt'), '# top\nCMAKE_MINIMUM_REQUIRED(VERSION 3.20...3.28)\nproject(app)\nadd_subdirectory(lib)\n');
    await mkdir(join(root, 'lib'));
    await writeFile(join(root, 'lib', 'CMakeLists.txt'), 'add_library(lib lib.c)\n');
    assert.deepEqual(await at(join(root, 'lib')), {tool: 'cmake', file: 'CMakeLists.txt', version: '≥3.20', versionFrom: 'CMakeLists.txt'});
    await rm(join(root, 'lib'), {recursive: true}); await rm(join(root, 'CMakeLists.txt'));

    await writeFile(join(root, 'meson.build'), "project('app', 'c',\n  version : '1.0',\n  meson_version : '>= 1.1.0')\n");
    assert.deepEqual(await at(), {tool: 'meson', file: 'meson.build', version: '≥1.1.0', versionFrom: 'meson.build'});
    await rm(join(root, 'meson.build'));

    // Bazel: the nearest marker wins over a Makefile in the same directory; .bazelversion is Bazelisk's pin.
    await writeFile(join(root, 'MODULE.bazel'), 'module(name = "app")\n');
    await writeFile(join(root, '.bazelversion'), '7.4.1\n');
    assert.deepEqual(await at(), {tool: 'bazel', file: 'MODULE.bazel', version: '7.4.1', versionFrom: '.bazelversion'});
    assert.deepEqual(await resolve(projectBuild, {cwd: root, root, fields: ['tool']}), {tool: 'bazel', file: 'MODULE.bazel'}, 'versions only on demand');
    assert.equal(await exists(join(root, 'MAKE_RAN')), false);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('project.build: hostile build metadata is bounded text, never a version it does not state', async () => {
  const root = await workspace();
  try {
    await writeFile(join(root, 'settings.gradle'), '');
    await mkdir(join(root, 'gradle', 'wrapper'), {recursive: true});
    const properties = join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    await writeFile(properties, `distributionUrl=https://evil.example/gradle-8.10.2-bin.zip\u001b]8;;x\u0007\n`);
    assert.equal((await resolve(projectBuild, {cwd: root, root}))?.version, undefined, 'a value with trailing controls is not a version');
    await writeFile(properties, `${'distributionUrl'.repeat(4000)}=${' '.repeat(4000)}\n`);
    assert.equal((await resolve(projectBuild, {cwd: root, root}))?.version, undefined);
    await rm(properties);
    await symlink('/etc/passwd', properties);
    assert.equal((await resolve(projectBuild, {cwd: root, root}))?.version, undefined, 'symlinked metadata is not read');
    await rm(join(root, 'gradle'), {recursive: true}); await rm(join(root, 'settings.gradle'));
    await writeFile(join(root, 'CMakeLists.txt'), `${'\n \t'.repeat(20_000)}x\n`);
    const started = performance.now();
    assert.deepEqual(await resolve(projectBuild, {cwd: root, root}), {tool: 'cmake', file: 'CMakeLists.txt'});
    assert.ok(performance.now() - started < 250);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('vcs.hg and vcs.jj: Mercurial and Jujutsu state from their own directories, found upward without Git, never by running hg or jj', async () => {
  const home = await workspace();
  try {
    const repo = join(home, 'src', 'project');
    const deep = join(repo, 'a', 'b');
    await mkdir(join(repo, '.hg'), {recursive: true});
    await mkdir(deep, {recursive: true});
    // No .hg/branch: the default branch. The Git-derived root is absent, as it is in a Mercurial-only repository.
    assert.deepEqual(await resolve(mercurial, {cwd: deep, home}), {branch: 'default'});
    await writeFile(join(repo, '.hg', 'branch'), 'stable\n');
    await writeFile(join(repo, '.hg', 'bookmarks.current'), 'feature-x');
    assert.deepEqual(await resolve(mercurial, {cwd: deep, home}), {branch: 'stable', bookmark: 'feature-x'});
    assert.deepEqual(await resolve(mercurial, {cwd: deep, home, fields: ['branch']}), {branch: 'stable'}, 'the bookmark is read only when demanded');
    // Hostile names are bounded; control characters are removed at the fact boundary (sanitizeFactValue), not trusted here.
    await writeFile(join(repo, '.hg', 'branch'), `${'x'.repeat(300)}\n`);
    assert.equal((await resolve(mercurial, {cwd: repo, home}))?.branch, 'default', 'an oversized name is not a name');
    await rm(join(repo, '.hg', 'branch'));
    await symlink('/etc/passwd', join(repo, '.hg', 'branch'));
    assert.equal((await resolve(mercurial, {cwd: repo, home}))?.branch, 'default', 'a symlinked branch file is not read');

    // The search stops at home: a .hg above home is not this directory's repository.
    const outerHome = join(home, 'users', 'me');
    await mkdir(join(outerHome, 'work'), {recursive: true});
    await mkdir(join(home, 'users', '.hg'));
    assert.equal(await resolve(mercurial, {cwd: join(outerHome, 'work'), home: outerHome}), undefined);
    await mkdir(join(outerHome, '.hg'));
    assert.deepEqual(await resolve(mercurial, {cwd: join(outerHome, 'work'), home: outerHome}), {branch: 'default'}, 'a repository at home itself is found');

    // Jujutsu: the main workspace holds .jj/repo as a directory, a secondary one as a file; Git may be colocated.
    const jjRepo = join(home, 'jj');
    await mkdir(join(jjRepo, '.jj', 'repo'), {recursive: true});
    await mkdir(join(jjRepo, 'src'));
    assert.deepEqual(await resolve(jujutsu, {cwd: join(jjRepo, 'src'), home}), {repository: true, colocated: false, workspace: 'main'});
    await mkdir(join(jjRepo, '.git'));
    assert.deepEqual(await resolve(jujutsu, {cwd: jjRepo, home}), {repository: true, colocated: true, workspace: 'main'});
    const second = join(home, 'jj-second');
    await mkdir(join(second, '.jj'), {recursive: true});
    await writeFile(join(second, '.jj', 'repo'), join(jjRepo, '.jj', 'repo'));
    assert.deepEqual(await resolve(jujutsu, {cwd: second, home}), {repository: true, colocated: false, workspace: 'secondary'});
    assert.equal(await resolve(jujutsu, {cwd: join(home, 'src'), home}), undefined);
  } finally { await rm(home, {recursive: true, force: true}); }
});

test('v0.21 modules: Bun from its own files, a Nix shell from IN_NIX_SHELL, a container from markers and host variables; nothing run', async () => {
  resetServiceCaches();
  const root = await workspace();
  const tools = await workspace();
  try {
    const cellar = join(tools, 'Cellar', 'bun', '1.1.34', 'bin');
    await mkdir(cellar, {recursive: true});
    await sentinelExecutable(join(cellar, 'bun'), join(tools, 'BUN_RAN'), '9.9.9');
    // Corepack's pin is exact; engines is a range; .bun-version wins over both.
    await writeFile(join(root, 'package.json'), JSON.stringify({packageManager: 'bun@1.1.30', engines: {bun: '>=1.0'}}));
    assert.deepEqual(await resolve(bunRuntime, {cwd: root, root, env: {PATH: cellar}}), {requested: '1.1.30', requestedFrom: 'package.json packageManager', active: '1.1.34', manager: 'Homebrew', mismatch: true});
    await writeFile(join(root, 'package.json'), JSON.stringify({engines: {bun: '>=1.0'}}));
    resetServiceCaches();
    assert.equal((await resolve(bunRuntime, {cwd: root, root, env: {PATH: cellar}}))?.requested, '>=1.0');
    await writeFile(join(root, '.bun-version'), '1.1.34\n');
    resetServiceCaches();
    assert.deepEqual(await resolve(bunRuntime, {cwd: root, root, env: {PATH: cellar}}), {requested: '1.1.34', requestedFrom: '.bun-version', active: '1.1.34', manager: 'Homebrew'});
    // Hostile package.json content stays inert data; a non-bun packageManager is no request.
    await rm(join(root, '.bun-version'));
    await writeFile(join(root, 'package.json'), JSON.stringify({packageManager: 'pnpm@9.0.0; touch PWNED', engines: 'not an object'}));
    resetServiceCaches();
    assert.equal(await resolve(bunRuntime, {cwd: root, root, env: {PATH: ''}, fields: ['requested']}), undefined);
    assert.equal(await exists(join(tools, 'BUN_RAN')), false, 'bun was never run');
    assert.equal(await exists(join(root, 'PWNED')), false);

    assert.deepEqual(await resolve(nixShell, {cwd: root, env: {IN_NIX_SHELL: 'impure'}}), {state: 'impure'});
    assert.deepEqual(await resolve(nixShell, {cwd: root, env: {IN_NIX_SHELL: '1'}}), {state: 'active'});
    assert.equal(await resolve(nixShell, {cwd: root, env: {}}), undefined);

    assert.deepEqual(await resolve(container, {cwd: root, env: {CODESPACES: 'true'}}), {kind: 'Codespaces'});
    assert.deepEqual(await resolve(container, {cwd: root, env: {REMOTE_CONTAINERS: 'true'}}), {kind: 'Dev Container'});
    const onHost = await resolve(container, {cwd: root, env: {}});
    const markers = (await exists('/.dockerenv')) || (await exists('/run/.containerenv'));
    assert.equal(onHost === undefined, !markers, 'only the real marker files decide, never workspace content');
  } finally { await rm(root, {recursive: true, force: true}); await rm(tools, {recursive: true, force: true}); resetServiceCaches(); }
});
