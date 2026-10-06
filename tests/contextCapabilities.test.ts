import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {CapabilityDefinition} from '../src/context/capability.js';
import {projectPackage} from '../src/context/capabilities/project.js';
import {goRuntime, javaRuntime, nodeRuntime, pythonRuntime, rustRuntime, versionMismatch} from '../src/context/capabilities/runtimes.js';
import {direnv, toolVersions} from '../src/context/capabilities/environment.js';
import {docker, helmChart, kubernetes, pulumi, terraform} from '../src/context/capabilities/infrastructure.js';
import {aws, azure, gcp} from '../src/context/capabilities/cloud.js';
import {clock, operatingSystem, sessionDuration, sessionJobs, sessionUser} from '../src/context/capabilities/system.js';
import {gitExtras} from '../src/context/capabilities/vcs.js';
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
