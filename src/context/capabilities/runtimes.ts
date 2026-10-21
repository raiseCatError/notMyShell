import {homedir} from 'node:os';
import {basename, dirname, isAbsolute, join, normalize} from 'node:path';
import {defineCapability, type CapabilityContext, type CapabilityDefinition} from '../capability.js';
import {findNearest, workspaceRoots, LARGE_METADATA_BYTES, isDirectory, listNames, parseIniData, parseJsonData, parseTomlData, parseToolVersions,
  parseYamlData, readMetadataText, readVersionFile, record, resolveTrustedExecutable, text, versionFromInstallPath, within,
  type ExecutableIdentity} from '../services.js';

/**
 * Runtime facts distinguish what the project asks for (`requested`, from its
 * own declarative files) from what the live shell would run (`active`, from
 * the executable the shell's PATH resolves to). Nothing is executed to learn
 * a version: active versions come from the install location or the runtime's
 * own metadata (Go's VERSION, a JDK's `release`, a virtualenv's pyvenv.cfg,
 * Node's node_version.h, Python's versioned interpreter, rustup settings).
 * When none of that exists the active version is honestly unknown.
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
  const roots = workspaceRoots(context.cwd, context.root, context.home);
  for (const name of names) {
    const result = await resolveTrustedExecutable(name, context.env.values.PATH, roots);
    if (result === 'not-found') continue;
    if (typeof result === 'string') return {refused: result === 'workspace' ? `${name} on PATH is inside this workspace; not inspected`
      : `${name} on PATH has unsafe ownership or permissions; not inspected`};
    return result;
  }
  return undefined;
}

/** Node's own header, installed beside the binary by official builds, nvm, n and most packages: `<prefix>/include/node/node_version.h`. */
async function nodeHeaderVersion(binary: ExecutableIdentity): Promise<string | undefined> {
  const header = await readMetadataText(join(dirname(dirname(binary.realpath)), 'include', 'node', 'node_version.h'));
  const part = (name: string) => new RegExp(`^#define NODE_${name}_VERSION (\\d{1,4})\\s*$`, 'mu').exec(header ?? '')?.[1];
  const [major, minor, patch] = [part('MAJOR'), part('MINOR'), part('PATCH')];
  return major && minor && patch ? `${major}.${minor}.${patch}` : undefined;
}

/** A versioned interpreter (python3.12) or the single `lib/pythonX.Y` beside it. */
async function pythonInstallVersion(binary: ExecutableIdentity): Promise<string | undefined> {
  const named = /python(\d+\.\d+)$/u.exec(binary.realpath)?.[1];
  if (named) return named;
  const libraries = (await listNames(join(dirname(dirname(binary.realpath)), 'lib'), 256)).flatMap(name => /^python(\d+\.\d+)$/u.exec(name)?.[1] ?? []);
  return libraries.length === 1 ? libraries[0] : undefined;
}

async function activeVersion(context: CapabilityContext, names: readonly string[], metadata?: (binary: ExecutableIdentity) => Promise<string | undefined>,
  {metadataFirst = false} = {}): Promise<Active> {
  if (!context.fields.has('active') && !context.fields.has('manager')) return {};
  const binary = await trustedBinary(context, names);
  if (!binary) return {};
  if ('refused' in binary) return {note: binary.refused};
  if (binary.shim) return {manager: binary.shim};
  const layout = versionFromInstallPath(binary.realpath);
  // A runtime bundled inside another SDK (Dart inside Flutter) sits in that SDK's install path: its own metadata is the authority.
  if (layout && metadataFirst && metadata && context.fields.has('active')) {
    const own = await metadata(binary);
    if (own) return {active: own, manager: layout.manager};
  }
  if (layout) return {active: layout.version, manager: layout.manager};
  const declared = metadata && context.fields.has('active') ? await metadata(binary) : undefined;
  return declared ? {active: declared} : {};
}

function runtimeCapability(id: string, title: string, reads: readonly string[], env: readonly string[], preview: RuntimeFact,
  resolve: (context: CapabilityContext) => Promise<{value: RuntimeFact; evidence: string} | undefined>): CapabilityDefinition<RuntimeFact> {
  return defineCapability<RuntimeFact>({id, title, reads, scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'workspace',
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
  'the node executable the shell resolves: its install location and node_version.h (never run)'], [],
{requested: '22', requestedFrom: '.nvmrc', active: '22.11.0', manager: 'Homebrew'}, async context => {
  let requested = await versionFile(context, ['.nvmrc', '.node-version']);
  const manifest = await findNearest(context, ['package.json']);
  const pkg = manifest ? parseJsonData(await readMetadataText(manifest.path, LARGE_METADATA_BYTES)) : undefined;
  requested ??= record(pkg) && record(pkg.volta) && text(pkg.volta.node, 64) ? {version: text((pkg.volta as Record<string, unknown>).node, 64)!, from: 'package.json volta'} : undefined;
  requested ??= await toolRequest(context, ['node', 'nodejs']);
  requested ??= record(pkg) && record(pkg.engines) && text(pkg.engines.node, 64) ? {version: text((pkg.engines as Record<string, unknown>).node, 64)!, from: 'package.json engines'} : undefined;
  const active = await activeVersion(context, ['node'], nodeHeaderVersion);
  const value = compact({requested: requested?.version.replace(/^v(?=\d)/u, ''), requestedFrom: requested?.from, ...active,
    active: active.active?.replace(/^v(?=\d)/u, '')});
  return value ? {value, evidence: [requested?.from, active.active ? 'node on PATH' : undefined].filter(Boolean).join(', ') || 'node on PATH'} : undefined;
});

export const pythonRuntime = runtimeCapability('runtime.python', 'Python version and environment', ['VIRTUAL_ENV and its pyvenv.cfg', 'CONDA_DEFAULT_ENV/CONDA_PREFIX conda-meta',
  '.python-version', 'pyproject.toml requires-python', '.tool-versions', 'mise.toml', 'the python executable the shell resolves: its install location (never run)'],
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
  const resolved = active ? {} : await activeVersion(context, ['python3', 'python'], pythonInstallVersion);
  const value = compact({requested: requested?.version, requestedFrom: requested?.from, environment, environmentKind, ...resolved, active: active ?? resolved.active});
  return value ? {value, evidence: [environment ? `${environmentKind} environment` : undefined, requested?.from].filter(Boolean).join(', ') || 'python on PATH'} : undefined;
});

export const goRuntime = runtimeCapability('runtime.go', 'Go toolchain', ['go.mod / go.work (go, toolchain)', '.go-version', '.tool-versions', 'mise.toml',
  'the go executable the shell resolves and its GOROOT VERSION file'], [],
{requested: '1.23', requestedFrom: 'go.mod', active: '1.23.2', manager: 'Homebrew'}, async context => {
  let requested: {version: string; from: string} | undefined;
  const module = await findNearest(context, ['go.work', 'go.mod']);
  if (module) {
    const content = await readMetadataText(module.path) ?? '';
    // Directives are single lines: horizontal whitespace only, so a hostile file cannot make a match span lines.
    const toolchain = /^toolchain[ \t]+go(\d[\w.+-]{0,31})[ \t]*(?:\/\/[^\n]*)?\r?$/mu.exec(content)?.[1];
    const go = /^go[ \t]+(\d[\w.+-]{0,31})[ \t]*(?:\/\/[^\n]*)?\r?$/mu.exec(content)?.[1];
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

export const rubyRuntime = runtimeCapability('runtime.ruby', 'Ruby version', ['.ruby-version', 'Gemfile (ruby "x")', '.tool-versions', 'mise.toml',
  'the ruby executable the shell resolves: its install location (never run)'], [],
{requested: '3.3', requestedFrom: '.ruby-version', active: '3.3.5', manager: 'rbenv', buildTool: 'bundler'}, async context => {
  let requested = await versionFile(context, ['.ruby-version']);
  const gemfile = await findNearest(context, ['Gemfile']);
  if (!requested && gemfile) {
    const declared = /^[ \t]*ruby[ \t]+['"](\d[\w.+-]{0,31})['"]/mu.exec(await readMetadataText(gemfile.path, 64 * 1024) ?? '')?.[1];
    if (declared) requested = {version: declared, from: 'Gemfile'};
  }
  requested ??= await toolRequest(context, ['ruby']);
  if (!requested && !gemfile && !context.fields.has('active')) return undefined;
  const active = await activeVersion(context, ['ruby']);
  const value = compact({requested: requested?.version.replace(/^ruby-(?=\d)/u, ''), requestedFrom: requested?.from, ...active, ...(gemfile ? {buildTool: 'bundler'} : {})});
  return value ? {value, evidence: [requested?.from, gemfile?.name, active.active ? 'ruby on PATH' : undefined].filter(Boolean).join(', ') || 'ruby'} : undefined;
});

export const phpRuntime = runtimeCapability('runtime.php', 'PHP version', ['.php-version', 'composer.json (require.php)', '.tool-versions', 'mise.toml',
  'the php executable the shell resolves: its install location (never run)'], [],
{requested: '8.3', requestedFrom: '.php-version', active: '8.3.12', manager: 'Homebrew', buildTool: 'composer'}, async context => {
  let requested = await versionFile(context, ['.php-version']);
  const manifest = await findNearest(context, ['composer.json']);
  if (!requested && manifest) {
    const pkg = parseJsonData(await readMetadataText(manifest.path, LARGE_METADATA_BYTES));
    const constraint = record(pkg) && record(pkg.require) ? text(pkg.require.php, 64) : undefined;
    if (constraint) requested = {version: constraint, from: 'composer.json'};
  }
  requested ??= await toolRequest(context, ['php']);
  if (!requested && !manifest && !context.fields.has('active')) return undefined;
  const active = await activeVersion(context, ['php']);
  const value = compact({requested: requested?.version, requestedFrom: requested?.from, ...active, ...(manifest ? {buildTool: 'composer'} : {})});
  return value ? {value, evidence: [requested?.from, manifest?.name, active.active ? 'php on PATH' : undefined].filter(Boolean).join(', ') || 'php'} : undefined;
});


/** The shared shape of the smaller runtimes: a requested version from the project's own files, an active one from the install path. */
function simpleRuntime(id: string, title: string, binary: string, reads: readonly string[], preview: RuntimeFact,
  requestedVersion: (context: CapabilityContext) => Promise<{version: string; from: string; tool?: string} | undefined>, present: readonly string[],
  toolNames: readonly string[] = [binary], metadata?: (binary: ExecutableIdentity) => Promise<string | undefined>, metadataFirst = false): CapabilityDefinition<RuntimeFact> {
  return runtimeCapability(id, title, [...reads, `the ${binary} executable the shell resolves: its install location (never run)`], [], preview, async context => {
    const manifest = present.length ? await findNearest(context, present) : undefined;
    // A manifest can name the build tool without stating a version (an empty `version`): the version file or .tool-versions may still say one.
    const declared = await requestedVersion(context);
    const fallback = declared?.version ? undefined : await toolRequest(context, toolNames);
    const requested: {version: string; from: string; tool?: string} | undefined = fallback ? {...fallback, ...(declared?.tool ? {tool: declared.tool} : {})}
      : declared?.version ? declared : undefined;
    if (!requested && !manifest && !context.fields.has('active')) return undefined;
    const active = await activeVersion(context, [binary], metadata, {metadataFirst});
    const tool = requested?.tool ?? declared?.tool;
    const value = compact({requested: requested?.version, requestedFrom: requested?.from, ...active, ...(tool ? {buildTool: tool} : {})});
    return value ? {value, evidence: [requested?.from, manifest?.name, active.active ? `${binary} on PATH` : undefined].filter(Boolean).join(', ') || binary} : undefined;
  });
}

export const dotnetRuntime = simpleRuntime('runtime.dotnet', '.NET SDK', 'dotnet', ['global.json (sdk.version)', '.tool-versions', 'mise.toml'],
  {requested: '8.0.100', requestedFrom: 'global.json', active: '8.0.404', manager: 'Homebrew'}, async context => {
    const found = await findNearest(context, ['global.json']);
    const data = found ? parseJsonData(await readMetadataText(found.path, 64 * 1024)) : undefined;
    const version = record(data) && record(data.sdk) ? text((data.sdk as Record<string, unknown>).version, 64) : undefined;
    // global.json's version is a floor unless rollForward is "disable": a newer SDK satisfies it, so it is not judged as a mismatch.
    const exact = record(data) && record(data.sdk) && (data.sdk as Record<string, unknown>).rollForward === 'disable';
    return version ? {version: exact ? version : `≥${version}`, from: 'global.json'} : undefined;
  }, ['global.json'], ['dotnet', 'dotnet-core']);

export const swiftRuntime = simpleRuntime('runtime.swift', 'Swift toolchain', 'swift', ['.swift-version', 'Package.swift (swift-tools-version)', '.tool-versions', 'mise.toml'],
  {requested: '5.9', requestedFrom: 'Package.swift', active: '5.10.1', manager: 'Homebrew', buildTool: 'swiftpm'}, async context => {
    const file = await versionFile(context, ['.swift-version']);
    if (file) return file;
    const manifest = await findNearest(context, ['Package.swift']);
    // SwiftPM reads the declaration from the first line only; swift-tools-version is the oldest toolchain that can build the package, not a pin.
    const first = manifest ? (await readMetadataText(manifest.path, LARGE_METADATA_BYTES))?.split('\n', 1)[0] : undefined;
    const tools = /^\/\/[ \t]*swift-tools-version[ \t]*:[ \t]*(\d+(?:\.\d+){0,2})/u.exec(first ?? '')?.[1];
    return tools ? {version: `≥${tools}`, from: 'Package.swift', tool: 'swiftpm'} : undefined;
  }, ['Package.swift']);

export const zigRuntime = simpleRuntime('runtime.zig', 'Zig toolchain', 'zig', ['build.zig.zon (minimum_zig_version)', '.zigversion', '.tool-versions', 'mise.toml'],
  {requested: '0.13.0', requestedFrom: 'build.zig.zon', active: '0.13.0', manager: 'Homebrew'}, async context => {
    const file = await versionFile(context, ['.zigversion']);
    if (file) return file;
    const manifest = await findNearest(context, ['build.zig.zon']);
    const minimum = manifest ? /\.minimum_zig_version\s*=\s*"(\d[\w.+-]{0,31})"/u.exec(await readMetadataText(manifest.path) ?? '')?.[1] : undefined;
    // minimum_zig_version is a floor, not a pin.
    return minimum ? {version: `≥${minimum}`, from: 'build.zig.zon'} : undefined;
  }, ['build.zig', 'build.zig.zon']);

export const denoRuntime = simpleRuntime('runtime.deno', 'Deno runtime', 'deno', ['.dvmrc', 'deno.json / deno.jsonc presence', '.tool-versions', 'mise.toml'],
  {requested: '2.1.0', requestedFrom: '.dvmrc', active: '2.1.4', manager: 'Homebrew'}, async context => versionFile(context, ['.dvmrc']), ['deno.json', 'deno.jsonc', 'deno.lock']);

export const bunRuntime = simpleRuntime('runtime.bun', 'Bun runtime', 'bun', ['.bun-version', 'package.json (packageManager "bun@…", engines.bun)', '.tool-versions', 'mise.toml'],
  {requested: '1.1.30', requestedFrom: 'package.json', active: '1.1.34', manager: 'Homebrew'}, async context => {
    const file = await versionFile(context, ['.bun-version']);
    if (file) return file;
    const manifest = await findNearest(context, ['package.json']);
    const pkg = manifest ? parseJsonData(await readMetadataText(manifest.path, LARGE_METADATA_BYTES)) : undefined;
    if (!record(pkg)) return undefined;
    // Corepack's pin names the package manager and its exact version; engines.bun is a range.
    const pinned = /^bun@(\d[\w.+-]{0,31})$/u.exec(text(pkg.packageManager, 64) ?? '')?.[1];
    if (pinned) return {version: pinned, from: 'package.json packageManager'};
    const range = record(pkg.engines) ? text(pkg.engines.bun, 64) : undefined;
    return range ? {version: range, from: 'package.json engines'} : undefined;
  }, ['bun.lockb', 'bun.lock', 'bunfig.toml']);

/** A release version as an SDK's own version file states it (Dart's `version`, Flutter's `version`): one bounded line, nothing else. */
const RELEASE = /^v?(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]{1,32})?)$/u;
async function releaseFile(path: string): Promise<string | undefined> {
  const line = (await readMetadataText(path, 4096))?.split(/\r?\n/u, 1)[0]?.trim();
  return line ? RELEASE.exec(line)?.[1] : undefined;
}

export const elixirRuntime = simpleRuntime('runtime.elixir', 'Elixir version', 'elixir', ['mix.exs (elixir: requirement)', '.tool-versions', 'mise.toml',
  "the elixir install's lib/elixir/ebin/elixir.app"],
{requested: '~> 1.17', requestedFrom: 'mix.exs', active: '1.17.3', manager: 'Homebrew', buildTool: 'mix'}, async context => {
  const project = await findNearest(context, ['mix.exs']);
  if (!project) return undefined;
  // `elixir: "~> 1.17"` inside project/0: a requirement string, read as text and never evaluated.
  const requirement = /^[ \t]*elixir:[ \t]*"([^"\n]{1,32})"/mu.exec(await readMetadataText(project.path) ?? '')?.[1];
  return {version: requirement?.trim() ?? '', from: 'mix.exs', tool: 'mix'};
}, ['mix.exs'], ['elixir'], async binary => {
  // bin/elixir is a script; the application resource beside it states the release ({vsn,"1.17.3"}).
  const app = await readMetadataText(join(dirname(dirname(binary.realpath)), 'lib', 'elixir', 'ebin', 'elixir.app'), 16 * 1024);
  return /\{vsn,[ \t]*"(\d+\.\d+\.\d+(?:-[\w.]{1,16})?)"\}/u.exec(app ?? '')?.[1];
});

/** pubspec.yaml as data (failsafe YAML): the SDK constraints and whether the package depends on the Flutter SDK. */
async function pubspec(context: CapabilityContext): Promise<{sdk?: string; flutter?: string; usesFlutter: boolean} | undefined> {
  const found = await findNearest(context, ['pubspec.yaml']);
  if (!found) return undefined;
  const data = await parseYamlData(await readMetadataText(found.path));
  if (!record(data)) return {usesFlutter: false};
  const environment = record(data.environment) ? data.environment : {};
  const dependencies = record(data.dependencies) ? data.dependencies : {};
  const usesFlutter = record(dependencies.flutter) && dependencies.flutter.sdk === 'flutter';
  return {sdk: text(environment.sdk, 64), flutter: text(environment.flutter, 64), usesFlutter};
}

export const dartRuntime = simpleRuntime('runtime.dart', 'Dart SDK', 'dart', ['pubspec.yaml (environment.sdk)', '.tool-versions', 'mise.toml',
  "the Dart SDK's own version file (Flutter's bundled SDK under bin/cache/dart-sdk)"],
{requested: '^3.5.0', requestedFrom: 'pubspec.yaml', active: '3.5.4', manager: 'Homebrew', buildTool: 'pub'}, async context => {
  const spec = await pubspec(context);
  return spec ? {version: spec.sdk ?? '', from: 'pubspec.yaml', tool: 'pub'} : undefined;
}, ['pubspec.yaml'], ['dart'], async binary => {
  // The SDK root holds `version`. Flutter's bin/dart is a wrapper in the Flutter root, whose `version` is Flutter's, not Dart's.
  const root = dirname(dirname(binary.realpath));
  const bundled = join(root, 'bin', 'cache', 'dart-sdk');
  return await isDirectory(bundled) ? releaseFile(join(bundled, 'version')) : releaseFile(join(root, 'version'));
}, true);

export const flutterRuntime = runtimeCapability('runtime.flutter', 'Flutter SDK', ['.fvmrc / .fvm/fvm_config.json', 'pubspec.yaml (environment.flutter, a flutter SDK dependency)',
  '.tool-versions', 'mise.toml', "the flutter install's bin/cache/flutter.version.json or version file (never run)"], [],
{requested: '3.24.3', requestedFrom: '.fvmrc', active: '3.24.3', manager: 'FVM'}, async context => {
  let requested: {version: string; from: string} | undefined;
  const fvm = await findNearest(context, ['.fvmrc', join('.fvm', 'fvm_config.json')]);
  if (fvm) {
    const data = parseJsonData(await readMetadataText(fvm.path, 16 * 1024));
    // FVM 3 writes {"flutter": "3.24.3"}; earlier releases {"flutterSdkVersion": "3.10.0"}.
    const version = record(data) ? text(data.flutter, 64) ?? text(data.flutterSdkVersion, 64) : undefined;
    if (version) requested = {version, from: fvm.name === '.fvmrc' ? '.fvmrc' : 'fvm_config.json'};
  }
  const spec = await pubspec(context);
  requested ??= spec?.flutter ? {version: spec.flutter, from: 'pubspec.yaml'} : undefined;
  requested ??= await toolRequest(context, ['flutter']);
  if (!requested && !spec?.usesFlutter && !fvm) return undefined;
  const active = await activeVersion(context, ['flutter'], async binary => {
    const root = dirname(dirname(binary.realpath));
    const cached = parseJsonData(await readMetadataText(join(root, 'bin', 'cache', 'flutter.version.json'), 16 * 1024));
    const framework = record(cached) ? text(cached.frameworkVersion, 64) : undefined;
    return framework && RELEASE.test(framework) ? framework : releaseFile(join(root, 'version'));
  });
  const value = compact({requested: requested?.version, requestedFrom: requested?.from, ...active});
  return value ? {value, evidence: [requested?.from, active.active ? 'flutter on PATH' : undefined].filter(Boolean).join(', ') || 'flutter'} : undefined;
});

export const RUNTIME_CAPABILITIES: readonly CapabilityDefinition<unknown>[] = [nodeRuntime, pythonRuntime, goRuntime, rustRuntime, javaRuntime, rubyRuntime, phpRuntime, dotnetRuntime, swiftRuntime, zigRuntime, denoRuntime, bunRuntime,
  elixirRuntime, dartRuntime, flutterRuntime] as CapabilityDefinition<unknown>[];
