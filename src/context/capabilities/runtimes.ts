import {homedir} from 'node:os';
import {basename, dirname, isAbsolute, join, normalize} from 'node:path';
import {defineCapability, type CapabilityContext, type CapabilityDefinition} from '../capability.js';
import {findNearest, LARGE_METADATA_BYTES, listNames, parseIniData, parseJsonData, parseTomlData, parseToolVersions, probeVersion,
  readMetadataText, readVersionFile, record, resolveTrustedExecutable, text, versionFromInstallPath, within,
  type ExecutableIdentity} from '../services.js';

/**
 * Runtime facts distinguish what the project asks for (`requested`, from its
 * own declarative files) from what the live shell would run (`active`, from
 * the executable the shell's PATH resolves to). Active versions come from the
 * install location or the runtime's own metadata file (Go's VERSION, a JDK's
 * `release`, a virtualenv's pyvenv.cfg, rustup settings); only Node and
 * Python fall back to a bounded `--version` probe of a trusted, non-shim
 * binary, and only when a visible module asks for the active field.
 */
export interface RuntimeFact {
  requested?: string;
  requestedFrom?: string;
  active?: string;
  manager?: string;
  /** Python environment, Rust edition, Java build tool. */
  environment?: string;
  environmentKind?: string;
  buildTool?: string;
  /** Why an active version is unknown (workspace-controlled binary, shim), when that is the honest answer. */
  note?: string;
  /** A concrete requested version (22, 3.12, 1.23.2) that the active one does not match; ranges and channels never count. */
  mismatch?: boolean;
}

const toolRequest = async (context: CapabilityContext, names: readonly string[]): Promise<{version: string; from: string} | undefined> => {
  const found = await findNearest(context, ['.tool-versions', 'mise.toml', '.mise.toml', 'mise.local.toml', '.mise/config.toml', '.config/mise/config.toml']);
  if (!found) return undefined;
  if (found.name === '.tool-versions') {
    const tool = parseToolVersions(await readMetadataText(found.path)).find(item => names.includes(item.name));
    return tool ? {version: tool.version, from: '.tool-versions'} : undefined;
  }
  const tools = parseTomlData(await readMetadataText(found.path))?.tools;
  if (!record(tools)) return undefined;
  for (const name of names) {
    const entry = tools[name];
    const value = typeof entry === 'string' ? entry : Array.isArray(entry) ? entry.find(item => typeof item === 'string')
      : record(entry) ? entry.version : undefined;
    const literal = text(value, 64);
    if (literal) return {version: literal, from: found.name};
  }
  return undefined;
};

async function versionFile(context: CapabilityContext, files: readonly string[]): Promise<{version: string; from: string} | undefined> {
  const found = await findNearest(context, files);
  const version = found ? await readVersionFile(found.path) : undefined;
  return version && found ? {version, from: found.name} : undefined;
}

type Active = {active?: string; manager?: string; note?: string};

async function trustedBinary(context: CapabilityContext, names: readonly string[]): Promise<ExecutableIdentity | {refused: string} | undefined> {
  const roots = [context.cwd, ...(context.root ? [context.root] : [])];
  for (const name of names) {
    const result = await resolveTrustedExecutable(name, context.env.values.PATH, roots);
    if (result === 'not-found') continue;
    if (typeof result === 'string') return {refused: result === 'workspace' ? `${name} on PATH is inside this workspace; not inspected`
      : `${name} on PATH has unsafe ownership or permissions; not inspected`};
    return result;
  }
  return undefined;
}

async function activeVersion(context: CapabilityContext, names: readonly string[], probe?: readonly string[]): Promise<Active> {
  if (!context.fields.has('active') && !context.fields.has('manager')) return {};
  const binary = await trustedBinary(context, names);
  if (!binary) return {};
  if ('refused' in binary) return {note: binary.refused};
  if (binary.shim) return {manager: binary.shim};
  const layout = versionFromInstallPath(binary.realpath);
  if (layout) return {active: layout.version, manager: layout.manager};
  if (!probe || !context.fields.has('active')) return {};
  const probed = await probeVersion(binary, probe, {signal: context.signal});
  return probed ? {active: probed} : {};
}

function runtimeCapability(id: string, title: string, reads: readonly string[], env: readonly string[], preview: RuntimeFact,
  resolve: (context: CapabilityContext) => Promise<{value: RuntimeFact; evidence: string} | undefined>, cost: 'bounded-async' | 'probe' = 'bounded-async'): CapabilityDefinition<RuntimeFact> {
  return defineCapability<RuntimeFact>({id, title, reads, scope: 'workspace', family: cost === 'probe' ? 'probe' : 'metadata', cost, trust: 'workspace',
    sensitivity: 'public', persistence: 'snapshot-safe', fields: ['requested', 'requestedFrom', 'active', 'manager', 'environment', 'environmentKind', 'buildTool', 'note', 'mismatch'],
    env: ['PATH', ...env], ttlMs: 30_000, timeoutMs: 2500, invalidateOn: ['command'], preview, resolve});
}

/** Whether `active` fails a concrete `requested` pin: 22 → 22.x.y, 3.12 → 3.12.z; ranges (^, >=, lts/*) and channels are not judged. */
export function versionMismatch(requested: string | undefined, active: string | undefined): boolean {
  const pin = requested?.replace(/^v(?=\d)/u, '');
  if (!pin || !active || !/^\d+(?:\.\d+){0,2}$/u.test(pin)) return false;
  const want = pin.split('.'), have = active.replace(/^v(?=\d)/u, '').split(/[.+-]/u);
  return want.some((part, index) => have[index] !== part);
}

const compact = (value: RuntimeFact): RuntimeFact | undefined => {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined && item !== '');
  if (!entries.length) return undefined;
  const result = Object.fromEntries(entries) as RuntimeFact;
  return versionMismatch(result.requested, result.active) ? {...result, mismatch: true} : result;
};

export const nodeRuntime = runtimeCapability('runtime.node', 'Node.js version', ['.nvmrc', '.node-version', 'package.json (volta, engines)', '.tool-versions', 'mise.toml',
  'the node executable the shell resolves (install location; a bounded --version probe only for a trusted non-shim binary)'], [],
{requested: '22', requestedFrom: '.nvmrc', active: '22.11.0', manager: 'Homebrew'}, async context => {
  let requested = await versionFile(context, ['.nvmrc', '.node-version']);
  const manifest = await findNearest(context, ['package.json']);
  const pkg = manifest ? parseJsonData(await readMetadataText(manifest.path, LARGE_METADATA_BYTES)) : undefined;
  requested ??= record(pkg) && record(pkg.volta) && text(pkg.volta.node, 64) ? {version: text((pkg.volta as Record<string, unknown>).node, 64)!, from: 'package.json volta'} : undefined;
  requested ??= await toolRequest(context, ['node', 'nodejs']);
  requested ??= record(pkg) && record(pkg.engines) && text(pkg.engines.node, 64) ? {version: text((pkg.engines as Record<string, unknown>).node, 64)!, from: 'package.json engines'} : undefined;
  const active = await activeVersion(context, ['node'], ['--version']);
  const value = compact({requested: requested?.version.replace(/^v(?=\d)/u, ''), requestedFrom: requested?.from, ...active,
    active: active.active?.replace(/^v(?=\d)/u, '')});
  return value ? {value, evidence: [requested?.from, active.active ? 'node on PATH' : undefined].filter(Boolean).join(', ') || 'node on PATH'} : undefined;
}, 'probe');

export const pythonRuntime = runtimeCapability('runtime.python', 'Python version and environment', ['VIRTUAL_ENV and its pyvenv.cfg', 'CONDA_DEFAULT_ENV/CONDA_PREFIX conda-meta',
  '.python-version', 'pyproject.toml requires-python', '.tool-versions', 'mise.toml', 'the python executable the shell resolves'],
['VIRTUAL_ENV', 'VIRTUAL_ENV_PROMPT', 'CONDA_DEFAULT_ENV', 'CONDA_PREFIX', 'POETRY_ACTIVE', 'PIPENV_ACTIVE', 'PYENV_VERSION'],
{requested: '3.12', requestedFrom: '.python-version', active: '3.12.7', environment: '.venv', environmentKind: 'uv'}, async context => {
  const env = context.env.values;
  let environment: string | undefined, environmentKind: string | undefined, active: string | undefined;
  if (env.VIRTUAL_ENV && isAbsolute(env.VIRTUAL_ENV)) {
    environment = env.VIRTUAL_ENV_PROMPT?.replace(/^\((.*)\)\s*$/u, '$1').trim() || basename(env.VIRTUAL_ENV);
    const cfg = parseIniData(`[venv]\n${await readMetadataText(join(env.VIRTUAL_ENV, 'pyvenv.cfg')) ?? ''}`)?.get('venv');
    active = text(cfg?.get('version') ?? cfg?.get('version_info')?.replace(/\.(final|alpha|beta|candidate)\.\d+$/u, ''), 32);
    environmentKind = env.POETRY_ACTIVE ? 'poetry' : env.PIPENV_ACTIVE ? 'pipenv' : cfg?.has('uv') ? 'uv' : cfg?.has('virtualenv') ? 'virtualenv' : 'venv';
  } else if (env.CONDA_DEFAULT_ENV) {
    environment = env.CONDA_DEFAULT_ENV;
    environmentKind = 'conda';
    if (env.CONDA_PREFIX && isAbsolute(env.CONDA_PREFIX)) {
      const meta = (await listNames(join(env.CONDA_PREFIX, 'conda-meta'), 2048)).find(name => /^python-\d+\.\d+\.\d+-.*\.json$/u.test(name));
      active = meta ? /^python-(\d+\.\d+\.\d+)/u.exec(meta)?.[1] : undefined;
    }
  }
  let requested = env.PYENV_VERSION ? {version: env.PYENV_VERSION, from: 'PYENV_VERSION'} : await versionFile(context, ['.python-version']);
  requested ??= await toolRequest(context, ['python']);
  if (!requested) {
    const pyproject = await findNearest(context, ['pyproject.toml']);
    const project = pyproject ? parseTomlData(await readMetadataText(pyproject.path))?.project : undefined;
    const constraint = record(project) ? text(project['requires-python'], 64) : undefined;
    if (constraint) requested = {version: constraint, from: 'pyproject.toml'};
  }
  const resolved = active ? {} : await activeVersion(context, ['python3', 'python'], ['--version']);
  const value = compact({requested: requested?.version, requestedFrom: requested?.from, environment, environmentKind, ...resolved, active: active ?? resolved.active});
  return value ? {value, evidence: [environment ? `${environmentKind} environment` : undefined, requested?.from].filter(Boolean).join(', ') || 'python on PATH'} : undefined;
}, 'probe');

export const goRuntime = runtimeCapability('runtime.go', 'Go toolchain', ['go.mod / go.work (go, toolchain)', '.go-version', '.tool-versions', 'mise.toml',
  'the go executable the shell resolves and its GOROOT VERSION file'], [],
{requested: '1.23', requestedFrom: 'go.mod', active: '1.23.2', manager: 'Homebrew'}, async context => {
  let requested: {version: string; from: string} | undefined;
  const module = await findNearest(context, ['go.work', 'go.mod']);
  if (module) {
    const content = await readMetadataText(module.path) ?? '';
    const toolchain = /^toolchain\s+go(\d[\w.+-]{0,31})\s*$/mu.exec(content)?.[1];
    const go = /^go\s+(\d[\w.+-]{0,31})\s*$/mu.exec(content)?.[1];
    if (toolchain || go) requested = {version: (toolchain ?? go)!, from: module.name};
  }
  requested ??= await versionFile(context, ['.go-version']);
  requested ??= await toolRequest(context, ['go', 'golang']);
  let active: Active = {};
  if (context.fields.has('active') || context.fields.has('manager')) {
    const binary = await trustedBinary(context, ['go']);
    if (binary && 'refused' in binary) active = {note: binary.refused};
    else if (binary?.shim) active = {manager: binary.shim};
    else if (binary) {
      // GOROOT/bin/go → GOROOT/VERSION ("go1.23.2"): the toolchain's own metadata, no process needed.
      const versionText = await readMetadataText(join(dirname(dirname(binary.realpath)), 'VERSION'), 4096);
      const fromFile = /^go(\d+\.\d+(?:\.\d+)?(?:rc\d+|beta\d+)?)/u.exec(versionText ?? '')?.[1];
      const layout = versionFromInstallPath(binary.realpath);
      active = {active: fromFile ?? layout?.version, ...(layout ? {manager: layout.manager} : {})};
    }
  }
  const value = compact({requested: requested?.version, requestedFrom: requested?.from, ...active});
  return value ? {value, evidence: [requested?.from, active.active ? 'go on PATH' : undefined].filter(Boolean).join(', ') || 'go'} : undefined;
});

export const rustRuntime = runtimeCapability('runtime.rust', 'Rust toolchain', ['RUSTUP_TOOLCHAIN', 'rust-toolchain.toml / rust-toolchain', 'Cargo.toml (rust-version, edition)',
  'rustup settings.toml (default and directory overrides)', 'the rustc executable the shell resolves'], ['RUSTUP_TOOLCHAIN', 'RUSTUP_HOME'],
{requested: 'stable', requestedFrom: 'rust-toolchain.toml', active: 'stable-aarch64-apple-darwin', manager: 'rustup', environment: '2021', environmentKind: 'edition'}, async context => {
  const env = context.env.values;
  let requested: {version: string; from: string} | undefined;
  const toolchainFile = await findNearest(context, ['rust-toolchain.toml', 'rust-toolchain']);
  if (toolchainFile) {
    const content = await readMetadataText(toolchainFile.path, 8192);
    const toml = parseTomlData(content);
    const channel = record(toml?.toolchain) ? text(toml.toolchain.channel, 64) : toolchainFile.name === 'rust-toolchain' ? await readVersionFile(toolchainFile.path) : undefined;
    if (channel) requested = {version: channel, from: toolchainFile.name};
  }
  const cargo = await findNearest(context, ['Cargo.toml']);
  const pkg = cargo ? parseTomlData(await readMetadataText(cargo.path))?.package : undefined;
  const edition = record(pkg) ? text(pkg.edition, 8) : undefined;
  const msrv = record(pkg) ? text(pkg['rust-version'], 32) : undefined;
  if (!requested && msrv) requested = {version: msrv, from: 'Cargo.toml rust-version'};
  if (!toolchainFile && !cargo && !env.RUSTUP_TOOLCHAIN && !context.fields.has('active')) return undefined;
  let active: Active = {};
  if (context.fields.has('active') || context.fields.has('manager')) {
    const binary = await trustedBinary(context, ['rustc']);
    if (binary && 'refused' in binary) active = {note: binary.refused};
    else if (binary && binary.shim === 'rustup') {
      // rustup chooses: RUSTUP_TOOLCHAIN, then the toolchain file, then a directory override, then the default.
      const home = env.RUSTUP_HOME && isAbsolute(env.RUSTUP_HOME) ? env.RUSTUP_HOME : join(homedir(), '.rustup');
      const settings = parseTomlData(await readMetadataText(join(home, 'settings.toml'), LARGE_METADATA_BYTES));
      const overrides = record(settings?.overrides) ? settings.overrides : {};
      const override = Object.entries(overrides).filter(([path]) => isAbsolute(path) && within(context.cwd, path))
        .sort(([a], [b]) => b.length - a.length)[0]?.[1];
      const chosen = env.RUSTUP_TOOLCHAIN ?? (toolchainFile && requested?.from === toolchainFile.name ? requested.version : undefined)
        ?? text(override, 128) ?? (settings ? text(settings.default_toolchain, 128) : undefined);
      active = {manager: 'rustup', ...(chosen ? {active: chosen} : {})};
    } else if (binary && !binary.shim) {
      const layout = versionFromInstallPath(binary.realpath);
      active = layout ? {active: layout.version, manager: layout.manager} : {};
    } else if (binary?.shim) active = {manager: binary.shim};
  }
  const value = compact({requested: requested?.version, requestedFrom: requested?.from, ...active, ...(edition ? {environment: edition, environmentKind: 'edition'} : {})});
  return value ? {value, evidence: [requested?.from, active.manager].filter(Boolean).join(', ') || 'rust'} : undefined;
});

export const javaRuntime = runtimeCapability('runtime.java', 'Java runtime and build tool', ['JAVA_HOME/release', '.java-version', '.sdkmanrc', '.tool-versions', 'mise.toml',
  'pom.xml / build.gradle presence (never executed)', 'the java executable the shell resolves and its JDK release file'], ['JAVA_HOME'],
{requested: '21', requestedFrom: '.java-version', active: '21.0.5', buildTool: 'gradle'}, async context => {
  let requested = await versionFile(context, ['.java-version']);
  if (!requested) {
    const sdkman = await findNearest(context, ['.sdkmanrc']);
    const java = sdkman ? /^java=([\w.+-]{1,64})\s*$/mu.exec(await readMetadataText(sdkman.path, 4096) ?? '')?.[1] : undefined;
    if (java) requested = {version: java, from: '.sdkmanrc'};
  }
  requested ??= await toolRequest(context, ['java']);
  const build = await findNearest(context, ['pom.xml', 'build.gradle.kts', 'build.gradle', 'settings.gradle.kts', 'settings.gradle']);
  const buildTool = build ? (build.name === 'pom.xml' ? 'maven' : 'gradle') : undefined;
  if (!requested && !build && !context.env.values.JAVA_HOME && !context.fields.has('active')) return undefined;
  let active: Active = {};
  if (context.fields.has('active')) {
    const releaseVersion = async (home: string) => /^JAVA_VERSION="([^"]{1,32})"/mu.exec(await readMetadataText(join(home, 'release'), 16 * 1024) ?? '')?.[1];
    const javaHome = context.env.values.JAVA_HOME;
    if (javaHome && isAbsolute(javaHome) && !within(normalize(javaHome), context.cwd) && !(context.root && within(normalize(javaHome), context.root))) {
      const version = await releaseVersion(javaHome);
      if (version) active = {active: version, manager: 'JAVA_HOME'};
    }
    if (!active.active) {
      const binary = await trustedBinary(context, ['java']);
      if (binary && 'refused' in binary) active = {note: binary.refused};
      else if (binary?.shim) active = {manager: binary.shim};
      else if (binary) {
        const version = await releaseVersion(dirname(dirname(binary.realpath)));
        const layout = versionFromInstallPath(binary.realpath);
        if (version || layout) active = {active: version ?? layout?.version, ...(layout ? {manager: layout.manager} : {})};
      }
    }
  }
  const value = compact({requested: requested?.version, requestedFrom: requested?.from, ...active, ...(buildTool ? {buildTool} : {})});
  return value ? {value, evidence: [requested?.from, build?.name, active.active ? 'JDK release file' : undefined].filter(Boolean).join(', ') || 'java'} : undefined;
});

export const RUNTIME_CAPABILITIES: readonly CapabilityDefinition<unknown>[] = [nodeRuntime, pythonRuntime, goRuntime, rustRuntime, javaRuntime] as CapabilityDefinition<unknown>[];

